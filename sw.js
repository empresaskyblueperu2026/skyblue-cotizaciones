/* SKY BLUE PWA - Service Worker */
const CACHE = 'skyblue-v5';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function(e){
  /* Let API calls go to network always */
  if(e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(resp){
        if(resp.status===200){
          var c2=resp.clone();
          caches.open(CACHE).then(function(c){c.put(e.request,c2);});
        }
        return resp;
      }).catch(function(){ return cached; });
    })
  );
});
