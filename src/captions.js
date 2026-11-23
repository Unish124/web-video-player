/* captions.js: subtitles for local videos.
   - Auto-detects .srt / .vtt files that sit next to a video (same selection, dropped
     together, or inside an opened folder) and loads them with the video.
   - C toggles captions on/off, Shift+C switches track, the + button adds a file manually.
   - Captions are drawn in our own overlay (works in fullscreen, theater, any theme). */

import { state, video, playerWrapper, showToast, escapeHtml } from './core.js';

const SUB_RE = /\.(srt|vtt)$/i;
const PREF_KEY = 'lvp_captionsOn';

export const isSubtitleFile = (f) => !!f && SUB_RE.test(f.name || '');

/* ---------- registry of subtitle files the player has seen ---------- */

const registry = []; // { file, dir, stem }

function splitPath(file) {
  const rel = file.webkitRelativePath || file.name;
  const i = rel.lastIndexOf('/');
  return { dir: i >= 0 ? rel.slice(0, i).toLowerCase() : '', name: i >= 0 ? rel.slice(i + 1) : rel };
}
const stemOf = (name) => name.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFC').trim();

export function registerFiles(files) {
  Array.from(files).filter(isSubtitleFile).forEach((file) => {
    if (registry.some((r) => r.file === file)) return;
    const p = splitPath(file);
    registry.push({ file, dir: p.dir, stem: stemOf(p.name) });
  });
  const item = currentItem();
  if (item) syncAutoTracks(item);
}

/* subtitle "movie.en.srt" / "movie_English.vtt" / "movie.srt" belong to "movie.mp4" */
function findMatches(item) {
  if (!item.file) return [];
  const v = splitPath(item.file);
  const vstem = stemOf(item.name || v.name);
  const hits = registry.filter((r) => {
    if (r.stem === vstem) return true;
    return r.stem.startsWith(vstem) && /^[.\s_\-\[(]/.test(r.stem.slice(vstem.length));
  });
  const sameDir = hits.filter((r) => r.dir === v.dir);
  return (sameDir.length ? sameDir : hits).map((r) => ({
    file: r.file,
    label: labelFor(r.stem, vstem)
  }));
}
function labelFor(sstem, vstem) {
  const extra = sstem.slice(vstem.length).replace(/^[.\s_\-\[(]+|[\])\s]+$/g, '');
  return extra ? extra.charAt(0).toUpperCase() + extra.slice(1) : 'Subtitles';
}

/* ---------- parsing ---------- */

async function readText(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('\uFFFD')) {
    try { t = new TextDecoder('windows-1252').decode(buf); } catch (e) {}
  }
  return t.replace(/^\uFEFF/, '');
}

function parseTime(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return NaN;
  return (m[1] ? +m[1] : 0) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4].padEnd(3, '0')) : 0);
}

/* handles both SRT and WebVTT */
export function parseCues(text) {
  const blocks = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]+\n/g, '\n\n').split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) continue;
    const [a, rest] = lines[ti].split('-->');
    const start = parseTime(a);
    const end = parseTime((rest || '').trim().split(/\s+/)[0] || '');
    const body = lines.slice(ti + 1).join('\n').trim();
    if (isNaN(start) || isNaN(end) || !body) continue;
    cues.push({ start, end, html: cueHtml(body) });
  }
  cues.sort((x, y) => x.start - y.start);
  return cues;
}

function cueHtml(raw) {
  const clean = raw
    .replace(/\{\\[^}]*\}/g, '')            // {\an8} style codes
    .replace(/<(?!\/?[ibu]>)[^>]*>/gi, '');  // drop every tag except <i> <b> <u>
  return escapeHtml(clean)
    .replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>')
    .replace(/\n/g, '<br>');
}

/* ---------- per-video track state ---------- */

const currentItem = () => state.playlist[state.currentIndex] || null;
const isLocal = (item) => item && item.type !== 'youtube' && item.type !== 'facebook';

function capsOf(item) {
  if (!item._caps) item._caps = { tracks: [], active: 0, loaded: new Set() };
  return item._caps;
}

async function addTrackFromFile(item, file, label) {
  const caps = capsOf(item);
  if (caps.loaded.has(file)) return false;
  caps.loaded.add(file);
  let cues = [];
  try { cues = parseCues(await readText(file)); } catch (e) {}
  if (!cues.length) return false;
  caps.tracks.push({ label: label || file.name.replace(SUB_RE, ''), cues });
  return true;
}

async function syncAutoTracks(item) {
  if (!isLocal(item)) return;
  let added = false;
  for (const m of findMatches(item)) {
    if (await addTrackFromFile(item, m.file, m.label)) added = true;
  }
  if (added && currentItem() === item) {
    refreshUi();
    if (!autoToastShown.has(item)) {
      autoToastShown.add(item);
      showToast('Captions found \u2014 press C to turn on');
    }
  }
}
const autoToastShown = new WeakSet();

