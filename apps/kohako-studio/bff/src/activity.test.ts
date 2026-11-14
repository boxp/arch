import { describe, expect, it } from 'vitest'
import { createActivity, redactPublic } from './activity.js'
describe('activity', () => {
  it('公開イベントを集約し、思考と最後の返答を残さない', () => {
    const a = createActivity(() => 123); a.apply({ event: 'reasoning.available', text: 'SECRET-THOUGHT' }); a.apply({ event: 'message.delta', delta: '途中です' }); a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id', preview: 'ls' }); a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id' }); a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'private-id', duration: 1.234 }); a.apply({ event: 'message.delta', delta: '最終返答' }); a.finish()
    const snap = a.snapshot()!; expect(snap.steps).toHaveLength(2); expect(snap.steps[1]).toMatchObject({ status: 'done', durationMs: 1234 }); expect(JSON.stringify(snap)).not.toMatch(/SECRET-THOUGHT|private-id|最終返答/)
  })
  it('資格情報を伏せる', () => { for (const value of ['TOKEN=abc', '--password abc', 'https://user:pass@host/a?key=abc', 'Authorization: Bearer abc', 'ghp_abc123', 'eyJabc.def.ghi']) expect(redactPublic(value)).not.toMatch(/abc|pass@|def/) })
  it('上限を守り実行中を中断する', () => { const a = createActivity(() => 1); for (let i = 0; i < 45; i++) a.apply({ event: 'message.interim', text: String(i) }); a.apply({ event: 'tool.started', tool: 'terminal' }); a.finish(); expect(a.snapshot()).toMatchObject({ dropped: 6, writing: false }); expect(a.snapshot()!.steps.at(-1)).toMatchObject({ status: 'interrupted' }) })
})
