import { expect, test } from 'vitest'
import { nextRev, planSync, Seen, Shared, validateTranscript } from './sync'

test('履歴の検証と重複防止、追跡中の終端抑制', () => {
  const data = validateTranscript({
    rev: 'r',
    sessionStartedAt: 1,
    items: [
      { requestId: 'old', at: 1, current: false, status: 'done', text: '前', reply: { text: '返事', at: 2 } },
      { requestId: 'new', at: 3, current: true, status: 'pending', text: '続き', attachments: ['添付'] },
    ],
    active: { requestId: 'new', kind: 'text' },
  })
  expect(data && !('unchanged' in data)).toBe(true)
  if (!data || 'unchanged' in data) throw new Error('検証失敗')
  const seen = new Seen()
  expect(planSync(data.items, data.active, { seen, trackingId: '', canFollow: true }).map((x) => x.op)).toEqual([
    'user',
    'reply',
    'divider',
    'user',
    'follow',
  ])
  expect(planSync(data.items, data.active, { seen, trackingId: 'new', canFollow: false })).toEqual([])
  expect(validateTranscript({ rev: 'r', unchanged: true })).toEqual({ rev: 'r', unchanged: true })
  expect(validateTranscript({ rev: 'r', sessionStartedAt: 1, items: Array(51).fill({}), active: null })).toBeNull()
})

const item = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  at: 10,
  current: true,
  status: 'done' as const,
  text: `発言:${requestId}`,
  reply: { text: `返答:${requestId}`, at: 20, views: [] },
  ...extra,
})
const ctx = (seen: Seen, trackingId = '', canFollow = true) => ({ seen, trackingId, canFollow })

// BOXP-613: 旧「この端末が既に出した発言・返答は足さない」は、planSync 自身が同じ markUser/markReply を使うため
// 変異の検出が本テストに完全に包含されていた（kill-matrix）。送信側の印付けも同じ経路である旨をここへ統合した。
test('同じ履歴を 2 回流しても、この端末が既に出した発言・返答も、2 回目は何も足さない', () => {
  const seen = new Seen(),
    items = [item('a'), item('b')]
  expect(planSync(items, null, ctx(seen)).map((x) => [x.op, 'id' in x ? x.id : ''])).toEqual([
    ['user', 'a'],
    ['reply', 'a'],
    ['user', 'b'],
    ['reply', 'b'],
  ])
  expect(planSync(items, null, ctx(seen))).toEqual([])
  const sent = new Seen()
  sent.markUser('c')
  sent.markReply('c')
  expect(planSync([item('c')], null, ctx(sent))).toEqual([])
})

test('この端末が追っている依頼は発言だけ足し、返答・終了は照会側に任せる', () => {
  const seen = new Seen()
  const pending = item('a', { status: 'pending', reply: undefined })
  expect(planSync([pending], { requestId: 'a', kind: 'text' }, ctx(seen, 'a')).map((x) => x.op)).toEqual(['user'])
  // 同期の応答が照会より先に完了を知っても、追跡中は返答を足さない（照会側が 1 回だけ出す）。
  expect(planSync([item('a')], null, ctx(seen, 'a'))).toEqual([])
  // 照会側が出した後（markReply 済み）は、追跡が終わっても足さない。
  seen.markReply('a')
  expect(planSync([item('a')], null, ctx(seen, ''))).toEqual([])
})

test('他端末の進行中の依頼は、この端末が空いている時だけ追う', () => {
  const pending = item('a', { status: 'pending', reply: undefined })
  const active = { requestId: 'a', kind: 'text' as const }
  expect(planSync([pending], active, ctx(new Seen(), '', false)).map((x) => x.op)).toEqual(['user'])
  expect(planSync([pending], active, ctx(new Seen(), '', true)).at(-1)).toEqual({ op: 'follow', id: 'a', kind: 'text' })
  // 履歴に載らない通知返信も追える（本文は出さない）。
  expect(planSync([], { requestId: 'n', kind: 'reply' }, ctx(new Seen()))).toEqual([
    { op: 'follow', id: 'n', kind: 'reply' },
  ])
})

