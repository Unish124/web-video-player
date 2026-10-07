/*!
 * playlist.js
 * Everything about how items get in and out of the playlist: adding
 * local files, loading and rendering the "Now Playing" list (including
 * drag-and-drop reordering), the saved/multi-playlist tabs (with their
 * own localStorage persistence), and the URL/YouTube-link add flow
 * (inline row + modal).
 *
 * Depends on (one-directional imports — nothing below imports from
 * this file):
 *
 *   from './core.js':
 *     state, video, dropZone, playerWrapper, fileInput, videoTitle,
 *     durTimeEl, playlistPanel, playlistItemsEl, playlistTabs,
 *     savedItemsEl, savedCountBadge, extraPlaylistTabs, addMoreBtn,
 *     addFilesTopBtn, prevBtn, nextBtn, addUrlBtn2,
 *     urlInput, urlAddBtn, urlError, urlModalOverlay, urlModalInput,
 *     urlModalAddBtn, urlModalError, urlModalCloseBtn, newPlaylistOverlay,
 *     newPlaylistInput, newPlaylistAddBtn, newPlaylistCloseBtn,
 *     fmtTime, showToast, uid, escapeHtml
 *
 *   from './media.js':
 *     loadMediaItem(item, autoplay), saveCurrentPosition(),
 *     setOnEndedCallback(fn), setOnDurationCallback(fn)
 *
 * Exports:
 *   initPlaylist()          — wires everything below and restores the
 *                             default Saved playlist on load.
 *   handleFiles(fileList)   — used by main.js's drag & drop, and by this
 *                             file's own #fileInput 'change' listener
 *                             (which also fires for course-feature.js's
 *                             synthetic DataTransfer import).
 *   loadVideo(index, autoplay) — used by main.js's keyboard shortcuts
 *                             (Shift+N/Shift+P), and internally.
 *   closeUrlModal()         — used by main.js's Escape-key handling.
 *   onMultiFeatureToggled() — used by controls.js's Extra Features
 *                             overlay when the "multiple playlists"
 *                             toggle is flipped.
 *
 * Drag-and-drop reordering (Now Playing list only — see renderPlaylist()
 * and reorderPlaylist() below): uses the native HTML5 Drag and Drop API,
 * so it covers mouse drags on desktop browsers. That API has no touch
 * equivalent, so dragging to reorder isn't available on touchscreens —
 * everything else in the playlist (tapping to load, the remove button)
 * still works fine there.
 */
import {
  state, video, dropZone, playerWrapper, fileInput, videoTitle, durTimeEl,
  playlistPanel, playlistItemsEl, playlistTabs, savedItemsEl, savedCountBadge,
  extraPlaylistTabs, addMoreBtn, addFilesTopBtn, prevBtn, nextBtn,
  addUrlBtn2, urlInput, urlAddBtn, urlError,
  urlModalOverlay, urlModalInput, urlModalAddBtn, urlModalError, urlModalCloseBtn,
  newPlaylistOverlay, newPlaylistInput, newPlaylistAddBtn, newPlaylistCloseBtn,
  fmtTime, showToast, uid, escapeHtml
} from './core.js';
import { loadMediaItem, saveCurrentPosition, setOnEndedCallback, setOnDurationCallback } from './media.js';

/* ============================================================
   Adding local files
   ============================================================ */
// insertAt (optional): index to insert the new items at, instead of
// appending them to the end. Used when a removed course lesson is
// restored, so it goes back where it was rather than at the bottom.
// Values outside 0..length fall back to appending.
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
  // Inserting at or before the playing item pushes it down; keep
  // currentIndex pointing at the same video.
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

/* ============================================================
   Loading / removing / rendering the "Now Playing" list
   ============================================================ */
