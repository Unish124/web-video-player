/* study-timer.js: draggable, resizable study timer */

import {
  state, app, studyTimerBtn, studyTimerMenu, studyTimerHeader,
  studyTimerCloseX, studyTimerHideBtn, studyTimerResizeHandle,
  studyTimerSetup, studyTimerRun, studyTimerEditBtn, studyTimerDurations,
  studyTimerCustomInput, studyTimerCountdown, studyTimerStartBtn,
  studyTimerStopBtn, fsStudyTimerPill, fsPillTime, fsPillCloseBtn,
  showToast
} from './core.js';
import { mediaPause } from './media.js';

const studyTimerStyleBtn = document.getElementById('studyTimerStyleBtn');
const studyTimerAnalog = document.getElementById('studyTimerAnalog');
const analogFace = document.getElementById('analogFace');
const analogTime = document.getElementById('analogTime');
const studyTimerSetupBack = document.getElementById('studyTimerSetupBack');

const STUDY_DURATIONS = [15, 25, 45, 60];
const STUDY_GEOM_KEY = 'lvp_studyTimerGeom';
const STUDY_DISPLAY_KEY = 'lvp_studyTimerDisplay';
const STUDY_MIN_W = 210, STUDY_MIN_H = 190, STUDY_MAX_W = 480, STUDY_MAX_H = 540;

const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
const EYE_CLOSED_SVG = '<svg viewBox="0 0 24 24"><path d="M2.39 1.73 1.11 3l3.2 3.2A12.4 12.4 0 0 0 1 12s4.27 7.5 11 7.5c1.77 0 3.39-.36 4.8-.97l3.08 3.08 1.27-1.27L2.39 1.73zM12 17c-4.42 0-7.53-3.61-8.79-5C4.03 10.9 5.6 9.32 7.53 8.32l1.78 1.78a3.5 3.5 0 0 0 4.6 4.6l1.56 1.56A8.8 8.8 0 0 1 12 17zm.18-9.99L14.2 9.03A3.5 3.5 0 0 0 12 8c-.13 0-.25.02-.38.03L9.9 6.31A9.3 9.3 0 0 1 12 6c4.42 0 7.53 3.61 8.79 5-.66.75-1.62 1.71-2.83 2.53l-1.44-1.44c.31-.56.48-1.2.48-1.87 0-.34-.05-.67-.13-.99l-1.69-1.69c-.06-.01-.12-.02-.18-.02z"/></svg>';

function fmtCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function loadDisplayMode() {
  try { return localStorage.getItem(STUDY_DISPLAY_KEY) === 'analog' ? 'analog' : 'digital'; }
  catch (e) { return 'digital'; }
}
function saveDisplayMode(mode) {
  try { localStorage.setItem(STUDY_DISPLAY_KEY, mode); } catch (e) {}
}
function applyDisplayMode(mode) {
  state.studyTimer.displayMode = mode;
  const analog = mode === 'analog';
  studyTimerCountdown.hidden = analog;
  studyTimerAnalog.hidden = !analog;
  studyTimerStyleBtn.classList.toggle('active', analog);
  studyTimerStyleBtn.title = analog ? 'Switch to digital display' : 'Switch to analog clock';
  syncAnalogRaf();
}
function toggleDisplayMode() {
  const next = state.studyTimer.displayMode === 'analog' ? 'digital' : 'analog';
  applyDisplayMode(next);
  saveDisplayMode(next);
}
function updateAnalogPct(remainingSeconds) {
  const total = state.studyTimer.totalSeconds || 1;
  const pct = Math.max(0, Math.min(100, (remainingSeconds / total) * 100));
  analogFace.style.setProperty('--pct', pct + '%');
}
function updateAnalogClock(remainingSeconds) {
  analogTime.textContent = fmtCountdown(Math.max(0, Math.round(remainingSeconds)));
  updateAnalogPct(remainingSeconds);
}

