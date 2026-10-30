/* playlist.js: Now Playing rows, saved playlists and the URL / YouTube add flow */

import {
  state, video, dropZone, playerWrapper, fileInput, videoTitle, durTimeEl,
  playlistPanel, playlistItemsEl, playlistTabs, savedItemsEl, savedCountBadge,
  extraPlaylistTabs, addMoreBtn, addFilesTopBtn, prevBtn, nextBtn,
  addUrlBtn2, urlInput, urlAddBtn, urlError,
  urlModalOverlay, urlModalInput, urlModalAddBtn, urlModalError, urlModalCloseBtn,
  newPlaylistOverlay, newPlaylistInput, newPlaylistAddBtn, newPlaylistCloseBtn,
  fmtTime, showToast, uid, escapeHtml
} from './core.js';
import { loadMediaItem, saveCurrentPosition, setOnEndedCallback, setOnDurationCallback, mediaDuration, mediaCurrentTime, parseFacebookUrl, stopEmbeds } from './media.js';
import { ensureThumbnail, ensureYouTubeMeta } from './thumbs.js';
import { initPlaylistSort } from './playlist-sort.js';

export function handleFiles(fileList, insertAt) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('video/') || /\.(mkv|mov|avi|webm|mp4|m4v|ogv)$/i.test(f.name));
  if (!files.length) { showToast('No supported video files found'); return; }
  const startIndex = (Number.isInteger(insertAt) && insertAt >= 0 && insertAt <= state.playlist.length)
    ? insertAt
    : state.playlist.length;
  const newItems = files.map(file => ({
    id: uid(),
    name: file.name,
    url: URL.createObjectURL(file),
    file,
    duration: null
  }));
  state.playlist.splice(startIndex, 0, ...newItems);
  if (state.currentIndex !== -1 && startIndex <= state.currentIndex) {
    state.currentIndex += newItems.length;
  }
  renderPlaylist();
  if (dropZone.parentElement && !dropZone.classList.contains('hidden')) {
    dropZone.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
    playlistPanel.classList.remove('hidden');
    state.playlistOpen = true;
  }
  if (state.currentIndex === -1) {
    loadVideo(startIndex);
  } else {
    showToast(`Added ${files.length} video${files.length > 1 ? 's' : ''} to playlist`);
  }
}

export function loadVideo(index, autoplay) {
  if (index < 0 || index >= state.playlist.length) return;
  saveCurrentPosition();
  state.currentIndex = index;
  const item = state.playlist[index];

  loadMediaItem(item, autoplay);

  videoTitle.textContent = item.name;
  document.title = item.name + ' \u2014 Local Video Player';
  renderPlaylist();
}

function removeFromPlaylist(id) {
  const idx = state.playlist.findIndex(p => p.id === id);
  if (idx === -1) return;
  const wasCurrent = idx === state.currentIndex;
  if (!state.playlist[idx].isRemote) URL.revokeObjectURL(state.playlist[idx].url);
  state.playlist.splice(idx, 1);
  if (idx < state.currentIndex) state.currentIndex--;
  if (wasCurrent) {
    if (state.playlist.length === 0) {
      state.currentIndex = -1;
      video.removeAttribute('src');
      stopEmbeds();
      videoTitle.textContent = 'No video loaded';
      playerWrapper.classList.add('hidden');
      playlistPanel.classList.add('hidden');
      dropZone.classList.remove('hidden');
    } else {
      loadVideo(Math.min(idx, state.playlist.length - 1));
    }
  }
  renderPlaylist();
}

const rowCache = new Map();
let sorter = null;

const KEBAB_SVG = '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
const HANDLE_SVG = '<svg viewBox="0 0 24 24"><path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"/></svg>';

function linkType(link) {
  return link && link.type === 'youtube' ? 'youtube' : (link && link.type === 'facebook' ? 'facebook' : 'video');
}
function defaultLinkName(type, url) {
  return type === 'youtube' ? 'YouTube video' : (type === 'facebook' ? 'Facebook video' : nameFromUrl(url));
}

function subtitleHtml(item) {
  if (item.type === 'facebook') {
    return '<span class="yt-badge fb-badge">Facebook</span>';
  }
  if (item.type === 'youtube') {
    return item.author
      ? escapeHtml(item.author) + '<span class="yt-badge yt-badge-sep">YouTube</span>'
      : '<span class="yt-badge">YouTube</span>';
  }
  if (item.isRemote) {
    try { return escapeHtml(new URL(item.url).hostname.replace(/^www\./, '')); }
    catch (e) { return 'Video link'; }
  }
  const rel = item.file && item.file.webkitRelativePath;
  if (rel) {
    const parts = rel.split('/');
    if (parts.length > 1) return escapeHtml(parts[parts.length - 2]);
  }
  return 'Local file';
}

