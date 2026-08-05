self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Семейный чат', body: 'Новое сообщение' };
  event.waitUntil(self.registration.showNotification(data.title || 'Семейный чат', { body: data.body || 'Новое сообщение', data }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => windows[0] ? windows[0].focus() : clients.openWindow('/')));
});