export function loadVideo(index, autoplay) {
  if (index < 0 || index >= state.playlist.length) return;
  saveCurrentPosition(); // capture the outgoing item's position, if resume is on
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
      playerWrapper.classList.remove('yt-mode');
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

/* ============================================================
   Drag-and-drop reordering
   dragSrcIndex tracks which row a drag started from. On drop, the row
   being dropped ON tells us where (before/above vs after/below itself,
   based on cursor position within that row) — reorderPlaylist() then
   does the actual array move.
   ============================================================ */
let dragSrcIndex = null;

function clearDragOverIndicators() {
  Array.from(playlistItemsEl.children).forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

// Moves the item at fromIndex so it ends up immediately before whatever
// is currently at toIndex (toIndex measured in the array BEFORE the
// item is removed — e.g. toIndex = state.playlist.length means "move
// to the very end"). Keeps state.currentIndex pointing at whichever
// item is actually playing by re-finding it by id afterward, since a
// reorder shifts everyone's index around it.
function reorderPlaylist(fromIndex, toIndex) {
  let insertAt = toIndex;
  if (fromIndex < toIndex) insertAt -= 1; // account for the removal shifting later indices down
  if (insertAt === fromIndex) return; // dropped back where it started — no-op

  const playingId = state.currentIndex !== -1 ? state.playlist[state.currentIndex].id : null;

  const [moved] = state.playlist.splice(fromIndex, 1);
  state.playlist.splice(insertAt, 0, moved);

  if (playingId != null) {
    state.currentIndex = state.playlist.findIndex(p => p.id === playingId);
  }

  renderPlaylist();
}

function renderPlaylist() {
  playlistItemsEl.innerHTML = '';
  state.playlist.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (i === state.currentIndex ? ' playing' : '');
    li.draggable = true;
    // Local files can never be saved (there's nothing durable to store
    // for an in-memory blob URL), so the per-item save icon only appears
    // for remote items (direct URLs and YouTube links). Its filled-vs-
    // outline state reflects whether this url is saved in any playlist
    // that currently counts (see getSaveTargets()).
    const saved = item.isRemote && isLinkSaved(item.url);
    const saveBtnHtml = item.isRemote ? `
      <button class="save-item-btn${saved ? ' saved' : ''}" title="${state.features.multi ? (saved ? 'Saved \u2014 click to manage playlists' : 'Save to a playlist\u2026') : (saved ? 'Saved \u2014 click to remove' : 'Save this video')}">
        ${saved ? BOOKMARK_FILLED_SVG : BOOKMARK_OUTLINE_SVG}
      </button>` : '';
    li.innerHTML = `
      <div class="thumb">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <div class="playing-badge">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff0000"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="meta">
        <div class="name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}${item.type === 'youtube' ? '<span class="yt-badge">YouTube</span>' : (item.isRemote ? ' <span style="color:#666;">(URL)</span>' : '')}</div>
        <div class="dur">${item.duration ? fmtTime(item.duration) : ''}</div>
      </div>
      ${saveBtnHtml}
      <button class="remove-btn" title="Remove">
        <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.41 6.3-6.29 6.3 6.29 1.41-1.41-6.3-6.29 6.3-6.3z"/></svg>
      </button>`;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn') || e.target.closest('.save-item-btn')) return;
      loadVideo(i);
    });
    li.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromPlaylist(item.id);
    });
    const saveBtnEl = li.querySelector('.save-item-btn');
    if (saveBtnEl) {
      saveBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onSaveButtonClick(item, saveBtnEl);
      });
    }

    li.addEventListener('dragstart', (e) => {
      dragSrcIndex = i;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers require dataTransfer data to be set for the drag
      // to be permitted at all — the value itself isn't used, since
      // dragSrcIndex (captured above) is what drop reads from.
      try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) {}
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      dragSrcIndex = null;
      clearDragOverIndicators();
    });
    li.addEventListener('dragover', (e) => {
      if (dragSrcIndex === null) return;
      e.preventDefault(); // required for this element to accept a drop at all
      e.dataTransfer.dropEffect = 'move';
      const rect = li.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      li.classList.toggle('drag-over-top', before);
      li.classList.toggle('drag-over-bottom', !before);
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null) return;
      const rect = li.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      const targetIndex = before ? i : i + 1;
      reorderPlaylist(dragSrcIndex, targetIndex);
      clearDragOverIndicators();
    });

    playlistItemsEl.appendChild(li);
  });
}

/* ============================================================
   Saved playlists (persist across refresh/reopen)
   Only remote entries (direct video URLs and YouTube links) can live
   here — local files are in-memory blob URLs that die when the page
   closes, so there's nothing durable to store for them.
   ============================================================ */