function buildRow(item) {
  const li = document.createElement('li');
  li.className = 'playlist-item enter';
  li.dataset.id = item.id;
  li.innerHTML = `
    <div class="idx-col">
      <span class="idx"></span>
      <svg class="idx-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      <button class="drag-handle" type="button" title="Drag to reorder" aria-label="Drag to reorder">${HANDLE_SVG}</button>
    </div>
    <div class="thumb">
      <img class="thumb-img" alt="" draggable="false" hidden>
      <svg class="thumb-ph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      <span class="saved-flag" hidden>${BOOKMARK_FILLED_SVG}</span>
      <div class="dur"></div>
      <div class="prog"><div class="prog-fill"></div></div>
    </div>
    <div class="meta">
      <div class="name"></div>
      <div class="sub"></div>
    </div>
    <button class="row-menu-btn" type="button" title="More options" aria-label="More options">${KEBAB_SVG}</button>`;

  li.addEventListener('animationend', () => li.classList.remove('enter'), { once: true });

  const itemOf = () => state.playlist.find(p => p.id === item.id);

  li.addEventListener('click', (e) => {
    if (e.target.closest('.row-menu-btn') || e.target.closest('.drag-handle')) return;
    const idx = state.playlist.findIndex(p => p.id === item.id);
    if (idx !== -1) loadVideo(idx);
  });
  li.querySelector('.row-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const it = itemOf();
    if (it) openRowMenu(it, e.currentTarget);
  });
  const img = li.querySelector('.thumb-img');
  img.addEventListener('error', () => {
    const it = itemOf();
    if (it) { it.thumb = null; it.thumbTried = true; }
    img.hidden = true;
    li.querySelector('.thumb-ph').style.display = '';
  });
  sorter.attachHandle(li.querySelector('.drag-handle'), li);
  return li;
}

function updateThumbAndDuration(li, item) {
  const img = li.querySelector('.thumb-img');
  const ph = li.querySelector('.thumb-ph');
  if (item.thumb) {
    if (img.getAttribute('src') !== item.thumb) img.src = item.thumb;
    img.hidden = false;
    ph.style.display = 'none';
  }
  if (item.duration) {
    const text = fmtTime(item.duration);
    const dur = li.querySelector('.dur');
    if (dur.textContent !== text) dur.textContent = text;
  }
}

function updateProgress(li, item) {
  const pct = Math.round((item.progress || 0) * 1000) / 10;
  li.querySelector('.prog-fill').style.width = pct + '%';
  li.classList.toggle('has-progress', pct > 0);
}

function updateRow(li, item, i, savedUrls) {
  li.classList.toggle('playing', i === state.currentIndex);
  const idx = li.querySelector('.idx');
  const label = String(i + 1);
  if (idx.textContent !== label) idx.textContent = label;

  const nameEl = li.querySelector('.name');
  if (nameEl.getAttribute('title') !== item.name) {
    nameEl.setAttribute('title', item.name);
    nameEl.textContent = item.name;
  }
  const sub = li.querySelector('.sub');
  const subHtml = subtitleHtml(item);
  if (li.dataset.sub !== subHtml) { li.dataset.sub = subHtml; sub.innerHTML = subHtml; }

  li.querySelector('.saved-flag').hidden = !(item.isRemote && savedUrls.has(item.url));
  updateThumbAndDuration(li, item);
  updateProgress(li, item);
}

function patchRow(id) {
  const li = rowCache.get(id);
  const item = state.playlist.find(p => p.id === id);
  if (!li || !item) return;
  updateThumbAndDuration(li, item);
}

function applyMove(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.playlist.length || to >= state.playlist.length) return;
  const playingId = state.currentIndex !== -1 ? state.playlist[state.currentIndex].id : null;
  const [moved] = state.playlist.splice(from, 1);
  state.playlist.splice(to, 0, moved);
  if (playingId != null) state.currentIndex = state.playlist.findIndex(p => p.id === playingId);
}

