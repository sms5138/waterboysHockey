/* Waterboys Hockey — Service Worker
 * Pre-caches the app shell so Tools works offline at the rink.
 * Bump CACHE_VERSION on every release to purge stale assets. */
const CACHE_VERSION = 'wbh-v3';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './tools.js',
  './manifest.webmanifest',
  './vendor/sortable.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/html2canvas.min.js',
  './assets/logo.png',
  './assets/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API traffic (video hub) — always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  // Only handle same-origin requests. Cross-origin (e.g. api.waterboyshockey.com) bypasses.
  if (url.origin !== self.location.origin) return;

  // Network-first for navigations and top-level scripts/styles so edits show up on reload.
  // Falls back to cache when offline. Static vendor libs and images stay cache-first.
  const isFreshPath = req.mode === 'navigate'
    || /\/(index\.html|tools\.js|app\.js|config\.js|styles\.css|sw\.js|manifest\.webmanifest)$/.test(url.pathname)
    || url.pathname === '/' || url.pathname.endsWith('/');

  if (isFreshPath) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
