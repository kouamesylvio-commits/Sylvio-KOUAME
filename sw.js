/* Service worker : fonctionnement hors ligne et rappels d'échéance. */
importScripts('js/reminders.js');

const CACHE = 'suivi-objectifs-v4';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/app.js',
  './js/cloud.js',
  './js/reminders.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== Rappels.CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (pour recevoir les mises à jour), cache en secours hors connexion.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});

// ---------------- Rappels d'échéance ----------------

// Demandé par l'application à l'ouverture, au retour au premier plan et après chaque modification.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'check-reminders') {
    event.waitUntil(Rappels.notify(self.registration).catch(() => 0).then((n) => event.source?.postMessage({ type: 'reminders-checked', count: n })));
  }
});

// Vérification en arrière-plan (application installée sur Android, fréquence décidée par le système).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === Rappels.PERIODIC_TAG) event.waitUntil(Rappels.notify(self.registration).catch(() => 0));
});

// Toucher une notification ouvre l'application sur la tâche concernée.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data?.hash || '#/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      await client.focus();
      client.postMessage({ type: 'open', hash });
    } else {
      await self.clients.openWindow(self.registration.scope + hash);
    }
  })());
});