test('停止・失敗は 1 回だけ知らせ、最新の返答に latest を付ける', () => {
  const seen = new Seen()
  const items = [
    item('a', { status: 'failed', error: 'cancelled', reply: undefined }),
    item('b', { status: 'unknown', reply: undefined }),
    item('c'),
  ]
  const ops = planSync(items, null, ctx(seen))
  expect(ops.filter((x) => x.op === 'ended')).toEqual([
    { op: 'ended', id: 'a', stopped: true, at: 10 },
    { op: 'ended', id: 'b', stopped: false, at: 10 },
  ])
  expect(ops.at(-1)).toMatchObject({ op: 'reply', id: 'c', latest: true })
  expect(planSync(items, null, ctx(seen))).toEqual([])
})

test('以前の会話だけが残っている時は、続きの文脈に含まれないことを 1 回だけ知らせる', () => {
  const seen = new Seen(),
    items = [item('a', { current: false })]
  expect(planSync(items, null, ctx(seen)).map((x) => x.op)).toEqual(['user', 'reply', 'stale'])
  expect(planSync(items, null, ctx(seen))).toEqual([])
  // 新しい会話が始まったら境目を出す。
  expect(planSync([...items, item('b')], null, ctx(seen)).map((x) => x.op)).toEqual(['divider', 'user', 'reply'])
})

test('本文の無い古い履歴は返答だけ足し、添付名は発言に続けて出す', () => {
  const ops = planSync(
    [item('old', { text: undefined }), item('new', { attachments: ['a.pdf', 'b.png'] })],
    null,
    ctx(new Seen()),
  )
  expect(ops.map((x) => x.op)).toEqual(['reply', 'user', 'reply'])
  expect(ops[1]).toMatchObject({ text: '発言:new\n📎 a.pdf\n📎 b.png' })
})

test('不正な応答は捨てる', () => {
  const ok = { rev: 'r', sessionStartedAt: 1, items: [], active: null }
  expect(validateTranscript(ok)).not.toBeNull()
  for (const bad of [
    null,
    [],
    { ...ok, rev: '' },
    { ...ok, items: [{ requestId: 'a', at: 1, current: true, status: 'weird' }] },
    { ...ok, items: [{ requestId: 'a', at: 1, current: true, status: 'done', text: 'x'.repeat(501) }] },
    { ...ok, items: [{ requestId: 'a', at: 1, current: true, status: 'done', reply: { text: 1, at: 1 } }] },
    { ...ok, active: { requestId: 'a', kind: 'other' } },
    { ...ok, active: undefined },
  ])
    expect(validateTranscript(bad)).toBeNull()
})

test('履歴から外れた依頼（期限切れ・最新 50 件の外）だけを消す対象として返す', () => {
  const shared = new Shared()
  expect(shared.update([{ requestId: 'a' }, { requestId: 'b' }])).toEqual([])
  expect(shared.update([{ requestId: 'a' }, { requestId: 'b' }, { requestId: 'c' }])).toEqual([])
  expect(shared.update([{ requestId: 'b' }, { requestId: 'c' }])).toEqual(['a'])
  // 一度返した番号は繰り返さない。履歴に載ったことのない番号（通知返信など）は対象にならない。
  expect(shared.update([{ requestId: 'c' }])).toEqual(['b'])
  expect(shared.update([])).toEqual(['c'])
  expect(shared.update([])).toEqual([])
})

test('進行中の依頼を追えていない間は rev を覚えず、次回も追跡を試み直す', () => {
  // 進行中が無い・進行中の依頼をこの端末が追っている: 変化なしの照会でよい。
  expect(nextRev('r1', null, '')).toBe('r1')
  expect(nextRev('r1', null, 'old')).toBe('r1')
  expect(nextRev('r1', { requestId: 'a', kind: 'text' }, 'a')).toBe('r1')
  // 何も追っていないのに追跡できなかった（送信中・承認待ちなど）。
  expect(nextRev('r1', { requestId: 'a', kind: 'text' }, '')).toBe('')
  // 前の依頼を追跡中に別端末が次の依頼を始めた: 前の依頼の完了後に次の依頼を追えるよう覚えない。
  expect(nextRev('r1', { requestId: 'next', kind: 'text' }, 'prev')).toBe('')
})

