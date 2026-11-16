import { must } from '../must'
import { describe, expect, it } from 'vitest'
import { activityHeadline, activityTime, formatDuration, toolLabel, validateActivity } from './activity'
describe('activity', () => {
  it('未知フィールドを除き、不正な手順を捨てる', () => {
    const a = must(
      validateActivity({
        writing: false,
        dropped: 0,
        reasoning: 'secret',
        steps: [
          { id: 't1', kind: 'tool', tool: 'web_search', status: 'done', startedAt: 0, extra: 'secret' },
          { id: 'bad' },
        ],
      }),
    )
    expect(a.steps).toHaveLength(1)
    expect(JSON.stringify(a)).not.toContain('secret')
    expect(activityHeadline(a, { live: false, nowMs: 0, receivedAtMs: 0 })).toBe(
      'ツールを 1 回使いました（web_search）',
    )
  })
  it('ラベルと時間を表示する', () => {
    expect(toolLabel('web_search').doing).toBe('Web を検索しています')
    expect(formatDuration(800)).toBe('0.8秒')
    expect(formatDuration(65000)).toBe('1分05秒')
  })
  it('結果未確認の手順を受け取り、見出しに数える', () => {
    const a = must(
      validateActivity({
        steps: [{ id: 't1', kind: 'tool', tool: 'terminal', status: 'unconfirmed', startedAt: 1 }],
        writing: false,
        dropped: 0,
      }),
    )
    expect(a.steps).toHaveLength(1)
    expect(activityHeadline(a, { live: false, nowMs: 0, receivedAtMs: 0 })).toContain('結果未確認 1')
  })
  it('追加項目と時間不明を検証する', () => {
    const make = (extra: object) =>
      must(
        validateActivity({
          steps: [{ id: 't1', kind: 'tool', tool: 'terminal', status: 'done', startedAt: 1, ...extra }],
          writing: false,
          dropped: 0,
        }),
      )
    expect(make({ runningMs: 3, startMissing: true }).steps[0]).toMatchObject({ runningMs: 3, startMissing: true })
    expect(make({ runningMs: 86400001 }).steps).toHaveLength(0)
    expect(make({ startMissing: false }).steps).toHaveLength(0)
    const step = make({ startMissing: true }).steps[0]
    if (step.kind === 'tool') expect(activityTime(step)).toBe('開始未受信・時間不明')
    const other = make({}).steps[0]
    if (other.kind === 'tool') expect(activityTime(other)).toBe('時間不明')
    expect(formatDuration(0)).toBe('0.1秒未満')
  })
  it('道具名と橋渡しの表示を示す', () => {
    expect(toolLabel('tool_call').doing).toBe('ツールを呼び出しています')
    expect(toolLabel('tool_search').doing).toBe('使えるツールを探しています')
    expect(toolLabel('tool_describe').doing).toBe('ツールの説明を読んでいます')
    expect(toolLabel('mcp__langfuse__listObservations').noun).toBe('外部ツール')
    const a = must(
      validateActivity({
        steps: ['terminal', 'web_search', 'terminal', 'memory', 'tool_call'].map((tool, i) => ({
          id: `t${i}`,
          kind: 'tool',
          tool,
          status: 'done',
          startedAt: 1,
        })),
        writing: false,
        dropped: 0,
      }),
    )
    expect(activityHeadline(a, { live: false, nowMs: 0, receivedAtMs: 0 })).toBe(
      'ツールを 5 回使いました（terminal×2、web_search、memory、ほか）',
    )
  })
})
describe('実引数の詳細 (BOXP-560)', () => {
  it('一覧の argsState と詳細応答を厳格に検証する', async () => {
    const { validateActivity, validateDetail } = await import('./activity')
    const step = { id: 't1', kind: 'tool', tool: 'terminal', status: 'done', startedAt: 1 }
    expect(
      validateActivity({ steps: [{ ...step, argsState: 'full' }], writing: false, dropped: 0 })?.steps[0],
    ).toMatchObject({
      argsState: 'full',
    })
    expect(validateActivity({ steps: [{ ...step, argsState: 'x' }], writing: false, dropped: 0 })?.steps).toEqual([])
    const ok = { tool: 'terminal', source: 'args', fields: [{ key: 'command', value: 'git status', truncated: false }] }
    expect(validateDetail(ok)).toEqual(ok)
    expect(validateDetail({ ...ok, omitted: true })).toMatchObject({ omitted: true })
    for (const bad of [
      null,
      { ...ok, source: 'output' },
      { ...ok, tool: 'a b' },
      { ...ok, fields: [{ key: 'bad key', value: '', truncated: false }] },
      { ...ok, fields: [{ key: 'k', value: 'x'.repeat(20002), truncated: false }] },
      { ...ok, fields: [{ key: 'k', value: 1, truncated: false }] },
      { ...ok, fields: Array.from({ length: 25 }, () => ok.fields[0]) },
      { ...ok, omitted: 'yes' },
    ])
      expect(validateDetail(bad)).toBeNull()
  })
  it('概要のまま取得した引数は、一覧が実引数ありに変わっていたら取り直す', async () => {
    const { detailOutdated } = await import('./activity')
    // 取得中に最終の照会で full へ変わり、概要の応答が後から返った場合。
    expect(detailOutdated({ state: 'ready', forState: 'preview' }, 'full')).toBe(true)
    expect(detailOutdated({ state: 'ready', forState: 'full' }, 'full')).toBe(false)
    expect(detailOutdated({ state: 'loading', forState: 'preview' }, 'full')).toBe(false)
    expect(detailOutdated({ state: 'error', forState: 'preview' }, 'full')).toBe(false)
    expect(detailOutdated({ state: 'ready', forState: 'preview' }, undefined)).toBe(false)
    expect(detailOutdated(undefined, 'full')).toBe(false)
  })
  it('実行内容を出せる時だけ、行の短い概要を置き換える', async () => {
    const { showsArgs } = await import('./activity')
    const d = { tool: 'terminal', fields: [{ key: 'command', value: 'date', truncated: false }] }
    expect(showsArgs({ state: 'ready', detail: { ...d, source: 'args' } })).toBe(true)
    expect(showsArgs({ state: 'loading', detail: { ...d, source: 'args' } })).toBe(true)
    expect(showsArgs({ state: 'ready', detail: { ...d, source: 'preview' } })).toBe(true)
    expect(showsArgs({ state: 'ready', detail: { ...d, source: 'args', fields: [] } })).toBe(false)
    expect(showsArgs({ state: 'ready', detail: { ...d, source: 'args', omitted: true } })).toBe(false)
    expect(showsArgs({ state: 'loading' })).toBe(false)
    expect(showsArgs(undefined)).toBe(false)
  })
  it('項目名を日本語にし、主な引数と変更内容を先に並べる', async () => {
    const { fieldLabel, orderFields } = await import('./activity')
    expect(fieldLabel('terminal', 'command')).toBe('コマンド')
    expect(fieldLabel('read_file', 'path')).toBe('パス')
    expect(fieldLabel('patch', 'path')).toBe('対象')
    expect(fieldLabel('skill_view', 'name')).toBe('スキル名')
    expect(fieldLabel('web_search', 'query')).toBe('検索語')
    expect(fieldLabel('execute_code', 'code')).toBe('コード')
    expect(fieldLabel('x', 'custom_key')).toBe('custom_key')
    const f = (key: string) => ({ key, value: '', truncated: false })
    expect(
      orderFields([f('timeout'), f('new_string'), f('old_string'), f('zzz'), f('path')]).map((x) => x.key),
    ).toEqual(['path', 'old_string', 'new_string', 'timeout', 'zzz'])
  })
})
