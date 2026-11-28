import { expect, it } from 'vitest'
import { createStatus, parseBoard, parseQuota } from './status.js'
const now = 1794381474000
const metrics = `# HELP x test
ai_subscription_source_up{provider="claude"} 1
ai_subscription_generated_timestamp_seconds 1794381474
ai_subscription_window_present{provider="claude",limit="five_hour",name="shared_5h"} 0
ai_subscription_window_present{provider="claude",limit="seven_day",name="shared_7d"} 1
ai_subscription_window_used_percent{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 67
ai_subscription_window_observed_timestamp_seconds{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 1794380285
ai_subscription_window_resets_at_seconds{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 1794614400
ai_subscription_window_used_percent{provider="codex",limit="primary",name="primary",window="7d"} 59
ai_subscription_window_status{provider="codex",limit="primary",name="primary",window="7d",status="allowed"} 1
other_metric 123`
const board = (items: object[], truncated = false) => ({
  schema: 'kohako-board/v1',
  generatedAt: new Date(now).toISOString(),
  boardUpdatedAt: new Date(now).toISOString(),
  total: items.length,
  limit: 30,
  truncated,
  items,
})
it('parses real exposition, absent present series, and fixed pools', () => {
  const q = parseQuota(metrics, now)
  expect(q.pools.map((p) => p.id)).toEqual([
    'claude_shared',
    'claude_fable',
    'claude_opus',
    'codex_shared',
    'antigravity_gemini',
    'antigravity_claude_gpt',
    'antigravity_argon',
    'localllm',
  ])
  expect(q.pools[0].windows[0].state).toBe('not_provided')
  expect(q.pools[0].windows[0].usedPercent).toBeNull()
  expect(q.pools[0].windows[1]).toMatchObject({ state: 'ok', usedPercent: 67 })
  expect(q.pools[3].windows[0]).toMatchObject({ state: 'freshness_unknown', usedPercent: 59, observedAt: null })
})
it('classifies stale, expired, rejected and ignores invalid enum labels', () => {
  const w = (suffix: string, at = now) => parseQuota(`${metrics}\n${suffix}`, at).pools[3].windows[0]
  expect(w('', now + 90000000).state).toBe('freshness_unknown') // no observation timestamp: never shown as ok
  expect(
    w(
      'ai_subscription_window_observed_timestamp_seconds{provider="codex",limit="primary",name="primary",window="7d"} 1794000000',
    ).state,
  ).toBe('stale')
  expect(w('ai_subscription_window_expired{provider="codex",limit="primary",name="primary",window="7d"} 1').state).toBe(
    'expired',
  )
  expect(
    w('ai_subscription_window_status{provider="codex",limit="primary",name="primary",window="7d",status="rejected"} 1')
      .state,
  ).toBe('freshness_unknown') // first active status is allowed, but observation time is missing
  expect(parseQuota(metrics.replace('status="allowed"', 'status="rejected"'), now).pools[3].windows[0].state).toBe(
    'exhausted',
  )
  expect(
    parseQuota(metrics.replace('window="7d"} 59', 'window="bad"} 59'), now).pools[3].windows[0].usedPercent,
  ).toBeNull()
})
it('deduplicates lane IDs, conflicts, mismatch and truncated lower bounds', () => {
  const item = (id: string, assignee: string, lane = 'In Progress', laneStatusMismatch = false) => ({
    id,
    assignee,
    lane,
    laneStatusMismatch,
  })
  const r = parseBoard(
    board(
      [
        item('BOXP-1', 'a'),
        item('BOXP-1', 'b', 'In Progress', true),
        item('BOXP-2', 'a'),
        item('BOXP-3', 'x', 'Ready'),
        item('BOXP-4', 'x', 'Blocked'),
        item('bad', 'x'),
      ],
      true,
    ),
    now,
  )
  expect(r.inProgress).toEqual({
    total: 2,
    complete: true,
    byAgent: [
      { agent: 'a', count: 1 },
      { agent: 'unknown', count: 1 },
    ],
    conflicts: ['BOXP-1'],
    laneStatusMismatch: 1,
  })
  expect(r.inProgress.total).toBe(r.inProgress.byAgent.reduce((n, x) => n + x.count, 0))
  expect(parseBoard(board([item('BOXP-1', 'a')], true), now).inProgress.complete).toBe(false)
  expect(() => parseBoard({ schema: 'bad' }, now)).toThrow()
})
it('caches independently, shares in-flight requests and retries failures after 15 seconds', async () => {
  let clock = now,
    calls = 0
  const fetcher = (async (url: string | URL | Request) => {
    calls++
    await Promise.resolve()
    return String(url) === 'quota' ? new Response('bad') : new Response(JSON.stringify(board([])))
  }) as typeof fetch
  const status = createStatus({ fetch: fetcher, now: () => clock, quotaUrl: 'quota', boardUrl: 'board' })
  const [a, b] = await Promise.all([status.get(), status.get()])
  expect(calls).toBe(2)
  expect(a).toEqual(b)
  expect(a.quota.state).toBe('unavailable')
  expect(a.quota.pools[0].windows[0]).toMatchObject({ state: 'unavailable', usedPercent: null })
  expect(a.tasks.state).toBe('ok')
  clock += 15001
  await status.get()
  expect(calls).toBe(3)
  clock += 45000
  await status.get()
  expect(calls).toBe(5)
})
it('treats a missing subscription file and a failed board as unknown, not 0', async () => {
  expect(() =>
    parseQuota('ai_subscription_metrics_file_present 0\nai_subscription_metrics_file_age_seconds -1', now),
  ).toThrow()
  const fetcher = (async () => new Response('down', { status: 503 })) as typeof fetch
  const s = await createStatus({ fetch: fetcher, now: () => now, quotaUrl: 'quota', boardUrl: 'board' }).get()
  expect(s.tasks.state).toBe('unavailable')
  expect(s.tasks.inProgress.total).toBeNull()
  expect(
    s.quota.pools.flatMap((p) => p.windows).every((w) => w.usedPercent === null && w.state === 'unavailable'),
  ).toBe(true)
})

