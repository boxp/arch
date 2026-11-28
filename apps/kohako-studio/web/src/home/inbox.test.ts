import { describe, expect, it } from 'vitest'
import {
  sourceLabel,
  formatReceived,
  notificationParam,
  replyText,
  stateLabel,
  canVisitNotification,
  noticeChoiceValues,
  noticeChoices,
} from './inbox'
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
  it('警告通知だけに現場への入口を表示する', () => {
    expect(canVisitNotification({ source: 'alertmanager' })).toBe(true)
    expect(canVisitNotification({ source: 'hermes-cron' })).toBe(false)
    expect(
      canVisitNotification({
        source: 'alertmanager',
        reply: { replyId: 'a', requestId: 'b', kind: 'text', value: '見てきて', status: 'submitted' },
      }),
    ).toBe(false)
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
describe('通知の選択肢ボタン（BOXP-646）', () => {
  it('送る値は記号のまま、表示に本文の説明を添える', () => {
    expect(noticeChoices({ choices: ['A', 'B'], body: '**A：実装へ進む／B：あとで決める**' })).toEqual([
      { value: 'A', text: 'A：実装へ進む' },
      { value: 'B', text: 'B：あとで決める' },
    ])
    // 本文に説明が見つからない古い選択肢はそのまま
    expect(noticeChoices({ choices: ['はい'], body: '本文' })).toEqual([{ value: 'はい', text: 'はい' }])
    expect(noticeChoices({ body: 'A) x\nB) y' })).toEqual([])
  })
})
describe('送信直前の選択肢確認（BOXP-658）', () => {
  it('明示の choices が無ければ BFF と同じく本文から抽出した選択肢を有効とする', () => {
    expect(noticeChoiceValues({ body: 'A) 進める\nB) やめる' })).toEqual(['A', 'B'])
    expect(noticeChoiceValues({ choices: ['はい'], body: 'A) 進める\nB) やめる' })).toEqual(['はい'])
    expect(noticeChoiceValues({ body: '本文' })).toEqual([])
  })
})

describe('通知からのジャンプを一度だけ行う（BOXP-772）', () => {
  it('URL から notification だけを外し、他のパラメータの表記と順序を保つ', async () => {
    const { withoutNotificationParam } = await import('./inbox')
    expect(withoutNotificationParam('?notification=event-123456')).toBe('')
    expect(withoutNotificationParam('?acting=0&notification=event-123456&face=static')).toBe('?acting=0&face=static')
    expect(withoutNotificationParam('?q=a%20b&notification=x&notification=y&z=c+d')).toBe('?q=a%20b&z=c+d')
    expect(withoutNotificationParam('?notificationx=1&a=2')).toBeNull()
    expect(withoutNotificationParam('')).toBeNull()
  })

  type Item = { eventId: string; source: string; title: string; body: string; receivedAt: string }
  const setup = async (
    search: string,
    items: Item[],
    failFirst = 0,
    failAnnounce = 0,
    /** 先頭から順に、該当する送信へ 1 度ずつ返す失敗（'throw' は通信失敗、数値は JSON 付きの HTTP 状態） */
    faults: { suffix: string; result: 'throw' | number; skip?: number }[] = [],
  ) => {
    const { initInbox } = await import('./inbox'),
      { vi } = await import('vitest')
    const els: Record<string, { hidden: boolean }> = {},
      // 描画の細部は検査しないので、未定義のプロパティは何でも受ける要素で代用する
      el = (): { hidden: boolean } => {
        const props: Record<string | symbol, unknown> = {
          hidden: true,
          textContent: '',
          value: '',
          dataset: {},
          style: {},
        }
        return new Proxy(props, {
          get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : k === 'querySelector' ? () => null : () => el()),
          set: (t, k, v) => {
            t[k] = v
            return true
          },
        }) as unknown as { hidden: boolean }
      }
    const calls: string[] = [],
      urls: string[] = [],
      handlers: Record<string, () => void> = {},
      sw: { listener?: (e: { data: unknown }) => void } = {},
      ticks: (() => void)[] = [],
      holds: { suffix: string; gate: Promise<void> }[] = []
    let failures = failFirst
    let announceFailures = failAnnounce
    const loc = { search, pathname: '/kohako/home.html', hash: '#x' }
    vi.stubGlobal('document', {
      hidden: false,
      getElementById: (id: string) => (els[id] ??= el()),
      addEventListener: (type: string, fn: () => void) => {
        handlers[type] = fn
      },
      createElement: () => el(),
      createDocumentFragment: () => el(),
      createTextNode: () => el(),
    })
    vi.stubGlobal('location', loc)
    vi.stubGlobal('history', {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        urls.push(url)
        loc.search = url.slice(loc.pathname.length).replace(/#.*$/, '')
      },
    })
    vi.stubGlobal('navigator', {
      serviceWorker: { addEventListener: (_t: string, fn: (e: { data: unknown }) => void) => (sw.listener = fn) },
    })
    vi.stubGlobal('window', {
      setTimeout: () => 0,
      setInterval: (fn: () => void) => {
        ticks.push(fn)
        return 0
      },
    })
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      const path = url.replace('/kohako/api/v1/', '')
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      const held = holds.findIndex((h) => path.endsWith(h.suffix))
      if (held >= 0) await holds.splice(held, 1)[0].gate
      if (path === 'notifications' && failures > 0) {
        failures--
        throw new Error('offline')
      }
      if (path.endsWith('/announced') && announceFailures > 0) {
        announceFailures--
        throw new Error('offline')
      }
      const fault = faults.findIndex((f) => path.endsWith(f.suffix))
      const f0 = fault >= 0 ? faults[fault] : undefined
      if (f0?.skip) f0.skip--
      else if (fault >= 0) {
        const [{ result }] = faults.splice(fault, 1)
        if (result === 'throw') throw new Error('offline')
        return { status: result, json: async () => ({ error: 'internal' }) }
      }
      return { status: 200, json: async () => (path === 'notifications' ? { items, unread: 0 } : {}) }
    })
    initInbox(() => false)
    const settle = () => new Promise((r) => setTimeout(r, 100))
    const resume = async () => {
      handlers.visibilitychange()
      await settle()
    }
    await settle()
    /** 該当する次の送信 1 回を、返した関数を呼ぶまで止める */
    const hold = (suffix: string) => {
      let release = () => {}
      holds.push({ suffix, gate: new Promise<void>((r) => (release = r)) })
      return () => release()
    }
    return {
      calls,
      urls,
      els,
      resume,
      sw,
      settle,
      loc,
      vi,
      hold,
      addFault: (f: (typeof faults)[number]) => faults.push(f),
    }
  }
  const item = (id: string): Item => ({
    eventId: id,
    source: 'task-board-report',
    title: id,
    body: '本文',
    receivedAt: new Date(Date.now() - 60_000).toISOString(),
  })
  const reads = (calls: string[], id: string) => calls.filter((c) => c === `POST notifications/${id}/read`).length

  it('URL の通知を 1 度だけ開き、notification だけを履歴を増やさず外す', async () => {
    const t = await setup('?acting=0&notification=event-AAAAAA&face=static', [item('event-AAAAAA')])
    try {
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
      expect(t.els.inbox.hidden).toBe(false)
      expect(t.urls).toEqual(['/kohako/home.html?acting=0&face=static#x'])
    } finally {
      t.vi.unstubAllGlobals()
    }
  })

  it('表示へ戻っても開いた通知を開き直さない', async () => {
    const t = await setup('?notification=event-AAAAAA', [item('event-AAAAAA')])
    try {
      t.els.inbox.hidden = true // 本人が受信箱を閉じた
      await t.resume()
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
      expect(t.els.inbox.hidden).toBe(true)
      expect(t.calls.filter((c) => c === 'GET notifications').length).toBeGreaterThanOrEqual(3)
    } finally {
      t.vi.unstubAllGlobals()
    }
  })

  it('一覧取得に失敗したら消費せず URL も残し、次に取得できた時に 1 度だけ開く', async () => {
    const t = await setup('?notification=event-AAAAAA', [item('event-AAAAAA')], 1)
    try {
      expect(reads(t.calls, 'event-AAAAAA')).toBe(0)
      expect(t.urls).toEqual([])
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
      expect(t.urls).toEqual(['/kohako/home.html#x'])
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
    } finally {
      t.vi.unstubAllGlobals()
    }
  })

  it('一覧に無い通知は開かず URL から外す。不正な ID は読み込み時に外す', async () => {
    const t = await setup('?notification=event-GONE00', [item('event-AAAAAA')])
    try {
      expect(t.calls.some((c) => c.endsWith('/read'))).toBe(false)
      expect(t.urls).toEqual(['/kohako/home.html#x'])
    } finally {
      t.vi.unstubAllGlobals()
    }
    const bad = await setup('?a=1&notification=../bad', [item('event-AAAAAA')])
    try {
      expect(bad.calls.some((c) => c.endsWith('/read'))).toBe(false)
      expect(bad.urls).toEqual(['/kohako/home.html?a=1#x'])
    } finally {
      bad.vi.unstubAllGlobals()
    }
  })

  it('一覧は取れたが通知を開く途中で通信失敗したら消費せず URL も残し、次に取得できた時に開いてから外す', async () => {
    const t = await setup('?a=1&notification=event-AAAAAA', [item('event-AAAAAA')], 0, 1)
    try {
      expect(t.calls.filter((c) => c === 'POST notifications/event-AAAAAA/announced').length).toBe(1)
      expect(reads(t.calls, 'event-AAAAAA')).toBe(0)
      expect(t.urls).toEqual([])
      expect(t.loc.search).toBe('?a=1&notification=event-AAAAAA')
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
      expect(t.urls).toEqual(['/kohako/home.html?a=1#x'])
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(1)
    } finally {
      t.vi.unstubAllGlobals()
    }
  })
  it.each([
    ['案内済みの送信が JSON 付きの HTTP 500', { suffix: '/announced', result: 500 }],
    ['既読の送信が通信失敗', { suffix: '/read', result: 'throw' }],
    ['既読の送信が JSON 付きの HTTP 500', { suffix: '/read', result: 500 }],
  ] as const)('%sなら受信箱を開かず消費せず URL も残し、次に取得できた時に開いてから外す', async (_name, fault) => {
    const t = await setup('?a=1&notification=event-AAAAAA', [item('event-AAAAAA')], 0, 0, [{ ...fault }])
    try {
      expect(t.els.inbox.hidden).toBe(true)
      expect(t.urls).toEqual([])
      expect(t.loc.search).toBe('?a=1&notification=event-AAAAAA')
      await t.resume()
      expect(t.els.inbox.hidden).toBe(false)
      expect(t.urls).toEqual(['/kohako/home.html?a=1#x'])
      const before = reads(t.calls, 'event-AAAAAA')
      t.els.inbox.hidden = true // 本人が受信箱を閉じた
      await t.resume()
      expect(reads(t.calls, 'event-AAAAAA')).toBe(before)
      expect(t.els.inbox.hidden).toBe(true)
    } finally {
      t.vi.unstubAllGlobals()
    }
  })
  // 開く手順（案内済み→既読→一覧の再取得）のどの段の失敗でも、URL と SW のどちらの入口でも同じ扱いにする（BOXP-772）
  const openFaults = [
    ['案内済みの送信が JSON 付きの HTTP 500', { suffix: '/announced', result: 500 }],
    ['既読の送信が通信失敗', { suffix: '/read', result: 'throw' }],
    ['既読の送信が JSON 付きの HTTP 500', { suffix: '/read', result: 500 }],
    ['既読後の一覧の再取得が通信失敗', { suffix: 'notifications', result: 'throw', skip: 1 }],
  ] as const
  it.each(openFaults)(
    '開いたままの家への SW 通知で%sなら受信箱を開かず保留し、次の取得で 1 度だけ開く',
    async (_name, fault) => {
      const t = await setup('', [item('event-AAAAAA'), item('event-BBBBBB')])
      try {
        t.calls.length = 0
        // 初回の一覧取得が済んだ後に入れるので、skip は SW 通知以降の取得から数える
        t.addFault({ ...fault })
        t.sw.listener?.({ data: { type: 'open-notification', eventId: 'event-BBBBBB' } })
        await t.settle()
        expect(t.els.inbox.hidden).toBe(true)
        await t.resume()
        expect(t.els.inbox.hidden).toBe(false)
        const before = reads(t.calls, 'event-BBBBBB')
        t.els.inbox.hidden = true // 本人が受信箱を閉じた
        await t.resume()
        expect(reads(t.calls, 'event-BBBBBB')).toBe(before)
        expect(t.els.inbox.hidden).toBe(true)
        expect(t.urls).toEqual([])
      } finally {
        t.vi.unstubAllGlobals()
      }
    },
  )
  it('URL のジャンプで既読後の一覧の再取得が失敗したら受信箱を開かず URL も残し、次の取得で開いてから外す', async () => {
    const t = await setup('?a=1&notification=event-AAAAAA', [item('event-AAAAAA')], 0, 0, [
      { suffix: 'notifications', result: 'throw', skip: 1 },
    ])
    try {
      expect(t.els.inbox.hidden).toBe(true)
      expect(t.loc.search).toBe('?a=1&notification=event-AAAAAA')
      await t.resume()
      expect(t.els.inbox.hidden).toBe(false)
      expect(t.urls).toEqual(['/kohako/home.html?a=1#x'])
    } finally {
      t.vi.unstubAllGlobals()
    }
  })
  // 開く手順の実行中に届いた要求は捨てず、実行中の手順が成功しても失敗しても続けて処理する（BOXP-772）
  it.each([
    ['失敗', 500],
    ['成功', 200],
  ] as const)(
    '通知 A を開く途中で通知 B の SW 通知が届き A が%sしたら、表示復帰を待たずに B を開く',
    async (_name, status) => {
      const t = await setup('', [item('event-AAAAAA'), item('event-BBBBBB')])
      try {
        const release = t.hold('event-AAAAAA/announced')
        if (status !== 200) t.addFault({ suffix: 'event-AAAAAA/announced', result: status })
        t.sw.listener?.({ data: { type: 'open-notification', eventId: 'event-AAAAAA' } })
        await t.settle()
        t.sw.listener?.({ data: { type: 'open-notification', eventId: 'event-BBBBBB' } })
        await t.settle()
        expect(reads(t.calls, 'event-BBBBBB')).toBe(0)
        release()
        await t.settle()
        expect(reads(t.calls, 'event-BBBBBB')).toBe(1)
        expect(t.els.inbox.hidden).toBe(false)
        t.els.inbox.hidden = true
        await t.resume()
        expect(reads(t.calls, 'event-BBBBBB')).toBe(1)
        expect(reads(t.calls, 'event-AAAAAA')).toBe(status === 200 ? 1 : 0) // A は成功した時だけ既読になり、B の後に開き直さない
        expect(t.els.inbox.hidden).toBe(true)
      } finally {
        t.vi.unstubAllGlobals()
      }
    },
  )
  it('開いたままの家で別の通知を押すと URL を変えずにその通知を開き、表示復帰で開き直さない', async () => {
    const t = await setup('', [item('event-AAAAAA'), item('event-BBBBBB')])
    try {
      t.sw.listener?.({ data: { type: 'open-notification', eventId: 'event-BBBBBB' } })
      await t.settle()
      expect(reads(t.calls, 'event-BBBBBB')).toBe(1)
      t.sw.listener?.({ data: { type: 'open-notification', eventId: 'event-BBBBBB' } })
      await t.settle()
      expect(reads(t.calls, 'event-BBBBBB')).toBe(2) // 押すたびに開く
      t.els.inbox.hidden = true
      await t.resume()
      expect(reads(t.calls, 'event-BBBBBB')).toBe(2)
      expect(t.els.inbox.hidden).toBe(true)
      expect(t.urls).toEqual([])
    } finally {
      t.vi.unstubAllGlobals()
    }
  })
})

