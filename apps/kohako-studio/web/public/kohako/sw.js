// Only the self-contained fallback is stored. Never cache authenticated pages or API responses.
const CACHE = 'kohako-offline-v1'
const OFFLINE = '/kohako/kohako/offline-v1.html'
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(OFFLINE, { redirect: 'error', cache: 'no-store' })
    if (!response.ok || response.redirected || response.type !== 'basic' || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Offline page unavailable')
    const cache = await caches.open(CACHE)
    await cache.put(OFFLINE, response)
  })())
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('kohako-offline-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname !== '/kohako/home.html') return
  event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => (await caches.open(CACHE)).match(OFFLINE)))
})
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
