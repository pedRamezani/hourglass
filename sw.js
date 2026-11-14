// Service worker: makes Hourglass work offline once it has been opened.
//
// Network first, cache as the fallback: online you always get the current files (no stale page
// while developing), offline the last copy. Bump VERSION when the file list changes.

const VERSION = 'hourglass-v1';
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
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(VERSION)
            .then((cache) => cache.addAll(FILES))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

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
