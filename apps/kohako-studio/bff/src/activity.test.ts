import { must } from './must.js'
import { describe, expect, it } from 'vitest'
import { createActivity, publicDetail } from './activity.js'
describe('activity', () => {
  it('公開イベントを集約し、思考・途中発言・最後の返答を残さない', () => {
    const a = createActivity(() => 123)
    a.apply({ event: 'reasoning.available', text: 'SECRET-THOUGHT' })
    a.apply({ event: 'message.delta', delta: '途中です' })
    expect(a.snapshot()).toEqual({ steps: [], writing: true, dropped: 0 })
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id', preview: 'ls' })
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id' })
    a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'private-id', duration: 1.234 })
    a.apply({ event: 'message.delta', delta: '最終返答' })
    a.finish()
    const snap = must(a.snapshot())
    expect(snap.steps).toEqual([
      {
        id: 't1',
        kind: 'tool',
        tool: 'terminal',
        detail: 'ls',
        status: 'done',
        startedAt: 123,
        durationMs: 1234,
        argsState: 'preview',
      },
    ])
    expect(JSON.stringify(snap)).not.toMatch(/SECRET-THOUGHT|private-id|途中です|最終返答/)
  })
  it('途中発言の本文は、秘密値の書き方によらず一切載せない', () => {
    for (const text of [
      'mysql -pabc123',
      'mysql -uroot -pabc123 db を実行します',
      "--password ' abc123'",
      '{"api_key":"abc123"}',
      'https://example.com/reset/abc123 を開きます',
      'echo abc123 | docker login --password-stdin',
      'abc123',
      '```\nabc123\n```',
    ]) {
      for (const event of [
        { event: 'message.interim', text },
        { event: 'message.delta', delta: text },
      ]) {
        const a = createActivity(() => 1)
        a.apply(event)
        a.apply({ event: 'tool.started', tool: 'terminal', preview: 'ls' })
        a.apply(event)
        a.apply({ event: 'tool.completed', tool: 'terminal' })
        a.apply(event)
        const snap = must(a.snapshot())
        expect(JSON.stringify(snap), text).not.toMatch(/abc123|example|password|api_key/)
        expect(snap.steps).toHaveLength(1)
      }
    }
  })
  it('ツールの引数・出力は載せず、固定一覧のプログラム名だけを載せる', () => {
    for (const [tool, preview] of [
      ['terminal', 'mysql -pabc123'],
      ['terminal', 'mysql -uroot -pabc123 db'],
      ['terminal', 'echo abc123 | docker login --password-stdin'],
      ['terminal', 'PGPASSWORD=" abc123 " psql'],
      ['terminal', 'abc123=1 ls'],
      ['terminal', 'abc123'],
      ['terminal', '/tmp/abc123 x'],
      ['terminal', '{"command":"mysql -pabc123"}'],
      ['terminal', "'abc123' x"],
      ['execute_code', 'login("abc123")'],
      ['process', 'abc123'],
      ['mcp_vault_put', 'abc123'],
      ['unknown', 'abc123'],
      ['write_file', '/tmp/abc123.txt'],
      ['read_file', '/home/abc123'],
      ['patch', 'abc123'],
      ['web_search', 'abc123 とは'],
      ['search_files', 'abc123'],
      ['session_search', 'abc123'],
      ['web_extract', 'https://abc123.example.com/reset/abc123'],
      ['browser_navigate', 'https://u:abc123@h/p?k=abc123'],
    ] as const) {
      const a = createActivity(() => 1)
      a.apply({ event: 'tool.started', tool, tool_call_id: 'c', preview })
      a.apply({ event: 'tool.completed', tool, tool_call_id: 'c', preview: 'out abc123', error: true })
      const snap = must(a.snapshot())
      expect(JSON.stringify(snap), preview).not.toContain('abc123')
      expect(snap.steps[0]).toMatchObject({ tool, status: 'failed' })
      expect(snap.steps[0]).not.toHaveProperty('result')
    }
    expect(publicDetail('terminal', 'mysql -pabc123')).toBe('mysql')
    expect(publicDetail('terminal', 'ls')).toBe('ls')
    expect(publicDetail('terminal', '/usr/bin/git status')).toBe('git status')
    expect(publicDetail('terminal', 'mytool --x')).toBe('')
    for (const [tool, preview] of [
      ['web_extract', 'https://example.com/a'],
      ['web_search', '東京 天気'],
      ['execute_code', 'print(1)'],
      ['mcp_x', 'git'],
    ] as const)
      expect(publicDetail(tool, preview)).toBe('')
  })
  it('道具名として不正な値は固定名にする', () => {
    const a = createActivity(() => 1)
    a.apply({ event: 'tool.started', tool: 'abc 123 secret' })
    expect(must(a.snapshot()).steps[0].tool).toBe('tool')
  })
  it('run が正常終了したのに完了通知が無い手順は結果未確認にする', () => {
    const a = createActivity(() => 1)
    a.apply({ event: 'tool.started', tool: 'terminal' })
    a.finish(true)
    expect(must(a.snapshot()).steps[0]).toMatchObject({ status: 'unconfirmed' })
  })
  it('上限を守り実行中を中断する', () => {
    const a = createActivity(() => 1)
    for (let i = 0; i < 45; i++) {
      a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: `c${i}` })
      a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: `c${i}` })
    }
    a.apply({ event: 'tool.started', tool: 'terminal' })
    a.finish()
    const snap = must(a.snapshot())
    expect(snap).toMatchObject({ dropped: 6, writing: false })
    expect(snap.steps).toHaveLength(40)
    expect(snap.steps.at(-1)).toMatchObject({ status: 'interrupted' })
  })
  it('timestamp と ID で並行する手順を計測する', () => {
    const a = createActivity(() => 12000)
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'a', timestamp: 10 })
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'b', timestamp: 11 })
    expect(must(a.snapshot()).steps.map((s) => s.runningMs)).toEqual([2000, 1000])
    expect(JSON.stringify(a.snapshot())).not.toMatch(/hermesAt|call|timestamp/)
    a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'b', timestamp: 13, duration: 0 })
    a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'a', timestamp: 15, duration: 0 })
    expect(must(a.snapshot()).steps.map((s) => s.durationMs)).toEqual([5000, 2000])
  })
  it('開始不明の完了は実行中に対応付けない', () => {
    const a = createActivity(() => 1)
    a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'a' })
    a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'unknown', duration: 5 })
    expect(must(a.snapshot()).steps).toMatchObject([{ status: 'running' }, { status: 'done', startMissing: true }])
    expect(must(a.snapshot()).steps[1]).not.toHaveProperty('durationMs')
    const b = createActivity(() => 1)
    b.apply({ event: 'tool.started', tool: 'terminal' })
    b.apply({ event: 'tool.started', tool: 'terminal' })
    b.apply({ event: 'tool.completed', tool: 'terminal', duration: 0 })
    expect(must(b.snapshot()).steps).toMatchObject([
      { status: 'running' },
      { status: 'running' },
      { status: 'done', startMissing: true },
    ])
    const c = createActivity(() => 1)
    c.apply({ event: 'tool.started', tool: 'terminal' })
    c.apply({ event: 'tool.completed', tool: 'terminal', duration: 0 })
    expect(must(c.snapshot()).steps[0]).not.toHaveProperty('durationMs')
  })
  it('概要は固定語だけで組み立てる', () => {
    for (const [tool, input, expected] of [
      ['terminal', 'git status --short', 'git status'],
      ['terminal', 'kubectl get pods -n x', 'kubectl get'],
      ['terminal', 'FOO=abc123 git push https://user:pw@host/x', 'git push'],
      ['terminal', 'mysql -pabc123', 'mysql'],
      ['terminal', "curl -H 'Authorization: Bearer abc123'", 'curl'],
      ['terminal', './deploy.sh abc', ''],
      ['read_file', '/home/u/.ssh/id_rsa', ''],
      ['read_file', 'secret-abc123.md L1-5', '.md ファイル'],
      ['tool_call', 'Langfuse · list observations', 'Langfuse · list observations'],
      ['tool_call', 'langfuse · list observations', ''],
      ['tool_call', 'Langfuse · list abc123', ''],
      ['tool_call', 'Langfuse · list !', ''],
    ] as const)
      expect(publicDetail(tool, input)).toBe(expected)
  })
})
describe('実引数の詳細 (BOXP-560)', () => {
  it('一覧には本文を載せず、開いた時だけ伏字済みの引数を返す', () => {
    const a = createActivity(() => 1)
    a.apply({
      event: 'tool.started',
      tool: 'terminal',
      tool_call_id: 'c1',
      preview: 'curl -H "Authorization: Bearer abcdef123456" x',
    })
    a.apply({ event: 'tool.started', tool: 'patch', tool_call_id: 'c2', preview: '/srv/app/a.ts' })
    a.apply({ event: 'tool.started', tool: 'memory' })
    expect(a.needsArgs()).toBe(true)
    expect(must(a.snapshot()).steps.map((s) => s.argsState)).toEqual(['preview', 'preview', undefined])
    expect(JSON.stringify(a.snapshot())).not.toMatch(/Authorization|\/srv\/app/)
    // 実引数が届くまでは開始通知の要約（伏字済み）を返す。
    expect(a.detail('t1')).toEqual({
      tool: 'terminal',
      source: 'preview',
      fields: [{ key: 'preview', value: 'curl -H "Authorization: Bearer ［伏字］" x', truncated: false }],
    })
    expect(a.detail('t3')).toBeUndefined()
    expect(a.detail('t9')).toBeUndefined()
    a.attachArgs([
      {
        id: 'c2',
        name: 'patch',
        args: { mode: 'replace', path: '/srv/app/a.ts', old_string: 'a = 1', new_string: 'a = 2' },
      },
      {
        id: 'c1',
        name: 'terminal',
        args: { command: 'echo ghp_abcdefghijklmnopqrstuvwxyz0123456789 && ls /srv', timeout: 30 },
      },
      { id: 'other-run', name: 'terminal', args: { command: 'x' } },
    ])
    expect(a.needsArgs()).toBe(false)
    expect(a.detail('t2')).toEqual({
      tool: 'patch',
      source: 'args',
      fields: [
        { key: 'mode', value: 'replace', truncated: false },
        { key: 'path', value: '/srv/app/a.ts', truncated: false },
        { key: 'old_string', value: 'a = 1', truncated: false },
        { key: 'new_string', value: 'a = 2', truncated: false },
      ],
    })
    expect(must(a.detail('t1')).fields[0].value).toBe('echo ［伏字］ && ls /srv')
    const snap = JSON.stringify(a.snapshot())
    expect(snap).not.toMatch(/ghp_|\/srv|a = 2|c1|c2/)
    expect(must(a.snapshot()).steps.map((s) => s.argsState)).toEqual(['full', 'full', undefined])
  })
  it('保持する引数の合計が上限を超えたら古い手順から捨て、捨てたことを返す', () => {
    const a = createActivity(() => 1)
    for (let i = 1; i <= 9; i++) a.apply({ event: 'tool.started', tool: 'write_file', tool_call_id: `c${i}` })
    a.attachArgs(
      Array.from({ length: 9 }, (_, i) => ({
        id: `c${i + 1}`,
        name: 'write_file',
        args: { a: 'x'.repeat(20000), b: 'y'.repeat(20000), c: 'z'.repeat(20000) },
      })),
    )
    expect(a.detail('t1')).toEqual({ tool: 'write_file', source: 'args', fields: [], omitted: true })
    expect(must(a.detail('t9')).fields).toHaveLength(3)
    expect(a.needsArgs()).toBe(false)
  })
})
