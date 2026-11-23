/* Cache only the application shell; never cache authenticated /api requests. */
const CACHE="carhistory-shell-v9";
const ASSETS=[
 "/","/index.html","/ui.css","/features.js","/ai-mechanic.js","/account.js","/manifest.webmanifest",
 "/app-icon-192.png","/app-icon-512.png","/icon.png","/apple-touch-icon.png"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(names=>Promise.all(
    names.filter(name=>name.startsWith("carhistory-shell-")&&name!==CACHE).map(name=>caches.delete(name))
  )).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put("/index.html",response.clone())));
      return response;
    }).catch(()=>caches.match("/index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
