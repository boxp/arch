import { expect, it } from 'vitest'
import { formatPool, formatTasks, gaugeOf, taskBadgeOf, relativeTime, summaryLine, upstreamUnavailable, type Pool, type Status } from './status'
const pool: Pool = { id: 'claude_shared', label: 'Claude', windows: [{ name: 'shared_5h', label: '5時間', state: 'not_provided', usedPercent: null, resetsAt: null, observedAt: null, status: null }] }
it('shows unavailable numbers as a dash rather than zero', () => { expect(formatPool(pool)).toContain('—'); expect(formatPool(pool)).not.toContain('0%') })
it('shows task totals, breakdown and incomplete lower bound', () => { const tasks = { state: 'ok', inProgress: { total: 3, complete: false, byAgent: [{ agent: 'a', count: 2 }, { agent: 'b', count: 1 }], conflicts: ['BOXP-1'] } }; expect(tasks.inProgress.byAgent.reduce((n, x) => n + x.count, 0)).toBe(tasks.inProgress.total); expect(formatTasks(tasks)).toContain('3件以上（全件は不明）'); expect(formatTasks(tasks)).toContain('整合不明あり') })
it('formats relative reset and summary', () => { expect(relativeTime('2026-11-13T00:00:00Z', Date.parse('2026-11-11T00:00:00Z'))).toBe('あと2日'); expect(summaryLine({ schema: '', generatedAt: '', quota: { state: 'ok', pools: [pool] }, tasks: { state: 'unavailable', inProgress: { total: 0, complete: false, byAgent: [], conflicts: [] } } } as Status)).toContain('Claude 不明') })
it('marks a stale top window in the summary and never shows 0 for unavailable tasks', () => {
  const stale: Pool = { id: 'claude_shared', label: 'Claude共有（Opus/Fable）', windows: [{ name: 'shared_7d', label: '7日', state: 'stale', usedPercent: 67, resetsAt: null, observedAt: null, status: 'allowed' }] }
  const s = summaryLine({ schema: '', generatedAt: '', quota: { state: 'ok', pools: [stale] }, tasks: { state: 'unavailable', inProgress: { total: null, complete: false, byAgent: [], conflicts: [] } } } as Status)
  expect(s).toContain('Claude 67%（古い）'); expect(s).toContain('進行中 不明'); expect(s).not.toMatch(/進行中 0件/)
})
it('treats a 200 response with an unavailable upstream as a reason to back off', () => {
  const tasks = (state: string) => ({ state, inProgress: { total: null, complete: false, byAgent: [], conflicts: [] } })
  const s = (q: string, b: string) => ({ schema: 'kohako-home-status/v1', generatedAt: '', quota: { state: q, pools: [] }, tasks: tasks(b) }) as Status
  expect(upstreamUnavailable(s('unavailable', 'ok'))).toBe(true); expect(upstreamUnavailable(s('ok', 'unavailable'))).toBe(true); expect(upstreamUnavailable(s('ok', 'ok'))).toBe(false); expect(upstreamUnavailable(s('stale', 'ok'))).toBe(false)
})

it('models gauges without inventing zero and picks the highest observed window', () => { expect(gaugeOf(pool).percent).toBeNull(); const w = pool.windows[0]; const g = gaugeOf({ ...pool, windows: [{ ...w, state: 'ok', usedPercent: 25 }, { ...w, label: '7日', state: 'stale', usedPercent: 69 }, { ...w, state: 'unavailable', usedPercent: 90 }] }); expect(g).toMatchObject({ percent: 69, label: '7日', stateText: '古い', cls: 'stale' }) })
it('models incomplete and unavailable task totals', () => { const tasks = { state: 'ok', inProgress: { total: 2, complete: false, byAgent: [], conflicts: ['x'] } }; expect(taskBadgeOf(tasks)).toMatchObject({ total: 2, suffix: '以上', stateText: '整合不明' }); expect(taskBadgeOf({ ...tasks, state: 'unavailable' }).total).toBeNull() })
