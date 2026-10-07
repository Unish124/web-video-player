/*!
 * main.js
 * Entry point for the Local Video Player. This is the only file
 * index.html links from src/:
 *   <script type="module" src="src/main.js"></script>
 *
 * Responsibilities that don't belong to any single feature module:
 *   - Booting every module (core.js needs no init; the rest do).
 *   - Document-level drag & drop of video files.
 *   - The global keyboard-shortcut handler.
 *   - The keyboard-shortcuts help overlay (built here, since nothing
 *     else needs the shortcut list).
 *
 * Depends on (one-directional imports — main.js is the top of the
 * dependency graph, nothing else imports from main.js):
 *
 *   from './core.js':
 *     state, video, dropZone, fileInput, openBtn, settingsMenu,
 *     shortcutsOverlay, shortcutsGrid, shortcutsCloseBtn, loopBtn, ICONS
 *
 *   from './media.js':
 *     initMedia(), mediaSeek(t), mediaDuration(), isPausedNow()
 *
 *   from './controls.js':
 *     initControls(), togglePlay(), flashCenterIcon(iconSvg),
 *     seekBy(delta), flashSeek(direction, seconds), seekToRatio(ratio),
 *     cycleSpeed(dir), stepFrame(dir), adjustVolume(delta),
 *     toggleMute(), toggleFullscreen(), toggleTheater(), togglePip(),
 *     toggleManualHide(), togglePlaylistPanel(),
 *     beginFastForward(), endFastForward()
 *
 *   from './playlist.js':
 *     initPlaylist(), handleFiles(fileList), loadVideo(index, autoplay),
 *     closeUrlModal()
 *
 *   from './study-timer.js':
 *     initStudyTimer()
 */
import { state, video, dropZone, fileInput, openBtn, settingsMenu,
         shortcutsOverlay, shortcutsGrid, shortcutsCloseBtn, loopBtn, ICONS } from './core.js';
import { initMedia, mediaSeek, mediaDuration, isPausedNow } from './media.js';
import {
  initControls, togglePlay, flashCenterIcon, seekBy, flashSeek, seekToRatio,
  cycleSpeed, stepFrame, adjustVolume, toggleMute, toggleFullscreen,
  toggleTheater, togglePip, toggleManualHide, togglePlaylistPanel,
  beginFastForward, endFastForward
} from './controls.js';
import { initPlaylist, handleFiles, loadVideo, closeUrlModal } from './playlist.js';
import { initStudyTimer } from './study-timer.js';

/* ============================================================
   Keyboard-shortcuts help overlay
   ============================================================ */
const SHORTCUTS = [
  ['Space / K', 'Play / pause'],
  ['Hold Space', 'Fast-forward at 2x while held'],
  ['\u2190  /  J', 'Rewind (skip amount set in \u2699 settings)'],
  ['\u2192  /  L', 'Forward (skip amount set in \u2699 settings)'],
  ['\u2191  /  \u2193', 'Volume up / down'],
  ['M', 'Mute / unmute'],
  ['F', 'Fullscreen'],
  ['T', 'Theater mode'],
  ['I', 'Picture-in-picture'],
  ['H', 'Hide/show all controls'],
  ['P', 'Toggle playlist'],
  ['Shift + N', 'Next video'],
  ['Shift + P', 'Previous video'],
  ['Shift + L', 'Toggle loop'],
  ['0 \u2013 9', 'Jump to 0%\u201390%'],
  ['Home / End', 'Jump to start / end'],
  [', / .', 'Step one frame back / forward'],
  ['< / >', 'Decrease / increase speed'],
  ['?', 'Show this help'],
  ['Esc', 'Close menus / exit fullscreen']
];

function buildShortcutsOverlay() {
  SHORTCUTS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `<span class="label">${label}</span><span class="kbd">${key}</span>`;
    shortcutsGrid.appendChild(row);
  });
  shortcutsCloseBtn.addEventListener('click', () => shortcutsOverlay.classList.add('hidden'));
}

