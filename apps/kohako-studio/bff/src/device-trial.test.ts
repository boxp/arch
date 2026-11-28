// BOXP-752: 家から端末へ 1 タップで地図を開く試験。期待値は Obsidian の
// Projects/kohako-device-delegation/trial-spec.md（決まり・具体例）と、Lean のモデル
// contract/device-trial-model/（cases.txt）から取る。実装を読んで写さない。
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createDeviceTrial, type DevicePush } from './device-trial.js'

const T0 = Date.parse('2026-11-28T10:00:00Z')
function memory() {
  const m: { value: unknown; writes: number } = { value: undefined, writes: 0 }
  return {
    m,
    store: {
      load: async () => m.value,
      save: async (v: unknown) => {
        m.value = JSON.parse(JSON.stringify(v))
        m.writes++
      },
    },
  }
}
function setup(start = T0) {
  const clock = { now: start },
    { m, store } = memory(),
    sent: { msg: DevicePush; ttl: number }[] = []
  let n = 0
  const make = () =>
    createDeviceTrial({
      store,
      now: () => clock.now,
      id: () => `req-${String(n++).padStart(4, '0')}-0000`,
      send: async (msg, ttl) => {
        sent.push({ msg, ttl })
        return { sent: 1, errors: 0 }
      },
    })
  return { clock, m, sent, make }
}

it('例 1: 待ちがない時に東京都庁で送ると、待ちになり 2 分の期限で通知を送る（本文に URL なし）', async () => {
  const s = setup(),
    t = await s.make()
  const r = await t.create({ place: 'tocho' })
  expect(r.status).toBe(201)
  expect(s.sent).toHaveLength(1)
  expect(s.sent[0].ttl).toBe(120)
  expect(s.sent[0].msg.body).toContain('東京都庁')
  expect(s.sent[0].msg.body).toContain('2分')
  expect(`${s.sent[0].msg.title} ${s.sent[0].msg.body}`).not.toMatch(/https?:|google/i)
  expect(s.sent[0].msg.url).toMatch(/^\/kohako\/device-trial\.html\?request=/)
  const v = await t.view()
  expect(v.stopped).toBe(false)
  expect(v.requests).toHaveLength(1)
  expect(v.requests[0]).toMatchObject({ place: 'tocho', name: '東京都庁', state: 'pending' })
})

it('例 2: 待ちがある間はもう 1 件作れない（409 pending_exists、通知なし）', async () => {
  const s = setup(),
    t = await s.make()
  await t.create({ place: 'tocho' })
  expect(await t.create({ place: 'tokyo-station' })).toEqual({ status: 409, error: 'pending_exists' })
  expect(s.sent).toHaveLength(1)
})

