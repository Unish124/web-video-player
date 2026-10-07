/*!
 * course-feature.js
 * Adds "Open Course Folder" support to the existing Local Video Player
 * (mainstable.html) WITHOUT modifying or duplicating its player logic.
 *
 * Integration strategy (see README block at bottom of this file for details):
 *  - Video files are handed to the EXISTING #fileInput via a DataTransfer,
 *    so they flow through the app's own handleFiles()/loadVideo()/state.
 *  - "Playing" a lesson = clicking the matching native <li class="playlist-item">.
 *  - A MutationObserver on #playlistItems keeps this module in sync with
 *    whatever the native player is doing (native Prev/Next, keyboard
 *    shortcuts, autoplay-to-next-video, manual clicks in the native list).
 *  - Text/markdown/code/csv/html files are previewed in a small viewer
 *    this module creates itself (the native app has no file for that).
 *
 * Namespaced under `CourseFeature` — no existing globals, IDs, classes,
 * or event listeners are touched or overwritten.
 */
const CourseFeature = (() => {
  'use strict';

  /* ============================================================
     0. References into the existing app (read-only DOM access)
     ============================================================ */
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

  /* ============================================================
     1. Small helpers (own copies — do not reuse native internals)
     ============================================================ */
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

  /* ============================================================
     2. Module state
     ============================================================ */
  let courseTree = null;          // recursive tree { type:'folder', items:[...] }
  let flatLessons = [];           // DFS-flattened leaf files, natural-sorted
  let lessonsById = new Map();    // id (relative path) -> lesson node
  let nativeIndexToLesson = new Map(); // native playlist index -> lesson node
  let expandedPaths = new Set();  // folder paths currently expanded
  let searchQuery = '';
  let courseId = null;
  let courseTitle = 'Course';
  let courseState = null;         // persisted progress object for this course
  let currentLessonId = null;
  let lessonGeneration = 0;       // invalidates stale "resume seek" callbacks
  let lastPosSaveTs = 0;
  let currentDocObjectUrl = null;

  /* ============================================================
     3. Recursive folder-tree building
     ============================================================ */
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

  /* ============================================================
     4. Persistence (localStorage — namespaced keys, no collisions
        with the native app's lvp_* keys)
     ============================================================ */
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

  /* ============================================================
     5. Feeding videos into the EXISTING player via #fileInput
     ============================================================ */
  // insertAt (optional): playlist index to insert the videos at instead
  // of appending. The native player reads it from the file input's
  // data-insert-at attribute while handling the 'change' event below.
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
    // Build the index map right away (synchronously) so goToLesson() —
    // called immediately after this, e.g. for the initial resume lesson
    // — has correct nativeIndex values without waiting for the
    // MutationObserver's own (asynchronous) rebuild below.
    buildNativeIndexMap();
  }

  // Recomputes which of OUR lessons corresponds to which currently-
  // visible native playlist row, by matching each row's displayed file
  // name against our lesson names — NOT by a fixed position. A fixed
  // index captured once at import time goes stale the moment the native
  // playlist's order changes underneath it, which now happens two ways
  // this module has no control over: the native player's own
  // drag-and-drop reordering, and removing an item (which shifts every
  // later index down by one). Rows that don't match any of our lessons
  // (e.g. videos from a different, previously-imported course sitting
  // in the same native playlist) are simply left unmapped.
  function buildNativeIndexMap() {
    nativeIndexToLesson = new Map();
    const videoLessons = flatLessons.filter(l => l.kind === 'video');
    if (!videoLessons.length) return;

    // Reset every lesson's index BEFORE re-matching. Without this, a
    // lesson whose native row was removed (e.g. via the playlist's ✕
    // button) would keep its old, now-stale nativeIndex forever, since
    // the matching loop below only ever SETS an index for lessons it
    // successfully finds — it never clears one for lessons it doesn't.
    // That stale index would then point at whatever row happens to have
    // shifted into that position, which is how "click lesson 5, video 6
    // plays instead" happens. Resetting to null first means a lesson
    // that isn't found ends up with nativeIndex === null, which
    // goToLesson() uses to detect "this video isn't in the playlist
    // right now" and offer to restore it.
    videoLessons.forEach(l => { l.nativeIndex = null; });

    // Group by display name (usually one lesson per name, but two
    // lessons in different folders can share a file name) so repeats
    // pair up in the same relative order on both sides.
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
      if (!candidates || !candidates.length) return; // not one of this course's lessons
      const n = claimedCount.get(name) || 0;
      if (n >= candidates.length) return; // more native rows with this name than lessons for it
      const lesson = candidates[n];
      claimedCount.set(name, n + 1);
      lesson.nativeIndex = idx;
      nativeIndexToLesson.set(idx, lesson);
      // Remember where this lesson sits (and who its neighbours are)
      // every time it's seen in the playlist. Once it's removed these
      // stop updating, so they keep describing its LAST position — which
      // is what computeRestoreIndex() uses to put it back in place.
      lesson.lastNativeIndex = idx;
      lesson.prevName = idx > 0 ? rowNames[idx - 1] : null;
      lesson.nextName = idx < rowNames.length - 1 ? rowNames[idx + 1] : null;
    });
  }

  // Where to re-insert a removed lesson so it lands back where it was.
  // Prefer the neighbour that used to be right before it (insert after
  // it), then the one right after it (insert before it) — that stays
  // correct even if OTHER items were removed or moved in the meantime,
  // which a plain remembered index would not. Falls back to the old
  // index, then to null (= append) if nothing is known.
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

  /* ============================================================
     6. Staying in sync with the native player
     ============================================================ */
  function observeNativePlayer() {
    const obs = new MutationObserver(() => {
      // Any DOM change to the native list — a full rebuild, a
      // reorder, or the '.playing' class moving — means the name-based
      // mapping needs recomputing before we trust it.
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
    // If the currently-playing native row isn't one of this course's
    // lessons at all (e.g. the person clicked a video left over from a
    // different, previously-imported course), newLessonId ends up null
    // — which correctly clears any stale highlight in the sidebar
    // instead of leaving the last-matched lesson looking "active" while
    // something unrelated actually plays.
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

  /* ============================================================
     7. Navigation
     ============================================================ */
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
        // This lesson's video isn't currently among the native "Now
        // Playing" rows — almost always because the person removed it
        // there with the playlist's ✕ button. Confirm before silently
        // re-adding it, rather than failing outright or (the bug this
        // fixes) ending up playing whatever unrelated video happens to
        // now sit at a stale leftover index.
        const restore = confirm(`"${lesson.name}" isn't in the playlist right now (it may have been removed). Restore it and play it?`);
        if (!restore) return;
        importVideosIntoNativePlayer([lesson], computeRestoreIndex(lesson)); // re-adds the file at its old spot; rebuilds the index map synchronously
        if (lesson.nativeIndex == null) {
          showToastCF('This video could not be restored to the playlist.');
          return;
        }
      }
      const li = nativePlaylistItems.children[lesson.nativeIndex];
      if (!li) { showToastCF('This video could not be loaded into the player.'); return; }
      hideDocViewer();
      activateVideoResume(lesson);
      li.click(); // native loadVideo() runs exactly as if the user clicked it
      currentLessonId = id; // optimistic; MutationObserver reconciles if needed
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
    // Only persist a resume point when a lesson from THIS course is
    // actually active. If currentLessonId just went null (the person
    // played something unrelated in the native playlist), we still want
    // to update the sidebar highlight to reflect that — but we don't
    // want to clobber the saved "resume from here" position with
    // nothing in the process.
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

  /* ============================================================
     8. Document / text viewer (overlaid on the existing player)
     ============================================================ */
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
        iframe.setAttribute('sandbox', ''); // no scripts, no same-origin
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

  /* ============================================================
     9. Sidebar rendering (recursive — no assumed nesting depth)
     ============================================================ */
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

  /* ============================================================
     10. Import flow
     ============================================================ */
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
    // Start with every folder collapsed. Previously this pre-populated
    // expandedPaths with EVERY folder path in the tree (via
    // collectAllFolderPaths), so a course with several nested subfolders
    // dumped its entire file tree open on load. Top-level items are
    // already visible without any expansion (they're the tree's first
    // level, rendered unconditionally by renderSidebarTree/renderTreeLevel)
    // — clicking a folder row now reveals only its own direct children,
    // and any subfolders inside those stay collapsed until clicked too.
    expandedPaths = new Set();
    searchQuery = '';
    cfSearchInput.value = '';

    const videoLessons = flatLessons.filter(l => l.kind === 'video');
    importVideosIntoNativePlayer(videoLessons);

    courseId = computeCourseId(files);
    courseState = loadCourseState(courseId, title);

    cfCourseTitle.textContent = title;

    // Build the tree/progress/nav content FIRST, while the sidebar is still
    // collapsed (width:0, overflow:hidden) and invisible. Only once that's
    // done do we reveal it — mirrors playlist.js's handleFiles(), which
    // calls renderPlaylist() before playlistPanel.classList.remove('hidden').
    // Doing it the other way around (reveal, then build) forces the heavy
    // tree-building layout work to happen DURING the width transition,
    // which is what caused the animation to look janky/instant instead of
    // a smooth slide, and stole frames from the playlist panel's own
    // transition happening around the same time.
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

  /* ============================================================
     11. UI shell (sidebar, doc viewer, buttons) — built entirely
         in JS so mainstable.html needs no HTML changes.
     ============================================================ */
  let cfFolderInput, cfSidebar, cfCourseTitle, cfProgressFill, cfProgressPct, cfProgressText,
      cfSearchInput, cfTreeContainer, cfPrevBtn, cfMarkBtn, cfNextBtn,
      cfDocViewer, cfDocTitle, cfDocBody, cfTopBtn;

  function buildUIShell() {
    // Hidden folder-picker input
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

    // "Open a course folder" entry point on the drop-zone (pre-video state)
    const dropInner = document.querySelector('.drop-inner');
    if (dropInner) {
      const divider = document.createElement('div');
      divider.className = 'or-divider cf-divider';
      divider.textContent = 'or';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'cfOpenFolderBtnDrop';
      btn.className = 'cf-open-folder-btn';
      btn.textContent = '\uD83D\uDCC2 Open a course folder';
      btn.addEventListener('click', () => cfFolderInput.click());
      dropInner.appendChild(divider);
      dropInner.appendChild(btn);
    }

    // Persistent top-bar entry point
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

    // Sidebar panel
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

    // Document viewer, overlaid on the existing player area
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

  /* ============================================================
     12. Injected CSS (scoped to cf- prefixed classes; reuses the
         host app's existing CSS custom properties for theming)

     Sidebar open/close animation:
     .cf-sidebar previously toggled with a hard `display:none`, which
     can't be transitioned — so it opened/closed instantly with no
     animation, unlike the native `.playlist-panel` (in player.css),
     which slides by animating `width`/`opacity`/`border-color` and
     using `overflow:hidden` instead of `display:none` while hidden.
     The rules below give `.cf-sidebar` that exact same treatment,
     reusing the app's own --dur-slow/--dur-base/--ease-snap/
     --ease-smooth custom properties so the motion matches the
     playlist panel's timing and easing precisely.
     ============================================================ */
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
      /* The OUTER .cf-sidebar above is what actually animates (width
         0 -> 320px via overflow:hidden). Its real content lives in this
         INNER box instead, at a constant 320px, so the lesson tree/rows
         never need their text-overflow/ellipsis widths recalculated on
         every animation frame — the browser just reveals more of an
         already-laid-out box as the outer box grows, instead of
         re-flowing potentially hundreds of rows 60 times a second. This
         is what was still causing jank even after fixing the render
         order — courses with many lessons cost far more per-frame layout
         work than the native playlist typically has to do. */
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

  /* ============================================================
     13. Init
     ============================================================ */
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

/*
README (integration notes)
---------------------------------------------------------------------------
mainstable.html is untouched except for one <script src="course-feature.js">
tag. Everything above runs as an isolated module (`CourseFeature`) and only
interacts with the existing app through:

  1. DOM reads/writes on elements that already exist (#video, #fileInput,
     #playlistItems, #dropZone, #playerWrapper, #topBar, #toast) — the same
     surface a real user interacts with.
  2. Feeding File objects into the real #fileInput via DataTransfer + a
     dispatched 'change' event, so the app's own handleFiles()/loadVideo()/
     state.playlist logic (resume-on-refresh exclusions for local files,
     duration display, native Prev/Next, keyboard shortcuts, etc.) all keep
     working exactly as before — for course videos and for any videos the
     user opens the normal way.
  3. A MutationObserver on #playlistItems (watching for the '.playing'
     class) so this module always knows which native video is active,
     regardless of *how* the user navigated there.

No existing function, id, class, or event listener is modified or removed.
Text/markdown/html/css/js/json/xml/csv files never touch the native
playlist at all — they're read with FileReader and shown in this module's
own viewer, which is only overlaid on top of #playerWrapper while active.
---------------------------------------------------------------------------
*/