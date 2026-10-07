/*!
 * core.js
 * The one file every other src/ module imports from. Has no imports of
 * its own — it's the leaf of the dependency graph:
 *
 *   core.js  <-  media.js  <-  controls.js, playlist.js, study-timer.js
 *                                        ^
 *                              (all of these also import core.js directly)
 *
 * Exports:
 *   state          — the shared mutable state object every module reads
 *                    and writes (playlist data, playback flags, feature
 *                    toggles, A/B loop points, study timer state, etc.)
 *   DOM refs        — one exported const per element this app touches,
 *                    looked up once by id at module load.
 *   ICONS           — the inline-SVG markup map for icon-button states.
 *   fmtTime(sec)    — "H:MM:SS" / "M:SS" formatter.
 *   showToast(msg)  — shows a message in the native toast element.
 *   uid()           — short random id, used for playlist item ids.
 *   escapeHtml(s)   — text-safe HTML-escaping for anything rendered via
 *                    innerHTML (playlist names, saved-link names, etc.)
 */

/* ============================================================
   DOM references
   ============================================================ */
const $ = id => document.getElementById(id);

export const app                    = $('app');
export const dropZone                = $('dropZone');
export const fileInput               = $('fileInput');
export const openBtn                 = $('openBtn');
export const playerWrapper           = $('playerWrapper');
export const video                   = $('video');
export const thumbVideo              = $('thumbVideo');
export const thumbCanvas             = $('thumbCanvas');
export const topBar                  = $('topBar');
export const videoTitle              = $('videoTitle');
export const bottomControls          = $('bottomControls');
export const progressBar             = $('progressBar');
export const progressTrack           = $('progressTrack');
export const bufferedBar             = $('bufferedBar');
export const playedBar               = $('playedBar');
export const hoverBar                = $('hoverBar');
export const progressHandle          = $('progressHandle');
export const progressTooltip         = $('progressTooltip');
export const tooltipCanvas           = $('tooltipCanvas');
export const tooltipTime             = $('tooltipTime');
export const abSegmentBar            = $('abSegmentBar');
export const abMarkerAEl             = $('abMarkerA');
export const abMarkerBEl             = $('abMarkerB');
export const playBtn                 = $('playBtn');
export const prevBtn                 = $('prevBtn');
export const nextBtn                 = $('nextBtn');
export const muteBtn                 = $('muteBtn');
export const volumeSlider            = $('volumeSlider');
export const volumeGroup             = $('volumeGroup');
export const curTimeEl               = $('curTime');
export const durTimeEl               = $('durTime');
export const loopBtn                 = $('loopBtn');
export const settingsBtn             = $('settingsBtn');
export const settingsMenu            = $('settingsMenu');
// Settings menu: drill-down panels (main list + one submenu per
// category). Only one of these has the .active class at a time —
// see controls.js's showSettingsPanel()/wireSettingsNavigation().
export const settingsMainPanel       = $('settingsMainPanel');
export const settingsSpeedPanel      = $('settingsSpeedPanel');
export const settingsSkipPanel       = $('settingsSkipPanel');
export const settingsBtnSizePanel    = $('settingsBtnSizePanel');
// The "current value" labels shown next to each category row in the
// main settings panel (e.g. "Normal", "10 seconds", "Large").
export const speedRowValue           = $('speedRowValue');
export const skipRowValue            = $('skipRowValue');
export const btnSizeRowValue         = $('btnSizeRowValue');
export const speedOptions            = $('speedOptions');
export const skipOptions             = $('skipOptions');
export const btnSizeOptions          = $('btnSizeOptions');
export const controlTogglesContainer = $('controlToggles');
export const resetControlVisibilityBtn = $('resetControlVisibilityBtn');
export const pipBtn                  = $('pipBtn');
export const theaterBtn              = $('theaterBtn');
export const fullscreenBtn           = $('fullscreenBtn');
export const playlistToggleBtn       = $('playlistToggleBtn');
export const addFilesTopBtn          = $('addFilesTopBtn');
export const playlistPanel           = $('playlistPanel');
export const playlistItemsEl         = $('playlistItems');
export const playlistTabs            = $('playlistTabs');
export const savedItemsEl            = $('savedItems');
export const savedCountBadge         = $('savedCountBadge');
export const extraPlaylistTabs       = $('extraPlaylistTabs');
export const addPlaylistTab          = $('addPlaylistTab');
export const featuresBtn             = $('featuresBtn');
export const featuresOverlay         = $('featuresOverlay');
export const featuresCloseBtn        = $('featuresCloseBtn');
export const newPlaylistOverlay      = $('newPlaylistOverlay');
export const newPlaylistInput        = $('newPlaylistInput');
export const newPlaylistAddBtn       = $('newPlaylistAddBtn');
export const newPlaylistCloseBtn     = $('newPlaylistCloseBtn');
export const abLoopBtn               = $('abLoopBtn');
export const studyTimerBtn           = $('studyTimerBtn');
export const studyTimerMenu          = $('studyTimerMenu');
export const studyTimerHeader        = $('studyTimerHeader');
export const studyTimerCloseX        = $('studyTimerCloseX');
export const studyTimerHideBtn       = $('studyTimerHideBtn');
export const studyTimerResizeHandle  = $('studyTimerResizeHandle');
export const studyTimerSetup         = $('studyTimerSetup');
export const studyTimerRun           = $('studyTimerRun');
export const studyTimerEditBtn       = $('studyTimerEditBtn');
export const studyTimerDurations     = $('studyTimerDurations');
export const studyTimerCustomInput   = $('studyTimerCustomInput');
export const studyTimerCountdown     = $('studyTimerCountdown');
export const studyTimerStartBtn      = $('studyTimerStartBtn');
export const studyTimerStopBtn       = $('studyTimerStopBtn');
export const saveLinksBtn            = $('saveLinksBtn');
export const addMoreBtn              = $('addMoreBtn');
export const addUrlBtn2              = $('addUrlBtn2');
export const closePlaylistBtn        = $('closePlaylistBtn');
export const centerIcon              = $('centerIcon');
export const spinner                 = $('spinner');
export const holdSpeedIndicator      = $('holdSpeedIndicator');
export const flashLeft               = $('flashLeft');
export const flashRight              = $('flashRight');
export const flashLeftLabel          = $('flashLeftLabel');
export const flashRightLabel         = $('flashRightLabel');
export const zoneLeft                = $('zoneLeft');
export const zoneCenter              = $('zoneCenter');
export const zoneRight               = $('zoneRight');
export const shortcutsOverlay        = $('shortcutsOverlay');
export const shortcutsGrid           = $('shortcutsGrid');
export const shortcutsCloseBtn       = $('shortcutsCloseBtn');
export const toast                   = $('toast');
export const fsStudyTimerPill        = $('fsStudyTimerPill');
export const fsPillTime              = $('fsPillTime');
export const fsPillCloseBtn          = $('fsPillCloseBtn');
export const urlInput                = $('urlInput');
export const urlAddBtn               = $('urlAddBtn');
export const urlError                = $('urlError');
export const urlModalOverlay         = $('urlModalOverlay');
export const urlModalInput           = $('urlModalInput');
export const urlModalAddBtn          = $('urlModalAddBtn');
export const urlModalError           = $('urlModalError');
export const urlModalCloseBtn        = $('urlModalCloseBtn');
export const youtubePlayerContainer  = $('youtubePlayerContainer');

