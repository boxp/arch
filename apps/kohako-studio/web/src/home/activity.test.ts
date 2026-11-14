import { describe, expect, it } from 'vitest'
import { activityHeadline, formatDuration, toolLabel, validateActivity } from './activity'
describe('activity', () => {
  it('未知フィールドを除き、不正な手順を捨てる', () => { const a = validateActivity({ writing: false, dropped: 0, reasoning: 'secret', steps: [{ id: 't1', kind: 'tool', tool: 'web_search', status: 'done', startedAt: 0, extra: 'secret' }, { id: 'bad' }] })!; expect(a.steps).toHaveLength(1); expect(JSON.stringify(a)).not.toContain('secret'); expect(activityHeadline(a, { live: false, nowMs: 0, receivedAtMs: 0 })).toBe('ツールを 1 回使いました') })
  it('ラベルと時間を表示する', () => { expect(toolLabel('web_search').doing).toBe('Web を検索しています'); expect(formatDuration(800)).toBe('0.8秒'); expect(formatDuration(65000)).toBe('1分05秒') })
  it('結果未確認の手順を受け取り、見出しに数える', () => { const a = validateActivity({ steps: [{ id: 't1', kind: 'tool', tool: 'terminal', status: 'unconfirmed', startedAt: 1 }], writing: false, dropped: 0 })!; expect(a.steps).toHaveLength(1); expect(activityHeadline(a, { live: false, nowMs: 0, receivedAtMs: 0 })).toContain('結果未確認 1') })
})
