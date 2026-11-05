const CACHE = "camhub-v1";
const SHELL = ["/", "/index.html", "/app.js", "/style.css", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API or go2rtc streams; always hit the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/go2rtc/")) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
