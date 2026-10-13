/* Cache static app assets only. NEVER cache authentication, API or personalized HTML. */
const CACHE='jump-assets-v1';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async()=>{
 const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch', event=>{
 const u=new URL(event.request.url);
 if(u.origin!==self.location.origin||event.request.method!=='GET'||u.pathname.startsWith('/api/')||event.request.mode==='navigate')return;
 const staticAsset=u.pathname.startsWith('/assets/')||u.pathname.startsWith('/icons/')||u.pathname==='/manifest.webmanifest';
 if(!staticAsset)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);const hit=await cache.match(event.request);if(hit)return hit;
  const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;
 })());
});