/* ============================================================
   Drag & drop
   ============================================================ */
function wireDragDrop() {
  openBtn.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      if (evt === 'drop') e.preventDefault();
      if (e.target === document || evt === 'drop') dropZone.classList.remove('dragover');
    });
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

/* ============================================================
   Global keyboard shortcuts
   ============================================================ */
function togglePlayWithFlash() {
  togglePlay();
  flashCenterIcon(isPausedNow() ? ICONS.play : ICONS.pause);
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (state.currentIndex === -1 && e.key !== '?') return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === ' ') {
      e.preventDefault();
      if (state.currentIndex === -1) return;
      if (!state.spaceKeyDown) {
        state.spaceKeyDown = true;
        clearTimeout(state.spaceHoldTimer);
        state.spaceHoldTimer = setTimeout(() => {
          state.spaceIsHolding = true;
          beginFastForward();
        }, 250);
      }
      return;
    }

    switch (e.key) {
      case 'k': case 'K':
        e.preventDefault(); togglePlayWithFlash();
        break;
      case 'ArrowLeft':
        e.preventDefault(); seekBy(-state.skipSeconds); flashSeek('left', state.skipSeconds); break;
      case 'ArrowRight':
        e.preventDefault(); seekBy(state.skipSeconds); flashSeek('right', state.skipSeconds); break;
      case 'j': case 'J':
        seekBy(-state.skipSeconds); flashSeek('left', state.skipSeconds); break;
      case 'l': case 'L':
        if (e.shiftKey) { loopBtn.click(); } else { seekBy(state.skipSeconds); flashSeek('right', state.skipSeconds); }
        break;
      case 'ArrowUp':
        e.preventDefault(); adjustVolume(0.05); break;
      case 'ArrowDown':
        e.preventDefault(); adjustVolume(-0.05); break;
      case 'm': case 'M':
        toggleMute(); break;
      case 'f': case 'F':
        toggleFullscreen(); break;
      case 't': case 'T':
        toggleTheater(); break;
      case 'i': case 'I':
        togglePip(); break;
      case 'h': case 'H':
        toggleManualHide(); break;
      case 'p':
        togglePlaylistPanel(); break;
      case 'P':
        if (state.currentIndex > 0) loadVideo(state.currentIndex - 1); break;
      case 'N':
        if (state.currentIndex < state.playlist.length - 1) loadVideo(state.currentIndex + 1); break;
      case 'Home':
        e.preventDefault(); mediaSeek(0); break;
      case 'End':
        e.preventDefault(); { const d = mediaDuration(); if (isFinite(d)) mediaSeek(d); } break;
      case ',':
        stepFrame(-1); break;
      case '.':
        stepFrame(1); break;
      case '<':
        cycleSpeed(-1); break;
      case '>':
        cycleSpeed(1); break;
      case '?':
        shortcutsOverlay.classList.toggle('hidden'); break;
      case 'Escape':
        shortcutsOverlay.classList.add('hidden');
        settingsMenu.classList.add('hidden');
        closeUrlModal();
        break;
      default:
        if (/^[0-9]$/.test(e.key)) seekToRatio(parseInt(e.key, 10) / 10);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key !== ' ') return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!state.spaceKeyDown) return;
    state.spaceKeyDown = false;
    clearTimeout(state.spaceHoldTimer);
    if (state.spaceIsHolding) {
      endFastForward();
      state.spaceIsHolding = false;
    } else if (state.currentIndex !== -1) {
      togglePlayWithFlash();
    }
  });

  window.addEventListener('blur', () => {
    if (state.spaceKeyDown) {
      state.spaceKeyDown = false;
      clearTimeout(state.spaceHoldTimer);
      if (state.spaceIsHolding) {
        endFastForward();
        state.spaceIsHolding = false;
      }
    }
  });
}

/* ============================================================
   Boot
   ============================================================ */
buildShortcutsOverlay();
wireDragDrop();
wireKeyboardShortcuts();
initMedia();
initControls();
initPlaylist();
initStudyTimer();