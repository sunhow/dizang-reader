/* Offline cache is isolated by repository path, including on shared GitHub Pages origins. */
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = 'dizang:' + SCOPE + ':';
const VERSION = '5ae38309cf6331';
const CACHE = PREFIX + VERSION;
const ASSETS = ['./','./index.html','./style.css','./dizang.css','./config.js','./app.js','./book.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./favicon-32.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(SCOPE))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match('./index.html'))));
    return;
  }
  // Only serve assets from this site's own cache. User backups are never cached.
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const hit=await cache.match(request);return hit||fetch(request);
  }));
});