/* ============================================================
   Per-item save control (Now Playing list)
   Each remote item has a bookmark button: filled when the video is
   saved in at least one playlist, hollow when it isn't. Both icon
   strings use fill/stroke="currentColor" so one CSS color rule
   (.save-item-btn / .save-item-btn.saved) recolors whichever shows.

   With the "multiple playlists" feature OFF there is only the default
   "Saved" playlist, so the button simply toggles the video in/out of it.
   With it ON, the button opens a small "Save to playlist" menu listing
   every playlist with a check next to the ones that already contain the
   video — click a row to add/remove it there. The target is always
   chosen explicitly; it no longer depends on which Saved tab happened to
   be open last (which is what made saving unreliable before).
   ============================================================ */
const BOOKMARK_FILLED_SVG  = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
const BOOKMARK_OUTLINE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';

// Playlists that count for the saved indicator: just the default one
// unless the multi-playlist feature is on.
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
  renderPlaylist(); // refreshes every row's bookmark state
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

/* ---- "Save to playlist" menu (multi-playlist mode) ---- */
let saveMenuEl = null;
let saveMenuItem = null;            // link-shaped copy of the item the menu is for
let pendingNewPlaylistItem = null;  // item to add once a new playlist is created

function closeSaveMenu() {
  if (saveMenuEl) { saveMenuEl.remove(); saveMenuEl = null; }
  saveMenuItem = null;
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
      renderSaveMenu(); // keep the menu open so several playlists can be ticked
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
  if (top + m.height > window.innerHeight - 8) top = r.top - m.height - 6; // flip above if no room
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
  // Clicking the same row's bookmark again closes its menu.
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
  const n = getPlaylist('default').links.length;
  savedCountBadge.textContent = n;
  savedCountBadge.hidden = n === 0;
}
function restoreSavedLinks() {
  const defaultLinks = getPlaylist('default').links;
  updateSavedCountBadge();
  if (defaultLinks.length) {
    defaultLinks.forEach(link => {
      if (!link || !link.url) return;
      state.playlist.push({
        id: uid(),
        name: link.name || (link.type === 'youtube' ? 'YouTube video' : nameFromUrl(link.url)),
        url: link.url,
        file: null,
        isRemote: true,
        type: link.type === 'youtube' ? 'youtube' : 'video',
        youtubeId: link.youtubeId || null,
        duration: null
      });
    });
    dropZone.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
    playlistPanel.classList.remove('hidden');
    state.playlistOpen = true;
    renderPlaylist();
    loadVideo(0, false); // load first item's metadata without autoplaying on page load
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
      name: link.name || (link.type === 'youtube' ? 'YouTube video' : nameFromUrl(link.url)),
      url: link.url,
      file: null,
      isRemote: true,
      type: link.type === 'youtube' ? 'youtube' : 'video',
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
  renderPlaylist(); // in case that url is also sitting in Now Playing
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
    const displayName = link.name || (isYoutube ? 'YouTube video' : nameFromUrl(link.url));
    li.innerHTML = `
      <div class="thumb">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="meta">
        <div class="name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}${isYoutube ? '<span class="yt-badge">YouTube</span>' : ' <span style="color:#666;">(URL)</span>'}</div>
      </div>
      <div class="item-actions">
        <button class="load-btn" title="Load and play">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="remove-btn" title="Remove from this playlist">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.41 6.3-6.29 6.3 6.29 1.41-1.41-6.3-6.29 6.3-6.3z"/></svg>
        </button>
      </div>`;
    li.querySelector('.load-btn').addEventListener('click', () => loadSavedLink(pl.id, link.url));
    li.querySelector('.remove-btn').addEventListener('click', () => removeSavedLink(pl.id, link.url));
    savedItemsEl.appendChild(li);
  });
}
function renderPlaylistTabs() {
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
    // The Now Playing list's save icons reflect the ACTIVE saved
    // playlist's contents, which just changed — refresh them now
    // (even while hidden) so they're already correct if the person
    // switches back to the Now Playing tab.
    renderPlaylist();
  } else {
    savedItemsEl.classList.add('hidden');
    playlistItemsEl.classList.remove('hidden');
  }
}