function renderPlaylist() {
  if (!sorter) {
    sorter = initPlaylistSort({
      list: playlistItemsEl,
      onCommit: (from, to) => { applyMove(from, to); renderPlaylist(); }
    });
  }
  const savedUrls = new Set();
  getSaveTargets().forEach(pl => pl.links.forEach(l => savedUrls.add(l.url)));

  const liveIds = new Set(state.playlist.map(p => p.id));
  rowCache.forEach((li, id) => {
    if (!liveIds.has(id)) { li.remove(); rowCache.delete(id); }
  });

  let prev = null;
  state.playlist.forEach((item, i) => {
    let li = rowCache.get(item.id);
    if (!li) { li = buildRow(item); rowCache.set(item.id, li); }
    ensureThumbnail(item, () => patchRow(item.id), () => state.playlist.includes(item));
    ensureYouTubeMeta(item, onItemMetaLoaded);
    updateRow(li, item, i, savedUrls);
    const expected = prev ? prev.nextElementSibling : playlistItemsEl.firstElementChild;
    if (li !== expected) playlistItemsEl.insertBefore(li, expected);
    prev = li;
  });
}

function onItemMetaLoaded() {
  const cur = state.playlist[state.currentIndex];
  if (cur) {
    videoTitle.textContent = cur.name;
    document.title = cur.name + ' \u2014 Local Video Player';
  }
  renderPlaylist();
}

function startProgressTracking() {
  setInterval(() => {
    const item = state.playlist[state.currentIndex];
    if (!item) return;
    const d = mediaDuration();
    if (!isFinite(d) || d <= 0) return;
    const p = Math.max(0, Math.min(1, mediaCurrentTime() / d));
    if (Math.abs(p - (item.progress || 0)) < 0.002) return;
    item.progress = p;
    const li = rowCache.get(item.id);
    if (li) updateProgress(li, item);
  }, 1000);
}

function openRowMenu(item, anchorEl) {
  if (saveMenuEl && rowMenuAnchor === anchorEl) { closeSaveMenu(); return; }
  closeSaveMenu();
  rowMenuAnchor = anchorEl;
  const index = state.playlist.findIndex(p => p.id === item.id);
  const last = state.playlist.length - 1;

  saveMenuEl = document.createElement('div');
  saveMenuEl.className = 'pl-save-menu';
  saveMenuEl.addEventListener('click', (e) => e.stopPropagation());

  const addEntry = (label, handler, opts = {}) => {
    const row = document.createElement('div');
    row.className = 'pl-save-row' + (opts.disabled ? ' pl-menu-disabled' : '');
    row.textContent = label;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opts.disabled) return;
      handler();
    });
    saveMenuEl.appendChild(row);
  };
  const addDivider = () => {
    const d = document.createElement('div');
    d.className = 'pl-save-divider';
    saveMenuEl.appendChild(d);
  };

  if (item.isRemote) {
    const saved = isLinkSaved(item.url);
    const label = state.features.multi
      ? (saved ? 'Saved \u2014 manage playlists\u2026' : 'Save to playlist\u2026')
      : (saved ? 'Remove from Saved' : 'Save');
    addEntry(label, () => { closeSaveMenu(); onSaveButtonClick(item, anchorEl); });
    addDivider();
  }
  addEntry('Move to top', () => {
    closeSaveMenu();
    sorter.animateChange(() => { applyMove(index, 0); renderPlaylist(); });
  }, { disabled: index <= 0 });
  addEntry('Move to bottom', () => {
    closeSaveMenu();
    sorter.animateChange(() => { applyMove(index, last); renderPlaylist(); });
  }, { disabled: index === last });
  addDivider();
  addEntry('Remove from playlist', () => {
    closeSaveMenu();
    sorter.animateChange(() => removeFromPlaylist(item.id));
  });

  document.body.appendChild(saveMenuEl);
  positionSaveMenu(anchorEl);
}

const BOOKMARK_FILLED_SVG  = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
const BOOKMARK_OUTLINE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';

