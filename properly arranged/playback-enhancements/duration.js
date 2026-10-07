/*!
 * duration.js
 * Video length + total playlist length feature for playback-enhancements.
 *
 * Exports a single function, initDuration(deps), called once by index.js
 * after the DOM is ready. This file does NOT import anything from
 * index.js — that would create a circular import (index.js → duration.js
 * → index.js). Instead, everything it needs is handed to it as `deps`:
 *
 *   deps.nativeApp            — the <div id="app"> root
 *   deps.nativeVideo          — the native <video id="video">
 *   deps.nativeFileInput      — the native <input id="fileInput">
 *   deps.nativePlaylistItems  — the native <ul id="playlistItems">
 *   deps.nativePlaylistPanel  — the native <div id="playlistPanel">
 *   deps.nativePlaylistTabs   — the native <div id="playlistTabs">
 *   deps.nativePlayerWrapper  — the native <div id="playerWrapper">
 *   deps.nativeSettingsMenu   — the native <div id="settingsMenu">
 *   deps.nativeSettingsMainPanel — the settings menu's main category
 *                              list (<div id="settingsMainPanel">), if
 *                              the drill-down settings menu markup is
 *                              present. This file's toggle row is
 *                              appended here instead of directly onto
 *                              nativeSettingsMenu, so it shows up as a
 *                              row in the main list rather than always
 *                              being visible under every submenu too.
 *                              Falls back to nativeSettingsMenu itself
 *                              if this isn't provided.
 *   deps.fmtTime(seconds)     — "H:MM:SS" / "M:SS" formatter
 *   deps.showToast(msg)       — shows a message in the native toast
 *   deps.isYouTubeActive()    — true while playerWrapper is in yt-mode
 *   deps.loadBoolPref(key, fallback)
 *   deps.saveBoolPref(key, value)
 *
 * CSS for the elements this file creates (.pe-total-badge, .pe-title-row,
 * the mini toggle switch, #app.pe-hide-lengths rules) lives in index.js's
 * injectStyles() — shared with speed.js, not duplicated here.
 *
 * How durations are learned (see file header notes in the project docs
 * for the two known limitations — YouTube items, and name-based matching):
 *   a) Local files: intercepted on #fileInput's 'change' event (fires for
 *      user-picked files AND course-feature.js's synthetic import) —
 *      each file's duration is probed with a detached, hidden <video>,
 *      keyed by file name.
 *   b) Anything that actually plays (typed-in URLs, files once loaded):
 *      read directly off the real #video element's own
 *      'loadedmetadata'/'durationchange' events, keyed by the name of
 *      whichever row currently has the native '.playing' class.
 * A MutationObserver on #playlistItems re-applies known durations any
 * time the native code rebuilds the list, since that rebuild replaces
 * the row markup wholesale.
 */

const VIDEO_EXT_RE = /\.(mkv|mov|avi|webm|mp4|m4v|ogv)$/i;

function isVideoFile(file) {
  return (file.type && file.type.startsWith('video/')) || VIDEO_EXT_RE.test(file.name);
}

