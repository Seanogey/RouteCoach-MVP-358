// ─── DEV / PROD SWITCH ──────────────────────────────────────────────────────
// Set DEV_MODE = false when shipping.  In dev mode the SW does zero caching
// and passes every request straight to the network, so a normal reload always
// sees your latest files.  Bump CACHE_NAME whenever you edit this file so the
// new worker replaces the old one on the next reload.
const DEV_MODE   = true;
const CACHE_NAME = 'routecoach-v3';
// ────────────────────────────────────────────────────────────────────────────

// skipWaiting: new worker activates immediately instead of waiting for all
// tabs on the old version to close.
self.addEventListener('install', e => {
  self.skipWaiting();

  if (!DEV_MODE) {
    // PRODUCTION: precache the app shell for offline use.
    const SHELL = [
      './',
      './index.html',
      './app.js',
      './styles.css',
      './manifest.webmanifest',
      // route358.json uses network-first below, so it's excluded from precache.
    ];
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  }
});

// clients.claim: this worker controls already-open tabs without waiting for a
// reload, so the new fetch strategy kicks in immediately.
self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Wipe every cache that belongs to an older version of this SW.
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener('fetch', e => {
  if (DEV_MODE) {
    // Pass every request to the browser unchanged — no SW caching at all.
    // A normal reload (Cmd+R / F5) picks up every file edit immediately.
    return;
  }

  // ── PRODUCTION strategies ─────────────────────────────────────────────────
  const url = new URL(e.request.url);

  if (url.pathname.endsWith('.json')) {
    // Network-first for data files: always reflects the latest route data;
    // falls back to cache if the device is offline.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for the app shell (HTML, JS, CSS).
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