it('例 3・4: 30 秒後に開くと地図の URL が返り、2 回目は 409 already_opened', async () => {
  const s = setup(),
    t = await s.make()
  const r = await t.create({ place: 'tocho' })
  if (r.status !== 201) throw Error('create failed')
  s.clock.now = T0 + 30_000
  expect(await t.open(r.request.id, 'notification')).toEqual({
    status: 200,
    url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('東京都庁')}`,
  })
  expect(await t.open(r.request.id, 'notification')).toEqual({ status: 409, error: 'already_opened' })
  const v = await t.view()
  expect(v.requests[0]).toMatchObject({ state: 'opened', via: 'notification', seconds: 30 })
})

it('例 5: 2 分 1 秒後に開くと 410 expired で、URL は返らない', async () => {
  const s = setup(),
    t = await s.make()
  const r = await t.create({ place: 'kahaku' })
  if (r.status !== 201) throw Error('create failed')
  s.clock.now = T0 + 121_000
  expect(await t.open(r.request.id, 'notification')).toEqual({ status: 410, error: 'expired' })
  expect((await t.view()).requests[0].state).toBe('expired')
})

it('期限ちょうど（2 分）で開けなくなる', async () => {
  const s = setup(),
    t = await s.make()
  const r = await t.create({ place: 'ndl' })
  if (r.status !== 201) throw Error('create failed')
  s.clock.now = T0 + 119_999
  expect((await t.view()).requests[0].state).toBe('pending')
  s.clock.now = T0 + 120_000
  expect(await t.open(r.request.id, 'page')).toEqual({ status: 410, error: 'expired' })
})

it('例 6・7・8: 停止で待ちは取消、停止中は作れない、解除しても取消は戻らない', async () => {
  const s = setup(),
    t = await s.make()
  const r = await t.create({ place: 'tocho' })
  if (r.status !== 201) throw Error('create failed')
  await t.setStopped(true)
  expect(await t.open(r.request.id, 'notification')).toEqual({ status: 409, error: 'cancelled' })
  expect(await t.create({ place: 'tocho' })).toEqual({ status: 409, error: 'stopped' })
  expect(s.sent).toHaveLength(1)
  await t.setStopped(false)
  expect(await t.open(r.request.id, 'page')).toEqual({ status: 409, error: 'cancelled' })
  expect((await t.view()).stopped).toBe(false)
})

it('停止は BFF の再起動をまたいで残る', async () => {
  const s = setup()
  await (await s.make()).setStopped(true)
  const again = await s.make()
  expect((await again.view()).stopped).toBe(true)
  expect(await again.create({ place: 'tocho' })).toEqual({ status: 409, error: 'stopped' })
})

it('例 9: 一覧にない行き先・URL・余計な項目は 400 invalid', async () => {
  const s = setup(),
    t = await s.make()
  for (const x of [
    { place: 'https://example.com' },
    { place: 'example' },
    { place: 'tocho', url: 'https://example.com' },
    { place: 'toString' },
    { place: '__proto__' },
    null,
    'tocho',
    {},
  ])
    expect(await t.create(x)).toEqual({ status: 400, error: 'invalid' })
  expect(s.sent).toHaveLength(0)
})

it('例 10: 直近 1 時間に 10 件作った後の 11 件目は 429 too_many、1 時間たてばまた作れる', async () => {
  const s = setup(),
    t = await s.make()
  for (let i = 0; i < 10; i++) {
    s.clock.now = T0 + i * 1000
    const r = await t.create({ place: 'tocho' })
    if (r.status !== 201) throw Error(`create ${i} failed`)
    await t.cancel(r.request.id)
  }
  s.clock.now = T0 + 20_000
  expect(await t.create({ place: 'tocho' })).toEqual({ status: 429, error: 'too_many' })
  expect(s.sent).toHaveLength(10)
  s.clock.now = T0 + 3600_000
  expect((await t.create({ place: 'tocho' })).status).toBe(201)
})

it('ない依頼は 404 not_found', async () => {
  const t = await setup().make()
  expect(await t.open('req-9999-0000', 'page')).toEqual({ status: 404, error: 'not_found' })
  expect(await t.cancel('req-9999-0000')).toEqual({ status: 404, error: 'not_found' })
})

it('決まり 10: 履歴は直近 50 件まで', async () => {
  const s = setup(),
    t = await s.make()
  for (let i = 0; i < 60; i++) {
    s.clock.now = T0 + i * 400_000
    const r = await t.create({ place: 'tocho' })
    if (r.status !== 201) throw Error(`create ${i} failed`)
  }
  const v = await t.view()
  expect(v.requests).toHaveLength(50)
  expect(v.requests.every((r) => r.state === 'expired' || r.state === 'pending')).toBe(true)
})

it('通知を送れなかった時も依頼は待ちのまま残り、送れなかったことが分かる', async () => {
  const { store } = memory()
  const t = await createDeviceTrial({
    store,
    now: () => T0,
    send: async () => ({ sent: 0, errors: 0, skipped: 'no-subscriptions' as const }),
  })
  const r = await t.create({ place: 'tocho' })
  expect(r.status).toBe(201)
  if (r.status !== 201) return
  expect(r.request.push).toEqual({ sent: 0, errors: 0, skipped: 'no-subscriptions' })
  expect((await t.view()).requests[0].state).toBe('pending')
})

/**
 * モデルとの照合: Lean のモデルが出した操作の並び（cases.txt）を実装に流し、各操作の結果と、
 * 並びの後の停止・各依頼の状態がモデルと同じであることを確かめる。
 * C=作る O0..O2=依頼 0..2 を開く X0..X2=依頼 0..2 をやめる S=停止 U=解除 T=期限が過ぎる R=再起動
 */
it('モデルの並び（依頼 0〜2、長さ 4 まで）と実装が一致する', async () => {
  const lines = readFileSync(new URL('../contract/device-trial-model/cases.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
  expect(lines.length).toBeGreaterThan(16000)
  const name: Record<string, string> = {
    stopped: 'stopped',
    pending_exists: 'exists',
    already_opened: 'opened',
    expired: 'expired',
    cancelled: 'cancelled',
    not_found: 'none',
  }
  const letter: Record<string, string> = { pending: 'P', opened: 'O', expired: 'E', cancelled: 'X' }
  for (const line of lines) {
    const [seq] = line.split(' ')
    const s = setup()
    let t = await s.make()
    const ids: string[] = []
    const got: string[] = []
    for (const op of seq.split('.')) {
      const target = (i: string) => ids[Number(i)] ?? `missing-${i}-0000`
      let r: { status: number; error?: string }
      if (op === 'C') {
        r = await t.create({ place: 'tocho' })
        if ('request' in r && r.status === 201) ids.push((r as { request: { id: string } }).request.id)
      } else if (op[0] === 'O') r = await t.open(target(op.slice(1)), 'page')
      else if (op[0] === 'X') r = await t.cancel(target(op.slice(1)))
      else if (op === 'S') r = await t.setStopped(true)
      else if (op === 'U') r = await t.setStopped(false)
      else if (op === 'T') {
        s.clock.now += 121_000
        r = { status: 200 }
      } else {
        t = await s.make()
        r = { status: 200 }
      }
      got.push(r.error ? name[r.error] : 'ok')
    }
    const v = await t.view()
    const actual = `${seq} ${got.join('.')} ${v.stopped ? 1 : 0} ${v.requests.map((q) => letter[q.state]).join('') || '-'}`
    expect(actual).toBe(line)
  }
}, 120_000)

it('HTTP: 本人だけが作る・開く・止める。検証用・通知用・眼鏡は 403、未設定は 503（Push は静かな時間帯でも送り TTL は 120 秒）', async () => {
  const { createServer } = await import('node:http'),
    { mkdtemp, rm } = await import('node:fs/promises'),
    { tmpdir } = await import('node:os'),
    { join } = await import('node:path'),
    { createPush } = await import('./push.js'),
    { createApp } = await import('./app.js')
  const dir = await mkdtemp(join(tmpdir(), 'device-trial-')),
    calls: { payload: string; ttl: number }[] = []
  const push = await createPush(dir, {
    subject: 'https://example.com',
    quietHours: '0-23',
    sender: (async (_s: unknown, payload: string, o: { TTL: number }) => {
      calls.push({ payload, ttl: o.TTL })
      return {}
    }) as unknown as NonNullable<Parameters<typeof createPush>[1]['sender']>,
  })
  const keys = { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') }
  await push.add({ endpoint: 'https://example.com/fold', keys })
  await push.add({ endpoint: 'https://example.com/pc', keys })
  const { store } = memory()
  const deviceTrial = await createDeviceTrial({ store, now: Date.now, send: push.sendDevice })
  let who: 'owner' | 'verifier' | 'notifier' | 'g2' = 'owner',
    enabled = true
  const app = createApp({ authenticate: async () => who, g2Mode: 'write', push })
  const appOn = createApp({ authenticate: async () => who, g2Mode: 'write', push, deviceTrial })
  const server = createServer((req, res) => void (enabled ? appOn : app)(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/device-trial`
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  try {
    for (const p of ['verifier', 'notifier', 'g2'] as const) {
      who = p
      expect((await fetch(base)).status).toBe(403)
      expect((await post('/requests', { place: 'tocho' })).status).toBe(403)
      expect((await post('/stop', { stopped: true })).status).toBe(403)
    }
    who = 'owner'
    enabled = false
    expect((await fetch(base)).status).toBe(503)
    enabled = true
    const created = await post('/requests', { place: 'tocho' })
    expect(created.status).toBe(201)
    const req = (await created.json()) as { id: string; push: unknown }
    expect(req.push).toEqual({ sent: 2, errors: 0 })
    expect(calls).toHaveLength(2)
    expect(calls[0].ttl).toBe(120)
    expect(JSON.parse(calls[0].payload)).toMatchObject({ kind: 'device-request', requestId: req.id })
    expect(calls[0].payload).not.toContain('google')
    expect((await post(`/requests/${req.id}/open`, { via: 'x' })).status).toBe(400)
    const opened = await post(`/requests/${req.id}/open`, { via: 'notification' })
    expect(opened.status).toBe(200)
    expect(((await opened.json()) as { url: string }).url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//)
    expect(await (await post(`/requests/${req.id}/open`, { via: 'page' })).json()).toEqual({ error: 'already_opened' })
    expect((await post('/stop', { stopped: 'yes' })).status).toBe(400)
    expect((await post('/stop', { stopped: true })).status).toBe(200)
    expect((await post('/requests', { place: 'tocho' })).status).toBe(409)
    expect(calls).toHaveLength(2)
    const view = (await (await fetch(base)).json()) as { stopped: boolean; requests: { state: string }[] }
    expect(view.stopped).toBe(true)
    expect(view.requests.map((r) => r.state)).toEqual(['opened'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    await rm(dir, { recursive: true, force: true })
  }
})

it('送信が応答しない間も、停止と取消は待たずに効く（送信は操作の順番を占有しない）', async () => {
  const { store } = memory()
  let n = 0
  const t = await createDeviceTrial({
    store,
    now: () => T0,
    id: () => `req-${String(n++).padStart(4, '0')}-0000`,
    send: () => new Promise(() => {}),
  })
  void t.create({ place: 'tocho' })
  const within = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 200))])
  const v = await within(t.view())
  if (v === 'timeout') throw Error('view blocked by send')
  expect(v.requests[0].state).toBe('pending')
  expect(await within(t.cancel(v.requests[0].id))).toEqual({ status: 200 })
  expect(await within(t.setStopped(true))).toEqual({ status: 200 })
})

it('送信が期限内に終わらなければ、失敗として記録して 201 を返す', async () => {
  const { store } = memory()
  const t = await createDeviceTrial({
    store,
    now: () => T0,
    id: () => 'req-9999-0000',
    send: () => new Promise(() => {}),
    sendTimeoutMs: 50,
  })
  const r = await t.create({ place: 'tocho' })
  expect(r.status).toBe(201)
  if (r.status !== 201) return
  expect(r.request.push).toEqual({ sent: 0, errors: 1, skipped: 'error' })
  expect((await t.view()).requests[0].push).toEqual({
    sent: 0,
    errors: 1,
    skipped: 'error',
  })
})
