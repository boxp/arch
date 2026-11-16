import { describe, expect, it } from 'vitest'
import { sourceLabel, formatReceived, notificationParam, replyText, stateLabel } from './inbox'
describe('受信箱の表示', () => {
  it('定期通知の送信元を表示する', () => {
    expect(sourceLabel('hermes-cron')).toBe('定期通知')
    expect(sourceLabel('task-board-report')).toBe('Task Board')
    expect(sourceLabel('alertmanager')).toBe('アラート')
  })
  it('状態と経過時間を表示する', () => {
    expect(stateLabel({})).toBe('未読')
    expect(stateLabel({ readAt: 'x' })).toBe('既読')
    expect(stateLabel({ handledAt: 'x' })).toBe('処理済み')
    expect(formatReceived('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:05:00Z'))).toContain('5分前')
  })
  it('通知 ID を検証する', () => {
    expect(notificationParam('?notification=event-123456')).toBe('event-123456')
    expect(notificationParam('?notification=../bad')).toBeNull()
  })
  it('返信を会話履歴用の文にする', () => {
    expect(replyText({ title: '完了', ticketId: 'BOXP-1' }, 'choice', 'A')).toBe('通知「完了」（BOXP-1）への選択: A')
    expect(replyText({ title: '完了' }, 'text', 'ok')).toBe('通知「完了」への返信: ok')
  })
})

it('案内候補を状態と24時間で絞り、古い順またはまとめて選ぶ', async () => {
  const { pickAnnouncements } = await import('./inbox'),
    now = Date.parse('2026-01-02T00:00:00Z')
  const item = (n: number) => ({
    eventId: `event-${n}`,
    source: 'test',
    title: '題',
    body: '本文',
    receivedAt: new Date(now - n * 3600_000).toISOString(),
  })
  const excluded = [
    { ...item(1), readAt: 'x' },
    { ...item(2), handledAt: 'x' },
    { ...item(3), announcedAt: 'x' },
    { ...item(4), reply: { replyId: 'x', kind: 'text' as const, value: 'x', requestId: 'x', status: 'submitted' } },
    item(25),
  ]
  expect(pickAnnouncements(excluded, now).item).toBeUndefined()
  expect(pickAnnouncements([item(1), item(3), item(2), ...excluded], now)).toEqual({ item: item(3), more: 0 })
  expect(pickAnnouncements([item(1), item(4), item(2), item(3)], now)).toEqual({ item: item(1), more: 3 })
})

it('吹き出しを表示した後にだけ案内済みを保存し、表示前に止まれば再案内できる', async () => {
  const { initInbox } = await import('./inbox'),
    { vi } = await import('vitest')
  const els: Record<string, ReturnType<typeof el>> = {},
    el = () => ({ hidden: false, textContent: '', replaceChildren() {}, append() {}, addEventListener() {} })
  const items = [
    {
      eventId: 'event-123456',
      source: 'task-board-report',
      title: '題',
      body: '本文',
      receivedAt: new Date(Date.now() - 60_000).toISOString(),
    },
  ]
  const calls: string[] = [],
    answers: boolean[] = []
  vi.stubGlobal('document', {
    hidden: false,
    getElementById: (id: string) => (els[id] ??= el()),
    addEventListener() {},
    createElement: () => el(),
  })
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('window', { setTimeout: () => 0, setInterval: () => 0 })
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const path = url.replace('/kohako/api/v1/', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const data =
      path === 'notifications'
        ? { items, unread: 1 }
        : path.endsWith('/announcing')
          ? { claimed: true }
          : { announced: true }
    return { status: 200, json: async () => data }
  })
  try {
    // 最初の一覧更新では案内しない
    const inbox = initInbox(() => false, {
      canAnnounce: () => answers.shift() ?? false,
      announce: () => {
        calls.push('SHOW')
      },
    })
    await vi.waitFor(() => expect(calls).toContain('GET notifications'))
    // 仮押さえ後に案内できなくなった（会話開始・ページ非表示など）: 表示せず、案内済みも保存しない
    await new Promise((r) => setTimeout(r, 10))
    answers.push(true, false)
    inbox.retry()
    await vi.waitFor(() => expect(calls).toContain('POST notifications/event-123456/announcing'))
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).not.toContain('SHOW')
    expect(calls).not.toContain('POST notifications/event-123456/announced')
    // 次の機会に表示し、その後で案内済みを保存する
    answers.push(true, true)
    inbox.retry()
    await vi.waitFor(() => expect(calls).toContain('POST notifications/event-123456/announced'))
    expect(calls.indexOf('SHOW')).toBeLessThan(calls.indexOf('POST notifications/event-123456/announced'))
  } finally {
    vi.unstubAllGlobals()
  }
})

