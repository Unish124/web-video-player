video-player/course-feature.js

Unchanged from what already exists — the "Open Course Folder" feature. Self-contained IIFE, no changes needed.

video-player/css/player.css

The entire <style>...</style> block from the current mainstable.html, moved out verbatim — every rule from :root{...} down through the @media (max-width:760px) block at the end. Nothing added or removed, just relocated. Linked from index.html's <head> via <link rel="stylesheet" href="css/player.css">.

video-player/index.html

Just the markup: the <head> (minus the <style> block, replaced by the <link> above) and the entire <body> — the #app div with the drop zone, player wrapper, playlist panel, all the overlays (shortcuts, features, new-playlist, study timer), etc. No <style> and no inline <script> left. Ends with the three script tags:

html
  <script type="module" src="src/main.js"></script>
  <script src="course-feature.js"></script>
  <script type="module" src="playback-enhancements/index.js"></script>
</body>
</html>
video-player/playback-enhancements/duration.js

Video/playlist-length feature only: file-duration probing (probeFileDuration, the hidden-video-element technique), learning durations from actual playback (loadedmetadata/durationchange on the native #video), the MutationObserver that re-fills playlist rows after native re-renders, the total-length badge, and its own on/off toggle + the settings-menu section for it. Exports an init() that index.js calls. Imports shared refs/helpers from index.js.

video-player/playback-enhancements/index.js

Entry point and the shared layer both other files in this folder depend on: the native-element refs (nativeVideo, nativeFileInput, nativePlaylistItems, nativeSettingsMenu, etc.) with the "bail out if the player isn't found" guard, small helpers (fmtTimePE, showToastPE, clampSpeed, loadBoolPref/saveBoolPref), and injectStyles() holding the CSS for both features. At the bottom: waits for DOM-ready, then calls duration.init() and speed.init().

video-player/playback-enhancements/speed.js

Custom-speed feature only: the slider panel (readout, steppers, draggable range, preset chips, pinned "P" chip), syncing with the native preset buttons via ratechange, and its own on/off toggle + settings-menu section. Exports init(). Imports shared refs/helpers from index.js.

video-player/src/controls.js

Everything about the player's chrome/controls: play/pause, gesture zones (click/dblclick seek), progress bar + scrubbing + hover-thumbnail preview, volume (slider, mute, wheel), playback speed presets + skip-amount + button-size options (the ⚙ settings menu's own native content), native loop button, A/B loop, PiP, theater mode, fullscreen, auto-hide-controls timer, the per-control show/hide toggles + reset button, and the "Extra features" overlay (the four feature toggles: resume/multi/abloop/timer). This is the biggest file — it's "everything that isn't playlist data or the timer panel."

video-player/src/core.js

DOM element references (every const x = document.getElementById(...) line) and the shared state object, exported for every other module to import. Plus the small cross-cutting helpers: fmtTime, showToast, uid, escapeHtml, the ICONS map, and localStorage pref load/save wrappers. This file has no behavior of its own — it exists so nothing else has to duplicate refs or helpers.

video-player/src/main.js

Entry point. Imports every other src/ module, calls each one's init() in the right order, wires up the top-level things that don't belong to any single module (drag & drop on document, the global keyboard-shortcut handler, the shortcuts-help overlay), and restores saved volume/state on load. This is the only file index.html links directly from src/.

video-player/src/media.js

The video/YouTube abstraction layer: mediaDuration, mediaCurrentTime, mediaSeek, isPausedNow, pauseMedia, isCurrentYouTube, plus all the YouTube IFrame API code (loadYouTubeAPI, createYtPlayer, onYtReady, onYtStateChange, updateYtProgress). Exists as its own file because both playlist.js (loading a YouTube item) and controls.js (seeking, volume, speed on whatever's currently playing) need to go through it rather than talking to <video> or YT.Player directly.

video-player/src/playlist.js

Everything playlist-data-related: handleFiles, loadVideo, removeFromPlaylist, renderPlaylist (the "Now Playing" list), the saved/multi-playlist tabs + their localStorage persistence (create/delete/load/remove-from-saved playlist), and the URL/YouTube-link add flow (addUrlToPlaylist, getYouTubeId, nameFromUrl, both the inline row and the modal). Grouped together because all of it is "how items get in and out of the playlist," regardless of source.

video-player/src/study-timer.js

The whole draggable/resizable study-timer panel: duration presets, custom-minutes input, start/pause/resume/stop, the countdown tick, the minimal ("H") mode, drag-to-move, drag-to-resize, geometry persistence, and the fullscreen pill. Kept separate from controls.js since it's a large, fully self-contained feature that only needs pauseMedia() from media.js and nothing else from the rest of the app.