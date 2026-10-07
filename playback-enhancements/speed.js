/*!
 * speed.js
 * Custom playback speed feature for playback-enhancements — a YouTube-
 * style slider panel (big readout, −/+ steppers, preset chips, and a
 * "pinned" chip for whatever custom value was last used) on top of the
 * native preset list already in the ⚙ settings menu's "Playback speed"
 * submenu.
 *
 * Exports a single function, initSpeed(deps), called once by index.js
 * after the DOM is ready. This file does NOT import anything from
 * index.js — that would create a circular import (index.js → speed.js
 * → index.js). Instead, everything it needs is handed to it as `deps`:
 *
 *   deps.nativeVideo         — the native <video id="video">
 *   deps.nativePlayerWrapper — the native <div id="playerWrapper">
 *   deps.nativeSpeedOptions  — the native <div id="speedOptions">
 *                              (the preset speed buttons already there)
 *   deps.nativeSettingsMenu  — the native <div id="settingsMenu">
 *   deps.nativeSpeedSubmenuPanel — the "Playback speed" submenu panel
 *                              (<div id="settingsSpeedPanel">), if the
 *                              drill-down settings menu markup is
 *                              present. This file's toggle + slider
 *                              block is appended here, right after the
 *                              native preset list, instead of directly
 *                              onto nativeSettingsMenu — so it lives
 *                              inside the speed submenu instead of
 *                              always being visible under every other
 *                              submenu too. Falls back to
 *                              nativeSettingsMenu if this isn't provided.
 *   deps.showToast(msg)      — shows a message in the native toast
 *   deps.isYouTubeActive()   — true while playerWrapper is in yt-mode
 *   deps.loadBoolPref(key, fallback)
 *   deps.saveBoolPref(key, value)
 *
 * CSS for the elements this file creates (.pe-speed-panel and its
 * children, .pe-chip, .pe-pin-flag, .pe-title-row) lives in index.js's
 * injectStyles() — shared with duration.js, not duplicated here.
 *
 * How it works:
 *   - Speed is applied by setting the real <video>.playbackRate, so the
 *     browser's own 'ratechange' event is how this file later detects
 *     "is a preset active, or is a custom value active?" — no access
 *     to the host page's internal JS variables is needed or used. That
 *     same 'ratechange' event is also how src/controls.js keeps the
 *     main settings panel's "Playback speed" row label in sync with
 *     whatever this file sets, without either file needing to import
 *     the other.
 *   - Whenever the active rate isn't one of the native presets, this
 *     file clears the native preset list's own .selected class itself
 *     (that list only updates .selected on its own clicks) so a stale
 *     preset never stays highlighted while a custom rate is playing.
 *   - Known limitation: YouTube-embedded links are controlled through
 *     the native script's own private YT.Player instance, which this
 *     file has no way to reach — custom speed only applies to local
 *     files and direct video-file URLs. A toast says so if you try.
 */

const PRESET_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_EPSILON = 0.0005;
const SLIDER_MIN = 0.1;
const SLIDER_MAX = 4;
const SLIDER_STEP = 0.05;
const NUDGE_STEP = 0.1;

function fmtSpeedLabelPE(v) {
  // Clean label: "1x", "1.25x", "0.4x" — no trailing zeros.
  return (Math.round(v * 100) / 100).toString() + 'x';
}
function isMatchingPreset(rate) {
  return PRESET_SPEEDS.some(p => Math.abs(p - rate) < RATE_EPSILON);
}
function clampSpeed(v) {
  if (!isFinite(v)) return null;
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v));
}

