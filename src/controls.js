/* controls.js: player controls, settings menu and extra-feature toggles */

import {
  state, app, video, thumbVideo, thumbCanvas, playerWrapper,
  playBtn, prevBtn, nextBtn, muteBtn, volumeSlider, volumeGroup,
  curTimeEl, durTimeEl, loopBtn, settingsBtn, settingsMenu,
  settingsMainPanel, settingsSpeedPanel, settingsSkipPanel, settingsBtnSizePanel,
  speedRowValue, skipRowValue, btnSizeRowValue,
  speedOptions, skipOptions, btnSizeOptions, controlTogglesContainer,
  resetControlVisibilityBtn, pipBtn, theaterBtn, fullscreenBtn,
  playlistToggleBtn, playlistPanel, closePlaylistBtn, featuresBtn,
  featuresOverlay, featuresCloseBtn, abLoopBtn, studyTimerBtn,
  centerIcon, spinner, holdSpeedIndicator, flashLeft, flashRight,
  flashLeftLabel, flashRightLabel, zoneLeft, zoneCenter, zoneRight,
  bottomControls, progressBar, progressTrack, bufferedBar, playedBar,
  hoverBar, progressHandle, progressTooltip, tooltipCanvas, tooltipTime,
  abSegmentBar, abMarkerAEl, abMarkerBEl,
  ICONS, fmtTime, showToast
} from './core.js';
import {
  mediaPlay, mediaPause, mediaSeek, mediaDuration, mediaCurrentTime,
  isPausedNow, isCurrentYouTube, mediaSetVolume, mediaSetMuted,
  mediaSetPlaybackRate
} from './media.js';
import { onMultiFeatureToggled } from './playlist.js';
import { stopStudyTimer } from './study-timer.js';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_OPTIONS = [5, 10, 15, 20, 30];
const BTN_SIZES = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
  { id: 'xl', label: 'Extra large' }
];
const CONTROL_TOGGLES = [
  { key: 'title',          label: 'Video title',               selector: '.video-title' },
  { key: 'timeline',       label: 'Timeline / progress bar',   selector: '.progress-row' },
  { key: 'time',           label: 'Time display',              selector: '.time-display' },
  { key: 'play',           label: 'Play / pause button',       selector: '#playBtn' },
  { key: 'prevnext',       label: 'Previous / next buttons',   selector: '#prevBtn, #nextBtn' },
  { key: 'volume',         label: 'Volume controls',           selector: '#volumeGroup' },
  { key: 'loop',           label: 'Loop button',               selector: '#loopBtn' },
  { key: 'abloop',         label: 'A/B loop button',            selector: '#abLoopBtn' },
  { key: 'studytimer',     label: 'Study timer button',        selector: '.study-timer-wrap' },
  { key: 'pip',            label: 'Picture-in-picture button', selector: '#pipBtn' },
  { key: 'theater',        label: 'Theater mode button',       selector: '#theaterBtn' },
  { key: 'fullscreen',     label: 'Fullscreen button',         selector: '#fullscreenBtn' },
  { key: 'home',           label: 'Home button',               selector: '#homeBtn' },
  { key: 'playlisttoggle', label: 'Playlist toggle button',    selector: '#playlistToggleBtn' },
  { key: 'addfiles',       label: 'Add files button (top bar)', selector: '#addFilesTopBtn' }
];

let hoverThumbTimer = null;
let dragScrubActive = false;

export function togglePlay() {
  if (state.currentIndex === -1) return;
  if (isPausedNow()) mediaPlay(); else mediaPause();
}

export function flashCenterIcon(iconSvg) {
  centerIcon.innerHTML = iconSvg;
  centerIcon.classList.remove('flash');
  void centerIcon.offsetWidth;
  centerIcon.classList.add('flash');
}