it('初回取得に失敗しても、表示したままの定期更新で取得できた時に 1 度だけ開く（BOXP-772）', async () => {
  // 上の describe の setup は閉じているため、同じ条件を最小限で組み直す
  const { initInbox } = await import('./inbox'),
    { vi } = await import('vitest')
  const el = (): { hidden: boolean } =>
    new Proxy(
      { hidden: true, textContent: '', value: '', dataset: {}, style: {} } as Record<string | symbol, unknown>,
      {
        get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : k === 'querySelector' ? () => null : () => el()),
        set: (t, k, v) => {
          t[k] = v
          return true
        },
      },
    ) as unknown as { hidden: boolean }
  const els: Record<string, { hidden: boolean }> = {},
    calls: string[] = [],
    urls: string[] = [],
    ticks: (() => void)[] = []
  let failures = 1
  const loc = { search: '?notification=event-AAAAAA', pathname: '/kohako/home.html', hash: '' }
  vi.stubGlobal('document', {
    hidden: false,
    getElementById: (id: string) => (els[id] ??= el()),
    addEventListener() {},
    createElement: () => el(),
    createDocumentFragment: () => el(),
    createTextNode: () => el(),
  })
  vi.stubGlobal('location', loc)
  vi.stubGlobal('history', { state: null, replaceState: (_s: unknown, _t: string, url: string) => urls.push(url) })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('window', {
    setTimeout: () => 0,
    setInterval: (fn: () => void) => {
      ticks.push(fn)
      return 0
    },
  })
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const path = url.replace('/kohako/api/v1/', '')
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === 'notifications' && failures-- > 0) return { status: 502, json: async () => ({}) }
    const items = [
      { eventId: 'event-AAAAAA', source: 't', title: 'A', body: 'b', receivedAt: new Date().toISOString() },
    ]
    return { status: 200, json: async () => (path === 'notifications' ? { items, unread: 0 } : {}) }
  })
  const settle = () => new Promise((r) => setTimeout(r, 100))
  try {
    initInbox(() => false)
    await settle()
    expect(calls).not.toContain('POST notifications/event-AAAAAA/read')
    expect(urls).toEqual([])
    ticks[0]()
    await settle()
    expect(calls.filter((c) => c === 'POST notifications/event-AAAAAA/read')).toHaveLength(1)
    expect(urls).toEqual(['/kohako/home.html'])
    ticks[0]()
    await settle()
    expect(calls.filter((c) => c === 'POST notifications/event-AAAAAA/read')).toHaveLength(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
