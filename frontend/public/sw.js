/* Service worker Web Push (42.B — №66). Affiche les notifications push et gère le clic. */
/* global self, clients */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'ReView';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/logo_192.png',
      // Le badge est rendu en monochrome par Android : silhouette blanche sur fond transparent.
      badge: '/logo_badge.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) {
          win.navigate?.(target);
          return win.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