let analogRafId = null;
function stopAnalogRaf() {
  if (analogRafId) { cancelAnimationFrame(analogRafId); analogRafId = null; }
}
function analogRafStep() {
  if (!state.studyTimer.running || state.studyTimer.paused || studyTimerAnalog.hidden) {
    analogRafId = null;
    return;
  }
  const remaining = Math.max(0, (state.studyTimer.endAt - Date.now()) / 1000);
  updateAnalogPct(remaining);
  analogRafId = requestAnimationFrame(analogRafStep);
}
function startAnalogRaf() {
  stopAnalogRaf();
  analogRafId = requestAnimationFrame(analogRafStep);
}
function syncAnalogRaf() {
  const shouldRun = state.studyTimer.running && !state.studyTimer.paused && state.studyTimer.displayMode === 'analog';
  if (shouldRun) startAnalogRaf(); else stopAnalogRaf();
}

function updateFsPillTime() {
  const remaining = state.studyTimer.paused
    ? (state.studyTimer.pausedRemaining || 0)
    : Math.max(0, Math.round((state.studyTimer.endAt - Date.now()) / 1000));
  fsPillTime.textContent = fmtCountdown(remaining);
}
function updateFsPillVisibility() {
  const shouldShow = !!document.fullscreenElement && state.studyTimer.running && !state.studyTimer.pillDismissed;
  fsStudyTimerPill.classList.toggle('hidden', !shouldShow);
  if (shouldShow) updateFsPillTime();
}

function tickStudyTimer() {
  const remaining = Math.max(0, Math.round((state.studyTimer.endAt - Date.now()) / 1000));
  studyTimerCountdown.textContent = fmtCountdown(remaining);
  updateAnalogClock(remaining);
  updateFsPillVisibility();
  if (remaining <= 0) stopStudyTimer(true);
}

function resolveStudyTimerMinutes() {
  const raw = studyTimerCustomInput.value;
  const val = parseInt(raw, 10);
  if (raw !== '' && isFinite(val) && val >= 1 && val <= 300) {
    state.studyTimer.selectedMinutes = val;
    Array.from(studyTimerDurations.children).forEach(el => el.classList.remove('selected'));
    return val;
  }
  return state.studyTimer.selectedMinutes;
}

function startStudyTimer() {
  const minutes = resolveStudyTimerMinutes();
  state.studyTimer.running = true;
  state.studyTimer.paused = false;
  state.studyTimer.pausedRemaining = null;
  state.studyTimer.pillDismissed = false;
  state.studyTimer.totalSeconds = minutes * 60;
  state.studyTimer.endAt = Date.now() + minutes * 60000;
  studyTimerSetup.hidden = true;
  studyTimerRun.hidden = false;
  studyTimerRun.classList.remove('paused');
  scaleCountdownFont();
  studyTimerCountdown.textContent = fmtCountdown(minutes * 60);
  updateAnalogClock(minutes * 60);
  syncAnalogRaf();
  studyTimerStartBtn.textContent = 'Restart';
  studyTimerStopBtn.textContent = 'Pause';
  studyTimerStopBtn.classList.remove('hidden');
  clearInterval(state.studyTimer.intervalId);
  state.studyTimer.intervalId = setInterval(tickStudyTimer, 1000);
  tickStudyTimer();
  updateFsPillVisibility();
  showToast(`Study timer started \u2014 ${minutes} min`);
}

export function stopStudyTimer(completed) {
  clearInterval(state.studyTimer.intervalId);
  state.studyTimer.running = false;
  state.studyTimer.paused = false;
  state.studyTimer.endAt = null;
  state.studyTimer.pausedRemaining = null;
  studyTimerSetup.hidden = false;
  studyTimerRun.hidden = true;
  studyTimerRun.classList.remove('paused');
  studyTimerStartBtn.textContent = 'Start';
  studyTimerStopBtn.classList.add('hidden');
  studyTimerSetupBack.classList.add('hidden');
  updateAnalogClock(state.studyTimer.totalSeconds || 0);
  syncAnalogRaf();
  updateFsPillVisibility();
  if (completed) {
    mediaPause();
    showToast('Study session complete \u2014 time for a break! \uD83C\uDF89');
  }
}

