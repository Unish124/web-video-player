/* media.js: native video / YouTube playback abstraction */

import { state, video, thumbVideo, tooltipCanvas, playerWrapper, durTimeEl, showToast, fmtTime } from './core.js';

let ytPlayer = null;
let ytApiReady = false;
let ytApiLoading = false;
let pendingYtLoad = null;
let onEndedCallback = null;
let onDurationCallback = null;

let fbPlayer = null;
let fbSdkReady = false;
let fbSdkLoading = false;
let fbPending = null;
let fbPlaying = false;
let fbCurrentId = null;
let fbSeq = 0;
let fbHandles = [];
let fbEventsSeen = false;
let fbWantPlay = false;
let fbWatchTimer = null;
let fbPollTimer = null;
let fbLastPos = -1;
let fbStill = 0;
let fbResizeObs = null;
const fbContainer = document.getElementById('facebookPlayerContainer');

export function parseFacebookUrl(u) {
  let p;
  try { p = new URL(u); } catch (e) { return null; }
  if (!/^https?:$/.test(p.protocol)) return null;
  const host = p.hostname.toLowerCase();
  if (host === 'fb.watch') return { url: p.origin + p.pathname + p.search, isVideo: p.pathname.length > 1 };
  if (!/(^|\.)(facebook\.com|fb\.com)$/.test(host)) return null;
  const path = p.pathname;
  const isVideo = /\/(videos?|reels?|watch)(\/|$)/i.test(path) || /\/share\/(v|r)\//i.test(path) || (/^\/video\.php/i.test(path) && p.searchParams.has('v'));
  return { url: 'https://www.facebook.com' + path + p.search, isVideo };
}

export function isCurrentFacebook() {
  const item = state.playlist[state.currentIndex];
  return !!(item && item.type === 'facebook');
}
export function isCurrentEmbed() {
  return isCurrentYouTube() || isCurrentFacebook();
}
function fbCall(name, ...args) {
  try { if (fbPlayer && typeof fbPlayer[name] === 'function') return fbPlayer[name](...args); } catch (e) {}
  return undefined;
}

export function isCurrentYouTube() {
  const item = state.playlist[state.currentIndex];
  return !!(item && item.type === 'youtube');
}

export function mediaDuration() {
  if (isCurrentFacebook()) { const d = fbCall('getDuration'); return (typeof d === 'number' && d > 0) ? d : NaN; }
  if (isCurrentYouTube()) return (ytPlayer && ytPlayer.getDuration) ? ytPlayer.getDuration() : NaN;
  return video.duration;
}
export function mediaCurrentTime() {
  if (isCurrentFacebook()) { const t = fbCall('getCurrentPosition'); return typeof t === 'number' ? t : 0; }
  if (isCurrentYouTube()) return (ytPlayer && ytPlayer.getCurrentTime) ? ytPlayer.getCurrentTime() : 0;
  return video.currentTime;
}
export function mediaSeek(t) {
  if (isCurrentFacebook()) { fbCall('seek', t); return; }
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(t, true); }
  else { video.currentTime = t; }
}
export function mediaPlay() {
  if (isCurrentFacebook()) { fbWantPlay = true; fbCall('play'); watchFbStart(); return; }
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo(); }
  else { video.play().catch(() => {}); }
}
export function mediaPause() {
  if (isCurrentFacebook()) { fbWantPlay = false; fbCall('pause'); return; }
  if (isCurrentYouTube()) { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); }
  else { video.pause(); }
}
export function isPausedNow() {
  if (isCurrentFacebook()) return !fbPlaying;
  if (isCurrentYouTube()) {
    if (!ytPlayer || !ytPlayer.getPlayerState) return true;
    return ytPlayer.getPlayerState() !== 1;
  }
  return video.paused;
}

