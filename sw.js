const CACHE = 'lvp-v1.0.8';
const ASSETS = [
  './',
  'index.html',
  'guide.html',
  'manifest.webmanifest',
  'css/player.css',
  'css/guide.css',
  'course-feature.js',
  'src/guide.js',
  'src/main.js',
  'src/core.js',
  'src/media.js',
  'src/controls.js',
  'src/playlist.js',
  'src/playlist-sort.js',
  'src/thumbs.js',
  'src/study-timer.js',
  'src/install.js',
  'playback-enhancements/index.js',
  'playback-enhancements/duration.js',
  'playback-enhancements/speed.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const target = req.mode === 'navigate' ? req.url : req;
  e.respondWith(
    fetch(target, { cache: 'no-cache' })
      .then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
