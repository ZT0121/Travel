const prefix = "travel-hub:" + self.registration.scope + ":";
const cacheName = prefix + "v1-22";
const shell = [
  "./",
  "./index.html",
  "./app.js",
  "./store.js",
  "./fields.js",
  "./style.css",
  "./fonts/SarasaMonoTC-Regular.woff2",
  "./fonts/SarasaMonoTC-SemiBold.woff2",
  "./supabase.js",
  "./manifest.webmanifest",
  "./icon-32.png?v=plane1",
  "./icon-192.png?v=plane1",
  "./icon-512.png?v=plane1",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(cacheName)
      .then((c) => c.addAll(shell))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k.startsWith(prefix) && k !== cacheName) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
const urls = new Set(
  shell.map((p) => new URL(p, self.registration.scope).href),
);
self.addEventListener("fetch", (e) => {
  if (e.request.method === "GET" && urls.has(e.request.url))
    e.respondWith(
      caches
        .open(cacheName)
        .then(async (c) => (await c.match(e.request)) || fetch(e.request)),
    );
});
