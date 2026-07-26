/* ============================================================
 sw.js - Service Worker for portfolio.yatinsharma.me
 Strategy: Stale-While-Revalidate for static assets,
           Network-Only for API calls.
 Cache version matches bot version: v6.1
 ============================================================ */

var CACHE_NAME = 'portfolio-v9.2';

/* Static assets to pre-cache on install */
var PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/sitemap.xml',
  '/robots.txt'
];

/* Routes that must NEVER be cached (API calls, real-time data) */
var NO_CACHE_PATTERNS = [
  '/api/lastfm',
  '/api/telegram',
  '/api/telegram-webhook',
  '/api/chat',
  'firestore.googleapis.com',
  'api.github.com',
  'graphql.anilist.co',
  'ws.audioscrobbler.com',
  'googleapis.com/token',
  'youtube.com',
  'google-analytics.com',
  'googletagmanager.com'
];

function shouldSkipCache(url) {
  for (var i = 0; i < NO_CACHE_PATTERNS.length; i++) {
    if (url.indexOf(NO_CACHE_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

/* INSTALL: Pre-cache static assets */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

/* ACTIVATE: Clean up old caches */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

/* FETCH: Stale-While-Revalidate for static, Network-Only for APIs */
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  /* Never cache API calls or real-time data */
  if (shouldSkipCache(url)) return;

  /* For navigation requests (HTML pages), try network first */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match('/index.html');
      })
    );
    return;
  }

  /* For static assets: Stale-While-Revalidate
     Serve from cache immediately (fast), update cache in background */
  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cachedResponse) {
        var fetchPromise = fetch(event.request).then(function(networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(function() {
          /* Network failed — if we have a cached version, that's fine */
          return cachedResponse;
        });

        /* Return cached immediately if available, otherwise wait for network */
        return cachedResponse || fetchPromise;
      });
    })
  );
});
