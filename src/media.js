/*!
 * media.js
 * The video/YouTube abstraction layer: whichever of the two is actually
 * playing, everything else in the app talks to it through the functions
 * exported here instead of touching <video> or YT.Player directly.
 *
 * Depends only on './core.js' (state, video, thumbVideo, tooltipCanvas,
 * playerWrapper, durTimeEl, showToast, fmtTime) — nothing else. That
 * keeps this file at the bottom of the dependency graph alongside
 * core.js itself: controls.js, playlist.js, and study-timer.js all
 * import from media.js, but media.js never imports from any of them.
 *
 * Two places where this file would otherwise need to call into
 * controls.js or playlist.js are handled without doing so:
 *
 *   0. Clearing A/B loop points for a new item (controls.js's state)
 *      is done by dispatching a 'lvp:itemloading' CustomEvent on the
 *      real <video> element at the start of loadMediaItem(), which
 *      controls.js listens for — rather than this file (or playlist.js,
 *      which calls loadMediaItem) importing controls.js directly.
 *
 *   1. Advancing to the next playlist item when playback ends (and
 *      isn't looping) is playlist.js's call to make, not this file's —
 *      so instead of importing loadVideo, this file exposes
 *      setOnEndedCallback(fn) / setOnDurationCallback(fn), which
 *      playlist.js registers during its own init. Loop-one restart
 *      needs no callback at all — this file just seeks back to 0 and
 *      plays, since that's pure media control.
 *
 *   2. Keeping the play/pause icon, spinner, and auto-hide timer in
 *      sync while a YouTube video is active — all controls.js's
 *      concerns — is done by dispatching synthetic 'play' / 'playing' /
 *      'pause' / 'waiting' events on the real <video> element from
 *      onYtStateChange(). controls.js already listens for exactly
 *      those events on that element for the native-video case; this
 *      just reuses that same listener for the YouTube case too,
 *      without either file needing to import the other.
 *
 * Resume-on-load ("remember where you left off on saved links") is
 * fully self-contained here: the position storage, the save-on-pause/
 * timeupdate/beforeunload wiring, and applying a saved position when a
 * link is (re)loaded all live in this one file, since it's really one
 * feature — "remember and restore media position" — regardless of
 * which element is actually playing.
 *
 * Exports:
 *   initMedia()                 — wires the 'ended' listener and the
 *                                 resume-position auto-save listeners.
 *   loadMediaItem(item, autoplay) — loads a playlist item (direct video
 *                                 or YouTube) into whichever element
 *                                 fits, applying a saved resume position
 *                                 when appropriate. Called by
 *                                 playlist.js's loadVideo().
 *   saveCurrentPosition()       — force-saves the position of whatever
 *                                 is playing right now. playlist.js
 *                                 calls this itself, before switching
 *                                 state.currentIndex to a new item, to
 *                                 capture the outgoing item's position.
 *   setOnEndedCallback(fn)      — fn() is called when playback ends and
 *                                 loop-one is off (playlist.js supplies
 *                                 "advance to next item").
 *   setOnDurationCallback(fn)   — fn() is called whenever this file
 *                                 learns a YouTube item's duration
 *                                 (playlist.js supplies "re-render the
 *                                 playlist list"; the native-video case
 *                                 doesn't need this — playlist.js listens
 *                                 for the real <video> element's own
 *                                 'loadedmetadata' event directly).
 *   isCurrentYouTube()
 *   mediaPlay() / mediaPause() / mediaSeek(t)
 *   mediaDuration() / mediaCurrentTime() / isPausedNow()
 *   mediaSetVolume(vol) / mediaSetMuted(muted) / mediaSetPlaybackRate(rate)
 *     — mirror a value already set canonically on the real <video>
 *       element onto the YouTube player, when one is active. Volume,
 *       mute, and playback rate stay canonical on <video> exactly as
 *       in the original single-file version; these three exist only
 *       for the mirroring, not as the source of truth.
 *
 * Known limitation carried over from the original design: buffered-
 * range display on the progress bar only reflects the real <video>
 * element — YouTube's own buffered fraction isn't surfaced here.
 */
import { state, video, thumbVideo, tooltipCanvas, playerWrapper, durTimeEl, showToast, fmtTime } from './core.js';

let ytPlayer = null;
let ytApiReady = false;
let ytApiLoading = false;
let pendingYtLoad = null; // {videoId, autoplay}
let onEndedCallback = null;
let onDurationCallback = null;

/* ============================================================
   Core abstraction
   ============================================================ */