function wirePlayPause() {
  video.addEventListener('play', () => {
    playBtn.innerHTML = ICONS.pause;
    playBtn.title = 'Pause (k)';
    resetHideTimer();
  });
  video.addEventListener('pause', () => {
    playBtn.innerHTML = ICONS.play;
    playBtn.title = 'Play (k)';
    showControls();
  });
  playBtn.addEventListener('click', togglePlay);

  video.addEventListener('waiting', () => spinner.classList.add('show'));
  video.addEventListener('playing', () => spinner.classList.remove('show'));
  video.addEventListener('canplay', () => spinner.classList.remove('show'));
}

export function seekBy(delta) {
  const dur = mediaDuration();
  if (!isFinite(dur)) return;
  const cur = mediaCurrentTime();
  mediaSeek(Math.min(Math.max(cur + delta, 0), dur));
}
export function seekToRatio(ratio) {
  const dur = mediaDuration();
  if (!isFinite(dur)) return;
  mediaSeek(ratio * dur);
}
export function stepFrame(dir) {
  mediaPause();
  const step = dir / 30;
  const dur = mediaDuration();
  mediaSeek(Math.min(Math.max(mediaCurrentTime() + step, 0), isFinite(dur) ? dur : 0));
}

export function flashSeek(direction, seconds) {
  const el = direction === 'left' ? flashLeft : flashRight;
  const label = direction === 'left' ? flashLeftLabel : flashRightLabel;
  label.textContent = `${seconds} seconds`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 550);
}

function wireGestureZones() {
  zoneCenter.addEventListener('click', () => {
    togglePlay();
    flashCenterIcon(isPausedNow() ? ICONS.play : ICONS.pause);
  });
  zoneCenter.addEventListener('dblclick', () => toggleFullscreen());
  zoneLeft.addEventListener('dblclick', () => { seekBy(-state.skipSeconds); flashSeek('left', state.skipSeconds); });
  zoneRight.addEventListener('dblclick', () => { seekBy(state.skipSeconds); flashSeek('right', state.skipSeconds); });
  zoneLeft.addEventListener('click', () => { togglePlay(); flashCenterIcon(isPausedNow() ? ICONS.play : ICONS.pause); });
  zoneRight.addEventListener('click', () => { togglePlay(); flashCenterIcon(isPausedNow() ? ICONS.play : ICONS.pause); });
}

function updateProgress() {
  if (!isFinite(video.duration) || video.duration === 0) return;
  const pct = (video.currentTime / video.duration) * 100;
  playedBar.style.width = pct + '%';
  progressHandle.style.left = pct + '%';
  curTimeEl.textContent = fmtTime(video.currentTime);
  if (video.buffered.length) {
    const end = video.buffered.end(video.buffered.length - 1);
    bufferedBar.style.width = (end / video.duration * 100) + '%';
  }
  if (state.abLoop.active && state.abLoop.b != null && video.currentTime >= state.abLoop.b) {
    video.currentTime = state.abLoop.a;
  }
}

function updateYtProgressUI() {
  if (state.isScrubbing) return;
  const dur = mediaDuration();
  const cur = mediaCurrentTime();
  if (isFinite(dur) && dur > 0) {
    const pct = (cur / dur) * 100;
    playedBar.style.width = pct + '%';
    progressHandle.style.left = pct + '%';
    durTimeEl.textContent = fmtTime(dur);
  }
  curTimeEl.textContent = fmtTime(cur);
  if (state.abLoop.active && state.abLoop.b != null && cur >= state.abLoop.b) {
    mediaSeek(state.abLoop.a);
  }
}

function ratioFromEvent(e) {
  const rect = progressBar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
}

function drawThumb(t) {
  if (!thumbVideo.src) return;
  try { thumbVideo.currentTime = t; } catch (e) {  }
}

