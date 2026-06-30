/* VolleyStat Service Worker — pairs with APP_VERSION 0.1.167 */
var CACHE = 'volleystat-v53';
var ASSETS = [
  './',
  './login.html',
  './share.html',
  './styles.css',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  var url = e.request.url;
  if (url.indexOf(self.location.origin) !== 0) return;
  if (e.request.method !== 'GET') return;
  if (url.indexOf('firestore') >= 0 || url.indexOf('firebase') >= 0 || url.indexOf('googleapis') >= 0) return;
  // Never cache these — always fetch fresh
  if (url.indexOf('app.js') >= 0) return;
  if (url.indexOf('firebase-sync.js') >= 0) return;
  if (url.indexOf('sw.js') >= 0) return;
  if (url.indexOf('index.html') >= 0 || url.endsWith('/')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(res){
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        var clone = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        return res;
      }).catch(function(){ return cached; });
    })
  );
});
