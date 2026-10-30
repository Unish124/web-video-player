/* playback-enhancements/index.js: shared helpers and styles for custom speed and lengths */

import { initDuration } from './duration.js';
import { initSpeed } from './speed.js';

const nativeApp           = document.getElementById('app');
const nativeVideo         = document.getElementById('video');
const nativeFileInput     = document.getElementById('fileInput');
const nativePlaylistItems = document.getElementById('playlistItems');
const nativePlaylistPanel = document.getElementById('playlistPanel');
const nativePlaylistTabs  = document.getElementById('playlistTabs');
const nativePlayerWrapper = document.getElementById('playerWrapper');
const nativeSettingsMenu  = document.getElementById('settingsMenu');
const nativeSpeedOptions  = document.getElementById('speedOptions');
const nativeToast         = document.getElementById('toast');

const nativeSettingsMainPanel = document.getElementById('settingsMainPanel');
const nativeSpeedSubmenuPanel = document.getElementById('settingsSpeedPanel');

const REQUIRED_ELEMENTS = [
  nativeApp, nativeVideo, nativeFileInput, nativePlaylistItems,
  nativePlaylistPanel, nativePlaylistTabs, nativePlayerWrapper,
  nativeSettingsMenu, nativeSpeedOptions, nativeToast
];

function fmtTimePE(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function showToastPE(msg) {
  nativeToast.textContent = msg;
  nativeToast.classList.add('show');
  clearTimeout(showToastPE._t);
  showToastPE._t = setTimeout(() => nativeToast.classList.remove('show'), 1800);
}

function isYouTubeActive() {
  return nativePlayerWrapper.classList.contains('yt-mode') || nativePlayerWrapper.classList.contains('fb-mode');
}

function loadBoolPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw === '1';
  } catch (e) {}
  return fallback;
}

function saveBoolPref(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch (e) {}
}

function injectStyles() {
  const style = document.createElement('style');
  style.id = 'peStyles';
  style.textContent = `
    .pe-title-row{
      display:flex;align-items:center;justify-content:space-between;
      padding-right:14px;
    }

    .pe-speed-panel{
      padding:4px 14px 10px;
      max-height:200px; opacity:1;
      transition:max-height var(--dur-base,260ms) var(--ease-snap,ease-in-out), opacity var(--dur-fast,140ms) var(--ease-smooth,ease-out), padding var(--dur-base,260ms) var(--ease-snap,ease-in-out);
      overflow:hidden;
    }
    .pe-speed-panel.hidden{ max-height:0; opacity:0; padding-top:0; padding-bottom:0; }
    .pe-speed-display{
      text-align:center;font-size:1.15rem;font-weight:700;color:#fff;
      margin-bottom:8px;font-variant-numeric:tabular-nums;
    }
    .pe-speed-slider-row{
      display:flex;align-items:center;gap:10px;margin-bottom:10px;
    }
    .pe-step-btn{
      background:#2a2a2a;border:1px solid #3a3a3a;color:#eee;
      width:26px;height:26px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:.95rem;line-height:1;cursor:pointer;
      transition:background var(--dur-fast,140ms) var(--ease-smooth,ease-out), transform var(--dur-fast,140ms) var(--ease-spring,ease-out);
    }
    .pe-step-btn:hover{ background:#3a3a3a;color:#fff; transform:scale(1.12); }
    .pe-step-btn:active{ transform:scale(.9); }
    .pe-speed-slider-row input[type=range]{
      flex:1;min-width:0;-webkit-appearance:none;appearance:none;
      height:4px;border-radius:2px;outline:none;cursor:pointer;
      background:linear-gradient(to right, var(--accent) 0%, #4d4d4d 0%);
    }
    .pe-speed-slider-row input[type=range]::-webkit-slider-thumb{
      -webkit-appearance:none;width:15px;height:15px;border-radius:50%;
      background:#fff;box-shadow:0 0 2px rgba(0,0,0,.6);cursor:pointer;
      margin-top:0;
    }
    .pe-speed-slider-row input[type=range]::-moz-range-thumb{
      width:15px;height:15px;border-radius:50%;border:none;
      background:#fff;box-shadow:0 0 2px rgba(0,0,0,.6);cursor:pointer;
    }
    .pe-speed-chips{
      display:flex;flex-wrap:wrap;gap:6px;
    }
    .pe-chip{
      background:#2a2a2a;border:1px solid #3a3a3a;color:#ddd;
      padding:5px 11px;border-radius:14px;font-size:.74rem;font-weight:600;
      cursor:pointer;
      transition:background var(--dur-fast,140ms) var(--ease-smooth,ease-out), transform var(--dur-fast,140ms) var(--ease-spring,ease-out), color var(--dur-fast,140ms) var(--ease-smooth,ease-out);
    }
    .pe-chip:hover{ background:#3a3a3a;color:#fff; transform:translateY(-1px) scale(1.04); }
    .pe-chip:active{ transform:scale(.95); }
    .pe-chip.selected{ background:var(--accent);border-color:var(--accent);color:#fff; }
    .pe-chip-pinned{ display:flex;align-items:center;gap:5px; }
    .pe-pin-flag{
      background:var(--accent);color:#fff;font-size:.62rem;font-weight:800;
      padding:0 4px;border-radius:3px;line-height:1.3;
    }
    .pe-chip-pinned.selected .pe-pin-flag{ background:#fff;color:var(--accent); }

    .pe-total-badge{
      padding:6px 16px 10px;
      font-size:.74rem;color:var(--text-dim);
      border-bottom:1px solid var(--border);
      flex-shrink:0;
    }
    #app.pe-hide-lengths .pe-total-badge{ display:none; }
    #app.pe-hide-lengths .playlist-item .dur{ display:none; }
  `;
  document.head.appendChild(style);
}

function init() {
  injectStyles();

  const deps = {
    nativeApp, nativeVideo, nativeFileInput, nativePlaylistItems,
    nativePlaylistPanel, nativePlaylistTabs, nativePlayerWrapper,
    nativeSettingsMenu, nativeSpeedOptions, nativeToast,
    nativeSettingsMainPanel, nativeSpeedSubmenuPanel,
    fmtTime: fmtTimePE,
    showToast: showToastPE,
    isYouTubeActive,
    loadBoolPref,
    saveBoolPref
  };

  initDuration(deps);
  initSpeed(deps);
}

function boot() {
  if (REQUIRED_ELEMENTS.some(el => !el)) {
    console.warn('[playback-enhancements] Expected player elements not found — feature disabled.');
    return;
  }
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