export function isCurrentYouTube() {
  const item = state.playlist[state.currentIndex];
  return !!(item && item.type === 'youtube');
}

export function mediaDuration() {
  if (isCurrentYouTube()) return (ytPlayer && ytPlayer.getDuration) ? ytPlayer.getDuration() : NaN;
  return video.duration;
}
export function mediaCurrentTime() {
  if (isCurrentYouTube()) return (ytPlayer && ytPlayer.getCurrentTime) ? ytPlayer.getCurrentTime() : 0;
  return video.currentTime;
}
export function mediaSeek(t) {
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(t, true); }
  else { video.currentTime = t; }
}
export function mediaPlay() {
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo(); }
  else { video.play().catch(() => {}); }
}
export function mediaPause() {
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); }
  else { video.pause(); }
}
export function isPausedNow() {
  if (isCurrentYouTube()) {
    if (!ytPlayer || !ytPlayer.getPlayerState) return true;
    return ytPlayer.getPlayerState() !== 1; // 1 = YT.PlayerState.PLAYING
  }
  return video.paused;
}

export function mediaSetVolume(vol) {
  if (isCurrentYouTube() && ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(Math.round(vol * 100));
}
export function mediaSetMuted(muted) {
  if (!isCurrentYouTube() || !ytPlayer) return;
  if (muted) { if (ytPlayer.mute) ytPlayer.mute(); }
  else { if (ytPlayer.unMute) ytPlayer.unMute(); }
}
export function mediaSetPlaybackRate(rate) {
  if (isCurrentYouTube() && ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(rate);
}

/* ============================================================
   Ended-playback callbacks (see file header)
   ============================================================ */
export function setOnEndedCallback(fn) { onEndedCallback = fn; }
export function setOnDurationCallback(fn) { onDurationCallback = fn; }

/* ============================================================
   Resume-on-load position storage (localStorage, per URL)
   ============================================================ */
function loadPositions() {
  try {
    const raw = localStorage.getItem('lvp_positions');
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}
function savePosition(url, seconds) {
  if (!url || !isFinite(seconds) || seconds < 4) return;
  try {
    const positions = loadPositions();
    positions[url] = Math.floor(seconds);
    localStorage.setItem('lvp_positions', JSON.stringify(positions));
  } catch (e) {}
}
function getPosition(url) {
  return loadPositions()[url] || 0;
}
let lastPositionSaveTs = 0;
function maybeSaveCurrentPosition(force) {
  if (!state.features.resume) return;
  const item = state.playlist[state.currentIndex];
  if (!item || !item.isRemote) return;
  const now = Date.now();
  if (!force && now - lastPositionSaveTs < 4000) return;
  lastPositionSaveTs = now;
  savePosition(item.url, mediaCurrentTime());
}
export function saveCurrentPosition() {
  maybeSaveCurrentPosition(true);
}

/* ============================================================
   Loading a playlist item (direct video or YouTube)
   ============================================================ */
export function loadMediaItem(item, autoplay) {
  // A/B loop points are per-video. Dispatched before either branch below
  // runs, so controls.js (which owns A/B loop state) can clear them by
  // listening on this event itself, rather than this file — or
  // playlist.js, which calls this function — importing controls.js.
  video.dispatchEvent(new CustomEvent('lvp:itemloading'));

  if (item.type === 'youtube') {
    video.pause();
    video.removeAttribute('src');
    thumbVideo.removeAttribute('src');
    try { tooltipCanvas.getContext('2d').clearRect(0, 0, tooltipCanvas.width, tooltipCanvas.height); } catch (e) {}
    playerWrapper.classList.add('yt-mode');
    const wantAutoplay = autoplay !== false;
    if (ytApiReady && window.YT && window.YT.Player) {
      createYtPlayer(item.youtubeId, wantAutoplay);
    } else {
      pendingYtLoad = { videoId: item.youtubeId, autoplay: wantAutoplay };
      loadYouTubeAPI();
    }
    setYtIframeVisible(true);
  } else {
    if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    setYtIframeVisible(false);
    playerWrapper.classList.remove('yt-mode');
    video.classList.add('lvp-swapping');
    video.src = item.url;
    video.addEventListener('loadeddata', function clearSwap() {
      video.removeEventListener('loadeddata', clearSwap);
      requestAnimationFrame(() => video.classList.remove('lvp-swapping'));
    }, { once: true });
    if (!item.isRemote) thumbVideo.src = item.url;
    else thumbVideo.removeAttribute('src');

    if (state.features.resume && item.isRemote) {
      const pos = getPosition(item.url);
      if (pos > 4) {
        video.addEventListener('loadedmetadata', function resumeOnce() {
          video.removeEventListener('loadedmetadata', resumeOnce);
          if (isFinite(video.duration) && pos < video.duration - 2) {
            video.currentTime = pos;
            showToast(`Resumed from ${fmtTime(pos)}`);
          }
        }, { once: true });
      }
    }
    if (autoplay !== false) video.play().catch(() => {});
  }
}

/* ============================================================
   YouTube IFrame API
   ============================================================ */
function setYtIframeVisible(visible) {
  if (!ytPlayer || !ytPlayer.getIframe) return;
  try {
    const frame = ytPlayer.getIframe();
    if (frame) frame.style.display = visible ? 'block' : 'none';
  } catch (err) { /* ignore */ }
}

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) { ytApiReady = true; return; }
  if (ytApiLoading) return;
  ytApiLoading = true;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingYtLoad) {
      const { videoId, autoplay } = pendingYtLoad;
      pendingYtLoad = null;
      createYtPlayer(videoId, autoplay);
    }
  };
}

