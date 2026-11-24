/* Cache only the application shell; never cache authenticated /api requests. */
const CACHE="carhistory-shell-v19";
const ASSETS=[
 "/","/index.html","/ui.css","/features.js","/documents.js","/ai-mechanic.js","/account.js","/manifest.webmanifest",
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
  // A stale cache-first account.js paired with a freshly fetched index.html
  // can break the login button. Prefer the network for app scripts/styles,
  // while retaining cached copies for true offline operation.
  if(["/account.js","/ui.css","/features.js","/documents.js","/ai-mechanic.js"].includes(url.pathname)){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok){
        const cachedCopy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,cachedCopy)));
      }
      return response;
    }).catch(()=>caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
