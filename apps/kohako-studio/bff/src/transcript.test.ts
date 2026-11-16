// BOXP-565: 端末間で共有する会話履歴（conversation/transcript）。
import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { createConversation } from './conversation.js'
import type { createHermes } from './hermes.js'

type Result = { status: 'done'; text: string } | { status: 'failed'; error: string }
function fake() {
  const settle: ((r: Result) => void)[] = []
  const sessions: string[] = []
  const run = vi.fn((_id: string, _input: unknown, session: string) => {
    sessions.push(session)
    return new Promise<Result>((r) => settle.push(r))
  })
  return {
    settle,
    sessions,
    run,
    hermes: {
      run,
      watch: vi.fn(),
      stop: vi.fn(async () => 'ok'),
      approve: vi.fn(async () => 'ok'),
    } as unknown as ReturnType<typeof createHermes>,
  }
}
const text = (requestId: string, body: string) => ({ requestId, kind: 'text' as const, text: body, expiresAt: 1e15 })

it('発言と返答を古い順に返し、進行中の依頼を active で示す', async () => {
  let t = 1000
  const f = fake()
  const conv = createConversation({ now: () => t, hermes: f.hermes, prefix: 'test' })
  const rev0 = conv.rev
  conv.submit(text('request-1', 'こんにちは'), '')
  expect(conv.rev).not.toBe(rev0)
  expect(conv.transcript()).toMatchObject({
    items: [{ requestId: 'request-1', at: 1000, current: true, text: 'こんにちは', status: 'pending' }],
    active: { requestId: 'request-1', kind: 'text' },
  })
  // 進行中は 2 件目を受け付けない（端末が違っても同じ会話なので同時実行しない）。
  expect(conv.submit(text('request-2', '別端末から'), '')).toEqual({ error: 'busy' })
  expect(conv.transcript().items).toHaveLength(1)
  const pendingRev = conv.transcript().rev
  await vi.waitFor(() => expect(f.settle).toHaveLength(1))
  f.settle[0]({ status: 'done', text: 'はい、ご主人さま。' })
  await vi.waitFor(() => expect(conv.get('request-1')?.status).toBe('done'))
  const done = conv.transcript()
  expect(done.rev).not.toBe(pendingRev)
  expect(done.active).toBeNull()
  expect(done.items[0]).toMatchObject({ status: 'done', reply: { text: 'はい、ご主人さま。' }, current: true })
  t = 2000
  conv.submit(text('request-2', '続き'), '')
  expect(conv.transcript().items.map((x) => x.requestId)).toEqual(['request-1', 'request-2'])
  // 同じ Hermes session に入る（続きの文脈を共有する）。
  await vi.waitFor(() => expect(f.sessions).toHaveLength(2))
  expect(f.sessions[0]).toBe(f.sessions[1])
})

it('なでると通知返信は履歴に載せず、通知返信の進行中は本文なしの active だけ示す', async () => {
  const f = fake()
  const conv = createConversation({ now: () => 1000, hermes: f.hermes, prefix: 'test' })
  conv.submit(
    { requestId: 'touch-001', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 1 }, expiresAt: 1e15 },
    '',
  )
  expect(conv.transcript()).toMatchObject({ items: [], active: null })
  await vi.waitFor(() => expect(f.settle).toHaveLength(1))
  f.settle[0]({ status: 'done', text: 'えへへ' })
  await vi.waitFor(() => expect(conv.get('touch-001')?.status).toBe('done'))
  conv.submit(text('reply-001', '通知の本文つき返信'), '', undefined, { sessionId: 's', idempotencyKey: 'k' })
  const shown = conv.transcript()
  expect(shown.items).toEqual([])
  expect(shown.active).toEqual({ requestId: 'reply-001', kind: 'reply' })
  expect(JSON.stringify(shown)).not.toContain('通知の本文つき返信')
  expect(conv.get('reply-001')?.text).toBeUndefined()
})

