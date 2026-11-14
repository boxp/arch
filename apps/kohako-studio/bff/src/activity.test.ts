import { describe, expect, it } from 'vitest'
import { createActivity, publicDetail, redactPublic } from './activity.js'
describe('activity', () => {
  it('公開イベントを集約し、思考と最後の返答を残さない', () => {
    const a = createActivity(() => 123); a.apply({ event: 'reasoning.available', text: 'SECRET-THOUGHT' }); a.apply({ event: 'message.delta', delta: '途中です' }); a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id', preview: 'ls' }); a.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'private-id' }); a.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'private-id', duration: 1.234 }); a.apply({ event: 'message.delta', delta: '最終返答' }); a.finish()
    const snap = a.snapshot()!; expect(snap.steps).toHaveLength(2); expect(snap.steps[1]).toMatchObject({ status: 'done', durationMs: 1234 }); expect(JSON.stringify(snap)).not.toMatch(/SECRET-THOUGHT|private-id|最終返答/)
  })
  it('資格情報を伏せる', () => { for (const value of ['TOKEN=abc', '--password abc', 'https://user:pass@host/a?key=abc', 'Authorization: Bearer abc', 'ghp_abc123', 'eyJabc.def.ghi']) expect(redactPublic(value)).not.toMatch(/abc|pass@|def/) })
  it('引用符の中に空白がある資格情報も値ごと伏せる', () => {
    for (const value of ["--password ' abc123'", '--password " abc123"', "--password='  abc123 def456'", "mysql --db-password ' abc123' -e x", '--api-key \\" abc123\\"', "-token ' abc123'", "password ' abc123'", "password: ' abc123'", "PGPASSWORD=' abc123' psql", "Bearer ' abc123'", "--password ' abc123", "--password '\tabc123'", "--password '\n abc123'", 'curl -u admin:abc123 https://h', "curl --user 'admin: abc123'", "--passwd ' abc123'", "--password $' abc123'", "-p ' abc123'", "password is ' abc123'", "--password 'x' abc123", "api_key = ` abc123`", "password=( abc123 )", "sshpass -p abc123 ssh h", "key\\n' abc123'", "token:\n  ' abc123'", "password:\n\n abc123"]) expect(redactPublic(value), value).not.toMatch(/abc12|def456/)
    expect(redactPublic('git push -u origin main')).toBe('git push -u origin main')
    expect(redactPublic("ls -la 'my dir'")).toBe("ls -la 'my dir'")
    expect(redactPublic('mkdir -p dir && ssh -p 22 host')).toBe('mkdir -p dir && ssh -p 22 host')
    expect(redactPublic('天気を調べます\ncurl https://example.com/a')).toBe('天気を調べます curl https://example.com/…')
  })
  it('JSON・引用符つき・エスケープ済みの資格情報も伏せる', () => {
    for (const value of ['{"api_key":"abc123"}', '{"apiKey": "abc123", "q": "weather"}', "{'access_token': 'abc123'}", '{\\\\"api_key\\\\":\\\\"abc123\\\\"}', '"password":"abc123 def456"', '{"authorization":"Bearer abc123"}', '{"tokens":["abc123","abc124"]}', 'client_secret: abc123', '{"api_key":"abc123']) expect(redactPublic(value)).not.toMatch(/abc12|def456/)
    // 資格情報らしい項目より前は残し、以降は安全側で丸ごと伏せる。
    expect(redactPublic('{"q": "weather", "apiKey": "abc123"}')).toBe('{"q": "weather", "<secret>')
    const a = createActivity(() => 1); a.apply({ event: 'message.interim', text: '設定は {"api_key":"abc123"} です' }); a.apply({ event: 'tool.started', tool: 'terminal', preview: 'curl -d {"api_key":"abc123"}' }); a.apply({ event: 'tool.completed', tool: 'terminal', preview: '{"api_key":"abc123"}' })
    expect(JSON.stringify(a.snapshot())).not.toContain('abc123')
  })
  it('ツールの引数は公開してよい形だけを載せ、出力は載せない', () => {
    // 伏字規則では見分けられない値（-p直結・位置引数・パイプ元・環境変数・コード・未知の道具）が出ないこと。
    for (const [tool, preview] of [['terminal', 'mysql -pabc123'], ['terminal', 'mysql -uroot -pabc123 db'], ['terminal', 'echo abc123 | docker login --password-stdin'], ['terminal', 'PGPASSWORD=" abc123 " psql'], ['terminal', 'abc123=1 ls'], ['terminal', '{"command":"mysql -pabc123"}'], ['terminal', "'abc123' x"], ['execute_code', 'login("abc123")'], ['process', 'abc123'], ['mcp_vault_put', 'abc123'], ['unknown', 'abc123'], ['write_file', '/tmp/a.txt abc123'], ['write_file', '{"path":"/tmp/a","content":"abc123"}'], ['read_file', 'a b'], ['web_extract', 'https://u:abc123@h/p?k=abc123']] as const) {
      const a = createActivity(() => 1); a.apply({ event: 'tool.started', tool, tool_call_id: 'c', preview }); a.apply({ event: 'tool.completed', tool, tool_call_id: 'c', preview: 'out abc123', error: true })
      const snap = a.snapshot()!; expect(JSON.stringify(snap)).not.toContain('abc123'); expect(snap.steps[0]).toMatchObject({ status: 'failed' }); expect(snap.steps[0]).not.toHaveProperty('result')
    }
    expect(publicDetail('terminal', 'mysql -pabc123')).toBe('mysql …'); expect(publicDetail('terminal', 'ls')).toBe('ls'); expect(publicDetail('terminal', '/usr/bin/git status')).toBe('git …')
    expect(publicDetail('read_file', '/home/kohako/メモ.md')).toBe('/home/kohako/メモ.md'); expect(publicDetail('web_extract', 'https://example.com/a?q=1')).toBe('example.com'); expect(publicDetail('web_search', '東京 天気')).toBe('東京 天気')
    expect(publicDetail('execute_code', 'print(1)')).toBe(''); expect(publicDetail('mcp_x', 'anything')).toBe('')
  })
  it('URL はホスト名だけを残し、パス・クエリ・利用者情報を載せない', () => {
    for (const tool of ['web_extract', 'browser_navigate']) for (const preview of ['https://example.com/reset/abc123', 'example.com/reset/abc123', 'https://example.com/#abc123', 'https://example.com:8443/abc123', 'https://u:abc123@example.com/', 'https://abc123@example.com', 'https://example.com/a abc123']) expect(publicDetail(tool, preview), preview).not.toContain('abc123')
    expect(publicDetail('web_extract', 'https://example.com/reset/abc123')).toBe('example.com'); expect(publicDetail('browser_navigate', 'https://u:abc123@example.com/')).toBe('')
    for (const text of ['https://example.com/reset/abc123 を開きます', 'ssh://git@h/abc123', 'postgres://u:abc123@db/x', 'https://u:pa/abc123@h/x', 'see http://h?t=abc123', 'https://h#abc123']) expect(redactPublic(text), text).not.toContain('abc123')
    expect(redactPublic('https://example.com/reset/abc123 を開きます')).toBe('https://example.com/… を開きます'); expect(redactPublic('https://example.com/ です')).toBe('https://example.com/ です')
    expect(publicDetail('read_file', 'https://example.com/reset/abc123')).toBe('https://example.com/…'); expect(publicDetail('web_search', 'site https://example.com/reset/abc123')).toBe('site https://example.com/…')
    const a = createActivity(() => 1); a.apply({ event: 'message.interim', text: '再設定は https://example.com/reset/abc123 です' }); a.apply({ event: 'tool.started', tool: 'web_extract', preview: 'https://example.com/reset/abc123' }); expect(JSON.stringify(a.snapshot())).not.toContain('abc123')
  })
  it('run が正常終了したのに完了通知が無い手順は結果未確認にする', () => { const a = createActivity(() => 1); a.apply({ event: 'tool.started', tool: 'terminal' }); a.finish(true); expect(a.snapshot()!.steps[0]).toMatchObject({ status: 'unconfirmed' }) })
  it('上限を守り実行中を中断する', () => { const a = createActivity(() => 1); for (let i = 0; i < 45; i++) a.apply({ event: 'message.interim', text: String(i) }); a.apply({ event: 'tool.started', tool: 'terminal' }); a.finish(); expect(a.snapshot()).toMatchObject({ dropped: 6, writing: false }); expect(a.snapshot()!.steps.at(-1)).toMatchObject({ status: 'interrupted' }) })
})
