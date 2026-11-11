self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url }, renotify: false }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(event.notification.data.url, self.location.origin)
  if (url.origin !== self.location.origin || url.pathname !== '/kohako/home.html') return
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const client = list.find(c => new URL(c.url).pathname === '/kohako/home.html')
    if (client) { await client.focus(); client.postMessage({ type: 'open-notification', eventId: url.searchParams.get('notification') }) }
    else await clients.openWindow(url.href)
  }))
})
