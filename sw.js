const CACHE_NAME = 'beatrice-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/firebase.js',
  '/js/main.js',
  '/js/config/config.js',
  '/js/core/websocket-client.js',
  '/js/tools/tool-manager.js',
  '/js/tools/google-search.js',
  '/js/tools/weather-tool.js',
  '/js/tools/gmail-tool.js',
  '/js/tools/calendar-tool.js',
  '/js/tools/drive-tool.js',
  '/js/tools/sheets-tool.js',
  '/js/tools/slides-tool.js',
  '/js/tools/tasks-tool.js',
  '/js/tools/geolocation-tool.js',
  '/assets/logo/logo.png',
  'https://unpkg.com/@phosphor-icons/web'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