function startScrub(e) {
  state.isScrubbing = true;
  dragScrubActive = true;
  progressBar.classList.add('scrubbing');
  doScrub(e);
  document.addEventListener('mousemove', doScrub);
  document.addEventListener('mouseup', endScrub);
  document.addEventListener('touchmove', doScrub, { passive: false });
  document.addEventListener('touchend', endScrub);
}
function doScrub(e) {
  if (e.cancelable) e.preventDefault();
  const ratio = ratioFromEvent(e);
  playedBar.style.width = (ratio * 100) + '%';
  progressHandle.style.left = (ratio * 100) + '%';
  const dur = mediaDuration();
  if (isFinite(dur)) curTimeEl.textContent = fmtTime(ratio * dur);
}
function endScrub(e) {
  const ratio = ratioFromEvent(e);
  seekToRatio(ratio);
  state.isScrubbing = false;
  dragScrubActive = false;
  progressBar.classList.remove('scrubbing');
  document.removeEventListener('mousemove', doScrub);
  document.removeEventListener('mouseup', endScrub);
  document.removeEventListener('touchmove', doScrub);
  document.removeEventListener('touchend', endScrub);
}

function wireProgressBar() {
  video.addEventListener('timeupdate', () => { if (!state.isScrubbing) updateProgress(); });
  video.addEventListener('progress', updateProgress);

  setInterval(() => { if (isCurrentYouTube()) updateYtProgressUI(); }, 250);

  progressBar.addEventListener('mousemove', (e) => {
    const ratio = ratioFromEvent(e);
    hoverBar.style.width = (ratio * 100) + '%';
    hoverBar.style.display = 'block';
    if (isCurrentYouTube()) {
      progressTooltip.style.display = 'none';
      clearTimeout(hoverThumbTimer);
      return;
    }
    const dur = mediaDuration();
    if (isFinite(dur)) {
      const t = ratio * dur;
      progressTooltip.style.display = 'flex';
      progressTooltip.style.left = (ratio * progressBar.clientWidth) + 'px';
      tooltipTime.textContent = fmtTime(t);
      tooltipCanvas.style.display = 'block';
      clearTimeout(hoverThumbTimer);
      hoverThumbTimer = setTimeout(() => drawThumb(t), 80);
    }
  });
  progressBar.addEventListener('mouseleave', () => {
    hoverBar.style.display = 'none';
    progressTooltip.style.display = 'none';
  });
  thumbVideo.addEventListener('seeked', () => {
    try {
      const ctx = tooltipCanvas.getContext('2d');
      ctx.drawImage(thumbVideo, 0, 0, tooltipCanvas.width, tooltipCanvas.height);
    } catch (e) {  }
  });

  progressBar.addEventListener('mousedown', (e) => { e.preventDefault(); startScrub(e); });
  progressBar.addEventListener('touchstart', startScrub, { passive: false });
}

function updateVolumeIcon() {
  if (video.muted || video.volume === 0) muteBtn.innerHTML = ICONS.volMute;
  else if (video.volume < 0.5) muteBtn.innerHTML = ICONS.volLow;
  else muteBtn.innerHTML = ICONS.volHigh;
  volumeSlider.value = video.muted ? 0 : video.volume;
}

export function toggleMute() {
  if (video.muted || video.volume === 0) {
    video.muted = false;
    video.volume = state.lastVolume || 1;
    mediaSetMuted(false);
    mediaSetVolume(video.volume);
  } else {
    state.lastVolume = video.volume;
    video.muted = true;
    mediaSetMuted(true);
  }
  updateVolumeIcon();
}

export function adjustVolume(delta) {
  video.volume = Math.min(Math.max(video.volume + delta, 0), 1);
  video.muted = video.volume === 0;
  mediaSetVolume(video.volume);
  if (video.volume > 0) mediaSetMuted(false);
  else mediaSetMuted(true);
  updateVolumeIcon();
  showToast('Volume ' + Math.round(video.volume * 100) + '%');
}

