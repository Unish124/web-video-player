/* thumbs.js: playlist thumbnails and YouTube titles */

const queue = [];
let running = false;

function youtubeThumb(id) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function captureFrame(item) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.playsInline = true;
    if (item.isRemote) v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.addEventListener('error', () => finish(null), { once: true });
    v.addEventListener('loadedmetadata', () => {
      const dur = isFinite(v.duration) ? v.duration : 0;
      v.dataset.dur = String(dur);
      v.currentTime = dur > 4 ? Math.min(dur * 0.1, 30) : 0.1;
    }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        const w = 200;
        const h = Math.round(w * (v.videoHeight || 9) / (v.videoWidth || 16));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        finish({ thumb: c.toDataURL('image/jpeg', 0.7), duration: parseFloat(v.dataset.dur) || null });
      } catch (e) {
        finish({ thumb: null, duration: parseFloat(v.dataset.dur) || null });
      }
    }, { once: true });
    v.src = item.url;
  });
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { item, onReady, isStillWanted } = queue.shift();
    if (!isStillWanted()) continue;
    const res = await captureFrame(item);
    item.thumbTried = true;
    if (res) {
      if (res.thumb) item.thumb = res.thumb;
      if (res.duration && !item.duration) item.duration = res.duration;
      onReady();
    }
  }
  running = false;
}

export function ensureThumbnail(item, onReady, isStillWanted) {
  if (item.thumb || item.thumbTried) return;
  if (item.type === 'youtube' && item.youtubeId) {
    item.thumb = youtubeThumb(item.youtubeId);
    return;
  }
  if (item.thumbQueued) return;
  item.thumbQueued = true;
  queue.push({ item, onReady, isStillWanted });
  pump();
}

export function ensureYouTubeMeta(item, onReady) {
  if (item.type !== 'youtube' || item.metaTried || item.author) return;
  if (item.name && item.name !== 'YouTube video') { item.metaTried = true; return; }
  item.metaTried = true;
  const url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + item.youtubeId);
  fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data) return;
      if (data.title) item.name = data.title;
      if (data.author_name) item.author = data.author_name;
      onReady();
    })
    .catch(() => {});
}
