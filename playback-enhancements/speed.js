/* playback-enhancements/speed.js: custom playback speed slider */

const PRESET_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_EPSILON = 0.0005;
const SLIDER_MIN = 0.1;
const SLIDER_MAX = 4;
const SLIDER_STEP = 0.05;
const NUDGE_STEP = 0.1;

function fmtSpeedLabelPE(v) {
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

  let speedPanelEnabled = loadBoolPref('pe_speedEnabled', false);
  let lastCustomSpeed = (function () {
    try {
      const v = parseFloat(localStorage.getItem('pe_lastCustomSpeed'));
      return isFinite(v) ? clampSpeed(v) : null;
    } catch (e) { return null; }
  })();

  let peSpeedPanel, peSpeedDisplay, peSpeedSlider, peSpeedChips,
      peSpeedToggleSwitch, peSpeedMinusBtn, peSpeedPlusBtn;

  function applySpeed(v, opts) {
    opts = opts || {};
    const clamped = clampSpeed(v);
    if (clamped == null) return;
    if (isYouTubeActive()) {
      showToast('Custom speed isn\u2019t available for YouTube videos');
      return;
    }
    nativeVideo.playbackRate = clamped;
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

  buildSettingsSection();
  applySpeedPanelEnabled();
  syncSpeedUI();

  return { applySpeed };
}
