// Dimensional service worker (D38): works offline after the first visit.
// Pages: network first, falling back to the cached app. Hashed assets and fonts: cache first.
// the build stamps this with a version (see vite.config.ts), so a new deploy replaces the cache
const CACHE = 'dimensional-dev';

self.addEventListener('install', (event) => {
  // precache.json lists every file of this build: the app works offline right after the first visit
  event.waitUntil(
    fetch('/precache.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then(({ files }) => caches.open(CACHE).then((c) => c.addAll(files)))
      .catch(() => caches.open(CACHE).then((c) => c.addAll(['/'])))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/', { ignoreVary: true })),
    );
    return;
  }

  // content-hashed files never change: serve from cache, fill it on first use
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/mathlive-fonts/')) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // everything else (icons, manifest): cached copy now, refreshed in the background
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});
