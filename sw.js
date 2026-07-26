const CACHE_NAME = "rustle-up-v44";
// index.html/manifest.json used to be cache-first, which caused a real bug:
// after an HTML-structure change (e.g. the bottom-nav rework), a browser
// slow to pick up the new service worker would keep serving the OLD cached
// HTML alongside the NEW network-first app.js. The new JS then reached for
// DOM elements/IDs the stale HTML didn't have (e.g. the bottom tab bar),
// threw partway through its top-level setup code, and left the page with
// no working navigation -- looking exactly like "the bottom nav vanished
// and nothing responds," un-fixable by a normal reload since the stale
// cache kept being served. HTML/JS/CSS/manifest are now all network-first
// together so the shell and code can never skew out of sync while online;
// only the icons (rarely changed, already versioned via ?v=N) stay
// cache-first for guaranteed offline availability.
const NETWORK_FIRST_SUFFIXES = ["/app.js", "/styles.css", "/index.html", "/manifest.json"];
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
  // "/" itself (no filename) always means index.html -- the navigation
  // request a browser makes for the page/app itself, so it must get the
  // same freshness treatment as index.html explicitly.
  const isNetworkFirst = url.pathname.endsWith("/") ||
    NETWORK_FIRST_SUFFIXES.some((path) => url.pathname.endsWith(path));

  if (isNetworkFirst) {
    // Always try the network first so the shell and code can never drift
    // out of sync while online; only fall back to whatever's cached if
    // actually offline.
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

  // Cache-first for what's left (the icons); no API calls happen from
  // this app, so everything still loads with no network at all once
  // installed, offline.
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