it('失敗・停止した依頼も状態つきで返し、最新 50 件に絞る', async () => {
  let t = 1000
  const f = fake()
  const conv = createConversation({ now: () => t, hermes: f.hermes, prefix: 'test' })
  for (let i = 0; i < 52; i++) {
    t += 10
    conv.submit(text(`request-${String(i).padStart(3, '0')}`, `発言${i}`), '')
    await vi.waitFor(() => expect(f.settle).toHaveLength(i + 1))
    f.settle[i](i === 51 ? { status: 'failed', error: 'boom' } : { status: 'done', text: `返答${i}` })
    await vi.waitFor(() => expect(conv.transcript().active).toBeNull())
  }
  const items = conv.transcript().items
  expect(items).toHaveLength(50)
  expect(items[0].requestId).toBe('request-002')
  expect(items.at(-1)).toMatchObject({ requestId: 'request-051', status: 'failed', error: 'boom' })
  expect(items.at(-1)?.reply).toBeUndefined()
})

it('6 時間空くと履歴は残るが current ではなくなり、次の発言から新しい会話になる', async () => {
  let t = 1000
  const f = fake()
  const conv = createConversation({ now: () => t, hermes: f.hermes, prefix: 'test' })
  conv.submit(text('request-1', '前の会話'), '')
  await vi.waitFor(() => expect(f.settle).toHaveLength(1))
  f.settle[0]({ status: 'done', text: '前の返答' })
  await vi.waitFor(() => expect(conv.get('request-1')?.status).toBe('done'))
  const before = conv.transcript()
  expect(before.items[0].current).toBe(true)
  t += 6 * 3600_000 + 1
  const idle = conv.transcript()
  expect(idle.items[0]).toMatchObject({ current: false, reply: { text: '前の返答' } })
  expect(idle.rev).not.toBe(before.rev)
  conv.submit(text('request-2', '新しい会話'), '')
  expect(conv.transcript().items.map((x) => x.current)).toEqual([false, true])
  await vi.waitFor(() => expect(f.sessions).toHaveLength(2))
  expect(f.sessions[0]).not.toBe(f.sessions[1])
  // 24 時間を過ぎた履歴は消える。
  t += 86_400_000
  expect(conv.transcript().items.map((x) => x.requestId)).toEqual(['request-2'])
})

it('API: 本人と検証用の履歴を分け、notifier と未認証を拒否し、rev が同じなら本文を返さない', async () => {
  const f = fake()
  const server = createServer(
    createApp({
      authenticate: async (h) =>
        h.authorization === 'owner' || h.authorization === 'verifier' || h.authorization === 'notifier'
          ? h.authorization
          : null,
      hermes: f.hermes,
    }),
  )
  await new Promise<void>((r) => server.listen(0, r))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/kohako/api/v1/`
  const get = async (path: string, who?: string) => {
    const r = await fetch(base + path, who ? { headers: { authorization: who } } : {})
    return { status: r.status, data: (await r.json()) as Record<string, unknown> }
  }
  try {
    const sent = await fetch(`${base}messages`, {
      method: 'POST',
      headers: { authorization: 'owner', 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'owner-request',
        kind: 'text',
        text: '本人の発言',
        expiresAt: Date.now() + 60000,
      }),
    })
    expect(sent.status).toBe(202)
    const owner = await get('conversation/transcript', 'owner')
    expect(owner.status).toBe(200)
    expect(owner.data).toMatchObject({
      items: [{ requestId: 'owner-request', text: '本人の発言', status: 'pending', current: true }],
      active: { requestId: 'owner-request', kind: 'text' },
    })
    const verifier = await get('conversation/transcript', 'verifier')
    expect(verifier.data).toMatchObject({ items: [], active: null })
    expect(JSON.stringify(verifier.data)).not.toContain('本人の発言')
    expect((await get('conversation/transcript', 'notifier')).status).toBe(403)
    expect((await get('conversation/transcript')).status).toBe(401)
    const same = await get(`conversation/transcript?rev=${encodeURIComponent(String(owner.data.rev))}`, 'owner')
    expect(same.data).toEqual({ rev: owner.data.rev, unchanged: true })
    expect((await get('conversation/transcript?rev=other', 'owner')).data.items).toHaveLength(1)
    // 既存の conversation 応答は変えない。
    expect((await get('conversation', 'owner')).data).toMatchObject({ enabled: true })
  } finally {
    server.close()
  }
})