function wireVolume() {
  video.addEventListener('volumechange', () => {
    try { localStorage.setItem('lvp_volume', JSON.stringify({ volume: video.volume, muted: video.muted })); } catch (e) {}
  });
  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value);
    video.muted = video.volume === 0;
    state.lastVolume = video.volume || state.lastVolume;
    mediaSetVolume(video.volume);
    mediaSetMuted(video.volume === 0);
    updateVolumeIcon();
  });
  muteBtn.addEventListener('click', toggleMute);
  volumeGroup.addEventListener('wheel', (e) => {
    e.preventDefault();
    adjustVolume(e.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });

  try {
    const raw = localStorage.getItem('lvp_volume');
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) {
        video.volume = saved.volume;
        state.lastVolume = saved.volume || state.lastVolume;
      }
      if (typeof saved.muted === 'boolean') video.muted = saved.muted;
    }
  } catch (e) {}
  updateVolumeIcon();
}

export function setSpeed(s) {
  video.playbackRate = s;
  mediaSetPlaybackRate(s);
  Array.from(speedOptions.children).forEach(opt => {
    opt.classList.toggle('selected', parseFloat(opt.dataset.speed) === s);
  });
  settingsMenu.classList.add('hidden');
  showToast(s === 1 ? 'Normal speed' : s + 'x speed');
}
export function cycleSpeed(dir) {
  const i = SPEEDS.indexOf(video.playbackRate);
  if (i === -1) return;
  const next = i + dir;
  if (next >= 0 && next < SPEEDS.length) setSpeed(SPEEDS[next]);
}

function buildSpeedOptions() {
  SPEEDS.forEach(s => {
    const div = document.createElement('div');
    div.className = 'speed-option' + (s === 1 ? ' selected' : '');
    div.dataset.speed = s;
    div.textContent = s === 1 ? 'Normal' : s + 'x';
    div.addEventListener('click', () => setSpeed(s));
    speedOptions.appendChild(div);
  });
}

function syncSpeedRowValue() {
  if (!speedRowValue) return;
  const rate = video.playbackRate;
  speedRowValue.textContent = Math.abs(rate - 1) < 0.0005
    ? 'Normal'
    : (Math.round(rate * 100) / 100) + 'x';
}
function wireSpeedRowValueSync() {
  video.addEventListener('ratechange', syncSpeedRowValue);
  syncSpeedRowValue();
}

function setSkipSeconds(s) {
  state.skipSeconds = s;
  Array.from(skipOptions.children).forEach(opt => {
    opt.classList.toggle('selected', parseInt(opt.dataset.skip, 10) === s);
  });
  if (skipRowValue) skipRowValue.textContent = `${s} seconds`;
  try { localStorage.setItem('lvp_skipSeconds', s); } catch (e) {}
  settingsMenu.classList.add('hidden');
  showToast(`Skip amount: ${s}s`);
}
function buildSkipOptions() {
  SKIP_OPTIONS.forEach(s => {
    const div = document.createElement('div');
    div.className = 'speed-option' + (s === state.skipSeconds ? ' selected' : '');
    div.dataset.skip = s;
    div.textContent = s + ' seconds';
    div.addEventListener('click', () => setSkipSeconds(s));
    skipOptions.appendChild(div);
  });
  if (skipRowValue) skipRowValue.textContent = `${state.skipSeconds} seconds`;
}

function setButtonSize(id) {
  state.buttonSize = id;
  app.classList.remove('btn-sm', 'btn-md', 'btn-lg', 'btn-xl');
  app.classList.add('btn-' + id);
  Array.from(btnSizeOptions.children).forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.btnsize === id);
  });
  const label = BTN_SIZES.find(b => b.id === id).label;
  if (btnSizeRowValue) btnSizeRowValue.textContent = label;
  try { localStorage.setItem('lvp_buttonSize', id); } catch (e) {}
  settingsMenu.classList.add('hidden');
  showToast(label + ' buttons');
}
function buildButtonSizeOptions() {
  BTN_SIZES.forEach(({ id, label }) => {
    const div = document.createElement('div');
    div.className = 'speed-option' + (id === state.buttonSize ? ' selected' : '');
    div.dataset.btnsize = id;
    div.textContent = label;
    div.addEventListener('click', () => setButtonSize(id));
    btnSizeOptions.appendChild(div);
  });
  app.classList.add('btn-' + state.buttonSize);
  if (btnSizeRowValue) btnSizeRowValue.textContent = BTN_SIZES.find(b => b.id === state.buttonSize).label;
}

