// BOXP-657 段0: 眼鏡の入口（principal g2）・入口（origin）の記録・入口句・契約 fixture。
import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuth, G2_OWNER_HEADER, G2_TOKEN_AUDIENCE } from './auth.js'
import { createApp, g2Instructions, g2Route, instructions, ownerTaskInstructions, studioInstructions } from './app.js'
import { readConfig } from './config.js'
import { createConversation, G2_ENTRY, HOME_ENTRY } from './conversation.js'
import type { createHermes } from './hermes.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const HOME_AUD = 'abc',
  G2_AUD = 'def',
  G2_USER = 'system:serviceaccount:even-g2-lab:kohako-g2-bff'
const jwt = (claims: Record<string, unknown> = {}, key = privateKey) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url'),
    p = Buffer.from(
      JSON.stringify({
        iss: 'https://access.example.test',
        aud: G2_AUD,
        email: 'owner@example.test',
        exp: Date.now() / 1000 + 60,
        ...claims,
      }),
    ).toString('base64url')
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`
}
type Reviewer = NonNullable<Parameters<typeof createAuth>[0]['review']>
const pod =
  (username = G2_USER, audiences = [G2_TOKEN_AUDIENCE]): Reviewer =>
  async (_token, audience) => ({
    status: { authenticated: audiences.includes(audience), user: { username }, audiences },
  })
const auth = (over: Partial<Parameters<typeof createAuth>[0]> = {}) =>
  createAuth({
    jwks: { getKey: async () => publicKey.export({ format: 'jwk' }) },
    issuer: 'https://access.example.test',
    audience: HOME_AUD,
    ownerEmails: ['owner@example.test'],
    verifierEnabled: true,
    verifierUsername: 'system:serviceaccount:codex-workspace:codex-workspace',
    notifierEnabled: true,
    notifierUsername: 'system:serviceaccount:codex-workspace:codex-workspace',
    g2Enabled: true,
    g2Username: G2_USER,
    g2Audience: G2_AUD,
    now: Date.now,
    review: pod(),
    ...over,
  })
const both = (assertion = jwt()) => ({ authorization: 'Bearer pod-token', [G2_OWNER_HEADER]: assertion })

it('g2 principal needs both the G2 pod token and the Owner assertion', async () => {
  expect(G2_OWNER_HEADER).toBe('x-kohako-owner-assertion')
  expect(G2_TOKEN_AUDIENCE).toBe('kohako-bff-g2')
  expect(await auth()(both())).toBe('g2')
  // Pod の token だけ／本人の証明だけ、では通らない。
  expect(await auth()({ authorization: 'Bearer pod-token' })).toBeNull()
  expect(await auth()({ [G2_OWNER_HEADER]: jwt() })).toBeNull()
  expect(await auth()({ authorization: 'Bearer pod-token', [G2_OWNER_HEADER]: ['a', 'b'] as never })).toBeNull()
})
it('g2 is disabled unless enabled with a username and an Access audience', async () => {
  for (const over of [{ g2Enabled: false }, { g2Enabled: undefined }, { g2Username: '' }, { g2Audience: '' }])
    expect(await auth(over)(both())).toBeNull()
})
it('rejects another pod, another audience and an unauthenticated token', async () => {
  for (const review of [
    pod('system:serviceaccount:even-g2-lab:default'),
    pod('system:serviceaccount:other:kohako-g2-bff'),
    pod(G2_USER, ['kohako-bff-verifier']),
    pod(G2_USER, ['kohako-bff-notifier']),
    pod(G2_USER, []),
    (async () => {
      throw Error('review down')
    }) as Reviewer,
  ])
    expect(await auth({ review })(both())).toBeNull()
  // 検証係・投入係の token に本人の証明を添えても g2 にはならない（それぞれの principal のまま）。
  const shared = pod('system:serviceaccount:codex-workspace:codex-workspace', ['kohako-bff-verifier'])
  expect(await auth({ review: shared })(both())).toBe('verifier')
})
it('rejects an Owner assertion that is expired, for the home audience, for another user or badly signed', async () => {
  const a = auth()
  for (const bad of [
    jwt({ exp: Date.now() / 1000 - 1 }),
    jwt({ aud: HOME_AUD }),
    jwt({ aud: 'other' }),
    jwt({ email: 'someone@example.test' }),
    jwt({ iss: 'https://evil.example.test' }),
    jwt({}, other.privateKey),
    'bad',
    '',
  ])
    expect(await a(both(bad))).toBeNull()
  expect(await a(both())).toBe('g2')
})
it('checks the Owner assertion on every request even while the pod review is cached', async () => {
  const review = vi.fn(pod())
  let now = Date.now()
  const a = auth({ review, now: () => now })
  const assertion = jwt({ exp: now / 1000 + 30 })
  expect(await a(both(assertion))).toBe('g2')
  expect(await a(both(assertion))).toBe('g2')
  // 初回だけ（検証係・投入係・g2 の順に）確かめ、以後 60 秒は API server を呼ばない。
  expect(review).toHaveBeenCalledTimes(3)
  expect(await a({ authorization: 'Bearer pod-token' })).toBeNull()
  now += 31_000
  expect(await a(both(assertion))).toBeNull()
  expect(review).toHaveBeenCalledTimes(3)
})
it('never treats a G2 assertion as the home Owner, nor a home JWT header as g2', async () => {
  // 家の入口（cf-access-jwt-assertion）は家の AUD だけ。G2 の AUD の JWT を家の header に入れても owner にならない。
  expect(await auth()({ 'cf-access-jwt-assertion': jwt() })).toBeNull()
  expect(await auth()({ 'cf-access-jwt-assertion': jwt({ aud: HOME_AUD }) })).toBe('owner')
  // 家の header があれば家の規則だけで決まり、g2 の資格を添えても g2 へは落ちない。
  expect(await auth()({ ...both(), 'cf-access-jwt-assertion': 'bad' })).toBeNull()
})
it('validates the G2 configuration', () => {
  const base = {
    KOHAKO_ACCESS_TEAM_DOMAIN: 'https://access.example.test',
    KOHAKO_ACCESS_AUD: 'abc123',
    KOHAKO_OWNER_EMAILS: 'owner@example.test',
  }
  expect(readConfig(base).g2Mode).toBeUndefined()
  expect(readConfig({ ...base, KOHAKO_G2_MODE: '' }).g2Mode).toBeUndefined()
  const g2 = { KOHAKO_G2_ACCESS_AUD: 'def456', KOHAKO_G2_USERNAME: G2_USER }
  const ok = readConfig({ ...base, KOHAKO_G2_MODE: 'read', ...g2 })
  expect(ok).toMatchObject({ g2Mode: 'read', g2Audience: 'def456', g2Username: G2_USER })
  expect(readConfig({ ...base, KOHAKO_G2_MODE: 'write', ...g2 }).g2Mode).toBe('write')
  for (const bad of [
    { KOHAKO_G2_MODE: 'on', ...g2 },
    { KOHAKO_G2_MODE: 'read' },
    { KOHAKO_G2_MODE: 'read', KOHAKO_G2_ACCESS_AUD: 'def456' },
    { KOHAKO_G2_MODE: 'read', ...g2, KOHAKO_G2_ACCESS_AUD: 'ABC123' },
    { KOHAKO_G2_MODE: 'read', ...g2, KOHAKO_G2_ACCESS_AUD: 'not-hex' },
    { KOHAKO_G2_MODE: 'read', ...g2, KOHAKO_G2_USERNAME: 'kohako' },
    { KOHAKO_G2_MODE: 'read', ...g2, KOHAKO_G2_USERNAME: 'system:serviceaccount:even-g2-lab:default' },
  ])
    expect(() => readConfig({ ...base, ...bad })).toThrow()
  expect(() => readConfig({ KOHAKO_G2_MODE: 'read', ...g2 })).toThrow()
})
it('opens only the designed routes to g2', () => {
  const id = 'request-1'
  const read: [string, string][] = [
    ['GET', 'conversation/transcript'],
    ['GET', `requests/${id}`],
  ]
  const write: [string, string][] = [
    ['POST', 'messages'],
    ['POST', 'approvals'],
    ['POST', `requests/${id}/cancel`],
  ]
  const never: [string, string][] = [
    ['GET', 'notifications'],
    ['POST', 'notifications/ingest'],
    ['GET', 'notifications/status'],
    ['POST', 'notifications/event-12345/read'],
    ['POST', 'notifications/event-12345/handled'],
    ['POST', 'notifications/event-12345/reply'],
    ['POST', 'notifications/event-12345/announcing'],
    ['POST', 'notifications/event-12345/announced'],
    ['GET', 'push/key'],
    ['POST', 'push/subscriptions'],
    ['DELETE', 'push/subscriptions'],
    ['GET', 'tts'],
    ['POST', 'tts'],
    ['POST', 'attachments'],
    ['GET', 'vault-image'],
    ['GET', 'status'],
    ['POST', 'transcriptions'],
    ['POST', 'stt'],
    ['GET', 'me'],
    ['GET', 'conversation'],
    ['GET', `requests/${id}/activity/t1`],
    ['GET', `requests/${id}/cancel`],
    ['POST', `requests/${id}`],
    ['DELETE', `requests/${id}`],
    ['GET', 'messages'],
    ['POST', 'conversation/transcript'],
  ]
  for (const [m, r] of read) {
    expect(g2Route(m, r, 'read'), r).toBe(true)
    expect(g2Route(m, r, 'write'), r).toBe(true)
    expect(g2Route(m, r, undefined), r).toBe(false)
  }
  for (const [m, r] of write) {
    expect(g2Route(m, r, 'read'), r).toBe(false)
    expect(g2Route(m, r, 'write'), r).toBe(true)
    expect(g2Route(m, r, undefined), r).toBe(false)
  }
  for (const [m, r] of never) for (const mode of ['read', 'write'] as const) expect(g2Route(m, r, mode), r).toBe(false)
  expect(g2Route(undefined, 'conversation/transcript', 'write')).toBe(false)
})

type Call = { id: string; input: unknown; session: string; instructions: string }
type Approval = { description: string; command: string; choices: string[] }
function fakeHermes() {
  const calls: Call[] = [],
    settle = new Map<string, (r: { status: 'done'; text: string } | { status: 'failed'; error: string }) => void>(),
    approvals = new Map<string, (runId: string, a: Approval | null) => void>()
  const approve = vi.fn(async () => 'ok' as const),
    stop = vi.fn(async (runId: string) => {
      settle.get(runId.slice(4))?.({ status: 'failed', error: 'cancelled' })
      return 'ok' as const
    })
  const hermes = {
    run: (
      id: string,
      input: unknown,
      session: string,
      instructions: string,
      onApproval: (runId: string, a: Approval | null) => void,
      _retry: unknown,
      onRun: (runId: string) => void,
    ) => {
      calls.push({ id, input, session, instructions })
      approvals.set(id, onApproval)
      onRun(`run-${id}`)
      return new Promise((r) => settle.set(id, r))
    },
    approve,
    stop,
  } as unknown as ReturnType<typeof createHermes>
  return {
    hermes,
    calls,
    approve,
    stop,
    done: (id: string, text: string) => settle.get(id)?.({ status: 'done', text }),
    ask: (id: string, command = 'ls /tmp') =>
      approvals.get(id)?.(`run-${id}`, { description: '実行', command, choices: ['once', 'deny'] }),
  }
}
const servers: ReturnType<typeof createServer>[] = [],
  dirs: string[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
async function start(g2Mode?: 'read' | 'write', store?: string) {
  const h = fakeHermes(),
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const conv = (prefix: string) =>
    createConversation({
      now: Date.now,
      hermes: h.hermes,
      prefix,
      store,
      sweepMs: 0,
      activityDrainMs: 0,
      cancelSettleMs: 50,
    })
  const conversations = { owner: conv('kohako-web'), verifier: conv('kohako-verify') }
  await conversations.owner.restore()
  const server = createServer(
    createApp({
      authenticate: async (x) =>
        x.authorization === 'owner' || x.authorization === 'g2' || x.authorization === 'verifier'
          ? x.authorization
          : null,
      g2Mode,
      hermes: h.hermes,
      conversations,
    }),
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
  const call = async (who: string, path: string, body?: object, method = body ? 'POST' : 'GET') => {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: who, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    // biome-ignore lint/suspicious/noExplicitAny: 試験では応答の中身を緩く読む
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }
  const msg = (requestId: string, text = 'こんにちは', extra: object = {}) => ({
    requestId,
    kind: 'text',
    text,
    expiresAt: Date.now() + 60_000,
    ...extra,
  })
  return { ...h, call, msg, log, conversations }
}

it('g2 is refused everywhere while the mode is unset, and home works as before', async () => {
  const t = await start()
  for (const [path, body] of [
    ['conversation/transcript', undefined],
    ['requests/request-1', undefined],
    ['messages', t.msg('g2-off-0001')],
    ['notifications', undefined],
    ['me', undefined],
  ] as const)
    expect((await t.call('g2', path, body)).status, path).toBe(403)
  expect(t.calls).toHaveLength(0)
  const sent = await t.call('owner', 'messages', t.msg('home-0001', '家から', { views: true }))
  expect(sent.status).toBe(202)
  expect(sent.body.origin).toBe('home')
  expect(t.calls[0].input).toBe('家から')
  expect(t.calls[0].instructions).toContain(instructions)
  expect(t.calls[0].instructions).toContain(ownerTaskInstructions)
})
it('read mode lets g2 read the shared transcript and requests but not write', async () => {
  const t = await start('read')
  await t.call('owner', 'messages', t.msg('home-0001', '家の発言'))
  t.done('home-0001', `長い返答${'あ'.repeat(5000)}`)
  await vi.waitFor(async () => expect((await t.call('owner', 'requests/home-0001')).body.status).toBe('done'))
  const home = await t.call('owner', 'conversation/transcript'),
    g2 = await t.call('g2', 'conversation/transcript')
  expect(g2.status).toBe(200)
  // 誰が読んでも同じ全文（端末向けに切らない）。
  expect(g2.body).toEqual(home.body)
  expect(g2.body.items[0]).toMatchObject({ requestId: 'home-0001', origin: 'home', text: '家の発言' })
  expect(g2.body.items[0].reply.text).toHaveLength(5004)
  expect((await t.call('g2', `conversation/transcript?rev=${g2.body.rev}`)).body).toEqual({
    rev: g2.body.rev,
    unchanged: true,
  })
  expect((await t.call('g2', 'requests/home-0001')).body).toMatchObject({ status: 'done', origin: 'home' })
  expect((await t.call('g2', 'requests/unknown-0001')).status).toBe(404)
  for (const [path, body] of [
    ['messages', t.msg('g2-read-00001')],
    ['requests/home-0001/cancel', {}],
    ['approvals', { requestId: 'home-0001', approvalId: '0000000000000000', choice: 'deny' }],
  ] as const)
    expect((await t.call('g2', path, body)).status, path).toBe(403)
  expect(t.calls).toHaveLength(1)
  // 記録は route の形と可否だけ（依頼 id・本文は出さない）。
  const lines = t.log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('kohako_g2 '))
  expect(lines).toContain('kohako_g2 GET conversation/transcript ok')
  expect(lines).toContain('kohako_g2 GET requests/:id ok')
  expect(lines).toContain('kohako_g2 POST messages forbidden')
  expect(lines).toContain('kohako_g2 POST requests/:id/cancel forbidden')
  expect(lines.join('\n')).not.toMatch(/home-0001|家の発言/)
})
it('write mode records origin g2, sends the entry line only to Hermes and uses the G2 instructions', async () => {
  const t = await start('write')
  await t.call('owner', 'messages', t.msg('home-0001', '家の発言', { views: true }))
  t.done('home-0001', '家への返答')
  await vi.waitFor(async () => expect((await t.call('owner', 'requests/home-0001')).body.status).toBe('done'))
  const sent = await t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の発言', { via: 'voice' }))
  expect(sent.status).toBe(202)
  expect(sent.body).toMatchObject({ requestId: 'g2-00001', origin: 'g2', via: 'voice', status: 'pending' })
  // 同じ会話（session）に続き、Hermes への入力の先頭にだけ入口句が付く。
  expect(t.calls[1].session).toBe(t.calls[0].session)
  expect(t.calls[1].session).toMatch(/^kohako-web-/)
  expect(G2_ENTRY).toBe('［眼鏡 Even G2 からの発言］')
  expect(t.calls[1].input).toBe(`${G2_ENTRY}\n眼鏡の発言`)
  expect(t.calls[0].input).toBe('家の発言')
  // 眼鏡向けの指示文: 長さの上限・家の画面の指示・監督登録を持ち込まない。
  expect(t.calls[1].instructions).toBe(g2Instructions)
  expect(g2Instructions).toContain('結論を先に')
  expect(g2Instructions).not.toMatch(/\d+\s*字|kohako-view|kohako-vault|ナビログ|監督登録/)
  expect(g2Instructions).not.toContain(G2_ENTRY)
  expect(studioInstructions).not.toMatch(/眼鏡|G2/)
  // 家から見ると進行中で、もう 1 件は受理されない（run は 1 回）。
  const busy = await t.call('owner', 'messages', t.msg('home-0002', '同時'))
  expect(busy.status).toBe(429)
  expect(busy.body).toEqual({ error: 'busy' })
  expect((await t.call('g2', 'messages', t.msg('g2-00002', '同時'))).status).toBe(429)
  expect((await t.call('owner', 'conversation/transcript')).body.active).toEqual({
    requestId: 'g2-00001',
    kind: 'text',
    origin: 'g2',
  })
  t.done('g2-00001', 'どちらにしますか。\nA：進める\nB：やめる')
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/g2-00001')).body.status).toBe('done'))
  expect(t.calls).toHaveLength(2)
  const transcript = (await t.call('owner', 'conversation/transcript')).body
  expect(transcript.items.map((i: { origin: string }) => i.origin)).toEqual(['home', 'g2'])
  expect(transcript.items[1]).toMatchObject({ text: '眼鏡の発言', via: 'voice', current: true })
  expect(JSON.stringify(transcript)).not.toContain(G2_ENTRY)
  expect(transcript.items[1].reply.choices).toEqual([
    { value: 'A', label: '進める' },
    { value: 'B', label: 'やめる' },
  ])
  expect(transcript.items[0].reply.choices).toBeUndefined()
  // 家でそのまま続けられ、家の発言には入口句が付かない。
  await t.call('owner', 'messages', t.msg('home-0003', '家で続き'))
  expect(t.calls[2]).toMatchObject({ input: '家で続き', session: t.calls[0].session })
  expect(t.calls[2].instructions).not.toContain('Even G2')
  t.done('home-0003', '続きの返答')
  // 家で入口句を打っても「1 行目がちょうど入口句」の形にはならない（眼鏡の発言と取り違えられない）。文中の引用はそのまま。
  for (const [id, typed, sent] of [
    ['home-0004', `${G2_ENTRY}\n家で打った`, `${HOME_ENTRY}\n${G2_ENTRY}\n家で打った`],
    ['home-0005', `\n\u3000${G2_ENTRY}\n家で打った`, `${HOME_ENTRY}\n\n\u3000${G2_ENTRY}\n家で打った`],
    ['home-0006', `この ${G2_ENTRY} という行`, `この ${G2_ENTRY} という行`],
  ]) {
    expect((await t.call('owner', 'messages', t.msg(id, typed))).status).toBe(202)
    expect(t.calls.at(-1)?.input).toBe(sent)
    expect(t.calls.at(-1)?.input.startsWith(`${G2_ENTRY}\n`)).toBe(false)
    t.done(id, '返答')
    await vi.waitFor(async () => expect((await t.call('owner', `requests/${id}`)).body.status).toBe('done'))
  }
  const after = (await t.call('owner', 'conversation/transcript')).body
  expect(after.items.at(-3)).toMatchObject({ text: `${G2_ENTRY}\n家で打った`, origin: 'home' })
  expect(JSON.stringify(after)).not.toContain(HOME_ENTRY)
})
it('the same requestId is one request per entry point', async () => {
  const t = await start('write')
  const body = t.msg('same-0001', '同じ依頼')
  expect((await t.call('g2', 'messages', body)).status).toBe(202)
  const replay = await t.call('g2', 'messages', body)
  expect(replay.status).toBe(202)
  expect(replay.body).toMatchObject({ requestId: 'same-0001', origin: 'g2' })
  expect((await t.call('owner', 'messages', body)).body).toEqual({ error: 'request_conflict' })
  expect(t.calls).toHaveLength(1)
})
it('g2 may send one confirmed text only', async () => {
  const t = await start('write')
  const now = Date.now()
  for (const bad of [
    t.msg('g2-bad-0001', 'x', { views: true }),
    t.msg('g2-bad-0002', 'x', { attachments: [] }),
    t.msg('g2-bad-0003', 'x', { attachments: ['0'.repeat(32)] }),
    t.msg('g2-bad-0004', 'x', { location: { status: 'ok', lat: 35, lon: 139, accuracy: 10, at: now } }),
    t.msg('g2-bad-0005', 'x', { origin: 'home' }),
    t.msg('g2-bad-0006', 'x', { via: 'home' }),
    t.msg('g2-bad-0007', 'x', { via: 1 }),
    t.msg('g2-bad-0008', 'x', { visit: true }),
    { requestId: 'g2-bad-0009', kind: 'visit', expiresAt: now + 60_000 },
    {
      requestId: 'g2-bad-0010',
      kind: 'touch',
      touch: { zone: 'head', action: 'pat', count: 1 },
      expiresAt: now + 60_000,
    },
    t.msg('g2-bad-0011', ''),
    t.msg('g2-bad-0012', 'あ'.repeat(501)),
  ]) {
    const res = await t.call('g2', 'messages', bad)
    expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400)
  }
  expect(t.calls).toHaveLength(0)
  // 「見てきて」は眼鏡からは普通の発言（現場の別 session・Grafana にはならない）。
  const sent = await t.call('g2', 'messages', t.msg('g2-visit-0001', '自宅クラスタを見てきて'))
  expect(sent.status).toBe(202)
  expect(sent.body.visit).toBeUndefined()
  expect(t.calls[0].session).toMatch(/^kohako-web-/)
  expect(t.calls[0].input).toBe(`${G2_ENTRY}\n自宅クラスタを見てきて`)
})
it('g2 answers approvals of its own requests once, and may only deny home requests', async () => {
  const t = await start('write')
  // 家発の依頼の許可: 眼鏡からは once は 403、deny だけ。
  await t.call('owner', 'messages', t.msg('home-0001', '家の依頼'))
  t.ask('home-0001')
  const home = (await t.call('g2', 'requests/home-0001')).body
  expect(home).toMatchObject({ status: 'approval', origin: 'home' })
  expect(home.approval).toMatchObject({ fullyShown: true })
  const approval = { requestId: 'home-0001', approvalId: home.approval.approvalId }
  expect((await t.call('g2', 'approvals', { ...approval, choice: 'once' })).status).toBe(403)
  expect(t.approve).not.toHaveBeenCalled()
  expect((await t.call('g2', 'approvals', { ...approval, choice: 'deny' })).status).toBe(200)
  expect(t.approve).toHaveBeenCalledTimes(1)
  expect(t.approve.mock.calls[0]).toEqual(['run-home-0001', 'deny', undefined, undefined])
  // もう片方（家）の違う回答は 409、同じ回答は同じ結果。Hermes へは 1 回だけ。
  expect((await t.call('owner', 'approvals', { ...approval, choice: 'once' })).body).toEqual({
    error: 'approval_conflict',
  })
  expect((await t.call('owner', 'approvals', { ...approval, choice: 'deny' })).status).toBe(200)
  expect(t.approve).toHaveBeenCalledTimes(1)
  t.done('home-0001', '了解')
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/home-0001')).body.status).toBe('done'))
  // 眼鏡発の依頼の許可: 眼鏡でも家でも 1 回だけ答えられる。
  await t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の依頼'))
  t.ask('g2-00001')
  const own = (await t.call('owner', 'requests/g2-00001')).body
  expect(own).toMatchObject({ status: 'approval', origin: 'g2' })
  const mine = { requestId: 'g2-00001', approvalId: own.approval.approvalId }
  expect((await t.call('g2', 'approvals', { ...mine, choice: 'once' })).status).toBe(200)
  expect((await t.call('owner', 'approvals', { ...mine, choice: 'deny' })).body).toEqual({ error: 'approval_conflict' })
  expect(t.approve).toHaveBeenCalledTimes(2)
  expect(t.approve.mock.calls[1][1]).toBe('once')
})
it('either entry point can stop a request and the other sees it stopped', async () => {
  const t = await start('write')
  await t.call('owner', 'messages', t.msg('home-0001', '家の依頼'))
  expect((await t.call('g2', 'requests/home-0001/cancel', {})).status).toBe(202)
  await vi.waitFor(async () =>
    expect((await t.call('owner', 'requests/home-0001')).body).toMatchObject({ status: 'failed', error: 'cancelled' }),
  )
  expect((await t.call('g2', 'requests/home-0001/cancel', {})).status).toBe(409)
  await t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の依頼'))
  expect((await t.call('owner', 'requests/g2-00001/cancel', {})).status).toBe(202)
  await vi.waitFor(async () =>
    expect((await t.call('g2', 'requests/g2-00001')).body).toMatchObject({ status: 'failed', error: 'cancelled' }),
  )
  expect(t.stop).toHaveBeenCalledTimes(2)
})
it('reads stored data without origin as home and keeps the origin across a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-g2-'))
  dirs.push(dir)
  // 既存の保存データ（origin 欄なし）は変換なしで読める。
  await writeFile(
    join(dir, 'conversations-kohako-web.json'),
    JSON.stringify({
      sessionStartedAt: Date.now() - 1000,
      lastUse: Date.now() - 1000,
      lastExchange: null,
      entries: [
        {
          requestId: 'old-0001',
          payloadHash: 'hash',
          text: '前からある発言',
          status: 'done',
          reply: { text: '前からある返答', at: Date.now() - 900 },
          createdAt: Date.now() - 1000,
          kind: 'text',
          sessionId: 'kohako-web-old',
        },
      ],
    }),
  )
  const t = await start('write', dir)
  expect((await t.call('g2', 'conversation/transcript')).body.items[0]).toMatchObject({
    requestId: 'old-0001',
    origin: 'home',
    text: '前からある発言',
    reply: { text: '前からある返答' },
  })
  await t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の発言', { via: 'ring' }))
  await vi.waitFor(() => expect(t.calls).toHaveLength(1))
  t.done('g2-00001', '返答')
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/g2-00001')).body.status).toBe('done'))
  await t.conversations.owner.flush()
  const saved = JSON.parse(await readFile(join(dir, 'conversations-kohako-web.json'), 'utf8'))
  expect(saved.entries.map((e: { origin?: string; via?: string }) => [e.origin, e.via])).toEqual([
    [undefined, undefined],
    ['g2', 'ring'],
  ])
  expect(JSON.stringify(saved)).not.toContain(G2_ENTRY)
  const again = await start('write', dir)
  expect(
    (await again.call('owner', 'conversation/transcript')).body.items.map((i: { origin: string }) => i.origin),
  ).toEqual(['home', 'g2'])
})

// 契約: 眼鏡の入口（boxp/even-g2-lab apps/kohako-bff の代理 client）が頼る応答の形。同じ fixture を両 repo に置き、
// 家の BFF はこの形を出力すること、G2 の client はこの形で通ることをそれぞれの試験で確かめる。
it('matches the shared contract fixture (contract/g2-v1.json)', async () => {
  const fixture = JSON.parse(await readFile(new URL('../contract/g2-v1.json', import.meta.url), 'utf8'))
  const t = await start('write')
  const norm = (x: unknown): unknown =>
    JSON.parse(
      JSON.stringify(x, (k, v) =>
        k === 'rev'
          ? '<rev>'
          : k === 'approvalId'
            ? '<approvalId>'
            : ['at', 'expiresAt', 'sessionStartedAt', 'startedAt', 'endedAt', 'ms'].includes(k) && typeof v === 'number'
              ? 0
              : v,
      ),
    )
  const got: Record<string, unknown> = {}
  const rec = async (name: string, res: Promise<{ status: number; body: unknown }>) => {
    const r = await res
    got[name] = { status: r.status, body: norm(r.body) }
  }
  await t.call('owner', 'messages', t.msg('home-0001', '家の発言', { views: true }))
  await rec('requestHomePending', t.call('g2', 'requests/home-0001'))
  await rec('messageBusy', t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の発言', { via: 'text' })))
  t.done('home-0001', '家への返答')
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/home-0001')).body.status).toBe('done'))
  await rec('requestHomeDone', t.call('g2', 'requests/home-0001'))
  await rec('messageAccepted', t.call('g2', 'messages', t.msg('g2-00001', '眼鏡の発言', { via: 'text' })))
  await rec('transcriptActive', t.call('g2', 'conversation/transcript'))
  t.ask('g2-00001')
  await rec('requestApproval', t.call('g2', 'requests/g2-00001'))
  const approvalId = (await t.call('g2', 'requests/g2-00001')).body.approval.approvalId
  await rec('approvalAccepted', t.call('g2', 'approvals', { requestId: 'g2-00001', approvalId, choice: 'once' }))
  await rec('approvalConflict', t.call('g2', 'approvals', { requestId: 'g2-00001', approvalId, choice: 'deny' }))
  await rec(
    'approvalStale',
    t.call('g2', 'approvals', { requestId: 'g2-00001', approvalId: '0'.repeat(16), choice: 'deny' }),
  )
  t.done('g2-00001', 'どちらにしますか。\nA：進める\nB：やめる')
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/g2-00001')).body.status).toBe('done'))
  await rec('requestDone', t.call('g2', 'requests/g2-00001'))
  await rec('transcriptIdle', t.call('g2', 'conversation/transcript'))
  const rev = (await t.call('g2', 'conversation/transcript')).body.rev
  await rec('transcriptUnchanged', t.call('g2', `conversation/transcript?rev=${rev}`))
  await rec('cancelNotPending', t.call('g2', 'requests/g2-00001/cancel', {}))
  await t.call('g2', 'messages', t.msg('g2-00002', '止める依頼'))
  await rec('cancelAccepted', t.call('g2', 'requests/g2-00002/cancel', {}))
  await vi.waitFor(async () => expect((await t.call('g2', 'requests/g2-00002')).body.status).toBe('failed'))
  await rec('requestCancelled', t.call('g2', 'requests/g2-00002'))
  await rec('requestUnknown', t.call('g2', 'requests/nothing-0001'))
  await rec('messageInvalid', t.call('g2', 'messages', t.msg('g2-00003', 'x', { views: true })))
  await rec('messageExpired', t.call('g2', 'messages', { ...t.msg('g2-00004', 'x'), expiresAt: Date.now() - 1 }))
  await rec('forbidden', t.call('g2', 'notifications'))
  await rec('unauthenticated', t.call('nobody', 'conversation/transcript'))
  if (process.env.KOHAKO_WRITE_CONTRACT === '1')
    await writeFile(
      new URL('../contract/g2-v1.json', import.meta.url),
      `${JSON.stringify({ ...fixture, responses: got }, null, 2)}\n`,
    )
  else expect(got).toEqual(fixture.responses)
})
