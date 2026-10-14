/* media.js: native video / YouTube playback abstraction */

import { state, video, thumbVideo, tooltipCanvas, playerWrapper, durTimeEl, showToast, fmtTime } from './core.js';

let ytPlayer = null;
let ytApiReady = false;
let ytApiLoading = false;
let pendingYtLoad = null;
let onEndedCallback = null;
let onDurationCallback = null;

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
    return ytPlayer.getPlayerState() !== 1;
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

export function setOnEndedCallback(fn) { onEndedCallback = fn; }
export function setOnDurationCallback(fn) { onDurationCallback = fn; }

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

export function loadMediaItem(item, autoplay) {
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

function setYtIframeVisible(visible) {
  if (!ytPlayer || !ytPlayer.getIframe) return;
  try {
    const frame = ytPlayer.getIframe();
    if (frame) frame.style.display = visible ? 'block' : 'none';
  } catch (err) {  }
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

export function initMedia() {
  video.addEventListener('ended', () => {
    if (state.loopOne) { video.currentTime = 0; video.play().catch(() => {}); }
    else if (onEndedCallback) onEndedCallback();
  });
  video.addEventListener('timeupdate', () => maybeSaveCurrentPosition(false));
  video.addEventListener('pause', () => maybeSaveCurrentPosition(true));
  window.addEventListener('beforeunload', () => maybeSaveCurrentPosition(true));
}