// BOXP-613: kill-matrix で以下が観測されていなかった（変異が生存）。値の境界・入力検証・取得の失敗時の形を固定する。
const win = (metric: string, labels: string, value: number | string) =>
  `ai_subscription_window_${metric}{provider="codex",limit="primary",name="primary",window="7d"${labels}} ${value}`
const codex = (lines: string[], at = now) =>
  parseQuota(['ai_subscription_source_up{provider="codex"} 0', ...lines].join('\n'), at).pools[3].windows[0]
const sec = now / 1000
it('プールの定義（対象の担当・窓・提供状態）を固定の一覧として返す', () => {
  expect(
    parseQuota(metrics, now).pools.map(({ id, label, agents, windows, state, note }) => ({
      id,
      label,
      agents,
      windows: windows.map((w) => [w.name, w.label]),
      state,
      note,
    })),
  ).toEqual([
    {
      id: 'claude_shared',
      label: 'Claude共有（Opus/Fable）',
      agents: ['claude-opus', 'claude-fable', 'fable'],
      windows: [
        ['shared_5h', '5時間'],
        ['shared_7d', '7日'],
      ],
      state: undefined,
      note: undefined,
    },
    {
      id: 'claude_fable',
      label: 'Fable専用上限',
      agents: ['claude-fable', 'fable'],
      windows: [['fable_7d', '7日']],
      state: undefined,
      note: 'Claude共有枠も同時に消費します',
    },
    {
      id: 'claude_opus',
      label: 'Opus専用',
      agents: ['claude-opus'],
      windows: [],
      state: 'not_provided',
      note: '期間別の利用率は提供されていません',
    },
    {
      id: 'codex_shared',
      label: 'Codex共有（codex/sol/astra）',
      agents: ['codex', 'codex-sol', 'codex-sol-xhigh', 'codex-astra'],
      windows: [['primary', '7日']],
      state: undefined,
      note: undefined,
    },
    {
      id: 'antigravity_gemini',
      label: 'Antigravity Gemini群',
      agents: ['antigravity'],
      windows: [
        ['gemini_5h', '5時間'],
        ['gemini_7d', '7日'],
      ],
      state: undefined,
      note: '群内のGeminiモデルで共有',
    },
    {
      id: 'antigravity_claude_gpt',
      label: 'Antigravity Claude/GPT群',
      agents: [],
      windows: [
        ['claude_gpt_5h', '5時間'],
        ['claude_gpt_7d', '7日'],
      ],
      state: undefined,
      note: 'Claude CLIの枠とは別',
    },
    {
      id: 'antigravity_argon',
      label: 'Antigravity Argon',
      agents: [],
      windows: [['argon_7d', '7日']],
      state: undefined,
      note: undefined,
    },
    {
      id: 'localllm',
      label: 'ローカルLLM',
      agents: ['localllm'],
      windows: [],
      state: 'not_applicable',
      note: undefined,
    },
  ])
})
it('観測値を ISO 時刻・取得元の稼働・ファイル経過秒とともに写す', () => {
  const q = parseQuota(
    [
      'ai_subscription_source_up{provider="claude"} 1',
      'ai_subscription_source_up{provider="codex"} 0',
      'ai_subscription_generated_timestamp_seconds 8640000000',
      'ai_subscription_metrics_file_age_seconds 12',
      win('used_percent', '', 42),
      win('resets_at_seconds', '', sec + 3600),
      win('observed_timestamp_seconds', '', sec - 60),
      win('status', ',status="allowed"', 1),
    ].join('\n'),
    now,
  )
  expect(q).toMatchObject({
    state: 'ok',
    fetchedAt: new Date(now).toISOString(),
    generatedAt: '2243-10-17T00:00:00.000Z',
    fileAgeSeconds: 12,
    sourceUp: { claude: true, codex: false },
  })
  expect(q.pools[3].windows[0]).toEqual({
    name: 'primary',
    label: '7日',
    state: 'ok',
    usedPercent: 42,
    resetsAt: new Date(now + 3600_000).toISOString(),
    observedAt: new Date(now - 60_000).toISOString(),
    status: 'allowed',
  })
  // 絶対値 8.64e9 秒（2243 年）を超える時刻・欠けた値は null（0 や現在時刻にしない）。
  const far = parseQuota('ai_subscription_generated_timestamp_seconds 8640000001', now)
  expect(far).toMatchObject({ generatedAt: null, fileAgeSeconds: null, sourceUp: { claude: null, codex: null } })
  expect(parseQuota('ai_subscription_generated_timestamp_seconds -8640000000', now).generatedAt).toBe(
    '1696-03-17T00:00:00.000Z',
  )
})
it('メトリクス行は字下げ・連続空白・時刻付きを受け、壊れた行は全体を拒否し、許可外のラベルの行だけ捨てる', () => {
  const used = (line: string) => codex([line]).usedPercent
  expect(used(`  ${win('used_percent', '', 10)}`)).toBe(10)
  expect(used(win('used_percent', '', '  11   1794381474'))).toBe(11)
  expect(used(win('used_percent', ' , foo="x"', 12))).toBeNull()
  expect(used(win('used_percent', ',1status="allowed"', 13))).toBeNull()
  expect(used(win('used_percent', ',status="allowed"x', 14))).toBeNull()
  expect(used(`ai_subscription_window_used_percent{ provider="codex" , limit="primary",name="primary" } 15`)).toBe(15)
  expect(() => codex([`${win('used_percent', '', 16)} #`])).toThrow()
  expect(() => codex([`${win('used_percent', '', 16)} x`])).toThrow()
  expect(() => parseQuota('# ai_subscription_x 1\nother 1', now)).toThrow()
})
it('窓の状態を期限・観測時刻・利用率・状態の境界で分類する', () => {
  const observed = (s: number) => win('observed_timestamp_seconds', '', s)
  const used = (v: number) => win('used_percent', '', v)
  expect(codex([win('present', '', 1)]).state).toBe('unobserved')
  expect(codex([win('status', ',status="allowed"', 1)]).state).toBe('freshness_unknown')
  expect(codex([observed(sec), win('status', ',status="allowed"', 1)]).state).toBe('unobserved')
  expect(codex([observed(sec), win('resets_at_seconds', '', sec), used(1)]).state).toBe('expired')
  expect(codex([observed(sec), win('resets_at_seconds', '', sec + 1), used(1)]).state).toBe('ok')
  expect(codex([observed(sec - 86400), used(1)]).state).toBe('ok')
  expect(codex([observed(sec - 86401), used(1)]).state).toBe('stale')
  expect(codex([observed(sec), used(90)]).state).toBe('near_limit')
  expect(codex([observed(sec), used(89.9)]).state).toBe('ok')
  expect(codex([observed(sec), used(10), win('status', ',status="allowed_warning"', 1)]).state).toBe('near_limit')
  // 状態は値が 1 の系列を採る。
  const both = [observed(sec), used(10), win('status', ',status="allowed"', 0), win('status', ',status="rejected"', 1)]
  expect(codex(both)).toMatchObject({ state: 'exhausted', status: 'rejected' })
  // 別の窓・別の名前の系列は混ぜない。
  expect(codex([used(10).replace('name="primary"', 'name="shared_7d"')]).state).toBe('unobserved')
})
it('ボードの必須フィールドと項目の型を検査する', () => {
  const ok = board([])
  expect(parseBoard(ok, now).state).toBe('ok')
  for (const bad of [
    null,
    [],
    'x',
    { ...ok, schema: 'kohako-board/v2' },
    { ...ok, generatedAt: 1 },
    { ...ok, generatedAt: 'x' },
    { ...ok, boardUpdatedAt: 1 },
    { ...ok, boardUpdatedAt: 'x' },
    { ...ok, total: 1.5 },
    { ...ok, limit: '30' },
    { ...ok, truncated: 'no' },
    { ...ok, items: {} },
    { ...ok, items: [null] },
    { ...ok, items: [[]] },
    { ...ok, items: [{ lane: 1 }] },
  ])
    expect(() => parseBoard(bad, now), JSON.stringify(bad)).toThrow()
})
it('進行中の項目の ID・担当・重複を正規化し、並びを固定する', () => {
  const item = (id: string, assignee: unknown, laneStatusMismatch = false) => ({
    id,
    assignee,
    lane: 'In Progress',
    laneStatusMismatch,
  })
  const r = parseBoard(
    board([
      item('BOXP-20', ' b '),
      item('BOXP-3', 'a'),
      item('BOXP-3', 'a'),
      item('BOXP-12', '  '),
      item('BOXP-11', 7),
      item('BOXP-5', 'c'),
      item('BOXP-5', 'd'),
      item('BOXP-4', 'c'),
      item('BOXP-4', 'e'),
      item('XBOXP-1', 'a'),
      item('BOXP-1x', 'a'),
      item('BOXP-7', 'z', true),
      item('BOXP-7', 'z'),
    ]),
    now,
  )
  expect(r.ids).toEqual(['BOXP-11', 'BOXP-12', 'BOXP-20', 'BOXP-3', 'BOXP-4', 'BOXP-5', 'BOXP-7'])
  expect(r.inProgress).toEqual({
    total: 7,
    complete: true,
    byAgent: [
      { agent: 'unknown', count: 4 },
      { agent: 'a', count: 1 },
      { agent: 'b', count: 1 },
      { agent: 'z', count: 1 },
    ],
    conflicts: ['BOXP-4', 'BOXP-5'],
    laneStatusMismatch: 1,
  })
  expect(r).toMatchObject({
    state: 'ok',
    fetchedAt: new Date(now).toISOString(),
    boardUpdatedAt: board([]).boardUpdatedAt,
  })
})
it('取得できない時は値の無い unavailable を返し、URL の無い取得・大きすぎる応答・リダイレクトを許さない', async () => {
  const seen: { url: string; init?: RequestInit }[] = []
  const body = JSON.stringify(board([]))
  const size = (n: number) => `${body}${' '.repeat(n - body.length)}`
  let boardBody = size(1048576)
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init })
    return new Response(boardBody)
  }) as typeof fetch
  let clock = now
  const status = createStatus({ fetch: fetcher, now: () => clock, quotaUrl: '', boardUrl: 'board' })
  const s = await status.get()
  expect(seen.map((x) => x.url)).toEqual(['board'])
  expect(seen[0].init).toMatchObject({ redirect: 'error' })
  expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal)
  expect(s).toMatchObject({ schema: 'kohako-home-status/v1', generatedAt: new Date(now).toISOString() })
  expect(s.tasks.state).toBe('ok')
  expect(s.quota).toEqual({
    state: 'unavailable',
    fetchedAt: new Date(now).toISOString(),
    generatedAt: null,
    fileAgeSeconds: null,
    sourceUp: { claude: null, codex: null, antigravity: null },
    pools: parseQuota(metrics, now).pools.map((p) => ({
      ...p,
      windows: p.windows.map((w) => ({
        ...w,
        state: 'unavailable',
        usedPercent: null,
        resetsAt: null,
        observedAt: null,
        status: null,
      })),
    })),
  })
  boardBody = size(1048577)
  clock += 60000
  const big = await status.get()
  expect(seen).toHaveLength(2)
  expect(big.tasks).toEqual({
    state: 'unavailable',
    fetchedAt: new Date(clock).toISOString(),
    boardUpdatedAt: null,
    inProgress: { total: null, complete: false, byAgent: [], conflicts: [], laneStatusMismatch: null },
    ids: [],
    dolls: [],
  })
})
it('成功は 60 秒、失敗は 15 秒ちょうどで期限切れにし、取得先ごとに数える', async () => {
  let clock = now
  const calls: string[] = []
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return String(url) === 'quota' ? new Response('bad') : new Response(JSON.stringify(board([])))
  }) as typeof fetch
  const status = createStatus({ fetch: fetcher, now: () => clock, quotaUrl: 'quota', boardUrl: 'board' })
  await status.get()
  clock = now + 14999
  await status.get()
  expect(calls.sort()).toEqual(['board', 'quota'])
  clock = now + 15000
  await status.get()
  expect(calls.filter((x) => x === 'quota')).toHaveLength(2)
  expect(calls.filter((x) => x === 'board')).toHaveLength(1)
  clock = now + 60000
  await status.get()
  expect(calls.filter((x) => x === 'board')).toHaveLength(2)
})
it('窓ごとの系列だけで状態を決め、Fable 専用窓と 5h 窓のラベルも受け付ける', () => {
  const observed = win('observed_timestamp_seconds', '', sec)
  // 他の窓の拒否状態を混ぜない。present=1 の系列が先にあっても状態系列を採る。
  const other =
    'ai_subscription_window_status{provider="claude",limit="seven_day",name="shared_7d",window="7d",status="rejected"} 1'
  expect(codex([other, observed, win('used_percent', '', 5)])).toMatchObject({ state: 'ok', status: null })
  expect(
    codex([win('present', '', 1), observed, win('used_percent', '', 5), win('status', ',status="rejected"', 1)]),
  ).toMatchObject({ state: 'exhausted', status: 'rejected' })
  // 観測時刻が無くても値があれば「鮮度不明」。
  expect(codex([win('used_percent', '', 5)]).state).toBe('freshness_unknown')
  const fable = parseQuota(
    [
      'ai_subscription_window_used_percent{provider="claude",limit="seven_day_overage_included",name="fable_7d",window="7d"} 33',
      'ai_subscription_window_used_percent{provider="claude",limit="five_hour",name="shared_5h",window="5h"} 44',
    ].join('\n'),
    now,
  ).pools
  expect(fable[1].windows[0].usedPercent).toBe(33)
  expect(fable[0].windows[0].usedPercent).toBe(44)
})
it('文字列でない ID の項目は数えない', () => {
  const r = parseBoard(board([{ id: ['BOXP-9'], assignee: 'a', lane: 'In Progress' }]), now)
  expect(r.ids).toEqual([])
  expect(r.inProgress.total).toBe(0)
})
it('同じ provider の別の窓の系列を混ぜない', () => {
  const q = parseQuota(
    'ai_subscription_window_status{provider="claude",limit="seven_day",name="shared_7d",window="7d",status="rejected"} 1',
    now,
  )
  expect(q.pools[0].windows.map((w) => [w.name, w.state, w.status])).toEqual([
    ['shared_5h', 'unobserved', null],
    ['shared_7d', 'exhausted', 'rejected'],
  ])
})
it('Antigravity の群ごとの枠を写し、残量 0 は上限到達、取得失敗は理由を添えて前回の観測を残す', () => {
  const sec = now / 1000
  const agy = (limit: string, name: string, window: string, rest: string) =>
    `ai_subscription_window_${rest.replace(/\{(.*)\}/, (_, extra) => `{provider="antigravity",limit="${limit}",name="${name}",window="${window}"${extra}}`)}`
  const base = [
    'ai_subscription_source_up{provider="antigravity"} 1',
    'ai_subscription_source_state{provider="antigravity",state="ok"} 1',
    'ai_subscription_window_present{provider="antigravity",limit="gemini_weekly",name="gemini_7d"} 1',
    'ai_subscription_window_present{provider="antigravity",limit="gemini_5h",name="gemini_5h"} 1',
    'ai_subscription_window_present{provider="antigravity",limit="gemini_argon_wtu_weekly",name="argon_7d"} 0',
    agy('gemini_weekly', 'gemini_7d', '7d', 'used_percent{} 25'),
    agy('gemini_weekly', 'gemini_7d', '7d', `resets_at_seconds{} ${sec + 3600}`),
    agy('gemini_weekly', 'gemini_7d', '7d', `observed_timestamp_seconds{} ${sec - 60}`),
    agy('gemini_5h', 'gemini_5h', '5h', 'used_percent{} 100'),
    agy('gemini_5h', 'gemini_5h', '5h', `observed_timestamp_seconds{} ${sec - 60}`),
    agy('gemini_5h', 'gemini_5h', '5h', 'status{,status="rejected"} 1'),
    agy('3p_weekly', 'claude_gpt_7d', '7d', `observed_timestamp_seconds{} ${sec - 60}`),
    agy('3p_weekly', 'claude_gpt_7d', '7d', `resets_at_seconds{} ${sec - 1}`),
    agy('3p_weekly', 'claude_gpt_7d', '7d', 'expired{} 1'),
  ]
  const q = parseQuota(base.join('\n'), now)
  const pool = (id: string) => q.pools.find((p) => p.id === id)
  expect(q.sourceUp).toMatchObject({ antigravity: true })
  expect(pool('antigravity_gemini')?.windows).toEqual([
    {
      name: 'gemini_5h',
      label: '5時間',
      state: 'exhausted',
      usedPercent: 100,
      resetsAt: null,
      observedAt: new Date(now - 60_000).toISOString(),
      status: 'rejected',
    },
    {
      name: 'gemini_7d',
      label: '7日',
      state: 'ok',
      usedPercent: 25,
      resetsAt: new Date(now + 3600_000).toISOString(),
      observedAt: new Date(now - 60_000).toISOString(),
      status: null,
    },
  ])
  expect(pool('antigravity_gemini')?.note).toBe('群内のGeminiモデルで共有')
  expect(pool('antigravity_claude_gpt')?.windows.map((w) => w.state)).toEqual(['unobserved', 'expired'])
  expect(pool('antigravity_argon')?.windows[0]).toMatchObject({ state: 'not_provided', usedPercent: null })
  // 最新の取得が失敗: 前回の値は残し、理由を pool に添える。理由が読めなければ「不明」。
  const failed = (state: string) =>
    parseQuota(
      base
        .map((l) =>
          l
            .replace('source_up{provider="antigravity"} 1', 'source_up{provider="antigravity"} 0')
            .replace('state="ok"', `state="${state}"`),
        )
        .join('\n'),
      now,
    )
  const f = failed('auth_required')
  expect(f.sourceUp).toMatchObject({ antigravity: false })
  expect(f.pools.find((p) => p.id === 'antigravity_gemini')).toMatchObject({
    note: '群内のGeminiモデルで共有・最新の取得: 未ログイン',
  })
  expect(f.pools.find((p) => p.id === 'antigravity_gemini')?.windows[1]).toMatchObject({ usedPercent: 25, state: 'ok' })
  expect(f.pools.find((p) => p.id === 'antigravity_argon')?.note).toBe('最新の取得: 未ログイン')
  expect(f.pools.find((p) => p.id === 'codex_shared')?.note).toBeUndefined()
  for (const [state, text] of [
    ['no_snapshot', '未観測'],
    ['parse_error', '集計データの読み取り失敗'],
    ['not_installed', 'CLI未導入'],
    ['timeout', 'CLI応答なし'],
    ['unsupported_auth', 'API鍵接続のため枠なし'],
    ['command_failed', 'CLI失敗'],
    ['invalid_output', '応答の読み取り失敗'],
  ])
    expect(failed(state).pools.find((p) => p.id === 'antigravity_argon')?.note).toBe(`最新の取得: ${text}`)
  expect(failed('something_else').pools.find((p) => p.id === 'antigravity_argon')?.note).toBe('最新の取得: 不明')
  // 系列が無い（古い exporter）なら注記しない。窓は不明のまま。
  const none = parseQuota('ai_subscription_generated_timestamp_seconds 1', now)
  expect(none.sourceUp).toMatchObject({ antigravity: null })
  expect(none.pools.find((p) => p.id === 'antigravity_argon')?.note).toBeUndefined()
  expect(none.pools.find((p) => p.id === 'antigravity_gemini')?.windows.map((w) => w.state)).toEqual([
    'unobserved',
    'unobserved',
  ])
})
// BOXP-766: 人形（現行仕様 Projects/kohako-home/model-dolls-home-spec.md）。
const full = (id: string, assignee: string, extra: object = {}) => ({
  id,
  title: `題 ${id}`,
  lane: 'In Progress',
  status: 'in-progress',
  laneStatusMismatch: false,
  assignee,
  ticketAssignee: assignee,
  assigneeMismatch: false,
  priority: 'medium',
  ticketUpdatedAt: '2026-11-28T10:00:00Z',
  latestNoteAt: '2026-11-28T09:59:00Z',
  latestNoteSource: 'claude-opus',
  progress: '最新の記録',
  blocker: null,
  decision: '本人の判断待ち',
  readError: null,
  ...extra,
})
it('In Progress の票を人形ごとにまとめ、本人・食い違い・他レーンは人形にしない（D1・D4）', () => {
  const r = parseBoard(
    board([
      full('BOXP-1', 'claude-opus'),
      full('BOXP-2', 'claude-opus'),
      full('BOXP-3', 'claude-fable'),
      full('BOXP-9', 'boxp'),
      full('BOXP-4', 'codex'),
      full('BOXP-4', 'codex-sol'),
      { ...full('BOXP-5', 'claude-sonnet'), lane: 'Ready' },
    ]),
    now,
  )
  expect(r.dolls).toEqual([
    {
      key: 'opus',
      name: '楽長の人形',
      version: 2,
      model: 'claude-opus-5-5',
      plainLabel: null,
      tickets: [
        { id: 'BOXP-1', assignee: 'claude-opus', model: 'claude-opus-5-5' },
        { id: 'BOXP-2', assignee: 'claude-opus', model: 'claude-opus-5-5' },
      ],
    },
    {
      key: 'fable',
      name: '語り部の人形',
      version: 2,
      model: 'claude-fable-5-2',
      plainLabel: null,
      tickets: [{ id: 'BOXP-3', assignee: 'claude-fable', model: 'claude-fable-5-2' }],
    },
  ])
})
it('定期の /status には Notes を載せず、票の詳細は In Progress の票だけ返す（T2・T3）', async () => {
  let clock = now
  const fetcher = (async (url: string) =>
    new Response(
      url === 'board'
        ? JSON.stringify(
            board([full('BOXP-1', 'claude-opus', { secret: 'x' }), { ...full('BOXP-2', 'codex'), lane: 'Ready' }]),
          )
        : metrics,
    )) as typeof fetch
  const status = createStatus({ fetch: fetcher, now: () => clock, quotaUrl: 'quota', boardUrl: 'board' })
  const s = await status.get()
  const text = JSON.stringify(s)
  expect(text).not.toContain('最新の記録')
  expect(text).not.toContain('本人の判断待ち')
  expect(text).not.toContain('題 BOXP-1')
  expect(s.tasks.dolls.map((d) => d.key)).toEqual(['opus'])
  clock += 1000
  expect(await status.ticket('BOXP-1')).toEqual({
    state: 'ok',
    fetchedAt: new Date(now).toISOString(),
    item: {
      id: 'BOXP-1',
      title: '題 BOXP-1',
      assignee: 'claude-opus',
      status: 'in-progress',
      ticketUpdatedAt: '2026-11-28T10:00:00Z',
      latestNoteAt: '2026-11-28T09:59:00Z',
      latestNoteSource: 'claude-opus',
      progress: '最新の記録',
      blocker: null,
      decision: '本人の判断待ち',
      readError: null,
    },
  })
  expect(await status.ticket('BOXP-2')).toEqual({ state: 'not_found' })
  // 担当が食い違う票は人形にしないので、中身も返さない（D1）。
  expect(await status.ticket('BOXP-4')).toEqual({ state: 'not_found' })
  expect((await status.get()).tasks.dolls.map((d) => d.key)).toEqual(['opus'])
  expect(await status.ticket('BOXP-3')).toEqual({ state: 'not_found' })
})
it('票の詳細は文字列でない値を null にし、取得できない時は unavailable（T3）', async () => {
  const ok = createStatus({
    fetch: (async () =>
      new Response(
        JSON.stringify(board([full('BOXP-1', 'codex', { title: 7, progress: { a: 1 }, blocker: '<b>止まり</b>' })])),
      )) as typeof fetch,
    now: () => now,
    quotaUrl: '',
    boardUrl: 'board',
  })
  expect(await ok.ticket('BOXP-1')).toMatchObject({
    state: 'ok',
    item: { title: null, progress: null, blocker: '<b>止まり</b>' },
  })
  const ng = createStatus({
    fetch: (async () => new Response('x', { status: 500 })) as typeof fetch,
    now: () => now,
    quotaUrl: '',
    boardUrl: 'board',
  })
  expect(await ng.ticket('BOXP-1')).toEqual({ state: 'unavailable' })
  expect((await ng.get()).tasks.dolls).toEqual([])
})
