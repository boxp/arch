// BOXP-560: 手順ごとの実引数の開閉表示を検証する。
// 一覧と詳細の応答は BFF の実コード（activity.ts / secrets.ts をビルドしたもの）で作るので、伏字と上限は実物を通る。
// 使い方: (bff で) npx tsc -p tsconfig.json --outDir <dir> → BFF_DIST=<dir> SITE=<site> node args560.mjs <out>
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = process.argv[2] || '/out',
  site = process.env.SITE || '/site',
  port = Number(process.env.PORT || 8810)
const { createActivity } = await import(pathToFileURL(path.resolve(process.env.BFF_DIST || '/bff-dist', 'activity.js')).href)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http
  .createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    fs.readFile(path.join(site, p), (err, data) => {
      if (err) {
        res.writeHead(404)
        return res.end()
      }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(port)
// 画面に出てはいけない値（Hermes から届く生の引数に仕込む）。
const SECRETS = ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'hunter2', 'dXNlcjpwYXNzd29yZA', 'SECRET-THOUGHT', 'sk-live-abcdefghijklmnopqrstuv']
const longCode = `import json\n${Array.from({ length: 120 }, (_, i) => `print("line ${i}", json.dumps({"n": ${i}}))`).join('\n')}\n`
const CALLS = [
  { id: 'c1', name: 'terminal', args: { command: `cd /srv/app && git status --short && curl -H "Authorization: Basic ${SECRETS[2]}" https://example.com/api/items?page=2 && login --password ${SECRETS[1]}`, timeout: 60 } },
  { id: 'c2', name: 'read_file', args: { path: '/home/kohako/notes/2026-11-16 買い物メモ.md', offset: 20, limit: 80 } },
  { id: 'c3', name: 'web_search', args: { query: '東京 天気 明日 降水確率' } },
  { id: 'c4', name: 'skill_view', args: { name: 'obsidian-task-board', file_path: 'SKILL.md' } },
  { id: 'c5', name: 'execute_code', args: { code: longCode } },
  { id: 'c6', name: 'patch', args: { mode: 'replace', path: '/srv/app/src/config.ts', old_string: 'export const retries = 1\n', new_string: `export const retries = 3\nexport const githubToken = "${SECRETS[0]}"\n`, api_key: SECRETS[4] } },
]
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }),
  results = {},
  failures = [],
  external = []
