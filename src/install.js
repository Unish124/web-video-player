/* install.js: app install, "open with" file launches and the default-player dialog */
import { state } from './core.js';
import { handleFiles, loadVideo } from './playlist.js';

let deferredPrompt = null;

const $ = (id) => document.getElementById(id);

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function refreshInstallUi() {
  const btn = $('dpInstallBtn');
  const status = $('dpStatus');
  if (!btn || !status) return;
  if (isStandalone()) {
    btn.disabled = true;
    btn.textContent = 'Installed';
    status.textContent = 'You are already running the installed app. Continue with step 2 or 3.';
  } else if (deferredPrompt) {
    btn.disabled = false;
    btn.textContent = 'Install app';
    status.textContent = '';
  } else {
    btn.disabled = true;
    btn.textContent = 'Install app';
    status.textContent = 'No one-click install is offered right now. In Chrome or Edge, open the browser menu and choose Install app (or Apps, then Install this site as an app). If it is already installed, skip to step 2.';
  }
}

function openDialog() {
  refreshInstallUi();
  $('defaultPlayerOverlay').classList.remove('hidden');
}
function closeDialog() {
  $('defaultPlayerOverlay').classList.add('hidden');
}

function wireDialog() {
  ['defaultPlayerBtn', 'defaultPlayerFeatureBtn'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('click', openDialog);
  });
  $('dpCloseBtn').addEventListener('click', closeDialog);
  $('defaultPlayerOverlay').addEventListener('click', (e) => {
    if (e.target === $('defaultPlayerOverlay')) closeDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialog();
  });

  $('dpInstallBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (err) {}
    deferredPrompt = null;
    refreshInstallUi();
  });
}

function wireInstallEvents() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallUi();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const status = $('dpStatus');
    const btn = $('dpInstallBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Installed'; }
    if (status) status.textContent = 'Installed. Now continue with step 2 or 3 to make it the default.';
  });
}

function registerServiceWorker() {
  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function wireFileLaunch() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = [];
    for (const handle of params.files) {
      try { files.push(await handle.getFile()); } catch (err) {}
    }
    if (!files.length) return;
    const before = state.playlist.length;
    handleFiles(files);
    if (state.playlist.length > before && state.currentIndex !== before) loadVideo(before);
  });
}

export function initInstall() {
  wireDialog();
  wireInstallEvents();
  wireFileLaunch();
  registerServiceWorker();
}
