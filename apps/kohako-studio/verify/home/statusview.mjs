// BOXP-504: 利用枠・進行中ステータスの表示を BFF モックで確認する（token 不要）。
// STATUS_JSON に BFF の /kohako/api/v1/status 応答（実データの写し）を渡し、PC/スマホでの描画、
// 画面の数値と応答の一致、取得失敗時に 0 へ置き換えないこと、入力・停止・承認を覆わないことを確かめる。
// 使い方: ローカル build を /site/kohako/ に置き `STATUS_JSON=/work/status.json node statusview.mjs out/<name>`
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const outDir = process.argv[2] || 'out/status'; fs.mkdirSync(outDir, { recursive: true })
const status = JSON.parse(fs.readFileSync(process.env.STATUS_JSON, 'utf8'))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site', p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8768)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}, failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }
const overlap = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height
async function scenario(name, viewport, mode) {
  const ctx = await b.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 }), page = await ctx.newPage()
  let statusCalls = 0
  await ctx.route('**/kohako/api/v1/**', async r => {
    const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === 'me') return j(200, { authenticated: true })
    if (p === 'conversation') return j(200, { enabled: true, stt: null })
    if (p === 'status') { statusCalls++; return mode === 'fail' ? j(503, { error: 'status_disabled' }) : j(200, status) }
    return j(404, {})
  })
  await page.goto('http://localhost:8768/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
  await page.waitForFunction(() => !document.getElementById('status-open').textContent.includes('確認中'), null, { timeout: 10000 })
  const summary = await page.textContent('#status-open')
  await page.screenshot({ path: `${outDir}/${name}-closed.png` })
  await page.click('#status-open')
  const detail = await page.textContent('#status-detail')
  const boxes = await page.evaluate(() => Object.fromEntries(['status-panel', 'form', 'message', 'send', 'stop', 'approval', 'character'].map(id => { const e = document.getElementById(id); const r = e && !e.hidden ? e.getBoundingClientRect() : null; return [id, r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null] })))
  await page.screenshot({ path: `${outDir}/${name}-open.png` })
  await page.keyboard.press('Escape')
  const closedByEsc = await page.evaluate(() => document.getElementById('status-panel').hidden)
  for (const id of ['form', 'message', 'send', 'stop']) check(!overlap(boxes['status-panel'], boxes[id]), `${name}: status panel overlaps #${id}`)
  check(closedByEsc, `${name}: Esc did not close the panel`)
  check(!/進行中 0件/.test(summary + detail) || (status.tasks.state === 'ok' && status.tasks.inProgress.total === 0), `${name}: shows 0 tasks without data`)
  if (mode === 'fail') { check(summary.includes('取得できません'), `${name}: failure not shown in summary`); check(!/\d+%/.test(summary + detail), `${name}: shows a percentage without data`) }
  else {
    const t = status.tasks.inProgress
    check(summary.includes(`進行中 ${t.total}件`), `${name}: summary total != ${t.total}`)
    check(t.total === t.byAgent.reduce((n, x) => n + x.count, 0), `${name}: total != sum(byAgent)`)
    for (const a of t.byAgent) check(detail.includes(`${a.agent} ${a.count}`), `${name}: detail misses ${a.agent} ${a.count}`)
    for (const p of status.quota.pools) { check(detail.includes(p.label), `${name}: detail misses pool ${p.label}`); for (const w of p.windows) if (w.usedPercent !== null) check(detail.includes(`${w.label} ${w.usedPercent}%`), `${name}: detail misses ${p.label} ${w.label} ${w.usedPercent}%`) }
  }
  out[name] = { summary, detail, statusCalls, boxes }
  await ctx.close()
}
await scenario('pc', { width: 1280, height: 800 }, 'ok')
await scenario('mobile', { width: 390, height: 844 }, 'ok')
await scenario('mobile-landscape', { width: 844, height: 390 }, 'ok')
await scenario('fail', { width: 390, height: 844 }, 'fail')
await b.close(); srv.close()
fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ out, failures }, null, 1))
console.log(JSON.stringify({ failures, summaries: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.summary])) }, null, 1))
process.exit(failures.length ? 1 : 0)