test('履歴の各フィールドは型と長さの上限を検証する', () => {
  const base = { rev: 'r', sessionStartedAt: 1, items: [item('a')], active: null }
  const validItem = {
    ...item('a'),
    text: 'x'.repeat(500),
    error: 'x'.repeat(500),
    attachments: Array(20).fill('x'.repeat(255)),
    reply: { text: 'x'.repeat(30000), at: 2, views: [] },
  }
  expect(validateTranscript({ ...base, rev: 'r'.repeat(100), items: Array(50).fill(validItem) })).not.toBeNull()
  for (const bad of [
    { ...base, rev: 'r'.repeat(101) },
    { ...base, sessionStartedAt: Infinity },
    { ...base, items: [{ ...validItem, requestId: '' }] },
    { ...base, items: [{ ...validItem, requestId: 'x'.repeat(65) }] },
    { ...base, items: [{ ...validItem, at: NaN }] },
    { ...base, items: [{ ...validItem, current: 1 }] },
    { ...base, items: [{ ...validItem, error: 'x'.repeat(501) }] },
    { ...base, items: [{ ...validItem, attachments: Array(21).fill('x') }] },
    { ...base, items: [{ ...validItem, attachments: ['ok', 42] }] },
    { ...base, items: [{ ...validItem, attachments: ['x'.repeat(256)] }] },
    { ...base, items: [{ ...validItem, reply: { text: 'x'.repeat(30001), at: 2 } }] },
    { ...base, items: [{ ...validItem, reply: { text: 'ok', at: Infinity } }] },
    { ...base, items: [{ ...validItem, reply: { text: 'ok', at: 2, views: Array(51).fill({}) } }] },
    { ...base, active: { requestId: '', kind: 'text' } },
  ])
    expect(validateTranscript(bad)).toBeNull()
})

// BOXP-613: 変異テストで、検証を通った履歴の中身（任意フィールドの写し・許す状態・views 件数境界）と、
// 印の上限・latest・stale の判定がどのテストにも観測されていなかった。
test('検証を通った履歴は値をそのまま写し、無いフィールドは足さない', () => {
  const full = {
    requestId: 'a',
    at: 1,
    current: true,
    status: 'failed',
    text: '発言',
    attachments: ['a.pdf'],
    error: 'cancelled',
    reply: { text: '返答', at: 2, views: Array(50).fill({}) },
  }
  const bare = { requestId: 'b', at: 3, current: false, status: 'pending' }
  expect(
    validateTranscript({
      rev: 'r',
      sessionStartedAt: 5,
      items: [full, bare],
      active: { requestId: 'b', kind: 'reply' },
    }),
  ).toStrictEqual({
    rev: 'r',
    sessionStartedAt: 5,
    items: [{ ...full, reply: { text: '返答', at: 2, views: [] } }, bare],
    active: { requestId: 'b', kind: 'reply' },
  })
  for (const status of ['pending', 'done', 'failed', 'unknown'])
    expect(
      validateTranscript({ rev: 'r', sessionStartedAt: 1, items: [{ ...bare, status }], active: null }),
    ).not.toBeNull()
  expect(
    validateTranscript({ rev: 'r', sessionStartedAt: 1, items: [], active: { requestId: 'a', kind: 'text' } }),
  ).toEqual({ rev: 'r', sessionStartedAt: 1, items: [], active: { requestId: 'a', kind: 'text' } })
  // 51 件以上の履歴（各項目は正しくても）、開始時刻が無い、items が配列でない応答は捨てる。
  expect(
    validateTranscript({ rev: 'r', sessionStartedAt: 1, items: Array(50).fill(bare), active: null }),
  ).not.toBeNull()
  expect(validateTranscript({ rev: 'r', sessionStartedAt: 1, items: Array(51).fill(bare), active: null })).toBeNull()
  expect(validateTranscript({ rev: 'r', items: [bare], active: null })).toBeNull()
  expect(validateTranscript({ rev: 'r', sessionStartedAt: 1, items: { 0: bare, length: 1 }, active: null })).toBeNull()
})