function pauseStudyTimer() {
  if (!state.studyTimer.running || state.studyTimer.paused) return;
  clearInterval(state.studyTimer.intervalId);
  state.studyTimer.pausedRemaining = Math.max(0, Math.round((state.studyTimer.endAt - Date.now()) / 1000));
  state.studyTimer.paused = true;
  state.studyTimer.endAt = null;
  studyTimerRun.classList.add('paused');
  studyTimerStopBtn.textContent = 'Resume';
  updateAnalogPct(state.studyTimer.pausedRemaining);
  syncAnalogRaf();
  updateFsPillVisibility();
  showToast('Study timer paused');
}
function resumeStudyTimer() {
  if (!state.studyTimer.paused) return;
  const remaining = state.studyTimer.pausedRemaining || 0;
  state.studyTimer.endAt = Date.now() + remaining * 1000;
  state.studyTimer.paused = false;
  state.studyTimer.pausedRemaining = null;
  studyTimerRun.classList.remove('paused');
  studyTimerStopBtn.textContent = 'Pause';
  clearInterval(state.studyTimer.intervalId);
  state.studyTimer.intervalId = setInterval(tickStudyTimer, 1000);
  tickStudyTimer();
  syncAnalogRaf();
  updateFsPillVisibility();
  showToast('Study timer resumed');
}
function togglePauseStudyTimer() {
  if (state.studyTimer.paused) resumeStudyTimer();
  else pauseStudyTimer();
}

function toggleStudyTimerMinimal() {
  const on = studyTimerMenu.classList.toggle('minimal-mode');
  studyTimerHideBtn.classList.toggle('active', on);
  studyTimerHideBtn.innerHTML = on ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
  studyTimerHideBtn.title = on ? 'Show all controls (H)' : 'Hide all controls except the timer (H)';
}

