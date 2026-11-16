import { describe, expect, it } from 'vitest'
import { MASK, publicText, redactArgs, redactSecrets, STEP_MAX, VALUE_MAX } from './secrets.js'
describe('redactSecrets', () => {
  it('普通のコマンド・パス・コードはそのまま読める', () => {
    for (const s of [
      'git status',
      'cat README.md',
      'grep -rn "foo" src',
      'kubectl get pods -n kohako',
      'ls -la /tmp/token-docs',
      'git log --author "boxp" -5',
      'curl -sS https://example.com/a/b?c=d | jq .items',
      'mysql -h db -P 3306 -u root app -e "select 1"',
      'ssh git@github.com',
      'for f in *.md; do wc -l "$f"; done',
      'print(sum(x for x in range(10)))',
      '今日の天気 東京',
    ])
      expect(redactSecrets(s)).toBe(s)
  })
  it.each([
    ['curl -H "Authorization: Bearer abcdef1234567890" https://x', 'abcdef1234567890'],
    ["curl -H 'authorization: Basic dXNlcjpwYXNz' https://x", 'dXNlcjpwYXNz'],
    ['{"headers":{"Authorization":"Bearer zzzzzzzzzzzz"}}', 'zzzzzzzzzzzz'],
    ['Cookie: sid=abc123; other=def456', 'abc123'],
    ['Cookie: sid=abc123; other=def456', 'def456'],
    ['echo ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghij'],
    ['x sk-proj-abcdefghijklmnopqrstuv y', 'sk-proj-abcdefghij'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['xoxb-1234567890-abcdefghij', 'xoxb-1234567890'],
    ['t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.sflKxwRJSMeKKF2QT4', 'eyJzdWIiOiIxMjM0NTYifQ'],
    ['git clone https://boxp:hunter2pw@github.com/a/b', 'hunter2pw'],
    ['git clone https://abcdefgh12345678@github.com/a/b', 'abcdefgh12345678'],
    ['API_KEY=abc123 node x.js', 'abc123'],
    ['export GITHUB_TOKEN="abc 123"', 'abc 123'],
    ['{"api_key": "abc123"}', 'abc123'],
    ['{\\"password\\": \\"abc 123\\"}', 'abc 123'],
    ['login --password hunter2', 'hunter2'],
    ["login --password ' abc123'", 'abc123'],
    ["login --password $'abc 123'", 'abc 123'],
    ['login --password=hunter2 --user a', 'hunter2'],
    ['client_secret: s3cr3tvalue', 's3cr3tvalue'],
    ['mysql -uroot -pabc123 db', 'abc123'],
    ["mysqldump -p'abc 123' db", 'abc 123'],
    ['sshpass -p hunter2 ssh a@b', 'hunter2'],
    ['curl -u admin:hunter2 https://x', 'hunter2'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3Nza\n-----END OPENSSH PRIVATE KEY-----', 'AAAAB3Nza'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow', 'MIIEow'],
  ])('%s の秘密値を伏せる', (text, secret) => {
    const out = redactSecrets(text)
    expect(out).not.toContain(secret)
    expect(out).toContain(MASK)
  })
  it('伏せた値の前後は残す', () => {
    expect(redactSecrets('curl -H "Authorization: Bearer abcdef1234567890" https://example.com/x')).toBe(
      `curl -H "Authorization: Bearer ${MASK}" https://example.com/x`,
    )
    expect(redactSecrets('API_KEY=abc123 node x.js')).toBe(`API_KEY=${MASK} node x.js`)
    expect(redactSecrets('mysql -uroot -pabc123 db')).toBe(`mysql -uroot -p${MASK} db`)
  })
  it('区切りの無い長い文字列でも時間がかからない', () => {
    const started = Date.now()
    redactSecrets('a'.repeat(80_000))
    redactSecrets('mysql '.repeat(10_000))
    redactSecrets('"'.repeat(40_000))
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
describe('redactArgs', () => {
  it('項目ごとに文字列化し、秘密らしい名前の項目は値ごと伏せる', () => {
    expect(
      redactArgs({
        command: 'git status',
        timeout: 30,
        api_key: 'abc123',
        env: { PATH: '/bin', GH_TOKEN: 'abc123' },
        'bad key': 'x',
      }),
    ).toEqual([
      { key: 'command', value: 'git status', truncated: false },
      { key: 'timeout', value: '30', truncated: false },
      { key: 'api_key', value: MASK, truncated: false },
      { key: 'env', value: `{\n  "PATH": "/bin",\n  "GH_TOKEN": ${MASK}\n}`, truncated: false },
    ])
  })
  it('auth / session を名前に含む項目は伏せ、author は伏せない', () => {
    expect(
      redactArgs({
        auth: 'hunter2',
        oauth_code: 'hunter2',
        session: 'hunter2',
        author: 'boxp',
        opts: { auth: 'hunter2', basicAuth: { user: 'u' }, author: 'boxp' },
        command: 'tool --auth hunter2 --author boxp; AUTH=hunter2 x; curl -d \'{"auth": "hunter2"}\' h',
        header: 'Authorization: Bearer abcdefgh12345678',
      }),
    ).toEqual([
      { key: 'auth', value: MASK, truncated: false },
      { key: 'oauth_code', value: MASK, truncated: false },
      { key: 'session', value: MASK, truncated: false },
      { key: 'author', value: 'boxp', truncated: false },
      {
        key: 'opts',
        value: `{\n  "auth": ${MASK},\n  "basicAuth": ${MASK},\n  "author": "boxp"\n}`,
        truncated: false,
      },
      {
        key: 'command',
        value: `tool --auth ${MASK} --author boxp; AUTH=${MASK} x; curl -d '{"auth": ${MASK}}' h`,
        truncated: false,
      },
      { key: 'header', value: `Authorization: Bearer ${MASK}`, truncated: false },
    ])
  })
  it('patch の置換前後を読める形で残し、中の秘密は伏せる', () => {
    const fields = redactArgs({
      mode: 'replace',
      path: '/srv/app/config.ts',
      old_string: 'const retries = 1\n',
      new_string: 'const retries = 3\nconst token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n',
    })
    expect(fields.map((f) => f.key)).toEqual(['mode', 'path', 'old_string', 'new_string'])
    expect(fields[2].value).toBe('const retries = 1\n')
    expect(fields[3].value).toContain('const retries = 3')
    expect(JSON.stringify(fields)).not.toContain('ghp_')
  })
  it('値と手順の上限で切り、切ったことを示す。制御文字は落とす', () => {
    const fields = redactArgs({
      a: 'x'.repeat(VALUE_MAX + 5),
      b: 'y\0\x1b[31mz\n\tw',
      c: 'c'.repeat(VALUE_MAX),
      d: 'd'.repeat(VALUE_MAX),
      e: 'e'.repeat(VALUE_MAX),
    })
    expect(fields[0]).toMatchObject({ truncated: true })
    expect(fields[0].value).toHaveLength(VALUE_MAX)
    expect(fields[1].value).toBe('y[31mz\n\tw')
    expect(fields.reduce((n, f) => n + f.value.length, 0)).toBeLessThanOrEqual(STEP_MAX)
    expect(fields[4].truncated).toBe(true)
    expect(redactArgs(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 1])))).toHaveLength(24)
  })
})
describe('切れた入力・閉じ引用符の無い値 (codex review P0)', () => {
  const secret = `hunter2${'x'.repeat(200_000)}`
  it('上限を超えて閉じ引用符が切り落とされても秘密値の先頭が残らない', () => {
    for (const text of [
      `export password="${secret}"`,
      `export password='${secret}'`,
      `curl -u "${secret}" https://example.com`,
      `mysql -p"${secret}" db`,
      `tool --token "${secret}"`,
      `{\\"password\\": \\"${secret}\\"}`,
    ]) {
      const [field] = redactArgs({ command: text })
      expect(field.value, text.slice(0, 30)).not.toContain('hunter2')
      expect(field.value).not.toContain('xxxx')
      expect(field.truncated).toBe(true)
    }
  })
  it('残り枠が小さくても伏字は全文に対して行う', () => {
    const fields = redactArgs({ a: 'y'.repeat(STEP_MAX - 5), command: `password="hunter2 ${'z'.repeat(100)}"` })
    expect(JSON.stringify(fields)).not.toContain('hunter2')
  })
  it('複数行にまたがる引用符つきの値・三連引用符も伏せる', () => {
    expect(redactSecrets('password="line1\nhunter2"\necho ok')).toBe(`password=${MASK}\necho ok`)
    expect(redactSecrets('secret = """a\nhunter2"""\nprint(1)')).toBe(`secret = ${MASK}\nprint(1)`)
    expect(redactSecrets('password="hunter2')).toBe(`password=${MASK}`)
  })
  it('切り口にかかった短いトークン断片は表示しない', () => {
    const text = `${'a '.repeat(VALUE_MAX * 2 - 4)}ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`
    const { value } = publicText(text, VALUE_MAX * 4)
    expect(value).not.toContain('ghp_')
  })
  it('通常の引数は従来どおり読める', () => {
    expect(redactSecrets('echo "hello world" && ls -la \'my dir\'')).toBe('echo "hello world" && ls -la \'my dir\'')
  })
})