test('印は直近 400 件まで覚え、溢れたら古いものから忘れる', () => {
  const seen = new Seen()
  for (let i = 0; i < 400; i++) expect(seen.markUser(String(i))).toBe(true)
  expect(seen.markUser('0')).toBe(false)
  expect(seen.markUser('400')).toBe(true)
  // 最古の 1 件だけを忘れ、他は覚えたまま。
  expect(seen.markUser('1')).toBe(false)
  expect(seen.markUser('0')).toBe(true)
})

test('latest は最後の項目の返答だけに付き、終わった依頼の返答は出さない', () => {
  const ops = planSync([item('a'), item('b'), item('c', { status: 'failed' })], null, ctx(new Seen()))
  expect(ops.filter((x) => x.op === 'reply').map((x) => [x.id, 'latest' in x && x.latest])).toEqual([
    ['a', false],
    ['b', false],
  ])
  // views を持たない返答は空の views として出す。
  expect(planSync([item('d', { reply: { text: '返答', at: 1 } })], null, ctx(new Seen())).at(-1)).toMatchObject({
    op: 'reply',
    views: [],
    latest: true,
  })
  expect(ops.filter((x) => x.op === 'user').map((x) => 'text' in x && x.text)).toEqual(['発言:a', '発言:b', '発言:c'])
})

test('以前の会話の最後の依頼が替わるたびに stale を知らせ、現在の会話や進行中なら知らせない', () => {
  const seen = new Seen()
  expect(planSync([item('a', { current: false })], null, ctx(seen)).at(-1)).toEqual({ op: 'stale', id: 'a' })
  expect(planSync([item('b', { current: false })], null, ctx(seen)).at(-1)).toEqual({ op: 'stale', id: 'b' })
  expect(planSync([item('c')], null, ctx(seen)).map((x) => x.op)).not.toContain('stale')
  const pending = item('d', { current: false, status: 'pending', reply: undefined })
  expect(planSync([pending], null, ctx(seen)).map((x) => x.op)).not.toContain('stale')
})

test('眼鏡から送った発言には印が付き、家の発言・印の無い古い応答・未知の値には付かない (BOXP-657)', () => {
  const data = validateTranscript({
    rev: 'r',
    sessionStartedAt: 1,
    items: [
      {
        requestId: 'home-1',
        at: 1,
        current: true,
        origin: 'home',
        status: 'done',
        text: '家',
        reply: { text: 'a', at: 2 },
      },
      {
        requestId: 'g2-1',
        at: 3,
        current: true,
        origin: 'g2',
        via: 'text',
        status: 'done',
        text: '眼鏡',
        reply: { text: 'b', at: 4 },
      },
      { requestId: 'old-1', at: 5, current: true, status: 'done', text: '古い', reply: { text: 'c', at: 6 } },
      {
        requestId: 'odd-1',
        at: 7,
        current: true,
        origin: 'other',
        status: 'done',
        text: '未知',
        reply: { text: 'd', at: 8 },
      },
    ],
    active: null,
  })
  if (!data || 'unchanged' in data) throw new Error('検証失敗')
  const users = planSync(data.items, data.active, { seen: new Seen(), trackingId: '', canFollow: true }).filter(
    (x) => x.op === 'user',
  )
  expect(users).toEqual([
    { op: 'user', id: 'home-1', text: '家', at: 1 },
    { op: 'user', id: 'g2-1', text: '眼鏡', at: 3, g2: true },
    { op: 'user', id: 'old-1', text: '古い', at: 5 },
    { op: 'user', id: 'odd-1', text: '未知', at: 7 },
  ])
})