function createYtPlayer(videoId, autoplay) {
  if (ytPlayer && ytPlayer.loadVideoById) {
    if (autoplay) ytPlayer.loadVideoById(videoId);
    else ytPlayer.cueVideoById(videoId);
    setYtIframeVisible(true);
    return;
  }
  // Pass the id of a never-replaced inner target div, not the stable
  // #youtubePlayerContainer wrapper itself — the YouTube IFrame API
  // replaces whatever element it's given with an <iframe> and doesn't
  // reliably preserve that element's id on the replacement.
  ytPlayer = new window.YT.Player('ytPlayerTarget', {
    videoId: videoId,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      controls: 0,
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      fs: 0,
      playsinline: 1,
      iv_load_policy: 3
    },
    events: {
      onReady: onYtReady,
      onStateChange: onYtStateChange
    }
  });
}

function onYtReady(e) {
  try {
    const frame = e.target.getIframe();
    if (frame) {
      frame.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      // The YT IFrame API grants this iframe "picture-in-picture"
      // permission by default, which lets Chromium browsers auto-pop
      // their own native miniplayer overlay for the video inside it.
      // Stripping it from the allow list blocks that browser-level
      // auto-PiP (our own PiP button is already disabled for YouTube).
      const allow = frame.getAttribute('allow') || '';
      frame.setAttribute('allow', allow.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('picture-in-picture')).join('; '));
    }
  } catch (err) {}

  e.target.setVolume(Math.round((video.muted ? 0 : video.volume) * 100));
  if (video.muted) e.target.mute();
  try { e.target.setPlaybackRate(video.playbackRate); } catch (err) {}

  const dur = e.target.getDuration();
  if (dur) {
    durTimeEl.textContent = fmtTime(dur);
    if (state.currentIndex !== -1 && state.playlist[state.currentIndex]) {
      state.playlist[state.currentIndex].duration = dur;
      if (onDurationCallback) onDurationCallback();
    }
  }

  const cur = state.playlist[state.currentIndex];
  if (state.features.resume && cur && cur.isRemote) {
    const pos = getPosition(cur.url);
    if (pos > 4 && dur && pos < dur - 2) {
      e.target.seekTo(pos, true);
      showToast(`Resumed from ${fmtTime(pos)}`);
    }
  }
}

function onYtStateChange(e) {
  const St = window.YT.PlayerState;
  if (e.data === St.PLAYING) {
    // Reuses controls.js's existing native <video> 'play'/'playing'
    // listeners (icon flip, spinner, auto-hide timer) instead of this
    // file importing controls.js to call them directly.
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  } else if (e.data === St.PAUSED) {
    video.dispatchEvent(new Event('pause'));
  } else if (e.data === St.BUFFERING) {
    video.dispatchEvent(new Event('waiting'));
  } else if (e.data === St.ENDED) {
    if (state.loopOne) {
      ytPlayer.seekTo(0, true);
      ytPlayer.playVideo();
    } else if (onEndedCallback) {
      onEndedCallback();
    }
  }
}

/* ============================================================
   Init
   ============================================================ */
export function initMedia() {
  video.addEventListener('ended', () => {
    if (state.loopOne) { video.currentTime = 0; video.play().catch(() => {}); }
    else if (onEndedCallback) onEndedCallback();
  });
  video.addEventListener('timeupdate', () => maybeSaveCurrentPosition(false));
  video.addEventListener('pause', () => maybeSaveCurrentPosition(true));
  window.addEventListener('beforeunload', () => maybeSaveCurrentPosition(true));
}