/* ============================================================
   Shared state — one object, mutated in place by every module
   that needs to. Persisted preferences are loaded synchronously
   here, at module-init time, exactly as the original inline
   script did.
   ============================================================ */
export const state = {
  playlist: [],        // {id, name, url, file, duration, isRemote, type, youtubeId, nativeIndex}
  currentIndex: -1,
  isScrubbing: false,
  lastVolume: 1,
  loopOne: false,
  hideTimer: null,
  playlistOpen: false,
  theater: false,
  manualHide: false,
  spaceKeyDown: false,
  spaceIsHolding: false,
  spaceHoldTimer: null,
  preHoldRate: null,
  skipSeconds: (function () {
    try {
      const saved = parseInt(localStorage.getItem('lvp_skipSeconds'), 10);
      if ([5, 10, 15, 20, 30].includes(saved)) return saved;
    } catch (e) {}
    return 10;
  })(),
  buttonSize: (function () {
    try {
      const saved = localStorage.getItem('lvp_buttonSize');
      if (['sm', 'md', 'lg', 'xl'].includes(saved)) return saved;
    } catch (e) {}
    return 'lg';
  })(),
  features: (function () {
    const defaults = { resume: false, multi: false, abloop: false, timer: false };
    try {
      const raw = localStorage.getItem('lvp_features');
      if (raw) return Object.assign(defaults, JSON.parse(raw));
    } catch (e) {}
    return defaults;
  })(),
  hiddenControls: (function () {
    try {
      const raw = localStorage.getItem('lvp_hiddenControls');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {};
  })(),
  activeSavedPlaylistId: 'default',
  abLoop: { a: null, b: null, active: false },
  studyTimer: {
    running: false, paused: false, endAt: null, pausedRemaining: null,
    totalSeconds: 25 * 60, intervalId: null, selectedMinutes: 25, pillDismissed: false
  }
};

/* ============================================================
   Icon markup
   ============================================================ */
export const ICONS = {
  play:  '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  volHigh:'<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  volLow:'<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5l-5 5H3z"/></svg>',
  volMute:'<svg viewBox="0 0 24 24"><path d="m16.5 12-2.02-2.02L16.5 7.96 15.44 6.9l-2.02 2.02L11.4 6.9 10.34 7.96l2.02 2.02L10.34 12l1.06 1.06 2.02-2.02 2.02 2.02zM3 10v4h4l5 5V5l-5 5H3z" opacity="0"/><path d="M4.34 2.93 2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l1.75 1.75 1.41-1.41L4.34 2.93zM19 12c0-1.77-1.02-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24zm-7-8-1.02.82L12 5.87V4zm7.94 14.31 1.51 1.51A8.968 8.968 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71 0 2.06-.89 3.9-2.06 5.31z"/></svg>',
  pipEnter:'<svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-2-8h-7v4h7v-4z"/></svg>',
  fsEnter:'<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  fsExit:'<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>'
};

/* ============================================================
   Small shared helpers
   ============================================================ */
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}