function getSaveTargets() {
  const all = loadPlaylists();
  return state.features.multi ? all : all.filter(p => p.id === 'default');
}
function isLinkSaved(url) {
  if (!url) return false;
  return getSaveTargets().some(pl => pl.links.some(l => l.url === url));
}
function itemToLink(item) {
  return { name: item.name, url: item.url, type: item.type || 'video', youtubeId: item.youtubeId || null };
}
function refreshAfterSaveChange() {
  updateSavedCountBadge();
  renderPlaylistTabs();
  if (savedItemsEl && !savedItemsEl.classList.contains('hidden')) renderSavedList();
  renderPlaylist();
}
function toggleSaveInPlaylist(item, playlistId) {
  const pl = loadPlaylists().find(p => p.id === playlistId);
  if (!pl) return;
  if (pl.links.some(l => l.url === item.url)) {
    removeLinkFromPlaylist(pl.id, item.url);
    showToast(`Removed from "${pl.name}"`);
  } else {
    addLinksToPlaylist(pl.id, [itemToLink(item)]);
    showToast(`Saved to "${pl.name}"`);
  }
  refreshAfterSaveChange();
}

let saveMenuEl = null;
let saveMenuItem = null;
let pendingNewPlaylistItem = null;
let rowMenuAnchor = null;

function closeSaveMenu() {
  if (saveMenuEl) { saveMenuEl.remove(); saveMenuEl = null; }
  saveMenuItem = null;
  rowMenuAnchor = null;
}
function renderSaveMenu() {
  if (!saveMenuEl || !saveMenuItem) return;
  const item = saveMenuItem;
  saveMenuEl.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'pl-save-title';
  title.textContent = 'Save to playlist';
  saveMenuEl.appendChild(title);

  loadPlaylists().forEach(pl => {
    const checked = pl.links.some(l => l.url === item.url);
    const row = document.createElement('div');
    row.className = 'pl-save-row' + (checked ? ' checked' : '');
    const box = document.createElement('span');
    box.className = 'pl-save-check';
    box.textContent = checked ? '\u2713' : '';
    const name = document.createElement('span');
    name.className = 'pl-save-name';
    name.textContent = pl.name;
    const count = document.createElement('span');
    count.className = 'pl-save-count';
    count.textContent = String(pl.links.length);
    row.append(box, name, count);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSaveInPlaylist(item, pl.id);
      renderSaveMenu();
    });
    saveMenuEl.appendChild(row);
  });

  const divider = document.createElement('div');
  divider.className = 'pl-save-divider';
  saveMenuEl.appendChild(divider);

  const newRow = document.createElement('div');
  newRow.className = 'pl-save-row pl-save-new';
  newRow.textContent = '+ New playlist\u2026';
  newRow.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingNewPlaylistItem = item;
    closeSaveMenu();
    newPlaylistInput.value = '';
    newPlaylistOverlay.classList.remove('hidden');
    setTimeout(() => newPlaylistInput.focus(), 0);
  });
  saveMenuEl.appendChild(newRow);
}
function positionSaveMenu(anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const m = saveMenuEl.getBoundingClientRect();
  let left = r.right - m.width;
  let top = r.bottom + 6;
  if (top + m.height > window.innerHeight - 8) top = r.top - m.height - 6;
  left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
  top = Math.max(8, top);
  saveMenuEl.style.left = left + 'px';
  saveMenuEl.style.top = top + 'px';
}
function openSaveMenu(item, anchorEl) {
  closeSaveMenu();
  saveMenuItem = itemToLink(item);
  saveMenuEl = document.createElement('div');
  saveMenuEl.className = 'pl-save-menu';
  saveMenuEl.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(saveMenuEl);
  renderSaveMenu();
  positionSaveMenu(anchorEl);
}
function onSaveButtonClick(item, anchorEl) {
  if (!state.features.multi) {
    closeSaveMenu();
    toggleSaveInPlaylist(item, 'default');
    return;
  }
  if (saveMenuEl && saveMenuItem && saveMenuItem.url === item.url) { closeSaveMenu(); return; }
  openSaveMenu(item, anchorEl);
}
function injectSaveMenuStyles() {
  if (document.getElementById('plSaveMenuStyles')) return;
  const style = document.createElement('style');
  style.id = 'plSaveMenuStyles';
  style.textContent = `
    .pl-save-menu{
      position:fixed;z-index:60;min-width:190px;max-width:260px;max-height:300px;overflow-y:auto;
      background:rgba(28,28,28,.98);border:1px solid #333;border-radius:10px;padding:6px 0;
      box-shadow:0 6px 22px rgba(0,0,0,.55);font-size:.82rem;color:#eee;
      animation:plSaveMenuPop var(--dur-fast,140ms) var(--ease-spring,ease-out);
    }
    @keyframes plSaveMenuPop{ from{ opacity:0; transform:translateY(-4px) scale(.96); } to{ opacity:1; transform:none; } }
    .pl-save-title{ padding:7px 14px 6px;color:#aaa;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px; }
    .pl-save-row{
      display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;
      transition:background var(--dur-fast,140ms) var(--ease-smooth,ease-out);
    }
    .pl-save-row:hover{ background:rgba(255,255,255,.08); }
    .pl-save-check{
      width:16px;height:16px;flex-shrink:0;border:1.5px solid #666;border-radius:4px;
      display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;color:#fff;
    }
    .pl-save-row.checked .pl-save-check{ background:var(--accent,#f00);border-color:var(--accent,#f00); }
    .pl-save-name{ flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .pl-save-count{ color:#888;font-size:.72rem; }
    .pl-save-divider{ height:1px;background:#333;margin:4px 0; }
    .pl-save-new{ color:#9ecbff; }
    .pl-menu-disabled{ opacity:.4;cursor:default; }
    .pl-menu-disabled:hover{ background:none; }
  `;
  document.head.appendChild(style);
}