export function mediaSetVolume(vol) {
  if (isCurrentFacebook()) { fbCall('setVolume', Math.max(0, Math.min(1, vol))); return; }
  if (isCurrentYouTube() && ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(Math.round(vol * 100));
}
export function mediaSetMuted(muted) {
  if (isCurrentFacebook()) { fbCall(muted ? 'mute' : 'unmute'); return; }
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

  if (item.type !== 'facebook') {
    fbPending = null;
    destroyFbPlayer();
    playerWrapper.classList.remove('fb-mode');
  }

  if (item.type === 'facebook') {
    video.pause();
    video.removeAttribute('src');
    thumbVideo.removeAttribute('src');
    try { tooltipCanvas.getContext('2d').clearRect(0, 0, tooltipCanvas.width, tooltipCanvas.height); } catch (e) {}
    if (ytPlayer && ytPlayer.pauseVideo) { try { ytPlayer.pauseVideo(); } catch (e) {} }
    pendingYtLoad = null;
    setYtIframeVisible(false);
    playerWrapper.classList.remove('yt-mode');
    playerWrapper.classList.add('fb-mode');
    const wantFbAutoplay = autoplay !== false;
    if (fbSdkReady && window.FB && window.FB.XFBML) {
      createFbPlayer(item.url, wantFbAutoplay);
    } else {
      fbPending = { url: item.url, autoplay: wantFbAutoplay };
      loadFacebookSdk();
    }
  } else if (item.type === 'youtube') {
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

function loadFacebookSdk() {
  if (window.FB && window.FB.XFBML) { initFbSdk(); return; }
  if (fbSdkLoading) return;
  fbSdkLoading = true;
  window.fbAsyncInit = initFbSdk;
  const tag = document.createElement('script');
  tag.async = true;
  tag.defer = true;
  tag.crossOrigin = 'anonymous';
  tag.src = 'https://connect.facebook.net/en_US/sdk.js';
  tag.onerror = () => {
    fbSdkLoading = false;
    showToast('Could not load Facebook player \u2014 check your connection or ad blocker');
  };
  document.head.appendChild(tag);
}

function initFbSdk() {
  if (fbSdkReady) return;
  try { window.FB.init({ xfbml: false, version: 'v19.0' }); } catch (e) {}
  fbSdkReady = true;
  try {
    window.FB.Event.subscribe('xfbml.ready', (msg) => {
      if (msg && msg.type === 'video' && msg.id === fbCurrentId) onFbReady(msg.instance);
    });
  } catch (e) {}
  if (fbPending) {
    const { url, autoplay } = fbPending;
    fbPending = null;
    createFbPlayer(url, autoplay);
  }
}

function setFbNative(on) {
  playerWrapper.classList.toggle('fb-native', !!on);
}

function setFbPlaying(p) {
  if (fbPlaying === p) return;
  fbPlaying = p;
  if (p) {
    setFbNative(false);
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  } else {
    video.dispatchEvent(new Event('pause'));
  }
}

function watchFbStart() {
  clearTimeout(fbWatchTimer);
  fbWatchTimer = setTimeout(() => {
    if (!isCurrentFacebook() || fbPlaying || !fbWantPlay) return;
    setFbNative(true);
    showToast('Facebook blocked auto-play \u2014 click the video once to start it');
  }, 1600);
}

function startFbPoll() {
  clearInterval(fbPollTimer);
  fbLastPos = -1;
  fbStill = 0;
  fbPollTimer = setInterval(() => {
    if (!fbPlayer || !isCurrentFacebook()) return;
    refreshFbDuration();
    if (fbEventsSeen) return;
    const t = fbCall('getCurrentPosition');
    if (typeof t !== 'number') return;
    if (fbLastPos >= 0 && Math.abs(t - fbLastPos) > 0.05) { fbStill = 0; setFbPlaying(true); }
    else if (++fbStill >= 3) setFbPlaying(false);
    fbLastPos = t;
  }, 400);
}

function fitFb() {
  if (!fbContainer) return;
  const box = fbContainer.querySelector('.fb-video');
  const inner = box && (box.querySelector('iframe') || box.querySelector('span'));
  if (!box || !inner) return;
  const w = inner.offsetWidth, h = inner.offsetHeight;
  const cw = fbContainer.clientWidth, ch = fbContainer.clientHeight;
  if (!w || !h || !cw || !ch) return;
  const scale = Math.min(cw / w, ch / h);
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  box.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
}

function destroyFbPlayer() {
  fbHandles.forEach(h => { try { h && h.release && h.release(); } catch (e) {} });
  fbHandles = [];
  clearTimeout(fbWatchTimer);
  clearInterval(fbPollTimer);
  if (fbResizeObs) { try { fbResizeObs.disconnect(); } catch (e) {} fbResizeObs = null; }
  if (fbPlayer) { try { fbPlayer.pause(); } catch (e) {} }
  fbPlayer = null;
  fbPlaying = false;
  fbEventsSeen = false;
  fbWantPlay = false;
  fbCurrentId = null;
  setFbNative(false);
  if (fbContainer) fbContainer.innerHTML = '';
}

function createFbPlayer(url, autoplay) {
  destroyFbPlayer();
  if (!fbContainer) return;
  const id = 'fbVideo' + (++fbSeq);
  fbCurrentId = id;
  fbWantPlay = !!autoplay;
  const el = document.createElement('div');
  el.className = 'fb-video';
  el.id = id;
  const parsed = parseFacebookUrl(url);
  el.setAttribute('data-href', parsed ? parsed.url : url);
  el.setAttribute('data-width', String(Math.max(220, Math.min(1000, Math.round(fbContainer.clientWidth || playerWrapper.clientWidth || 640)))));
  el.setAttribute('data-show-text', 'false');
  el.setAttribute('data-allowfullscreen', 'false');
  el.setAttribute('data-autoplay', autoplay ? 'true' : 'false');
  el.setAttribute('data-lazy', 'false');
  fbContainer.appendChild(el);
  if (window.ResizeObserver) {
    fbResizeObs = new ResizeObserver(() => fitFb());
    fbResizeObs.observe(fbContainer);
    fbResizeObs.observe(el);
  }
  try { window.FB.XFBML.parse(fbContainer); }
  catch (e) { showToast('Could not start the Facebook player'); }
  if (autoplay) watchFbStart();
}

function refreshFbDuration() {
  const dur = fbCall('getDuration');
  if (typeof dur !== 'number' || !(dur > 0)) return;
  durTimeEl.textContent = fmtTime(dur);
  const cur = state.playlist[state.currentIndex];
  if (cur && cur.type === 'facebook' && cur.duration !== dur) {
    cur.duration = dur;
    if (onDurationCallback) onDurationCallback();
  }
}

function onFbReady(inst) {
  fbPlayer = inst;
  const sub = (name, fn) => {
    try { fbHandles.push(inst.subscribe(name, () => { fbEventsSeen = true; fn(); })); } catch (e) {}
  };
  sub('startedPlaying', () => { refreshFbDuration(); setFbPlaying(true); });
  sub('paused', () => setFbPlaying(false));
  sub('startedBuffering', () => video.dispatchEvent(new Event('waiting')));
  sub('finishedBuffering', () => {
    refreshFbDuration();
    if (fbPlaying) video.dispatchEvent(new Event('playing'));
  });
  sub('finishedPlaying', () => {
    if (state.loopOne) {
      fbCall('seek', 0);
      fbCall('play');
    } else {
      setFbPlaying(false);
      if (onEndedCallback) onEndedCallback();
    }
  });
  sub('error', () => {
    showToast('Facebook could not play this video \u2014 it must be public and allow embedding');
  });
  startFbPoll();
  fitFb();

  const muted = video.muted || video.volume === 0;
  fbCall('setVolume', muted ? 0 : video.volume);
  fbCall(muted ? 'mute' : 'unmute');
  refreshFbDuration();

  const cur = state.playlist[state.currentIndex];
  if (state.features.resume && cur && cur.isRemote) {
    const pos = getPosition(cur.url);
    const dur = fbCall('getDuration');
    if (pos > 4 && dur && pos < dur - 2) {
      fbCall('seek', pos);
      showToast(`Resumed from ${fmtTime(pos)}`);
    }
  }
}

export function stopEmbeds() {
  if (ytPlayer && ytPlayer.pauseVideo) { try { ytPlayer.pauseVideo(); } catch (e) {} }
  fbPending = null;
  destroyFbPlayer();
  playerWrapper.classList.remove('yt-mode', 'fb-mode');
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
