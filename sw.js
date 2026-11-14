/**
 * Service worker: makes Hourglass work offline once it has been opened.
 *
 * @remarks
 * Network first, cache as the fallback: online you always get the current files (no stale page
 * while developing), offline the last copy. Bump VERSION when the file list changes.
 *
 * Registered from `js/main.js`; only runs on HTTPS or localhost.
 * @see docs/interface.md ("Installing and offline").
 * @packageDocumentation
 */

/** Cache name. Bumping it makes `activate` delete every older cache. */
const VERSION = 'hourglass-v3';
/** Files precached on install, relative to the worker's scope: everything the app needs to start offline. */
const FILES = [
    './',
    'index.html',
    'style.css',
    'js/main.js',
    'js/sim.js',
    'js/tilt.js',
    'manifest.webmanifest',
    'icon/favicon.svg',
    'icon/icon.svg',
    'icon/icon-192.png',
    'icon/icon-512.png',
    'icon/apple-touch-icon.png',
    'fonts/monogram.ttf',
    'fonts/recursive-latin.woff2',
];

/** Install: precache {@link FILES}, then take over without waiting for old tabs to close. */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(VERSION)
            .then((cache) => cache.addAll(FILES))
            .then(() => self.skipWaiting()),
    );
});

/** Activate: drop caches from other versions and start controlling open pages right away. */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

/**
 * Fetch: same-origin GETs go to the network and successful responses refresh the cache; when the
 * network fails, serve the cached copy (ignoring the query string), else the cached start page.
 * Other requests fall through to the browser.
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(VERSION).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
    );
});