function loadStudyTimerGeom() {
  try {
    const raw = localStorage.getItem(STUDY_GEOM_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function saveStudyTimerGeom(geom) {
  try { localStorage.setItem(STUDY_GEOM_KEY, JSON.stringify(geom)); } catch (e) {}
}
function scaleCountdownFont() {
  const rect = studyTimerRun.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const availW = Math.max(20, rect.width - 44);
  const availH = Math.max(16, rect.height);
  const size = Math.max(16, Math.min(180, Math.min(availW / 3.1, availH * 0.85)));
  studyTimerCountdown.style.fontSize = size + 'px';
}
function persistStudyTimerGeomFromDom() {
  const rect = studyTimerMenu.getBoundingClientRect();
  saveStudyTimerGeom({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
}
function clampGeomToViewport() {
  const rect = studyTimerMenu.getBoundingClientRect();
  const left = Math.max(0, Math.min(rect.left, window.innerWidth - rect.width));
  const top = Math.max(0, Math.min(rect.top, window.innerHeight - rect.height));
  studyTimerMenu.style.left = left + 'px';
  studyTimerMenu.style.top = top + 'px';
}
function positionStudyTimerIfNeeded() {
  const geom = loadStudyTimerGeom();
  if (geom) { clampGeomToViewport(); return; }
  const rect = studyTimerBtn.getBoundingClientRect();
  const menuRect = studyTimerMenu.getBoundingClientRect();
  let left = rect.right - menuRect.width;
  let top = rect.top - menuRect.height - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
  top = Math.max(8, top);
  studyTimerMenu.style.left = left + 'px';
  studyTimerMenu.style.top = top + 'px';
}
function initStudyTimerFloating() {
  app.appendChild(studyTimerMenu);
  const geom = loadStudyTimerGeom();
  if (geom) {
    studyTimerMenu.style.width = geom.width + 'px';
    studyTimerMenu.style.height = geom.height + 'px';
    studyTimerMenu.style.left = geom.left + 'px';
    studyTimerMenu.style.top = geom.top + 'px';
    scaleCountdownFont();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(() => scaleCountdownFont()).observe(studyTimerMenu);
  }
}

let dragState = null;
function startStudyTimerDrag(clientX, clientY) {
  const rect = studyTimerMenu.getBoundingClientRect();
  dragState = { offsetX: clientX - rect.left, offsetY: clientY - rect.top };
  document.body.classList.add('lvp-no-select');
}
function moveStudyTimerDrag(clientX, clientY) {
  if (!dragState) return;
  const rect = studyTimerMenu.getBoundingClientRect();
  let left = clientX - dragState.offsetX;
  let top = clientY - dragState.offsetY;
  left = Math.max(0, Math.min(left, window.innerWidth - rect.width));
  top = Math.max(0, Math.min(top, window.innerHeight - rect.height));
  studyTimerMenu.style.left = left + 'px';
  studyTimerMenu.style.top = top + 'px';
}
function endStudyTimerDrag() {
  if (!dragState) return;
  dragState = null;
  document.body.classList.remove('lvp-no-select');
  persistStudyTimerGeomFromDom();
}
function wireDrag() {
  studyTimerHeader.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startStudyTimerDrag(e.clientX, e.clientY);
    document.addEventListener('mousemove', onHeaderMouseMove);
    document.addEventListener('mouseup', onHeaderMouseUp);
  });
  function onHeaderMouseMove(e) { moveStudyTimerDrag(e.clientX, e.clientY); }
  function onHeaderMouseUp() {
    endStudyTimerDrag();
    document.removeEventListener('mousemove', onHeaderMouseMove);
    document.removeEventListener('mouseup', onHeaderMouseUp);
  }
  studyTimerHeader.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    const t = e.touches[0];
    startStudyTimerDrag(t.clientX, t.clientY);
    document.addEventListener('touchmove', onHeaderTouchMove, { passive: false });
    document.addEventListener('touchend', onHeaderTouchEnd);
  }, { passive: true });
  function onHeaderTouchMove(e) {
    if (e.cancelable) e.preventDefault();
    const t = e.touches[0];
    moveStudyTimerDrag(t.clientX, t.clientY);
  }
  function onHeaderTouchEnd() {
    endStudyTimerDrag();
    document.removeEventListener('touchmove', onHeaderTouchMove);
    document.removeEventListener('touchend', onHeaderTouchEnd);
  }
}

let resizeState = null;
function startStudyTimerResize(clientX, clientY) {
  const rect = studyTimerMenu.getBoundingClientRect();
  resizeState = { startX: clientX, startY: clientY, startWidth: rect.width, startHeight: rect.height };
  document.body.classList.add('lvp-no-select');
}
function moveStudyTimerResize(clientX, clientY) {
  if (!resizeState) return;
  let width = Math.min(STUDY_MAX_W, Math.max(STUDY_MIN_W, resizeState.startWidth + (clientX - resizeState.startX)));
  let height = Math.min(STUDY_MAX_H, Math.max(STUDY_MIN_H, resizeState.startHeight + (clientY - resizeState.startY)));
  const rect = studyTimerMenu.getBoundingClientRect();
  width = Math.min(width, window.innerWidth - rect.left - 4);
  height = Math.min(height, window.innerHeight - rect.top - 4);
  studyTimerMenu.style.width = width + 'px';
  studyTimerMenu.style.height = height + 'px';
  scaleCountdownFont();
}
function endStudyTimerResize() {
  if (!resizeState) return;
  resizeState = null;
  document.body.classList.remove('lvp-no-select');
  persistStudyTimerGeomFromDom();
}
function wireResize() {
  studyTimerResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startStudyTimerResize(e.clientX, e.clientY);
    document.addEventListener('mousemove', onResizeMouseMove);
    document.addEventListener('mouseup', onResizeMouseUp);
  });
  function onResizeMouseMove(e) { moveStudyTimerResize(e.clientX, e.clientY); }
  function onResizeMouseUp() {
    endStudyTimerResize();
    document.removeEventListener('mousemove', onResizeMouseMove);
    document.removeEventListener('mouseup', onResizeMouseUp);
  }
  studyTimerResizeHandle.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    const t = e.touches[0];
    startStudyTimerResize(t.clientX, t.clientY);
    document.addEventListener('touchmove', onResizeTouchMove, { passive: false });
    document.addEventListener('touchend', onResizeTouchEnd);
  }, { passive: true });
  function onResizeTouchMove(e) {
    if (e.cancelable) e.preventDefault();
    const t = e.touches[0];
    moveStudyTimerResize(t.clientX, t.clientY);
  }
  function onResizeTouchEnd() {
    endStudyTimerResize();
    document.removeEventListener('touchmove', onResizeTouchMove);
    document.removeEventListener('touchend', onResizeTouchEnd);
  }
  window.addEventListener('resize', () => {
    if (!studyTimerMenu.classList.contains('hidden')) clampGeomToViewport();
  });
}

