/* Web Push service worker (42.B, №66). Displays push notifications and handles the click. */
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
      // The badge is rendered in monochrome by Android: white silhouette on a transparent background.
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
