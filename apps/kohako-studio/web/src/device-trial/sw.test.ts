// BOXP-752: Service Worker の通知タップ（trial-spec.md 決まり 9）。実際の sw.js を偽の self・clients・fetch の上で動かす。
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const source = readFileSync(new URL('../../public/kohako/sw.js', import.meta.url), 'utf8')
type Handler = (event: Record<string, unknown>) => void
function boot(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const handlers: Record<string, Handler> = {},
    opened: string[] = [],
    fetched: { url: string; init: RequestInit }[] = [],
    shown: { title: string; options: { data: unknown } }[] = []
  let skipped = false
  const self = {
    skipWaiting: async () => {
      skipped = true
    },
    location: { origin: 'https://kohako-home.example' },
    addEventListener: (name: string, fn: Handler) => {
      handlers[name] = fn
    },
    registration: {
      showNotification: async (title: string, options: { data: unknown }) => {
        shown.push({ title, options })
      },
    },
    clients: { claim: async () => {} },
  }
  const clients = {
    matchAll: async () => [],
    openWindow: async (url: string) => {
      opened.push(url)
      return null
    },
  }
  const fetchFn = async (url: string, init: RequestInit) => {
    fetched.push({ url, init })
    return respond(url, init)
  }
  new Function('self', 'clients', 'fetch', 'caches', source)(self, clients, fetchFn, {})
  const fire = async (name: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve()
    handlers[name]({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) })
    await wait
  }
  const tap = (data: unknown) => fire('notificationclick', { notification: { data, close() {} } })
  return { fire, tap, opened, fetched, shown, skipped: () => skipped }
}
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, type: 'basic', json: async () => body }) as unknown as Response
const ok = (body: unknown) => reply(200, body)
const MAP = 'https://www.google.com/maps/search/?api=1&query=%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%BA%81'
const PAGE = 'https://kohako-home.example/kohako/device-trial.html?request=req-0001-0000&from=notification'

it('試験の通知を受けたら、依頼番号を通知に持たせる', async () => {
  const sw = boot(() => ok({}))
  await sw.fire('push', {
    data: {
      json: () => ({
        title: 't',
        body: 'b',
        tag: 'device-x',
        url: '/kohako/device-trial.html?request=req-0001-0000',
        kind: 'device-request',
        requestId: 'req-0001-0000',
      }),
    },
  })
  expect(sw.shown[0].options.data).toEqual({
    url: '/kohako/device-trial.html?request=req-0001-0000',
    kind: 'device-request',
    requestId: 'req-0001-0000',
  })
})

it('タップすると BFF に開封を問い合わせ、返った地図の URL を開く', async () => {
  const sw = boot(() => ok({ url: MAP }))
  await sw.tap({ kind: 'device-request', requestId: 'req-0001-0000' })
  expect(sw.fetched).toHaveLength(1)
  expect(sw.fetched[0].url).toBe('/kohako/api/v1/device-trial/requests/req-0001-0000/open')
  expect(sw.fetched[0].init.method).toBe('POST')
  expect(JSON.parse(String(sw.fetched[0].init.body))).toEqual({ via: 'notification' })
  expect(sw.opened).toEqual([MAP])
})

it('期限切れ・開封済み・取消は地図を開かず、家の試験ページで理由を出す', async () => {
  for (const [status, error] of [
    [410, 'expired'],
    [409, 'already_opened'],
    [409, 'cancelled'],
  ] as const) {
    const sw = boot(() => reply(status, { error }))
    await sw.tap({ kind: 'device-request', requestId: 'req-0001-0000' })
    expect(sw.opened).toEqual([PAGE])
  }
})

it('ログイン切れ（リダイレクト）・通信失敗・地図以外の URL は試験ページを開く', async () => {
  const cases: (() => Promise<Response> | Response)[] = [
    () => ({ ok: false, status: 0, type: 'opaqueredirect' }) as unknown as Response,
    () => Promise.reject(new TypeError('offline')),
    () => ok({ url: 'https://evil.example/maps/search/' }),
    () => ok({ url: 'intent://maps#Intent;end' }),
  ]
  for (const respond of cases) {
    const sw = boot(respond)
    await sw.tap({ kind: 'device-request', requestId: 'req-0001-0000' })
    expect(sw.opened).toEqual([PAGE])
  }
})

it('形の合わない依頼番号では何もしない（問い合わせもしない）', async () => {
  const sw = boot(() => ok({ url: MAP }))
  await sw.tap({ kind: 'device-request', requestId: '../../x' })
  expect(sw.fetched).toHaveLength(0)
  expect(sw.opened).toHaveLength(0)
})

it('既存の家の通知のタップは今までどおり家のページを開く', async () => {
  const sw = boot(() => ok({}))
  await sw.tap({ url: '/kohako/home.html?notification=event-123456' })
  expect(sw.fetched).toHaveLength(0)
  expect(sw.opened).toEqual(['https://kohako-home.example/kohako/home.html?notification=event-123456'])
})

// trial-spec.md 決まり 13: 新しい版は待たずに切り替わり、版を問い合わせると答える。
it('導入時に待たずに切り替わる（skipWaiting）', async () => {
  const sw = boot(() => ok({}))
  await sw.fire('install', {})
  expect(sw.skipped()).toBe(true)
})
it('版を問い合わせると device-trial-v1 を返す', async () => {
  const sw = boot(() => ok({}))
  const replies: unknown[] = []
  await sw.fire('message', { data: { type: 'sw-version' }, ports: [{ postMessage: (m: unknown) => replies.push(m) }] })
  expect(replies).toEqual([{ type: 'sw-version', version: 'device-trial-v1' }])
})