it('まとめて案内する時は対象全件を仮押さえし、他タブが押さえた通知は案内・保存しない', async () => {
  const { initInbox } = await import('./inbox'),
    { vi } = await import('vitest')
  const els: Record<string, ReturnType<typeof el>> = {},
    el = () => ({ hidden: false, textContent: '', replaceChildren() {}, append() {}, addEventListener() {} })
  const items = [1, 2, 3, 4, 5].map((n) => ({
    eventId: `event-00000${n}`,
    source: 'task-board-report',
    title: `題${n}`,
    body: '本文',
    receivedAt: new Date(Date.now() - n * 60_000).toISOString(),
  }))
  const otherTab = new Set(['event-000002', 'event-000004']) // 他タブが既に仮押さえ済み
  const calls: string[] = [],
    shown: { id: string; more: number }[] = [],
    answers: boolean[] = []
  vi.stubGlobal('document', {
    hidden: false,
    getElementById: (id: string) => (els[id] ??= el()),
    addEventListener() {},
    createElement: () => el(),
  })
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('window', { setTimeout: () => 0, setInterval: () => 0 })
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const path = url.replace('/kohako/api/v1/', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const id = path.split('/')[1]
    const data =
      path === 'notifications'
        ? { items, unread: 5 }
        : path.endsWith('/announcing')
          ? { claimed: !otherTab.has(id) }
          : { announced: true }
    return { status: 200, json: async () => data }
  })
  try {
    const inbox = initInbox(() => false, {
      canAnnounce: () => answers.shift() ?? false,
      announce: (item, _a, more) => {
        shown.push({ id: item.eventId, more })
      },
    })
    await vi.waitFor(() => expect(calls).toContain('GET notifications'))
    await new Promise((r) => setTimeout(r, 10))
    answers.push(true, true)
    inbox.retry()
    await vi.waitFor(() => expect(calls.filter((c) => c.endsWith('/announced'))).toHaveLength(3))
    for (const n of [1, 2, 3, 4, 5]) expect(calls).toContain(`POST notifications/event-00000${n}/announcing`)
    expect(shown).toEqual([{ id: 'event-000001', more: 2 }])
    for (const id of otherTab) expect(calls).not.toContain(`POST notifications/${id}/announced`)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('通知ごとに下書きを保持し、送信成功後に対象だけ破棄する', async () => {
  const { ReplyDrafts } = await import('./inbox'),
    drafts = new ReplyDrafts()
  drafts.set('A', '日本語の返信')
  expect(drafts.get('A')).toBe('日本語の返信')
  expect(drafts.get('B')).toBe('')
  drafts.set('B', '別の返信')
  expect(drafts.get('A')).toBe('日本語の返信')
  drafts.clear('A')
  expect(drafts.get('A')).toBe('')
  expect(drafts.get('B')).toBe('別の返信')
})

it('詳細キーは内容の変化を検出し、既読・処理済み・受信時刻を無視する', async () => {
  const { detailKey } = await import('./inbox')
  const item = { eventId: 'event-1', title: '題', body: '本文', source: 'test', receivedAt: 'now' }
  const key = detailKey(item)
  expect(detailKey({ ...item, readAt: 'x', handledAt: 'x', receivedAt: 'later' })).toBe(key)
  for (const change of [
    { eventId: 'event-2' },
    { title: '別' },
    { body: '別' },
    { source: '別' },
    { ticketId: 'BOXP-1' },
    { choices: ['選択'] },
    { reply: { replyId: 'r', kind: 'text' as const, value: 'v', requestId: 'q', status: 'submitted' } },
  ])
    expect(detailKey({ ...item, ...change })).not.toBe(key)
})
