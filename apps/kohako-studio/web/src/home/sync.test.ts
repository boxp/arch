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

test('同じ履歴を 2 回流しても 2 回目は何も足さない', () => {
  const seen = new Seen(),
    items = [item('a'), item('b')]
  expect(planSync(items, null, ctx(seen)).map((x) => [x.op, 'id' in x ? x.id : ''])).toEqual([
    ['user', 'a'],
    ['reply', 'a'],
    ['user', 'b'],
    ['reply', 'b'],
  ])
  expect(planSync(items, null, ctx(seen))).toEqual([])
})

test('この端末が既に出した発言・返答は足さない', () => {
  const seen = new Seen()
  seen.markUser('a')
  seen.markReply('a')
  expect(planSync([item('a')], null, ctx(seen))).toEqual([])
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
