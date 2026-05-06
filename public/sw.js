const APP_CACHE = 'peripheral-app-shell-v1';
const DYNAMIC_CACHE = 'peripheral-dynamic-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/socket.io/socket.io.js',
  '/manifest.json',
  '/content/home.html',
  '/content/catalog.html',
  '/content/about.html',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/icon-48.png',
  '/icons/icon-128.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== APP_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== location.origin || event.request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/content/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/content/home.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      }))
  );
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'Peripheral Planner',
    body: 'Новое уведомление',
    reminderId: null
  };

  if (event.data) {
    data = event.data.json();
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-48.png',
    data: {
      reminderId: data.reminderId
    }
  };

  if (data.reminderId) {
    options.actions = [
      { action: 'snooze', title: 'Отложить на 5 минут' }
    ];
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  const { notification, action } = event;
  const reminderId = notification.data?.reminderId;
  notification.close();

  if (action === 'snooze' && reminderId) {
    event.waitUntil(fetch(`/snooze?reminderId=${reminderId}`, { method: 'POST' }));
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow('/');
      }

      return null;
    })
  );
});