function showSettingsPanel(id) {
  [settingsMainPanel, settingsSpeedPanel, settingsSkipPanel, settingsBtnSizePanel].forEach(panel => {
    if (panel) panel.classList.toggle('active', panel.id === id);
  });
  settingsMenu.scrollTop = 0;
}
function wireSettingsNavigation() {
  if (settingsMainPanel) {
    settingsMainPanel.querySelectorAll('.settings-row[data-target]').forEach(row => {
      row.addEventListener('click', () => showSettingsPanel(row.dataset.target));
    });
  }
  [settingsSpeedPanel, settingsSkipPanel, settingsBtnSizePanel].forEach(panel => {
    if (!panel) return;
    const header = panel.querySelector('.settings-panel-header[data-back]');
    if (header) header.addEventListener('click', () => showSettingsPanel('settingsMainPanel'));
  });
}

function wireSettingsMenu() {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = settingsMenu.classList.contains('hidden');
    settingsMenu.classList.toggle('hidden');
    if (wasHidden && !settingsMenu.classList.contains('hidden')) showSettingsPanel('settingsMainPanel');
  });
  document.addEventListener('click', () => settingsMenu.classList.add('hidden'));
  settingsMenu.addEventListener('click', e => e.stopPropagation());
}

function persistHiddenControls() {
  try { localStorage.setItem('lvp_hiddenControls', JSON.stringify(state.hiddenControls)); } catch (e) {}
}
function applyHiddenControls() {
  CONTROL_TOGGLES.forEach(item => {
    const hide = !!state.hiddenControls[item.key];
    app.querySelectorAll(item.selector).forEach(el => { el.style.display = hide ? 'none' : ''; });
  });
}
function buildControlToggles() {
  CONTROL_TOGGLES.forEach(item => {
    const row = document.createElement('div');
    row.className = 'control-toggle-row';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    const sw = document.createElement('div');
    sw.className = 'toggle-switch mini' + (state.hiddenControls[item.key] ? '' : ' on');
    sw.title = 'Show/hide';
    sw.innerHTML = '<div class="knob"></div>';
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      state.hiddenControls[item.key] = !state.hiddenControls[item.key];
      sw.classList.toggle('on', !state.hiddenControls[item.key]);
      persistHiddenControls();
      applyHiddenControls();
    });
    row.appendChild(labelSpan);
    row.appendChild(sw);
    controlTogglesContainer.appendChild(row);
  });
  resetControlVisibilityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.hiddenControls = {};
    persistHiddenControls();
    applyHiddenControls();
    Array.from(controlTogglesContainer.querySelectorAll('.toggle-switch')).forEach(sw => sw.classList.add('on'));
    showToast('All controls shown');
  });
}

function wireLoop() {
  loopBtn.addEventListener('click', () => {
    state.loopOne = !state.loopOne;
    loopBtn.classList.toggle('active', state.loopOne);
    showToast(state.loopOne ? 'Loop on' : 'Loop off');
  });
}

