const CACHE_NAME = "rustle-up-v34";
// Code files use network-first below so edits show up immediately without
// bumping this version; it still matters for the app-shell files (HTML,
// manifest, icons) and as the offline fallback for the code files too.
const NETWORK_FIRST = ["/app.js", "/styles.css"];
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png?v=2",
  "./icons/icon-192-maskable.png?v=2",
  "./icons/icon-512.png?v=2",
  "./icons/icon-512-maskable.png?v=2"
];

// On install, cache the app shell so it works fully offline.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Clean up old caches when a new version activates.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isNetworkFirst = NETWORK_FIRST.some((path) => url.pathname.endsWith(path));

  if (isNetworkFirst) {
    // Always try the network first so code edits are visible on next
    // reload; only fall back to whatever's cached if actually offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (app shell, icons); no API calls
  // happen from this app, so this guarantees the page loads with no
  // network at all once installed.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
