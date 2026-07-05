/* Service Worker — offline caching for the portfolio.
   Caches the shell (HTML/CSS/JS) on first visit so returning
   visitors get instant loads even offline.
*/
const CACHE = 'yatin-portfolio-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/games.js',
  '/assets/cover.jpg',
  '/assets/smarthealthcare.jpg',
  '/assets/yatinigpt.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only cache same-origin GET requests.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