function updateAbLoopBtn() {
  const label = abLoopBtn.querySelector('.ab-label');
  abLoopBtn.classList.remove('ab-armed', 'active');
  if (state.abLoop.active) {
    abLoopBtn.classList.add('active');
    label.textContent = 'AB';
    abLoopBtn.title = 'A/B loop on — click to clear';
  } else if (state.abLoop.a != null) {
    abLoopBtn.classList.add('ab-armed');
    label.textContent = 'B';
    abLoopBtn.title = 'Point A set — click to set point B';
  } else {
    label.textContent = 'A';
    abLoopBtn.title = 'A/B loop — click to set point A, click again for B';
  }
}
function updateAbLoopMarker() {
  const dur = mediaDuration();
  if (!isFinite(dur) || dur <= 0 || state.abLoop.a == null) {
    abSegmentBar.style.display = 'none';
    abMarkerAEl.style.display = 'none';
    abMarkerBEl.style.display = 'none';
    return;
  }
  const aPct = Math.min(Math.max((state.abLoop.a / dur) * 100, 0), 100);
  abMarkerAEl.style.left = aPct + '%';
  abMarkerAEl.style.display = 'block';
  if (state.abLoop.b != null) {
    const bPct = Math.min(Math.max((state.abLoop.b / dur) * 100, 0), 100);
    abMarkerBEl.style.left = bPct + '%';
    abMarkerBEl.style.display = 'block';
    abSegmentBar.style.left = aPct + '%';
    abSegmentBar.style.width = Math.max(bPct - aPct, 0) + '%';
    abSegmentBar.style.display = 'block';
  } else {
    abMarkerBEl.style.display = 'none';
    abSegmentBar.style.display = 'none';
  }
}
export function clearAbLoop() {
  state.abLoop = { a: null, b: null, active: false };
  updateAbLoopBtn();
  updateAbLoopMarker();
}
function wireAbLoop() {
  abLoopBtn.addEventListener('click', () => {
    if (state.currentIndex === -1) return;
    if (state.abLoop.active) {
      clearAbLoop();
      showToast('A/B loop cleared');
      return;
    }
    const cur = mediaCurrentTime();
    if (state.abLoop.a == null) {
      state.abLoop.a = cur;
      updateAbLoopBtn();
      updateAbLoopMarker();
      showToast(`Point A set at ${fmtTime(cur)}`);
    } else {
      if (cur <= state.abLoop.a) { showToast('Point B must be after point A'); return; }
      state.abLoop.b = cur;
      state.abLoop.active = true;
      updateAbLoopBtn();
      updateAbLoopMarker();
      showToast(`Looping ${fmtTime(state.abLoop.a)} \u2013 ${fmtTime(cur)}`);
    }
  });
  video.addEventListener('loadedmetadata', updateAbLoopMarker);
  updateAbLoopBtn();
  updateAbLoopMarker();
}
function wireAbLoopResetOnNewItem() {
  video.addEventListener('lvp:itemloading', clearAbLoop);
}

export function togglePip() {
  pipBtn.click();
}
function wirePip() {
  if (!document.pictureInPictureEnabled) pipBtn.style.display = 'none';
  pipBtn.addEventListener('click', async () => {
    if (isCurrentYouTube()) {
      showToast('Picture-in-picture isn\'t available for YouTube videos');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (err) { showToast('Picture-in-picture not available'); }
  });
}

export function toggleTheater() {
  state.theater = !state.theater;
  app.classList.toggle('theater', state.theater);
  theaterBtn.classList.toggle('active', state.theater);
}
function wireTheater() {
  theaterBtn.addEventListener('click', toggleTheater);
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    (playerWrapper.requestFullscreen || playerWrapper.webkitRequestFullscreen || function () {}).call(playerWrapper);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  }
}
function wireFullscreen() {
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.innerHTML = document.fullscreenElement ? ICONS.fsExit : ICONS.fsEnter;
  });
}

function showControls() {
  if (state.manualHide) return;
  playerWrapper.classList.remove('controls-hidden');
  resetHideTimer();
}
export function toggleManualHide() {
  state.manualHide = !state.manualHide;
  if (state.manualHide) {
    clearTimeout(state.hideTimer);
    showToast('Controls will be hidden — press H to show them again');
    playerWrapper.classList.add('controls-hidden');
  } else {
    playerWrapper.classList.remove('controls-hidden');
    resetHideTimer();
    showToast('Controls shown');
  }
}
function resetHideTimer() {
  clearTimeout(state.hideTimer);
  state.hideTimer = setTimeout(() => {
    if (!isPausedNow() && !state.isScrubbing && settingsMenu.classList.contains('hidden')) {
      playerWrapper.classList.add('controls-hidden');
    }
  }, 3000);
}
function wireAutoHide() {
  playerWrapper.addEventListener('mousemove', showControls);
  playerWrapper.addEventListener('mouseleave', () => {
    if (!isPausedNow()) playerWrapper.classList.add('controls-hidden');
  });
  bottomControls.addEventListener('mouseenter', () => clearTimeout(state.hideTimer));
  bottomControls.addEventListener('mouseleave', resetHideTimer);
}