// Called by controls.js when the "multiple playlists" Extra Feature
// toggle is flipped, so the Saved tab UI reflects the change.
export function onMultiFeatureToggled() {
  renderPlaylistTabs();
  if (!state.features.multi && state.activeSavedPlaylistId !== 'default') {
    state.activeSavedPlaylistId = 'default';
    if (!savedItemsEl.classList.contains('hidden')) renderSavedList();
  }
}

function closeNewPlaylistOverlay() {
  newPlaylistOverlay.classList.add('hidden');
  pendingNewPlaylistItem = null; // cancelled — don't carry the item into a later create
}

function wireSavedPlaylists() {
  playlistTabs.addEventListener('click', (e) => {
    const tabEl = e.target.closest('.playlist-tab');
    if (!tabEl) return;
    if (tabEl.dataset.tab === '__add__') {
      pendingNewPlaylistItem = null; // plain "+" tab: just create an empty playlist
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

    // Came from a bookmark's "+ New playlist…" row: put that video in the
    // new playlist and stay on the Now Playing tab.
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

  // "Save to playlist" menu: close on outside click, Escape, or when the
  // list scrolls (the menu is positioned once, next to its bookmark button).
  document.addEventListener('click', () => closeSaveMenu());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSaveMenu(); });
  playlistItemsEl.addEventListener('scroll', closeSaveMenu);
}

/* ============================================================
   URL / YouTube-link add flow
   ============================================================ */
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
  const wasEmpty = state.playlist.length === 0;
  state.playlist.push({
    id: uid(),
    name: youtubeId ? 'YouTube video' : nameFromUrl(u),
    url: u,
    file: null,
    isRemote: true,
    type: youtubeId ? 'youtube' : 'video',
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
  else showToast(youtubeId ? 'Added YouTube video' : 'Added video from URL');
  if (!youtubeId) video.addEventListener('error', onRemoteVideoError, { once: true });
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

/* ============================================================
   File-picker triggers + change handler
   ============================================================ */
function wireFileInput() {
  addMoreBtn.addEventListener('click', () => fileInput.click());
  addFilesTopBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    // course-feature.js can set data-insert-at on the input just before
    // it dispatches a synthetic 'change', to have the files inserted at
    // a specific position (restoring a removed lesson to where it was).
    const raw = fileInput.dataset.insertAt;
    const insertAt = raw !== undefined && raw !== '' ? parseInt(raw, 10) : undefined;
    handleFiles(e.target.files, Number.isNaN(insertAt) ? undefined : insertAt);
    fileInput.value = '';
  });
}

/* ============================================================
   Prev / next
   ============================================================ */
function wirePrevNext() {
  prevBtn.addEventListener('click', () => {
    if (state.currentIndex > 0) loadVideo(state.currentIndex - 1);
  });
  nextBtn.addEventListener('click', () => {
    if (state.currentIndex < state.playlist.length - 1) loadVideo(state.currentIndex + 1);
  });
}

/* ============================================================
   Native <video> duration → item.duration + re-render
   (the YouTube equivalent lives in media.js's onYtReady, which calls
   setOnDurationCallback's registered function — renderPlaylist, below)
   ============================================================ */
function wireNativeDurationTracking() {
  video.addEventListener('loadedmetadata', () => {
    durTimeEl.textContent = fmtTime(video.duration);
    if (state.currentIndex !== -1 && state.playlist[state.currentIndex]) {
      state.playlist[state.currentIndex].duration = video.duration;
      renderPlaylist();
    }
  });
}

/* ============================================================
   Init
   ============================================================ */
export function initPlaylist() {
  setOnEndedCallback(() => {
    if (state.currentIndex < state.playlist.length - 1) loadVideo(state.currentIndex + 1);
  });
  setOnDurationCallback(renderPlaylist);

  // The old header "save all links" bookmark button was removed as a
  // feature (saving is now per-video, via each row's bookmark). Remove
  // its leftover markup if index.html still has it, so it can't show up
  // as a dead button.
  const legacySaveBtn = document.getElementById('saveLinksBtn');
  if (legacySaveBtn) legacySaveBtn.remove();

  injectSaveMenuStyles();
  wireFileInput();
  wirePrevNext();
  wireSavedPlaylists();
  wireUrlAdd();
  wireNativeDurationTracking();

  restoreSavedLinks();
  renderPlaylist();
}