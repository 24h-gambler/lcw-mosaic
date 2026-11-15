/* Guardian notices service worker for /family (docs/09 §12). Shows the push the server sends (title, one line,
   link to /family) and opens /family on tap. No caching, no fetch handling: it exists only for Web Push. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (_) {
    d = {};
  }
  const title = typeof d.title === 'string' && d.title ? d.title : '우리 가족 알림';
  const url = typeof d.url === 'string' && d.url.startsWith('/family') ? d.url : '/family';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof d.body === 'string' ? d.body : '',
      tag: typeof d.tag === 'string' ? d.tag : 'family',
      icon: '/icons/family-192.png',
      lang: 'ko',
      data: { url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/family';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).pathname.startsWith('/family') && 'focus' in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
