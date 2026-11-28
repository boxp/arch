// Only the self-contained fallback is stored. Never cache authenticated pages or API responses.
const CACHE = 'kohako-offline-v2'
const OFFLINE = '/kohako/kohako/offline-v1.html'
// オフライン画面の保存に失敗しても（Access 期限切れ等）SW の導入は止めない。Push を巻き込まないため。
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(OFFLINE, { redirect: 'error', cache: 'no-store' })
      if (!response.ok || response.redirected || response.type !== 'basic' || !response.headers.get('content-type')?.includes('text/html')) return
      await (await caches.open(CACHE)).put(OFFLINE, response)
    } catch {}
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
  // Pass the navigation request through unchanged so Access redirects (manual/opaqueredirect) keep working.
  event.respondWith(fetch(request).catch(async () => (await (await caches.open(CACHE)).match(OFFLINE)) ?? Response.error()))
})
self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  const extra = data.kind === 'device-request' ? { kind: data.kind, requestId: data.requestId } : {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url, ...extra }, renotify: false }))
})
// BOXP-752: 端末への試験依頼。開くのは BFF が「開いてよい」と返した Google マップの検索 URL だけ。
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/
function isMapUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && u.hostname === 'www.google.com' && u.pathname === '/maps/search/' && !u.username && !u.password && !u.port
  } catch {
    return false
  }
}
async function openDeviceRequest(id) {
  const page = new URL(`/kohako/device-trial.html?request=${encodeURIComponent(id)}&from=notification`, self.location.origin).href
  let target = null
  try {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 4000)
    try {
      const r = await fetch(`/kohako/api/v1/device-trial/requests/${encodeURIComponent(id)}/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ via: 'notification' }),
        credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal: abort.signal,
      })
      if (r.ok && r.type === 'basic') {
        const d = await r.json()
        if (isMapUrl(d?.url)) target = d.url
      }
    } finally { clearTimeout(timer) }
  } catch {}
  // 開けなかった時（期限切れ・停止・ログイン切れ・通信失敗）は家の試験ページで理由を出す。
  await clients.openWindow(target ?? page)
}
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data ?? {}
  if (data.kind === 'device-request') {
    if (DEVICE_ID.test(data.requestId ?? '')) event.waitUntil(openDeviceRequest(data.requestId))
    return
  }
  const url = new URL(event.notification.data.url, self.location.origin)
  if (url.origin !== self.location.origin || url.pathname !== '/kohako/home.html') return
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const client = list.find(c => new URL(c.url).pathname === '/kohako/home.html')
    if (client) { await client.focus(); client.postMessage({ type: 'open-notification', eventId: url.searchParams.get('notification') }) }
    else await clients.openWindow(url.href)
  }))
})
