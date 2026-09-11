/* Offline shell for TT Manager. The cache is named after the app version, so
   bumping version.js is what retires the previous cache. */
importScripts("./version.js");

const CACHE = `ttmanager-${self.APP_VERSION}`;

const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "version.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/app.js",
  "js/model.js",
  "js/qr.js",
  "js/store.js",
  "js/util.js",
  "js/components.js",
  "js/views/home.js",
  "js/views/setup.js",
  "js/views/matches.js",
  "js/views/standings.js",
  "js/views/bracket.js",
  "js/views/print.js",
  "js/views/scorecards.js",
  "js/views/scan.js",
  "js/scan/card.js",
  "js/scan/digits.js",
  "js/scan/digit-model.js",
  "js/scan/opencv.js",
  "js/scan/read.js",
  "js/scan/reconcile.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((path) => new Request(path, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/*
 * Navigations fall back to the cached shell; assets are cache-first with a
 * background refresh so a new deploy is picked up on the next visit.
 *
 * vendor/opencv.js is not in ASSETS on purpose - it is ten megabytes and only
 * the scorecard reader needs it - but it is cached here like anything else the
 * moment it is first fetched, which is what makes scanning work offline
 * afterwards.
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("index.html", copy));
          return response;
        })
        .catch(() => caches.match("index.html").then((cached) => cached || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
