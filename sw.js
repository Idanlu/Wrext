const CACHE_NAME = 'wrext-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sheets-service.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap'
];

// Install: pre-cache application shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching app shell assets');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up older caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate caching strategy
self.addEventListener('fetch', event => {
  // Only handle GET requests and local/font resources
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // Skip bypass for external API calls like Apps Script (must hit network)
  if (url.hostname.includes('google') && !url.hostname.includes('fonts')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // If response is valid, cache it
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.log('[Service Worker] Fetch failed, serving cached fallback:', err);
        // Fallback is already handled by returning cachedResponse
      });

      return cachedResponse || fetchPromise;
    })
  );
});