function buildDurationButtons() {
  STUDY_DURATIONS.forEach(min => {
    const b = document.createElement('button');
    b.textContent = min + ' min';
    b.dataset.min = min;
    if (min === state.studyTimer.selectedMinutes) b.classList.add('selected');
    b.addEventListener('click', () => {
      state.studyTimer.selectedMinutes = min;
      Array.from(studyTimerDurations.children).forEach(el => el.classList.toggle('selected', parseInt(el.dataset.min, 10) === min));
      studyTimerCustomInput.value = '';
    });
    studyTimerDurations.appendChild(b);
  });
}
function wirePanel() {
  studyTimerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = studyTimerMenu.classList.contains('hidden');
    studyTimerMenu.classList.toggle('hidden');
    if (wasHidden && !studyTimerMenu.classList.contains('hidden')) positionStudyTimerIfNeeded();
  });
  studyTimerMenu.addEventListener('click', e => e.stopPropagation());
  studyTimerStartBtn.addEventListener('click', startStudyTimer);
  studyTimerStopBtn.addEventListener('click', togglePauseStudyTimer);
  studyTimerCloseX.addEventListener('click', (e) => {
    e.stopPropagation();
    studyTimerMenu.classList.add('hidden');
  });
  studyTimerEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    studyTimerSetup.hidden = false;
    studyTimerRun.hidden = true;
    studyTimerSetupBack.classList.toggle('hidden', !state.studyTimer.running);
  });
  studyTimerSetupBack.addEventListener('click', (e) => {
    e.stopPropagation();
    studyTimerSetup.hidden = true;
    studyTimerRun.hidden = false;
  });
  studyTimerHideBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStudyTimerMinimal();
  });
  studyTimerStyleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDisplayMode();
  });

  studyTimerCustomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startStudyTimer(); } });
  studyTimerCustomInput.addEventListener('click', e => e.stopPropagation());
  studyTimerCustomInput.addEventListener('input', () => {
    if (studyTimerCustomInput.value !== '') {
      Array.from(studyTimerDurations.children).forEach(el => el.classList.remove('selected'));
    }
  });

  fsPillCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.studyTimer.pillDismissed = true;
    updateFsPillVisibility();
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) state.studyTimer.pillDismissed = false;
    updateFsPillVisibility();
  });
}

export function initStudyTimer() {
  buildDurationButtons();
  applyDisplayMode(loadDisplayMode());
  wirePanel();
  wireDrag();
  wireResize();
  initStudyTimerFloating();
}
