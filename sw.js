/* eslint-disable no-restricted-globals */
const NOTIF_ICON = '/icons/icon-192.png';
const CACHE_NAME = 'ekawent-shell-v11';

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCD98W5uFlavAh9ogTHinZoyWS3pE5JF0Y',
  authDomain: 'app-school-c6e40.firebaseapp.com',
  projectId: 'app-school-c6e40',
  messagingSenderId: '958617733308',
  appId: '1:958617733308:web:4b3e3847466080be0628b9',
});

firebase.messaging().onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'Ekawent';
  const body = payload.notification?.body || payload.data?.body || '';
  const tag = payload.data?.tag || 'act-push';
  return self.registration.showNotification(title, {
    body,
    tag: String(tag),
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    data: { url: '/?source=notif#actividades', tag: String(tag) },
  });
});

const SHELL_ASSETS = [
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/book/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.pathname.match(/\.(js|css|html|svg|webmanifest)$/)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/?source=notif#actividades';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_ACTIVITIES' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