export function beginFastForward() {
  state.preHoldRate = video.playbackRate;
  video.playbackRate = 2;
  mediaSetPlaybackRate(2);
  if (isPausedNow()) mediaPlay();
  holdSpeedIndicator.classList.add('show');
}
export function endFastForward() {
  const restoreRate = state.preHoldRate != null ? state.preHoldRate : video.playbackRate;
  video.playbackRate = restoreRate;
  mediaSetPlaybackRate(restoreRate);
  state.preHoldRate = null;
  holdSpeedIndicator.classList.remove('show');
}

export function togglePlaylistPanel() {
  state.playlistOpen = !state.playlistOpen;
  playlistPanel.classList.toggle('hidden', !state.playlistOpen);
  playlistToggleBtn.classList.toggle('active', state.playlistOpen);
}
function wirePlaylistToggle() {
  playlistToggleBtn.addEventListener('click', togglePlaylistPanel);
  closePlaylistBtn.addEventListener('click', () => {
    state.playlistOpen = false;
    playlistPanel.classList.add('hidden');
  });
}

function applyFeatureClasses() {
  app.classList.toggle('feat-resume', !!state.features.resume);
  app.classList.toggle('feat-multi', !!state.features.multi);
  app.classList.toggle('feat-abloop', !!state.features.abloop);
  app.classList.toggle('feat-timer', !!state.features.timer);
}
function persistFeatures() {
  try { localStorage.setItem('lvp_features', JSON.stringify(state.features)); } catch (e) {}
}
function renderFeatureToggles() {
  Array.from(featuresOverlay.querySelectorAll('.toggle-switch[data-feature]')).forEach(sw => {
    sw.classList.toggle('on', !!state.features[sw.dataset.feature]);
  });
}
function wireFeaturesOverlay() {
  featuresOverlay.querySelectorAll('.toggle-switch[data-feature]').forEach(sw => {
    sw.addEventListener('click', () => {
      const key = sw.dataset.feature;
      state.features[key] = !state.features[key];
      persistFeatures();
      applyFeatureClasses();
      renderFeatureToggles();
      if (key === 'multi') onMultiFeatureToggled();
      if (key === 'abloop' && !state.features.abloop) clearAbLoop();
      if (key === 'timer' && !state.features.timer) stopStudyTimer(false);
    });
  });
  featuresBtn.addEventListener('click', () => {
    renderFeatureToggles();
    featuresOverlay.classList.remove('hidden');
  });
  featuresCloseBtn.addEventListener('click', () => featuresOverlay.classList.add('hidden'));
  featuresOverlay.addEventListener('click', (e) => { if (e.target === featuresOverlay) featuresOverlay.classList.add('hidden'); });
  applyFeatureClasses();
}

export function initControls() {
  playBtn.innerHTML = ICONS.play;
  muteBtn.innerHTML = ICONS.volHigh;
  fullscreenBtn.innerHTML = ICONS.fsEnter;
  pipBtn.innerHTML = ICONS.pipEnter;

  buildSpeedOptions();
  buildSkipOptions();
  buildButtonSizeOptions();
  buildControlToggles();

  wirePlayPause();
  wireGestureZones();
  wireProgressBar();
  wireVolume();
  wireSettingsMenu();
  wireSettingsNavigation();
  wireSpeedRowValueSync();
  wireLoop();
  wireAbLoop();
  wireAbLoopResetOnNewItem();
  wirePip();
  wireTheater();
  wireFullscreen();
  wireAutoHide();
  wirePlaylistToggle();
  wireFeaturesOverlay();

  applyHiddenControls();
}