export function initSpeed(deps) {
  const {
    nativeVideo, nativePlayerWrapper, nativeSpeedOptions,
    nativeSettingsMenu, nativeSpeedSubmenuPanel, showToast, isYouTubeActive,
    loadBoolPref, saveBoolPref
  } = deps;

  /* ============================================================
     State
     ============================================================ */
  let speedPanelEnabled = loadBoolPref('pe_speedEnabled', false); // off by default, like the app's own "Extra features"
  let lastCustomSpeed = (function () {
    try {
      const v = parseFloat(localStorage.getItem('pe_lastCustomSpeed'));
      return isFinite(v) ? clampSpeed(v) : null;
    } catch (e) { return null; }
  })();

  let peSpeedPanel, peSpeedDisplay, peSpeedSlider, peSpeedChips,
      peSpeedToggleSwitch, peSpeedMinusBtn, peSpeedPlusBtn;

  /* ============================================================
     Applying speed + keeping the UI in sync
     ============================================================ */
  function applySpeed(v, opts) {
    opts = opts || {};
    const clamped = clampSpeed(v);
    if (clamped == null) return;
    if (isYouTubeActive()) {
      showToast('Custom speed isn\u2019t available for YouTube videos');
      return;
    }
    nativeVideo.playbackRate = clamped; // fires 'ratechange' → syncSpeedUI()
    if (!opts.silent) showToast(`${fmtSpeedLabelPE(clamped)} speed`);
  }

  function updateSliderFill() {
    if (!peSpeedSlider) return;
    const pct = ((parseFloat(peSpeedSlider.value) - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
    peSpeedSlider.style.background =
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, #4d4d4d ${pct}%, #4d4d4d 100%)`;
  }

  function renderChips() {
    if (!peSpeedChips) return;
    peSpeedChips.innerHTML = '';
    const rate = nativeVideo.playbackRate;

    PRESET_SPEEDS.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pe-chip' + (Math.abs(p - rate) < RATE_EPSILON ? ' selected' : '');
      chip.textContent = p === 1 ? 'Normal' : fmtSpeedLabelPE(p);
      chip.addEventListener('click', (e) => { e.stopPropagation(); applySpeed(p); });
      peSpeedChips.appendChild(chip);
    });

    if (lastCustomSpeed != null && !isMatchingPreset(lastCustomSpeed)) {
      const pinnedChip = document.createElement('button');
      pinnedChip.type = 'button';
      pinnedChip.className = 'pe-chip pe-chip-pinned' +
        (Math.abs(lastCustomSpeed - rate) < RATE_EPSILON ? ' selected' : '');
      pinnedChip.innerHTML = `<span class="pe-pin-flag">P</span>${fmtSpeedLabelPE(lastCustomSpeed)}`;
      pinnedChip.title = 'Your last custom speed';
      pinnedChip.addEventListener('click', (e) => { e.stopPropagation(); applySpeed(lastCustomSpeed); });
      peSpeedChips.appendChild(pinnedChip);
    }
  }

  function syncSpeedUI() {
    const rate = nativeVideo.playbackRate;

    // Keep the native preset list's own highlighting honest: it only
    // updates .selected on its own clicks, so a custom rate set from
    // here would otherwise leave a stale preset looking selected.
    if (!isMatchingPreset(rate)) {
      Array.from(nativeSpeedOptions.children).forEach(opt => opt.classList.remove('selected'));
      lastCustomSpeed = rate;
      try { localStorage.setItem('pe_lastCustomSpeed', String(rate)); } catch (e) {}
    }

    if (peSpeedDisplay) peSpeedDisplay.textContent = fmtSpeedLabelPE(rate);
    if (peSpeedSlider) {
      peSpeedSlider.value = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, rate));
      updateSliderFill();
    }
    renderChips();
  }
  nativeVideo.addEventListener('ratechange', syncSpeedUI);

  function applySpeedPanelEnabled() {
    if (peSpeedPanel) peSpeedPanel.classList.toggle('hidden', !speedPanelEnabled);
    if (peSpeedToggleSwitch) peSpeedToggleSwitch.classList.toggle('on', speedPanelEnabled);
  }

  /* ============================================================
     UI: appended into the settings menu's "Playback speed" submenu
     panel (nativeSpeedSubmenuPanel), right after the native preset
     list already inside it — falling back to the flat
     nativeSettingsMenu if that panel doesn't exist. Nothing existing
     is edited — only new elements added.
     ============================================================ */
  function buildSettingsSection() {
    const wrap = document.createElement('div');
    wrap.className = 'pe-settings-block';
    wrap.innerHTML = `
      <div class="menu-divider"></div>
      <div class="menu-title pe-title-row">
        <span>Custom speed</span>
        <div class="toggle-switch mini" id="peSpeedToggle"><div class="knob"></div></div>
      </div>
      <div class="pe-speed-panel hidden" id="peSpeedPanel">
        <div class="pe-speed-display" id="peSpeedDisplay">1x</div>
        <div class="pe-speed-slider-row">
          <button type="button" class="pe-step-btn" id="peSpeedMinus" title="Slower">\u2212</button>
          <input type="range" id="peSpeedSlider" min="${SLIDER_MIN}" max="${SLIDER_MAX}" step="${SLIDER_STEP}" value="1">
          <button type="button" class="pe-step-btn" id="peSpeedPlus" title="Faster">+</button>
        </div>
        <div class="pe-speed-chips" id="peSpeedChips"></div>
      </div>
    `;
    (nativeSpeedSubmenuPanel || nativeSettingsMenu).appendChild(wrap);

    peSpeedPanel    = wrap.querySelector('#peSpeedPanel');
    peSpeedDisplay  = wrap.querySelector('#peSpeedDisplay');
    peSpeedSlider   = wrap.querySelector('#peSpeedSlider');
    peSpeedMinusBtn = wrap.querySelector('#peSpeedMinus');
    peSpeedPlusBtn  = wrap.querySelector('#peSpeedPlus');
    peSpeedChips    = wrap.querySelector('#peSpeedChips');
    peSpeedToggleSwitch = wrap.querySelector('#peSpeedToggle');

    // Prevent clicks inside this panel from bubbling to the document-
    // level listener that closes the settings menu on any outside click.
    wrap.addEventListener('click', e => e.stopPropagation());

    peSpeedSlider.addEventListener('input', () => {
      applySpeed(parseFloat(peSpeedSlider.value), { silent: true });
    });
    peSpeedSlider.addEventListener('change', () => {
      showToast(`${fmtSpeedLabelPE(parseFloat(peSpeedSlider.value))} speed`);
    });
    peSpeedMinusBtn.addEventListener('click', () => applySpeed(nativeVideo.playbackRate - NUDGE_STEP));
    peSpeedPlusBtn.addEventListener('click', () => applySpeed(nativeVideo.playbackRate + NUDGE_STEP));

    peSpeedToggleSwitch.addEventListener('click', () => {
      speedPanelEnabled = !speedPanelEnabled;
      saveBoolPref('pe_speedEnabled', speedPanelEnabled);
      applySpeedPanelEnabled();
      showToast(speedPanelEnabled ? 'Custom speed panel on' : 'Custom speed panel off');
      if (speedPanelEnabled) syncSpeedUI();
    });
  }

  /* ============================================================
     Init
     ============================================================ */
  buildSettingsSection();
  applySpeedPanelEnabled();
  syncSpeedUI();

  return { applySpeed };
}