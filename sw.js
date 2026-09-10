/**
 * PastaPresto service worker.
 *
 * Network-first with a cache fallback, deliberately: a venue that just deployed
 * a menu change must see it on the next load, and cache-first would serve them
 * yesterday's app. The cache exists so a dropped connection mid-service does
 * not leave a cook staring at a blank screen.
 *
 * Only same-origin GETs are touched. Firestore traffic is left alone - it has
 * its own IndexedDB persistence and its own retry logic.
 */
const CACHE = 'pastapresto-v1';

const SHELL = [
  './',
  './index.html',
  './kitchen.html',
  './expo.html',
  './admin.html',
  './shared.css',
  './guest.css',
  './kitchen.css',
  './expo.css',
  './admin.css',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any single file 404s, so add them
      // individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase, gstatic, etc.

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