export function initDuration(deps) {
  const {
    nativeApp, nativeVideo, nativeFileInput, nativePlaylistItems,
    nativePlaylistPanel, nativePlaylistTabs, nativePlayerWrapper,
    nativeSettingsMenu, nativeSettingsMainPanel, fmtTime, showToast, isYouTubeActive,
    loadBoolPref, saveBoolPref
  } = deps;

  /* ============================================================
     State
     ============================================================ */
  const durationsByName = new Map(); // video name -> seconds
  let showLengths = loadBoolPref('pe_showLengths', true);

  /* ============================================================
     Probing durations for local files (via #fileInput 'change')
     ============================================================ */
  let probeContainer = null;
  function ensureProbeContainer() {
    if (probeContainer) return probeContainer;
    probeContainer = document.createElement('div');
    probeContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
    document.body.appendChild(probeContainer);
    return probeContainer;
  }
  function probeFileDuration(file) {
    const container = ensureProbeContainer();
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    const url = URL.createObjectURL(file);
    probe.src = url;
    container.appendChild(probe);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      probe.removeAttribute('src');
      probe.load();
      if (probe.parentNode) probe.parentNode.removeChild(probe);
    };
    probe.addEventListener('loadedmetadata', () => {
      if (isFinite(probe.duration) && probe.duration > 0) {
        durationsByName.set(file.name, probe.duration);
        scheduleRefresh();
      }
      cleanup();
    }, { once: true });
    probe.addEventListener('error', cleanup, { once: true });
  }
  nativeFileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    Array.from(files).forEach(file => {
      if (isVideoFile(file)) probeFileDuration(file);
    });
  });

  /* ============================================================
     Learning durations from whatever is actually playing
     (typed-in URLs, or files once their metadata loads anyway)
     ============================================================ */
  function currentPlayingName() {
    const row = nativePlaylistItems.querySelector('.playlist-item.playing .name');
    return row ? row.getAttribute('title') : null;
  }
  function recordCurrentDuration() {
    if (isYouTubeActive()) return; // not reachable from outside the native script
    if (!isFinite(nativeVideo.duration) || nativeVideo.duration <= 0) return;
    const name = currentPlayingName();
    if (!name) return;
    durationsByName.set(name, nativeVideo.duration);
    scheduleRefresh();
  }
  nativeVideo.addEventListener('loadedmetadata', recordCurrentDuration);
  nativeVideo.addEventListener('durationchange', recordCurrentDuration);

  /* ============================================================
     Rendering: fill in row lengths + total, on every list change
     ============================================================ */
  let peTotalBadge;
  let refreshQueued = false;
  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; refresh(); });
  }
  function refresh() {
    const rows = Array.from(nativePlaylistItems.children);
    let totalKnown = 0, unknownCount = 0, ytCount = 0;

    rows.forEach(row => {
      const nameDiv = row.querySelector('.name');
      const durDiv = row.querySelector('.dur');
      if (!nameDiv) return;
      const isYt = !!row.querySelector('.yt-badge');
      if (isYt) { ytCount++; return; }
      const name = nameDiv.getAttribute('title');
      const dur = name != null ? durationsByName.get(name) : null;
      if (dur != null && isFinite(dur)) {
        totalKnown += dur;
        if (durDiv && !durDiv.textContent) durDiv.textContent = fmtTime(dur);
      } else {
        unknownCount++;
      }
    });

    if (peTotalBadge) {
      const n = rows.length;
      let text = `${n} video${n !== 1 ? 's' : ''} \u2022 ${fmtTime(totalKnown)} total`;
      if (unknownCount) text += ` (+${unknownCount} not yet loaded)`;
      if (ytCount) text += ` \u2022 ${ytCount} YouTube not counted`;
      peTotalBadge.textContent = n ? text : '';
    }
  }
  new MutationObserver(scheduleRefresh).observe(nativePlaylistItems, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });

  /* ============================================================
     Show/hide toggle for the length displays
     ============================================================ */
  function applyShowLengths() {
    nativeApp.classList.toggle('pe-hide-lengths', !showLengths);
  }

  /* ============================================================
     UI: total badge (sibling of the playlist header, not a child
     of it — avoids touching the header's own flex layout/children)
     and a toggle row appended into the settings menu's main category
     list (nativeSettingsMainPanel) — falling back to the flat
     nativeSettingsMenu if that panel doesn't exist.
     ============================================================ */
  function buildTotalBadge() {
    peTotalBadge = document.createElement('div');
    peTotalBadge.id = 'peTotalBadge';
    peTotalBadge.className = 'pe-total-badge';
    nativePlaylistPanel.insertBefore(peTotalBadge, nativePlaylistTabs);
  }

  function buildSettingsSection() {
    const wrap = document.createElement('div');
    wrap.className = 'pe-settings-block';
    wrap.innerHTML = `
      <div class="menu-divider"></div>
      <div class="menu-title pe-title-row">
        <span>Video &amp; playlist lengths</span>
        <div class="toggle-switch mini" id="peLengthsToggle"><div class="knob"></div></div>
      </div>
    `;
    (nativeSettingsMainPanel || nativeSettingsMenu).appendChild(wrap);

    const toggle = wrap.querySelector('#peLengthsToggle');
    toggle.classList.toggle('on', showLengths);

    // Prevent clicks inside this row from bubbling to the document-level
    // listener that closes the settings menu on any outside click.
    wrap.addEventListener('click', e => e.stopPropagation());

    toggle.addEventListener('click', () => {
      showLengths = !showLengths;
      toggle.classList.toggle('on', showLengths);
      saveBoolPref('pe_showLengths', showLengths);
      applyShowLengths();
      showToast(showLengths ? 'Showing video/playlist lengths' : 'Hiding video/playlist lengths');
    });
  }

  /* ============================================================
     Init
     ============================================================ */
  buildTotalBadge();
  buildSettingsSection();
  applyShowLengths();
  refresh();

  return { refresh };
}