const PLAYLISTS_KEY = 'lvp_playlists';
const LEGACY_SAVED_LINKS_KEY = 'lvp_savedLinks';

function loadPlaylists() {
  let arr = [];
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
  } catch (e) { arr = []; }
  if (!arr.some(p => p && p.id === 'default')) {
    let migrated = [];
    try {
      const legacyRaw = localStorage.getItem(LEGACY_SAVED_LINKS_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (Array.isArray(legacy)) migrated = legacy;
      }
    } catch (e) {}
    arr.unshift({ id: 'default', name: 'Saved', links: migrated });
    persistPlaylists(arr);
  }
  return arr;
}
function persistPlaylists(arr) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}
function getPlaylist(id) {
  return loadPlaylists().find(p => p.id === id) || loadPlaylists().find(p => p.id === 'default');
}
function createPlaylist(name) {
  const arr = loadPlaylists();
  const id = uid();
  arr.push({ id, name: (name || 'Playlist').trim().slice(0, 40) || 'Playlist', links: [] });
  persistPlaylists(arr);
  return id;
}
function deletePlaylist(id) {
  if (id === 'default') return;
  persistPlaylists(loadPlaylists().filter(p => p.id !== id));
  if (state.activeSavedPlaylistId === id) state.activeSavedPlaylistId = 'default';
}
function addLinksToPlaylist(id, items) {
  const arr = loadPlaylists();
  const pl = arr.find(p => p.id === id) || arr.find(p => p.id === 'default');
  const existingUrls = new Set(pl.links.map(l => l.url));
  let added = 0;
  items.forEach(item => {
    if (!existingUrls.has(item.url)) {
      pl.links.push({ name: item.name, url: item.url, type: item.type || 'video', youtubeId: item.youtubeId || null });
      existingUrls.add(item.url);
      added++;
    }
  });
  persistPlaylists(arr);
  return added;
}
function removeLinkFromPlaylist(id, url) {
  const arr = loadPlaylists();
  const pl = arr.find(p => p.id === id);
  if (!pl) return;
  pl.links = pl.links.filter(l => l.url !== url);
  persistPlaylists(arr);
}
function updateSavedCountBadge() {
  renderLandingSaved();
  const n = getPlaylist('default').links.length;
  savedCountBadge.textContent = n;
  savedCountBadge.hidden = n === 0;
}
function linkToItem(link) {
  return {
    id: uid(),
    name: link.name || defaultLinkName(linkType(link), link.url),
    url: link.url,
    file: null,
    isRemote: true,
    type: linkType(link),
    youtubeId: link.youtubeId || null,
    duration: null
  };
}

export function renderLandingSaved() {
  const box = document.getElementById('savedLanding');
  if (!box) return;
  const list = box.querySelector('.saved-landing-list');
  const lists = loadPlaylists().filter(pl => pl && Array.isArray(pl.links) && pl.links.some(l => l && l.url));
  list.innerHTML = '';
  box.hidden = lists.length === 0;
  lists.forEach(pl => {
    const count = pl.links.filter(l => l && l.url).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saved-landing-item';
    btn.innerHTML = `${BOOKMARK_FILLED_SVG}<span class="sl-name"></span><span class="sl-count"></span><span class="sl-play">&#9654;</span>`;
    btn.querySelector('.sl-name').textContent = pl.name;
    btn.querySelector('.sl-count').textContent = count + (count === 1 ? ' video' : ' videos');
    btn.addEventListener('click', () => openSavedPlaylist(pl.id));
    list.appendChild(btn);
  });
}

