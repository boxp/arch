import { describe, expect, it } from 'vitest'
import { createActivity, publicDetail } from './activity.js'
describe('activity', () => {
  it('公開イベントを集約し、思考・途中発言・最後の返答を残さない', () => {
    const a = createActivity(() => 123); a.apply({ event: 'reasoning.available', text: 'SECRET-THOUGHT' }); a.apply({ event: 'message.delta', delta: '途中です' }); expect(a.snapshot()).toEqual({ steps: [], writing: true, dropped: 0 })
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id', preview: 'ls' }); a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id' }); a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'private-id', duration: 1.234 }); a.apply({ event: 'message.delta', delta: '最終返答' }); a.finish()
    const snap = a.snapshot()!; expect(snap.steps).toEqual([{ id: 't1', kind: 'tool', tool: 'terminal', detail: 'ls', status: 'done', startedAt: 123, durationMs: 1234 }]); expect(JSON.stringify(snap)).not.toMatch(/SECRET-THOUGHT|private-id|途中です|最終返答/)
  })
  it('途中発言の本文は、秘密値の書き方によらず一切載せない', () => {
    for (const text of ['mysql -pabc123', 'mysql -uroot -pabc123 db を実行します', "--password ' abc123'", '{"api_key":"abc123"}', 'https://example.com/reset/abc123 を開きます', 'echo abc123 | docker login --password-stdin', 'abc123', '```\nabc123\n```']) {
      for (const event of [{ event: 'message.interim', text }, { event: 'message.delta', delta: text }]) {
        const a = createActivity(() => 1); a.apply(event); a.apply({ event: 'tool.started', tool: 'terminal', preview: 'ls' }); a.apply(event); a.apply({ event: 'tool.completed', tool: 'terminal' }); a.apply(event)
        const snap = a.snapshot()!; expect(JSON.stringify(snap), text).not.toMatch(/abc123|example|password|api_key/); expect(snap.steps).toHaveLength(1)
      }
    }
  })
  it('ツールの引数・出力は載せず、固定一覧のプログラム名だけを載せる', () => {
    for (const [tool, preview] of [['terminal', 'mysql -pabc123'], ['terminal', 'mysql -uroot -pabc123 db'], ['terminal', 'echo abc123 | docker login --password-stdin'], ['terminal', 'PGPASSWORD=" abc123 " psql'], ['terminal', 'abc123=1 ls'], ['terminal', 'abc123'], ['terminal', '/tmp/abc123 x'], ['terminal', '{"command":"mysql -pabc123"}'], ['terminal', "'abc123' x"], ['execute_code', 'login("abc123")'], ['process', 'abc123'], ['mcp_vault_put', 'abc123'], ['unknown', 'abc123'], ['write_file', '/tmp/abc123.txt'], ['read_file', '/home/abc123'], ['patch', 'abc123'], ['web_search', 'abc123 とは'], ['search_files', 'abc123'], ['session_search', 'abc123'], ['web_extract', 'https://abc123.example.com/reset/abc123'], ['browser_navigate', 'https://u:abc123@h/p?k=abc123']] as const) {
      const a = createActivity(() => 1); a.apply({ event: 'tool.started', tool, tool_call_id: 'c', preview }); a.apply({ event: 'tool.completed', tool, tool_call_id: 'c', preview: 'out abc123', error: true })
      const snap = a.snapshot()!; expect(JSON.stringify(snap), preview).not.toContain('abc123'); expect(snap.steps[0]).toMatchObject({ tool, status: 'failed' }); expect(snap.steps[0]).not.toHaveProperty('result')
    }
    expect(publicDetail('terminal', 'mysql -pabc123')).toBe('mysql …'); expect(publicDetail('terminal', 'ls')).toBe('ls'); expect(publicDetail('terminal', '/usr/bin/git status')).toBe('git …'); expect(publicDetail('terminal', 'mytool --x')).toBe('')
    for (const [tool, preview] of [['read_file', '/home/kohako/メモ.md'], ['web_extract', 'https://example.com/a'], ['web_search', '東京 天気'], ['execute_code', 'print(1)'], ['mcp_x', 'git']] as const) expect(publicDetail(tool, preview)).toBe('')
  })
  it('道具名として不正な値は固定名にする', () => { const a = createActivity(() => 1); a.apply({ event: 'tool.started', tool: 'abc 123 secret' }); expect(a.snapshot()!.steps[0].tool).toBe('tool') })
  it('run が正常終了したのに完了通知が無い手順は結果未確認にする', () => { const a = createActivity(() => 1); a.apply({ event: 'tool.started', tool: 'terminal' }); a.finish(true); expect(a.snapshot()!.steps[0]).toMatchObject({ status: 'unconfirmed' }) })
  it('上限を守り実行中を中断する', () => { const a = createActivity(() => 1); for (let i = 0; i < 45; i++) { a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: `c${i}` }); a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: `c${i}` }) } a.apply({ event: 'tool.started', tool: 'terminal' }); a.finish(); const snap = a.snapshot()!; expect(snap).toMatchObject({ dropped: 6, writing: false }); expect(snap.steps).toHaveLength(40); expect(snap.steps.at(-1)).toMatchObject({ status: 'interrupted' }) })
})