for (const [device, viewport, mobile] of [
  ['pc', { width: 1440, height: 900 }, false],
  ['pixel7', { width: 412, height: 915 }, true],
]) {
  const checks = (results[device] = {}),
    ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }),
    page = await ctx.newPage(),
    pageErrors = [],
    detailCalls = []
  let stage = 0,
    requestId = '',
    t = Date.now() / 1000 - 1
  const activity = createActivity(() => Date.now())
  const setStage = (n) => {
    stage = n
    if (n === 1) activity.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: 'c1', preview: 'git status --short', timestamp: t })
    if (n === 2) {
      activity.apply({ event: 'reasoning.available', text: SECRETS[3] })
      activity.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: 'c1', timestamp: t + 2.5 })
      for (const [i, c] of CALLS.slice(1).entries()) {
        activity.apply({ event: 'tool.started', tool: c.name, tool_call_id: c.id, preview: 'x', timestamp: t + 3 + i })
        if (i < 4) activity.apply({ event: 'tool.completed', tool: c.name, tool_call_id: c.id, timestamp: t + 3.4 + i })
      }
      activity.attachArgs(CALLS)
    }
    if (n === 3) {
      activity.apply({ event: 'tool.completed', tool: 'patch', tool_call_id: 'c6', timestamp: t + 9 })
      activity.finish(true)
    }
  }
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('request', (req) => {
    if (new URL(req.url()).hostname !== 'localhost') external.push(req.url())
  })
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
  await page.route('**/kohako/api/v1/**', async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname.split('/v1/')[1],
      json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') {
      requestId = req.postDataJSON().requestId
      return json(202, { requestId, status: 'pending' })
    }
    if (p === 'approvals' || p.endsWith('/cancel')) return json(200, {})
    const step = /^requests\/[^/]+\/activity\/(t\d+)$/.exec(p)
    if (step) {
      detailCalls.push(step[1])
      const detail = activity.detail(step[1])
      return detail ? json(200, detail) : json(404, { error: 'unknown_step' })
    }
    if (p.startsWith('requests/')) {
      const snapshot = activity.snapshot()
      return json(200, { requestId, status: stage === 3 ? 'done' : 'pending', ...(snapshot ? { activity: snapshot } : {}), ...(stage === 3 ? { reply: { text: '返答です', at: Date.now() } } : {}) })
    }
    return json(200, {})
  })
  const check = (name, ok) => {
      checks[name] = ok ? 'PASS' : 'FAIL'
      if (!ok) failures.push(`${device}: ${name}`)
    },
    advance = async (n) => {
      setStage(n)
      await page.waitForTimeout(1400)
    },
    toggle = (id) => page.locator(`[data-toggle-step="${id}"]`),
    panel = (id) => page.locator(`#activity-args-${id}`),
    openArgs = async (id) => {
      await toggle(id).scrollIntoViewIfNeeded()
      await toggle(id).click()
      await page.waitForFunction((x) => document.querySelector(`#activity-args-${x} pre`), id, { timeout: 5000 })
    },
    field = (id, key) => page.locator(`#activity-args-${id} [data-key="${key}"] pre`).innerText(),
    label = (id, key) => page.locator(`#activity-args-${id} [data-key="${key}"] .activity-arg-label`).innerText()
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#message').fill('テスト')
    await page.locator('#send').click()
    await page.waitForTimeout(1250)
    await advance(1)
    await page.locator('.activity-head').click()
    check('引数は既定で閉じている', (await toggle('t1').getAttribute('aria-expanded')) === 'false' && (await panel('t1').isHidden()))
    check('一覧の応答に引数の本文が無い', !(await page.locator('#activity').innerText()).includes('--short'))
    await openArgs('t1')
    check('実引数が届く前は開始通知の概要を出す', (await label('t1', 'preview')) === '概要（実引数は未取得）' && (await field('t1', 'preview')) === 'git status --short')
    await advance(2)
    check('実引数が届いたら開いたまま置き換わる', (await toggle('t1').getAttribute('aria-expanded')) === 'true' && (await field('t1', 'command')).startsWith('cd /srv/app && git status --short && curl -H "Authorization: Basic ［伏字］" https://example.com/api/items?page=2'))
    check('terminal: コマンドと他の引数', (await label('t1', 'command')) === 'コマンド' && (await field('t1', 'timeout')) === '60')
    for (const id of ['t2', 't3', 't4', 't5', 't6']) await openArgs(id)
    check('read_file: パスと範囲', (await field('t2', 'path')) === '/home/kohako/notes/2026-11-16 買い物メモ.md' && (await label('t2', 'path')) === 'パス' && (await field('t2', 'offset')) === '20' && (await label('t2', 'limit')) === '行数')
    check('web_search: 検索語', (await field('t3', 'query')) === '東京 天気 明日 降水確率' && (await label('t3', 'query')) === '検索語')
    check('skill_view: スキル名', (await field('t4', 'name')) === 'obsidian-task-board' && (await label('t4', 'name')) === 'スキル名' && (await field('t4', 'file_path')) === 'SKILL.md')
    check('execute_code: コード全文', (await field('t5', 'code')).trim() === longCode.trim() && (await label('t5', 'code')) === 'コード')
    check('patch: 対象と置換前後', (await label('t6', 'path')) === '対象' && (await field('t6', 'path')) === '/srv/app/src/config.ts' && (await field('t6', 'old_string')).includes('export const retries = 1') && (await field('t6', 'new_string')).includes('export const retries = 3') && (await label('t6', 'old_string')) === '置換前' && (await label('t6', 'new_string')) === '置換後')
    check('patch: 秘密らしい名前の項目は値ごと伏字', (await field('t6', 'api_key')) === '［伏字］' && (await field('t6', 'new_string')).includes('［伏字］'))
    // 長いコードは枠内でスクロールし、作り直し（実行中は 1 秒ごと）でも位置と開閉が保たれる。
    await page.locator('#activity-args-t5 pre').first().evaluate((e) => { e.scrollTop = 300 })
    const before = detailCalls.length
    await page.waitForTimeout(3600)
    check('開いたままでも毎秒取り直さない', detailCalls.length === before)
    check('作り直しても開閉とスクロール位置を保つ', (await toggle('t5').getAttribute('aria-expanded')) === 'true' && (await page.locator('#activity-args-t5 pre').first().evaluate((e) => e.scrollTop)) >= 250)
    // スマホ縦では吹き出しは会話欄の中にあり、会話欄は固定の入力欄の下へスクロールして潜る（BOXP-544 の配置）。
    // そのため「重ならない」は、末尾まで送った時に手順表示の下端が入力欄より上に出て読めることで確かめる。
    await page.locator('#activity').evaluate((e) => e.scrollIntoView({ block: 'end' }))
    await page.waitForTimeout(300)
    const layout = await page.evaluate(() => {
      const rect = (s) => {
        const e = document.querySelector(s)
        if (!e || e.hidden) return null
        const r = e.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }
      const pre = document.querySelector('#activity-args-t5 pre')
      return { activity: rect('#activity'), form: rect('#form'), stop: rect('#stop'), width: innerWidth, scrollWidth: document.scrollingElement.scrollWidth, preScrolls: pre.scrollHeight > pre.clientHeight, preH: pre.clientHeight, vh: innerHeight }
    })
    const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    check('横にはみ出さない', layout.scrollWidth <= layout.width && layout.activity.left >= 0 && layout.activity.right <= layout.width)
    check('長い値は枠内でスクロール', layout.preScrolls && layout.preH <= layout.vh * 0.31)
    check('末尾まで送ると入力欄・停止ボタンに隠れない', !overlap(layout.activity, layout.form) && !overlap(layout.activity, layout.stop))
    const hit = await page.evaluate(() => Object.fromEntries(['stop', 'message'].map((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [id, !!top && (top === e || e.contains(top))] })))
    check('停止・入力が最前面', Object.values(hit).every(Boolean))
    await page.screenshot({ path: path.join(out, `${device}-running.png`) })
    await advance(3)
    check('完了後も開いたまま読める', (await page.locator('#reply').innerText()).includes('返答です') && (await toggle('t6').getAttribute('aria-expanded')) === 'true' && (await field('t6', 'old_string')).includes('retries = 1'))
    await toggle('t6').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, `${device}-done-patch.png`) })
    await toggle('t1').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, `${device}-done-terminal.png`) })
    await toggle('t3').click()
    check('閉じられる', (await panel('t3').isHidden()) && (await toggle('t3').getAttribute('aria-expanded')) === 'false')
    await toggle('t3').focus()
    await page.keyboard.press('Enter')
    check('キーボードで開ける', await panel('t3').isVisible())
    const dom = await page.content()
    check('秘密値と思考が DOM に無い', SECRETS.every((s) => !dom.includes(s)))
    check('ページエラー 0', pageErrors.length === 0)
    if (pageErrors.length) checks.pageErrors = pageErrors
  } catch (e) {
    checks.exception = e.message
    failures.push(`${device}: ${e.message}`)
    await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {})
  }
  await ctx.close()
}
await browser.close()
server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