/* manual add (button, or subtitle files dropped on their own) */
export async function attachManual(files) {
  const item = currentItem();
  const subs = Array.from(files).filter(isSubtitleFile);
  if (!subs.length) { showToast('Please choose a .srt or .vtt file'); return; }
  if (!isLocal(item)) { showToast('Open a local video first, then add captions'); return; }
  let ok = 0;
  for (const f of subs) {
    if (await addTrackFromFile(item, f, f.name.replace(SUB_RE, ''))) ok++;
  }
  if (!ok) { showToast('Could not read captions from that file'); return; }
  const caps = capsOf(item);
  caps.active = caps.tracks.length - 1;
  on = true;
  savePref();
  refreshUi();
  showToast('Captions added: ' + caps.tracks[caps.active].label);
}

/* ---------- on/off, track switching ---------- */

let on = (function () { try { return localStorage.getItem(PREF_KEY) === '1'; } catch (e) { return false; } })();
function savePref() { try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {} }

function activeTrack() {
  const item = currentItem();
  if (!isLocal(item) || !item._caps) return null;
  return item._caps.tracks[item._caps.active] || null;
}

export function toggleCaptions() {
  const item = currentItem();
  if (!isLocal(item)) { showToast('Captions are only available for local videos'); return; }
  const t = activeTrack();
  if (!t) { showToast('No captions found \u2014 use the + button to add a .srt / .vtt file'); return; }
  on = !on;
  savePref();
  refreshUi();
  showToast(on ? 'Captions on: ' + t.label : 'Captions off');
}

export function cycleCaptionTrack() {
  const item = currentItem();
  const caps = isLocal(item) && item._caps;
  if (!caps || !caps.tracks.length) { showToast('No captions loaded'); return; }
  caps.active = (caps.active + 1) % caps.tracks.length;
  on = true;
  savePref();
  refreshUi();
  showToast('Captions: ' + caps.tracks[caps.active].label +
    (caps.tracks.length > 1 ? ' (' + (caps.active + 1) + '/' + caps.tracks.length + ')' : ''));
}

/* ---------- drawing ---------- */

let layer = null, ccBtn = null, ccAddBtn = null, subInput = null, raf = 0, lastHtml = '';

function activeHtml(cues, t) {
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out = [];
  for (let i = idx; i >= 0 && i > idx - 6; i--) {
    if (cues[i].end > t) out.unshift(cues[i].html);
  }
  return out.join('<br>');
}

function render() {
  if (!layer) return;
  const t = activeTrack();
  const html = (on && t) ? activeHtml(t.cues, video.currentTime) : '';
  if (html === lastHtml) return;
  lastHtml = html;
  layer.innerHTML = html ? '<span>' + html + '</span>' : '';
}

function loop() {
  render();
  raf = (on && !video.paused && !video.ended) ? requestAnimationFrame(loop) : 0;
}
function kick() { cancelAnimationFrame(raf); raf = 0; loop(); }

function refreshUi() {
  const t = activeTrack();
  if (ccBtn) {
    ccBtn.classList.toggle('active', !!(on && t));
    ccBtn.classList.toggle('cc-empty', !t);
    ccBtn.title = t ? 'Captions (c) \u2014 ' + t.label : 'Captions (c) \u2014 none loaded, use + to add';
  }
  lastHtml = null;
  kick();
}

function onItemLoading() {
  lastHtml = null;
  if (layer) layer.innerHTML = '';
  const item = currentItem();
  refreshUi();
  if (item) syncAutoTracks(item);
}

export function initCaptions() {
  layer = document.createElement('div');
  layer.id = 'captionLayer';
  layer.setAttribute('aria-live', 'off');
  playerWrapper.appendChild(layer);

  ccBtn = document.getElementById('ccBtn');
  ccAddBtn = document.getElementById('ccAddBtn');

  subInput = document.createElement('input');
  subInput.type = 'file';
  subInput.accept = '.srt,.vtt,text/vtt';
  subInput.multiple = true;
  subInput.hidden = true;
  document.body.appendChild(subInput);
  subInput.addEventListener('change', () => {
    if (subInput.files.length) attachManual(subInput.files);
    subInput.value = '';
  });

  if (ccBtn) ccBtn.addEventListener('click', toggleCaptions);
  if (ccAddBtn) ccAddBtn.addEventListener('click', () => {
    if (!isLocal(currentItem())) { showToast('Open a local video first, then add captions'); return; }
    subInput.click();
  });

  video.addEventListener('lvp:itemloading', onItemLoading);
  ['play', 'playing', 'seeked', 'seeking', 'timeupdate', 'loadedmetadata', 'ratechange'].forEach(
    (ev) => video.addEventListener(ev, kick)
  );
  video.addEventListener('pause', render);

  window.LVPCaptions = { registerFiles, attachManual };
  refreshUi();
}
