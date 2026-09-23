// Offline shell. The page opens from the cache at once, so a sleeping server
// never holds it up, and a fresh copy is saved in the background for next time.
// Fonts and icons come from the cache first. The API is never cached.
const CACHE = 'deka-v13';
const SHELL = ['/', '/manifest.webmanifest', '/brand/icon.svg', '/brand/icon-180.png', '/brand/icon-192.png', '/fonts/melomaniac-serif-v0.1.woff2', '/fonts/figtree-deka.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    const fresh = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put('/', copy)).then(() => res); }
      return res;
    });
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(caches.match('/').then(hit => hit || fresh));
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
