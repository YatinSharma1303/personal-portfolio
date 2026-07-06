/* Service Worker — offline caching for the portfolio.
   Network-First Strategy: Always fetch fresh code from the server. 
   Only use cache if the network fails (offline mode).
*/
const CACHE = 'yatin-portfolio-v4'; // Bumped to v4 — visitor count fix + all new features

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (e) => {
  // Delete all old caches (like v1) to free up space and prevent bugs
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim(); // Take control of all open tabs immediately
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Only intercept same-origin GET requests (HTML, CSS, JS, images)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-First Strategy
  e.respondWith(
    // 1. Try to fetch the fresh version from the network
    fetch(e.request).then(response => {
      // If valid, save a copy to the cache for offline use later
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
      }
      return response;
    }).catch(() => {
      // 2. If network fails (offline), fall back to the cached version
      return caches.match(e.request);
    })
  );
});
