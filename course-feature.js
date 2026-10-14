/* course-feature.js: "Open folder" course sidebar, lesson tree, progress and document viewer */

const CourseFeature = (() => {
  'use strict';

  const nativeApp            = document.getElementById('app');
  const nativeVideo          = document.getElementById('video');
  const nativeFileInput      = document.getElementById('fileInput');
  const nativePlaylistItems  = document.getElementById('playlistItems');
  const nativeDropZone       = document.getElementById('dropZone');
  const nativePlayerWrapper  = document.getElementById('playerWrapper');
  const nativeTopBar         = document.getElementById('topBar');
  const nativeToast          = document.getElementById('toast');

  if (!nativeApp || !nativeVideo || !nativeFileInput || !nativePlaylistItems ||
      !nativeDropZone || !nativePlayerWrapper) {
    console.warn('[CourseFeature] Expected player elements not found — feature disabled.');
    return { init(){} };
  }

  const VIDEO_EXT_RE = /\.(mkv|mov|avi|webm|mp4|m4v|ogv)$/i;
  const TEXT_EXTS = ['txt', 'md', 'markdown', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'xml', 'csv'];

  function isVideoFile(file) {
    return (file.type && file.type.startsWith('video/')) || VIDEO_EXT_RE.test(file.name);
  }
  function getExt(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function isTextFile(file) {
    return TEXT_EXTS.includes(getExt(file.name));
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  let collator;
  try { collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); } catch (e) { collator = null; }
  function naturalCompare(a, b) {
    return collator ? collator.compare(a, b) : String(a).localeCompare(String(b));
  }
  function showToastCF(msg) {
    if (!nativeToast) return;
    nativeToast.textContent = msg;
    nativeToast.classList.add('show');
    clearTimeout(showToastCF._t);
    showToastCF._t = setTimeout(() => nativeToast.classList.remove('show'), 1800);
  }
  function fmtTimeCF(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  let courseTree = null;
  let flatLessons = [];
  let lessonsById = new Map();
  let nativeIndexToLesson = new Map();
  let expandedPaths = new Set();
  let searchQuery = '';
  let courseId = null;
  let courseTitle = 'Course';
  let courseState = null;
  let currentLessonId = null;
  let lessonGeneration = 0;
  let lastPosSaveTs = 0;
  let currentDocObjectUrl = null;

  function buildTreeFromFiles(files) {
    const root = { type: 'folder', name: '', path: '', childMap: new Map(), items: null };
    files.forEach(file => {
      const relPath = file.webkitRelativePath || file.name;
      const parts = relPath.split('/').filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!node.childMap.has(part)) {
          const folderPath = node.path ? node.path + '/' + part : part;
          node.childMap.set(part, { type: 'folder', name: part, path: folderPath, childMap: new Map(), items: null });
        }
        node = node.childMap.get(part);
      }
      const fname = parts[parts.length - 1] || file.name;
      let filePath = node.path ? node.path + '/' + fname : fname;
      let uniquePath = filePath, counter = 1;
      while (node.childMap.has('FILE::' + uniquePath)) {
        uniquePath = filePath + ' (' + (++counter) + ')';
      }
      const kind = isVideoFile(file) ? 'video' : (isTextFile(file) ? 'text' : 'unsupported');
      node.childMap.set('FILE::' + uniquePath, {
        type: 'file', kind, name: fname, path: uniquePath, id: uniquePath, file
      });
    });
    return root;
  }
  function finalizeNode(node) {
    const items = Array.from(node.childMap.values());
    items.sort((a, b) => naturalCompare(a.name, b.name));
    items.forEach(child => { if (child.type === 'folder') finalizeNode(child); });
    node.items = items;
    delete node.childMap;
  }
  function flattenLessons(node, out) {
    (node.items || []).forEach(child => {
      if (child.type === 'file') out.push(child);
      else flattenLessons(child, out);
    });
    return out;
  }
  function computeCourseId(files) {
    const sig = files.map(f => (f.webkitRelativePath || f.name) + ':' + f.size).sort().join('|');
    return 'course_' + hashString(sig) + '_' + files.length;
  }

  const CF_STORAGE_KEY = 'cf_courses_v1';
  function readAllCourseStates() {
    try {
      const raw = localStorage.getItem(CF_STORAGE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }
  function writeAllCourseStates(all) {
    try { localStorage.setItem(CF_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function loadCourseState(id, title) {
    const all = readAllCourseStates();
    if (!all[id]) {
      all[id] = { title, completed: {}, positions: {}, currentLessonId: null, lastOpened: Date.now() };
    } else {
      all[id].title = title;
      all[id].lastOpened = Date.now();
      all[id].completed = all[id].completed || {};
      all[id].positions = all[id].positions || {};
    }
    writeAllCourseStates(all);
    return all[id];
  }
  function persistCourseState() {
    if (!courseId || !courseState) return;
    const all = readAllCourseStates();
    all[courseId] = courseState;
    writeAllCourseStates(all);
  }

  function importVideosIntoNativePlayer(videoLessons, insertAt) {
    if (!videoLessons.length) return;
    if (typeof DataTransfer === 'undefined') {
      showToastCF('This browser can\u2019t auto-import videos into the player.');
      return;
    }
    try {
      const dt = new DataTransfer();
      videoLessons.forEach(l => dt.items.add(l.file));
      nativeFileInput.files = dt.files;
      if (Number.isInteger(insertAt)) nativeFileInput.dataset.insertAt = String(insertAt);
      nativeFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      showToastCF('Could not add videos to the player automatically.');
      return;
    } finally {
      delete nativeFileInput.dataset.insertAt;
    }
    buildNativeIndexMap();
  }

  function buildNativeIndexMap() {
    nativeIndexToLesson = new Map();
    const videoLessons = flatLessons.filter(l => l.kind === 'video');
    if (!videoLessons.length) return;

    videoLessons.forEach(l => { l.nativeIndex = null; });

    const byName = new Map();
    videoLessons.forEach(l => {
      if (!byName.has(l.name)) byName.set(l.name, []);
      byName.get(l.name).push(l);
    });
    const claimedCount = new Map();

    const rows = Array.from(nativePlaylistItems.children);
    const rowNames = rows.map(row => {
      const nd = row.querySelector('.name');
      return nd ? nd.getAttribute('title') : null;
    });

    rows.forEach((row, idx) => {
      const name = rowNames[idx];
      if (name == null) return;
      const candidates = byName.get(name);
      if (!candidates || !candidates.length) return;
      const n = claimedCount.get(name) || 0;
      if (n >= candidates.length) return;
      const lesson = candidates[n];
      claimedCount.set(name, n + 1);
      lesson.nativeIndex = idx;
      nativeIndexToLesson.set(idx, lesson);
      lesson.lastNativeIndex = idx;
      lesson.prevName = idx > 0 ? rowNames[idx - 1] : null;
      lesson.nextName = idx < rowNames.length - 1 ? rowNames[idx + 1] : null;
    });
  }

  function computeRestoreIndex(lesson) {
    const rows = Array.from(nativePlaylistItems.children);
    const names = rows.map(r => {
      const nd = r.querySelector('.name');
      return nd ? nd.getAttribute('title') : null;
    });
    if (lesson.prevName != null) {
      const i = names.indexOf(lesson.prevName);
      if (i !== -1) return i + 1;
    }
    if (lesson.nextName != null) {
      const i = names.indexOf(lesson.nextName);
      if (i !== -1) return i;
    }
    if (lesson.lastNativeIndex != null) return Math.min(lesson.lastNativeIndex, rows.length);
    return null;
  }

  function observeNativePlayer() {
    const obs = new MutationObserver(() => {
      buildNativeIndexMap();
      syncFromNativePlaylist();
    });
    obs.observe(nativePlaylistItems, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    nativeVideo.addEventListener('timeupdate', onNativeTimeUpdate);
    nativeVideo.addEventListener('ended', onNativeEnded);
  }
  function syncFromNativePlaylist() {
    const items = Array.from(nativePlaylistItems.children);
    const idx = items.findIndex(li => li.classList.contains('playing'));
    if (idx === -1) return;
    const lesson = nativeIndexToLesson.get(idx);
    const newLessonId = lesson ? lesson.id : null;
    if (newLessonId !== currentLessonId) {
      hideDocViewer();
      currentLessonId = newLessonId;
      afterLessonChanged();
    }
  }
  function onNativeTimeUpdate() {
    const lesson = lessonsById.get(currentLessonId);
    if (!lesson || lesson.kind !== 'video' || !courseState) return;
    const now = Date.now();
    if (now - lastPosSaveTs >= 4000) {
      lastPosSaveTs = now;
      if (isFinite(nativeVideo.currentTime) && nativeVideo.currentTime > 4) {
        courseState.positions[lesson.id] = nativeVideo.currentTime;
        persistCourseState();
      }
    }
    if (isFinite(nativeVideo.duration) && nativeVideo.duration > 0 &&
        nativeVideo.currentTime / nativeVideo.duration >= 0.9 &&
        !courseState.completed[lesson.id]) {
      markLessonComplete(lesson.id, true);
    }
  }
  function onNativeEnded() {
    const lesson = lessonsById.get(currentLessonId);
    if (lesson && lesson.kind === 'video' && courseState && !courseState.completed[lesson.id]) {
      markLessonComplete(lesson.id, true);
    }
  }

  function activateVideoResume(lesson) {
    lessonGeneration++;
    const myGen = lessonGeneration;
    const savedPos = courseState ? courseState.positions[lesson.id] : null;
    if (!savedPos) return;
    nativeVideo.addEventListener('loadedmetadata', function onMeta() {
      if (myGen !== lessonGeneration) return;
      if (savedPos > 4 && (!isFinite(nativeVideo.duration) || savedPos < nativeVideo.duration - 2)) {
        nativeVideo.currentTime = savedPos;
        showToastCF(`Resumed from ${fmtTimeCF(savedPos)}`);
      }
    }, { once: true });
  }
  function goToLesson(id) {
    const lesson = lessonsById.get(id);
    if (!lesson) return;
    if (lesson.kind === 'video') {
      if (lesson.nativeIndex == null) {
        const restore = confirm(`"${lesson.name}" isn't in the playlist right now (it may have been removed). Restore it and play it?`);
        if (!restore) return;
        importVideosIntoNativePlayer([lesson], computeRestoreIndex(lesson));
        if (lesson.nativeIndex == null) {
          showToastCF('This video could not be restored to the playlist.');
          return;
        }
      }
      const li = nativePlaylistItems.children[lesson.nativeIndex];
      if (!li) { showToastCF('This video could not be loaded into the player.'); return; }
      hideDocViewer();
      activateVideoResume(lesson);
      li.click();
      currentLessonId = id;
    } else {
      try { nativeVideo.pause(); } catch (e) {}
      nativeDropZone.classList.add('hidden');
      nativePlayerWrapper.classList.remove('hidden');
      currentLessonId = id;
      showDocViewer(lesson);
    }
    afterLessonChanged();
  }
  function afterLessonChanged() {
    if (courseState && currentLessonId) {
      courseState.currentLessonId = currentLessonId;
      persistCourseState();
    }
    renderSidebarTree();
    renderProgress();
    updateNavButtons();
    scrollLessonIntoView(currentLessonId);
  }
  function markLessonComplete(id, value) {
    if (!courseState) return;
    if (value) courseState.completed[id] = true; else delete courseState.completed[id];
    persistCourseState();
    renderSidebarTree();
    renderProgress();
    updateNavButtons();
  }
  function scrollLessonIntoView(id) {
    if (!id || !cfTreeContainer) return;
    requestAnimationFrame(() => {
      const el = cfTreeContainer.querySelector(`.cf-lesson-row[data-lesson-id="${cssEscape(id)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function splitCsvLine(line) {
    const out = []; let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }
  function renderCsvTable(text) {
    const lines = text.split(/\r?\n/).filter(l => l.length);
    if (!lines.length) return '<div class="cf-doc-empty">Empty file.</div>';
    const shown = lines.slice(0, 500);
    let html = '<div class="cf-csv-wrap"><table class="cf-csv-table"><tbody>';
    shown.forEach(line => {
      html += '<tr>' + splitCsvLine(line).map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (lines.length > 500) html += `<div class="cf-doc-note">Showing first 500 of ${lines.length} rows.</div>`;
    return html;
  }
  function renderMarkdownLite(src) {
    let html = escapeHtml(src)
      .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
      .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>\s*)+/gs, m => '<ul>' + m + '</ul>');
    html = html.split(/\n{2,}/).map(p => /^<h[1-6]|^<ul/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return html;
  }
  function showDocViewer(lesson) {
    if (currentDocObjectUrl) { URL.revokeObjectURL(currentDocObjectUrl); currentDocObjectUrl = null; }
    cfDocTitle.textContent = lesson.name;
    cfDocBody.innerHTML = '<div class="cf-doc-loading">Loading\u2026</div>';
    cfDocViewer.classList.remove('hidden');

    if (lesson.kind === 'unsupported') {
      const url = URL.createObjectURL(lesson.file);
      currentDocObjectUrl = url;
      const ext = getExt(lesson.name);
      cfDocBody.innerHTML = `<div class="cf-doc-unsupported">
        <p>Preview isn\u2019t available for this file type${ext ? ` (.${escapeHtml(ext)})` : ''}.</p>
        <a href="${url}" download="${escapeHtml(lesson.name)}" class="cf-download-link">Download ${escapeHtml(lesson.name)}</a>
      </div>`;
      return;
    }

    const ext = getExt(lesson.name);
    const reader = new FileReader();
    reader.onerror = () => { cfDocBody.innerHTML = '<div class="cf-doc-error">Could not read this file.</div>'; };
    reader.onload = () => {
      const text = String(reader.result);
      if (ext === 'html' || ext === 'htm') {
        cfDocBody.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.className = 'cf-doc-iframe';
        iframe.setAttribute('sandbox', '');
        cfDocBody.appendChild(iframe);
        iframe.srcdoc = text;
      } else if (ext === 'md' || ext === 'markdown') {
        cfDocBody.innerHTML = `<div class="cf-doc-markdown">${renderMarkdownLite(text)}</div>`;
      } else if (ext === 'csv') {
        cfDocBody.innerHTML = renderCsvTable(text);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'cf-doc-pre';
        pre.textContent = text;
        cfDocBody.innerHTML = '';
        cfDocBody.appendChild(pre);
      }
    };
    reader.readAsText(lesson.file);
  }
  function hideDocViewer() {
    cfDocViewer.classList.add('hidden');
    cfDocBody.innerHTML = '';
    if (currentDocObjectUrl) { URL.revokeObjectURL(currentDocObjectUrl); currentDocObjectUrl = null; }
  }

  function nodeMatchesSearch(node) {
    if (!searchQuery) return true;
    if (node.type === 'file') return node.name.toLowerCase().includes(searchQuery);
    return (node.items || []).some(nodeMatchesSearch);
  }
  function renderTreeLevel(node, container, depth) {
    (node.items || []).forEach(child => {
      if (!nodeMatchesSearch(child)) return;
      if (child.type === 'folder') {
        const expanded = !!searchQuery || expandedPaths.has(child.path);
        const row = document.createElement('div');
        row.className = 'cf-row cf-folder-row';
        row.style.paddingLeft = (depth * 16 + 10) + 'px';
        row.innerHTML = `<span class="cf-caret">${expanded ? '\u25BC' : '\u25B6'}</span>` +
          `<span class="cf-folder-icon">\uD83D\uDCC1</span><span class="cf-name">${escapeHtml(child.name)}</span>`;
        row.addEventListener('click', () => {
          if (expandedPaths.has(child.path)) expandedPaths.delete(child.path);
          else expandedPaths.add(child.path);
          renderSidebarTree();
        });
        container.appendChild(row);
        if (expanded) renderTreeLevel(child, container, depth + 1);
      } else {
        const isActive = child.id === currentLessonId;
        const isDone = !!(courseState && courseState.completed[child.id]);
        const row = document.createElement('div');
        row.className = 'cf-row cf-lesson-row' + (isActive ? ' active' : '') + (isDone ? ' done' : '');
        row.style.paddingLeft = (depth * 16 + 10) + 'px';
        row.dataset.lessonId = child.id;
        const icon = child.kind === 'video' ? '\u25B6' : (child.kind === 'text' ? '\uD83D\uDCC4' : '\u2754');
        row.innerHTML = `<span class="cf-lesson-icon">${icon}</span><span class="cf-name">${escapeHtml(child.name)}</span>` +
          (isDone ? '<span class="cf-check">\u2713</span>' : '');
        row.addEventListener('click', () => goToLesson(child.id));
        container.appendChild(row);
      }
    });
  }
  function renderSidebarTree() {
    if (!cfTreeContainer) return;
    cfTreeContainer.innerHTML = '';
    if (!courseTree) {
      cfTreeContainer.innerHTML = '<div class="cf-doc-empty">No course loaded yet.</div>';
      return;
    }
    renderTreeLevel(courseTree, cfTreeContainer, 0);
  }
  function renderProgress() {
    const total = flatLessons.length;
    const done = courseState ? flatLessons.filter(l => courseState.completed[l.id]).length : 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    cfProgressFill.style.width = pct + '%';
    cfProgressPct.textContent = pct + '%';
    cfProgressText.textContent = `${done} / ${total} completed`;
  }
  function updateNavButtons() {
    const idx = flatLessons.findIndex(l => l.id === currentLessonId);
    cfPrevBtn.disabled = idx <= 0;
    cfNextBtn.disabled = idx === -1 || idx >= flatLessons.length - 1;
    const done = !!(courseState && currentLessonId && courseState.completed[currentLessonId]);
    cfMarkBtn.textContent = done ? '\u2713 Completed' : 'Mark Complete';
    cfMarkBtn.classList.toggle('cf-done', done);
    cfMarkBtn.disabled = !currentLessonId;
  }

  function importCourseFolder(fileList) {
    const files = Array.from(fileList).filter(f => f.name);
    if (!files.length) { showToastCF('No files found in that folder.'); return; }

    const root = buildTreeFromFiles(files);
    finalizeNode(root);

    let title = 'Course', treeRoot = root;
    if (root.items.length === 1 && root.items[0].type === 'folder') {
      treeRoot = root.items[0];
      title = treeRoot.name;
    }

    flatLessons = flattenLessons(treeRoot, []);
    lessonsById = new Map(flatLessons.map(l => [l.id, l]));
    nativeIndexToLesson = new Map();
    courseTree = treeRoot;
    courseTitle = title;
    expandedPaths = new Set();
    searchQuery = '';
    cfSearchInput.value = '';

    const videoLessons = flatLessons.filter(l => l.kind === 'video');
    importVideosIntoNativePlayer(videoLessons);

    courseId = computeCourseId(files);
    courseState = loadCourseState(courseId, title);

    cfCourseTitle.textContent = title;

    renderSidebarTree();
    renderProgress();
    updateNavButtons();

    nativeDropZone.classList.add('hidden');
    nativePlayerWrapper.classList.remove('hidden');
    cfSidebar.classList.remove('hidden');

    const resumeId = (courseState.currentLessonId && lessonsById.has(courseState.currentLessonId))
      ? courseState.currentLessonId
      : (flatLessons[0] && flatLessons[0].id);
    if (resumeId) goToLesson(resumeId);

    showToastCF(`Loaded "${title}" \u2014 ${flatLessons.length} lesson${flatLessons.length !== 1 ? 's' : ''}`);
  }

  let cfFolderInput, cfSidebar, cfCourseTitle, cfProgressFill, cfProgressPct, cfProgressText,
      cfSearchInput, cfTreeContainer, cfPrevBtn, cfMarkBtn, cfNextBtn,
      cfDocViewer, cfDocTitle, cfDocBody, cfTopBtn;

  function buildUIShell() {
    cfFolderInput = document.createElement('input');
    cfFolderInput.type = 'file';
    cfFolderInput.id = 'cfFolderInput';
    cfFolderInput.hidden = true;
    cfFolderInput.multiple = true;
    cfFolderInput.setAttribute('webkitdirectory', '');
    cfFolderInput.setAttribute('directory', '');
    cfFolderInput.addEventListener('change', e => {
      const files = e.target.files;
      if (files && files.length) importCourseFolder(files);
      cfFolderInput.value = '';
    });
    document.body.appendChild(cfFolderInput);

    const dropInner = document.querySelector('.drop-inner');
    if (dropInner) {
      const divider = document.createElement('div');
      divider.className = 'or-divider cf-divider';
      divider.textContent = 'or';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'cfOpenFolderBtnDrop';
      btn.className = 'cf-open-folder-btn';
      btn.textContent = '\uD83D\uDCC2 Open folder';
      btn.addEventListener('click', () => cfFolderInput.click());
      dropInner.appendChild(divider);
      dropInner.appendChild(btn);
    }

    if (nativeTopBar) {
      cfTopBtn = document.createElement('button');
      cfTopBtn.type = 'button';
      cfTopBtn.id = 'cfTopBarBtn';
      cfTopBtn.className = 'icon-btn';
      cfTopBtn.title = 'Course content';
      cfTopBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5a1.5 1.5 0 0 0 0 3H20v2H6.5A2.5 2.5 0 0 1 4 19.5zM6.5 4A.5.5 0 0 0 6 4.5V17c.16-.03.33-.05.5-.05H18V4z"/></svg>';
      cfTopBtn.addEventListener('click', () => {
        if (!courseTree) cfFolderInput.click();
        else cfSidebar.classList.toggle('hidden');
      });
      nativeTopBar.appendChild(cfTopBtn);
    }

    cfSidebar = document.createElement('div');
    cfSidebar.id = 'cfSidebar';
    cfSidebar.className = 'cf-sidebar hidden';
    cfSidebar.innerHTML = `
      <div class="cf-sidebar-inner">
        <div class="cf-sidebar-header">
          <h2 id="cfCourseTitle">Course Content</h2>
          <button type="button" id="cfSidebarCloseBtn" class="cf-icon-btn" title="Close">\u2715</button>
        </div>
        <div class="cf-progress-block">
          <div class="cf-progress-label"><span>Course Progress</span><span id="cfProgressPct">0%</span></div>
          <div class="cf-progress-track"><div id="cfProgressFill" class="cf-progress-fill"></div></div>
          <div id="cfProgressText" class="cf-progress-text">0 / 0 completed</div>
        </div>
        <div class="cf-search-block"><input type="text" id="cfSearchInput" placeholder="Search lessons\u2026"></div>
        <div id="cfTreeContainer" class="cf-tree-container"></div>
        <div class="cf-nav-block">
          <button type="button" id="cfPrevBtn" class="cf-nav-btn">\u2190 Previous</button>
          <button type="button" id="cfMarkBtn" class="cf-mark-btn">Mark Complete</button>
          <button type="button" id="cfNextBtn" class="cf-nav-btn">Next \u2192</button>
        </div>
      </div>`;
    nativeApp.appendChild(cfSidebar);

    cfCourseTitle   = cfSidebar.querySelector('#cfCourseTitle');
    cfProgressFill  = cfSidebar.querySelector('#cfProgressFill');
    cfProgressPct   = cfSidebar.querySelector('#cfProgressPct');
    cfProgressText  = cfSidebar.querySelector('#cfProgressText');
    cfSearchInput   = cfSidebar.querySelector('#cfSearchInput');
    cfTreeContainer = cfSidebar.querySelector('#cfTreeContainer');
    cfPrevBtn       = cfSidebar.querySelector('#cfPrevBtn');
    cfMarkBtn       = cfSidebar.querySelector('#cfMarkBtn');
    cfNextBtn       = cfSidebar.querySelector('#cfNextBtn');

    cfSidebar.querySelector('#cfSidebarCloseBtn').addEventListener('click', () => cfSidebar.classList.add('hidden'));
    cfSearchInput.addEventListener('input', () => { searchQuery = cfSearchInput.value.trim().toLowerCase(); renderSidebarTree(); });
    cfPrevBtn.addEventListener('click', () => {
      const idx = flatLessons.findIndex(l => l.id === currentLessonId);
      if (idx > 0) goToLesson(flatLessons[idx - 1].id);
    });
    cfNextBtn.addEventListener('click', () => {
      const idx = flatLessons.findIndex(l => l.id === currentLessonId);
      if (idx >= 0 && idx < flatLessons.length - 1) goToLesson(flatLessons[idx + 1].id);
    });
    cfMarkBtn.addEventListener('click', () => {
      if (!currentLessonId || !courseState) return;
      markLessonComplete(currentLessonId, !courseState.completed[currentLessonId]);
    });

    cfDocViewer = document.createElement('div');
    cfDocViewer.id = 'cfDocViewer';
    cfDocViewer.className = 'cf-doc-viewer hidden';
    cfDocViewer.innerHTML = `
      <div class="cf-doc-header">
        <span id="cfDocTitle" class="cf-doc-title"></span>
        <span class="cf-doc-hint">Pick another lesson from the sidebar to continue</span>
      </div>
      <div id="cfDocBody" class="cf-doc-body"></div>`;
    nativePlayerWrapper.appendChild(cfDocViewer);
    cfDocTitle = cfDocViewer.querySelector('#cfDocTitle');
    cfDocBody  = cfDocViewer.querySelector('#cfDocBody');
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'cfStyles';
    style.textContent = `
      .cf-open-folder-btn{
        margin-top:14px;background:#2a2a2a;color:#fff;border:1px solid #3a3a3a;
        padding:10px 22px;border-radius:20px;font-size:.88rem;font-weight:600;cursor:pointer;
        transition:filter var(--dur-base,260ms) var(--ease-smooth,ease-out), transform var(--dur-fast,140ms) var(--ease-spring,ease-out);
      }
      .cf-open-folder-btn:hover{ filter:brightness(1.15); transform:translateY(-1px) scale(1.02); }
      .cf-open-folder-btn:active{ transform:scale(.96); transition-duration:80ms; }
      .cf-sidebar{
        width:320px;flex-shrink:0;background:var(--panel);border-left:1px solid var(--border);
        opacity:1;
        overflow:hidden;
        transition:width var(--dur-slow,420ms) var(--ease-snap,ease-in-out),
                   opacity var(--dur-base,260ms) var(--ease-smooth,ease-out),
                   border-color var(--dur-base,260ms) var(--ease-smooth,ease-out);
      }
      .cf-sidebar.hidden{ width:0; opacity:0; border-color:transparent; }
      .cf-sidebar-inner{
        width:320px;height:100%;flex-shrink:0;
        display:flex;flex-direction:column;color:var(--text);
      }
      .cf-sidebar-header{
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0;
      }
      .cf-sidebar-header h2{ font-size:1rem;margin:0;font-weight:600;white-space:nowrap; }
      .cf-icon-btn{
        background:none;border:none;color:#aaa;width:26px;height:26px;border-radius:50%;
        cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85rem;
        flex-shrink:0;
      }
      .cf-icon-btn:hover{ background:rgba(255,255,255,.12);color:#fff; }
      .cf-progress-block{ padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0; }
      .cf-progress-label{ display:flex;justify-content:space-between;font-size:.8rem;color:var(--text-dim);margin-bottom:6px; }
      .cf-progress-track{ height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden; }
      .cf-progress-fill{ height:100%;width:0%;background:var(--accent);transition:width .25s ease; }
      .cf-progress-text{ font-size:.76rem;color:var(--text-dim);margin-top:6px; }
      .cf-search-block{ padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0; }
      .cf-search-block input{
        width:100%;background:#0f0f0f;border:1px solid #3a3a3a;color:var(--text);
        padding:7px 10px;border-radius:14px;font-size:.8rem;outline:none;box-sizing:border-box;
      }
      .cf-search-block input:focus{ border-color:var(--accent); }
      .cf-tree-container{ flex:1;overflow-y:auto;padding:6px 0; }
      .cf-row{
        display:flex;align-items:center;gap:6px;padding:7px 10px 7px 0;
        cursor:pointer;font-size:.82rem;color:#ddd;white-space:nowrap;overflow:hidden;
        transition:background var(--dur-fast,140ms) var(--ease-smooth,ease-out), transform var(--dur-fast,140ms) var(--ease-smooth,ease-out);
      }
      .cf-row .cf-name{ overflow:hidden;text-overflow:ellipsis; }
      .cf-folder-row:hover, .cf-lesson-row:hover{ background:var(--panel-2); transform:translateX(2px); }
      .cf-row:active{ transform:scale(.98); }
      .cf-lesson-row.active{ background:#2a2a2a;color:#fff; }
      .cf-lesson-row.active .cf-name{ color:var(--accent); }
      .cf-lesson-row.done .cf-check{ color:#4caf50;margin-left:auto;padding-left:6px;flex-shrink:0; }
      .cf-caret{ width:14px;flex-shrink:0;font-size:.68rem;color:#888; }
      .cf-folder-icon,.cf-lesson-icon{ flex-shrink:0;font-size:.85rem; }
      .cf-nav-block{
        display:flex;gap:6px;padding:12px 14px;border-top:1px solid var(--border);flex-shrink:0;
      }
      .cf-nav-btn,.cf-mark-btn{
        border:none;border-radius:16px;padding:8px 6px;font-size:.78rem;font-weight:600;cursor:pointer;flex:1;
        background:#2a2a2a;color:#eee;
        transition:filter var(--dur-fast,140ms) var(--ease-smooth,ease-out), transform var(--dur-fast,140ms) var(--ease-spring,ease-out);
      }
      .cf-nav-btn:disabled,.cf-mark-btn:disabled{ opacity:.4;cursor:default; }
      .cf-nav-btn:not(:disabled):hover,.cf-mark-btn:not(:disabled):hover{ filter:brightness(1.2); transform:scale(1.03); }
      .cf-nav-btn:not(:disabled):active,.cf-mark-btn:not(:disabled):active{ transform:scale(.96); }
      .cf-mark-btn{ background:var(--accent);color:#fff;flex:1.3; }
      .cf-mark-btn.cf-done{ background:#2a2a2a;color:#4caf50; }

      .cf-doc-viewer{
        position:absolute;inset:0;background:var(--bg);z-index:9;
        display:flex;flex-direction:column;
      }
      .cf-doc-viewer.hidden{ display:none; }
      .cf-doc-header{
        flex-shrink:0;padding:14px 18px;border-bottom:1px solid var(--border);
        display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
      }
      .cf-doc-title{ font-size:1rem;font-weight:600;color:#fff; }
      .cf-doc-hint{ font-size:.76rem;color:var(--text-dim); }
      .cf-doc-body{ flex:1;overflow:auto;padding:20px 26px;color:#ddd; }
      .cf-doc-pre{
        white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;
        font-size:.85rem;line-height:1.5;margin:0;color:#ddd;
      }
      .cf-doc-markdown{ line-height:1.6;max-width:760px; }
      .cf-doc-markdown h1,.cf-doc-markdown h2,.cf-doc-markdown h3{ color:#fff; }
      .cf-doc-markdown code{ background:#222;padding:1px 5px;border-radius:4px;font-size:.85em; }
      .cf-doc-iframe{ width:100%;height:100%;border:none;background:#fff;border-radius:6px; }
      .cf-csv-wrap{ overflow:auto;max-width:100%; }
      .cf-csv-table{ border-collapse:collapse;font-size:.8rem; }
      .cf-csv-table td{ border:1px solid #333;padding:5px 9px;white-space:nowrap; }
      .cf-doc-note,.cf-doc-empty,.cf-doc-error{ color:var(--text-dim);font-size:.8rem;margin-top:10px; }
      .cf-doc-unsupported{ text-align:center;padding:40px 10px;color:var(--text-dim); }
      .cf-download-link{
        display:inline-block;margin-top:14px;background:var(--accent);color:#fff;text-decoration:none;
        padding:9px 20px;border-radius:18px;font-weight:600;font-size:.85rem;
      }

      @media (max-width:760px){
        .cf-sidebar{ position:absolute;right:0;top:0;bottom:0;z-index:15;width:82vw;max-width:320px; }
        .cf-sidebar.hidden{ width:0; }
        .cf-doc-body{ padding:16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    buildUIShell();
    observeNativePlayer();
    renderSidebarTree();
    renderProgress();
    updateNavButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, importCourseFolder };
})();