export function openSavedPlaylist(id) {
  const pl = loadPlaylists().find(p => p.id === id);
  if (!pl) return;
  const links = pl.links.filter(l => l && l.url);
  if (!links.length) return;
  let startIndex = -1;
  links.forEach(link => {
    let idx = state.playlist.findIndex(it => it.isRemote && it.url === link.url);
    if (idx === -1) {
      state.playlist.push(linkToItem(link));
      idx = state.playlist.length - 1;
    }
    if (startIndex === -1) startIndex = idx;
  });
  dropZone.classList.add('hidden');
  playerWrapper.classList.remove('hidden');
  playlistPanel.classList.remove('hidden');
  state.playlistOpen = true;
  state.activeSavedPlaylistId = id;
  renderPlaylist();
  renderPlaylistTabs();
  switchPlaylistTab('playing');
  loadVideo(startIndex);
}

function restoreSavedLinks() {
  const defaultLinks = getPlaylist('default').links;
  updateSavedCountBadge();
  if (defaultLinks.length) {
    defaultLinks.forEach(link => {
      if (!link || !link.url) return;
      state.playlist.push(linkToItem(link));
    });
    dropZone.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
    playlistPanel.classList.remove('hidden');
    state.playlistOpen = true;
    renderPlaylist();
    loadVideo(0, false);
  }
  renderPlaylistTabs();
}
function loadSavedLink(playlistId, url) {
  const pl = getPlaylist(playlistId);
  const link = pl.links.find(l => l.url === url);
  if (!link) return;
  let idx = state.playlist.findIndex(p => p.url === url);
  if (idx === -1) {
    state.playlist.push({
      id: uid(),
      name: link.name || defaultLinkName(linkType(link), link.url),
      url: link.url,
      file: null,
      isRemote: true,
      type: linkType(link),
      youtubeId: link.youtubeId || null,
      duration: null
    });
    idx = state.playlist.length - 1;
  }
  dropZone.classList.add('hidden');
  playerWrapper.classList.remove('hidden');
  playlistPanel.classList.remove('hidden');
  state.playlistOpen = true;
  switchPlaylistTab('playing');
  loadVideo(idx);
}
function removeSavedLink(playlistId, url) {
  removeLinkFromPlaylist(playlistId, url);
  updateSavedCountBadge();
  renderPlaylistTabs();
  renderSavedList();
  renderPlaylist();
  showToast('Removed from playlist');
}
function renderSavedList() {
  const activeId = state.activeSavedPlaylistId || 'default';
  const pl = getPlaylist(activeId);
  const links = pl.links;
  savedItemsEl.innerHTML = '';
  if (!links.length) {
    const empty = document.createElement('li');
    empty.className = 'saved-empty';
    empty.textContent = `No saved videos in "${pl.name}" yet. Go to Now Playing and tap the bookmark on a video to save it here.`;
    savedItemsEl.appendChild(empty);
    return;
  }
  links.forEach(link => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    const isYoutube = link.type === 'youtube';
    const isFacebook = link.type === 'facebook';
    const displayName = link.name || defaultLinkName(linkType(link), link.url);
    li.innerHTML = `
      <div class="thumb">
        ${isYoutube && link.youtubeId ? `<img class="thumb-img" alt="" src="https://i.ytimg.com/vi/${encodeURIComponent(link.youtubeId)}/mqdefault.jpg" onerror="this.remove()">` : ''}
        <svg class="thumb-ph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="meta">
        <div class="name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}${isYoutube ? '<span class="yt-badge">YouTube</span>' : (isFacebook ? '<span class="yt-badge fb-badge">Facebook</span>' : ' <span style="color:#666;">(URL)</span>')}</div>
      </div>
      <div class="item-actions">
        <button class="load-btn" title="Play" tabindex="-1">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="remove-btn" title="Remove from this playlist">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.41 6.3-6.29 6.3 6.29 1.41-1.41-6.3-6.29 6.3-6.3z"/></svg>
        </button>
      </div>`;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      loadSavedLink(pl.id, link.url);
    });
    li.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSavedLink(pl.id, link.url);
    });
    savedItemsEl.appendChild(li);
  });
}
function renderPlaylistTabs() {
  renderLandingSaved();
  extraPlaylistTabs.innerHTML = '';
  if (!state.features.multi) return;
  const extras = loadPlaylists().filter(p => p.id !== 'default');
  extras.forEach(pl => {
    const tab = document.createElement('div');
    tab.className = 'playlist-tab saved-extra' + (state.activeSavedPlaylistId === pl.id ? ' active' : '');
    tab.dataset.tab = 'saved:' + pl.id;
    tab.innerHTML = `${escapeHtml(pl.name)}<span class="count">${pl.links.length}</span><span class="tab-del" title="Delete playlist">\u2715</span>`;
    tab.querySelector('.tab-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete the "${pl.name}" playlist? This can't be undone.`)) {
        deletePlaylist(pl.id);
        renderPlaylistTabs();
        switchPlaylistTab('saved:default');
      }
    });
    extraPlaylistTabs.appendChild(tab);
  });
}
function switchPlaylistTab(tab) {
  Array.from(playlistTabs.querySelectorAll('.playlist-tab')).forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  if (tab.startsWith('saved:')) {
    state.activeSavedPlaylistId = tab.slice(6);
    playlistItemsEl.classList.add('hidden');
    savedItemsEl.classList.remove('hidden');
    renderSavedList();
    renderPlaylist();
  } else {
    savedItemsEl.classList.add('hidden');
    playlistItemsEl.classList.remove('hidden');
  }
}

export function onMultiFeatureToggled() {
  renderPlaylistTabs();
  if (!state.features.multi && state.activeSavedPlaylistId !== 'default') {
    state.activeSavedPlaylistId = 'default';
    if (!savedItemsEl.classList.contains('hidden')) renderSavedList();
  }
}

function closeNewPlaylistOverlay() {
  newPlaylistOverlay.classList.add('hidden');
  pendingNewPlaylistItem = null;
}

function wireSavedPlaylists() {
  playlistTabs.addEventListener('click', (e) => {
    const tabEl = e.target.closest('.playlist-tab');
    if (!tabEl) return;
    if (tabEl.dataset.tab === '__add__') {
      pendingNewPlaylistItem = null;
      newPlaylistInput.value = '';
      newPlaylistOverlay.classList.remove('hidden');
      setTimeout(() => newPlaylistInput.focus(), 0);
      return;
    }
    switchPlaylistTab(tabEl.dataset.tab);
  });
  newPlaylistAddBtn.addEventListener('click', () => {
    const name = newPlaylistInput.value.trim();
    if (!name) return;
    const id = createPlaylist(name);
    newPlaylistOverlay.classList.add('hidden');

    if (pendingNewPlaylistItem) {
      const item = pendingNewPlaylistItem;
      pendingNewPlaylistItem = null;
      addLinksToPlaylist(id, [itemToLink(item)]);
      refreshAfterSaveChange();
      showToast(`Saved to new playlist "${name}"`);
      return;
    }

    renderPlaylistTabs();
    switchPlaylistTab('saved:' + id);
    showToast(`Created playlist "${name}"`);
  });
  newPlaylistInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); newPlaylistAddBtn.click(); } });
  newPlaylistCloseBtn.addEventListener('click', closeNewPlaylistOverlay);
  newPlaylistOverlay.addEventListener('click', (e) => { if (e.target === newPlaylistOverlay) closeNewPlaylistOverlay(); });

  document.addEventListener('click', () => closeSaveMenu());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSaveMenu(); });
  playlistItemsEl.addEventListener('scroll', closeSaveMenu);
}

function isLikelyDirectVideoUrl(u) {
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol);
  } catch (e) { return false; }
}
function nameFromUrl(u) {
  try {
    const parsed = new URL(u);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || parsed.hostname) || 'Video from URL';
  } catch (e) { return 'Video from URL'; }
}
function getYouTubeId(u) {
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const segs = parsed.pathname.split('/').filter(Boolean);
      if ((segs[0] === 'embed' || segs[0] === 'shorts' || segs[0] === 'live') && segs[1]) return segs[1];
    }
    return null;
  } catch (e) { return null; }
}
function onRemoteVideoError() {
  const item = state.playlist[state.currentIndex];
  if (item && item.isRemote) {
    showToast('Could not play this link \u2014 it may not allow direct playback or isn\'t a supported format');
  }
}
function addUrlToPlaylist(rawUrl, errorEl) {
  const u = (rawUrl || '').trim();
  if (errorEl) errorEl.textContent = '';
  if (!u) { if (errorEl) errorEl.textContent = 'Paste a video link first.'; return; }
  if (!isLikelyDirectVideoUrl(u)) {
    if (errorEl) errorEl.textContent = 'That doesn\'t look like a valid http(s) link.';
    return;
  }
  const youtubeId = getYouTubeId(u);
  const fb = youtubeId ? null : parseFacebookUrl(u);
  if (fb && !fb.isVideo) {
    if (errorEl) errorEl.textContent = 'That Facebook link doesn\'t look like a video. Open the video on Facebook and copy its link (Share \u2192 Copy link).';
    return;
  }
  const embedded = !!youtubeId || !!fb;
  const wasEmpty = state.playlist.length === 0;
  state.playlist.push({
    id: uid(),
    name: youtubeId ? 'YouTube video' : (fb ? 'Facebook video' : nameFromUrl(u)),
    url: fb ? fb.url : u,
    file: null,
    isRemote: true,
    type: youtubeId ? 'youtube' : (fb ? 'facebook' : 'video'),
    youtubeId: youtubeId || null,
    duration: null
  });
  renderPlaylist();
  if (dropZone.parentElement && !dropZone.classList.contains('hidden')) {
    dropZone.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
    playlistPanel.classList.remove('hidden');
    state.playlistOpen = true;
  }
  if (wasEmpty) loadVideo(state.playlist.length - 1);
  else showToast(youtubeId ? 'Added YouTube video' : (fb ? 'Added Facebook video' : 'Added video from URL'));
  if (!embedded) video.addEventListener('error', onRemoteVideoError, { once: true });
}

export function closeUrlModal() {
  urlModalOverlay.classList.add('hidden');
}
function openUrlModal() {
  urlModalError.textContent = '';
  urlModalInput.value = '';
  urlModalOverlay.classList.remove('hidden');
  setTimeout(() => urlModalInput.focus(), 0);
}

function wireUrlAdd() {
  urlAddBtn.addEventListener('click', () => {
    addUrlToPlaylist(urlInput.value, urlError);
    if (!urlError.textContent) urlInput.value = '';
  });
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); urlAddBtn.click(); } });

  addUrlBtn2.addEventListener('click', openUrlModal);
  urlModalCloseBtn.addEventListener('click', closeUrlModal);
  urlModalAddBtn.addEventListener('click', () => {
    addUrlToPlaylist(urlModalInput.value, urlModalError);
    if (!urlModalError.textContent) closeUrlModal();
  });
  urlModalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); urlModalAddBtn.click(); } });
  urlModalOverlay.addEventListener('click', (e) => { if (e.target === urlModalOverlay) closeUrlModal(); });
}

function wireFileInput() {
  addMoreBtn.addEventListener('click', () => fileInput.click());
  addFilesTopBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const raw = fileInput.dataset.insertAt;
    const insertAt = raw !== undefined && raw !== '' ? parseInt(raw, 10) : undefined;
    handleFiles(e.target.files, Number.isNaN(insertAt) ? undefined : insertAt);
    fileInput.value = '';
  });
}

function wirePrevNext() {
  prevBtn.addEventListener('click', () => {
    if (state.currentIndex > 0) loadVideo(state.currentIndex - 1);
  });
  nextBtn.addEventListener('click', () => {
    if (state.currentIndex < state.playlist.length - 1) loadVideo(state.currentIndex + 1);
  });
}

function wireNativeDurationTracking() {
  video.addEventListener('loadedmetadata', () => {
    durTimeEl.textContent = fmtTime(video.duration);
    if (state.currentIndex !== -1 && state.playlist[state.currentIndex]) {
      state.playlist[state.currentIndex].duration = video.duration;
      renderPlaylist();
    }
  });
}

export function initPlaylist() {
  setOnEndedCallback(() => {
    const cur = state.playlist[state.currentIndex];
    if (cur) { cur.progress = 1; const li = rowCache.get(cur.id); if (li) updateProgress(li, cur); }
    if (state.currentIndex < state.playlist.length - 1) loadVideo(state.currentIndex + 1);
  });
  setOnDurationCallback(renderPlaylist);

  const legacySaveBtn = document.getElementById('saveLinksBtn');
  if (legacySaveBtn) legacySaveBtn.remove();

  injectSaveMenuStyles();
  wireFileInput();
  wirePrevNext();
  wireSavedPlaylists();
  wireUrlAdd();
  wireNativeDurationTracking();
  startProgressTracking();

  restoreSavedLinks();
  renderPlaylist();
}
