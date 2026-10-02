const VERSION = 'healthconnect-v1';
const SHELL = ['/', '/manifest.webmanifest'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(event.request)) || (await caches.match('/'))));
});
self.addEventListener('sync', (event) => { if (event.tag === 'healthconnect-sync') event.waitUntil(self.clients.matchAll().then((clients) => clients.forEach((client) => client.postMessage('sync')))); });
