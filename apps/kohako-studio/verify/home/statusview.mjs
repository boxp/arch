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
async function scenario(name, viewport, mode, scene = 'relax', large = false) {
  const ctx = await b.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 }), page = await ctx.newPage()
  await ctx.route('**/kohako/api/v1/**', async r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return mode === 'fail' ? j(503, {}) : j(200, status); return j(404, {}) })
  await page.goto('http://localhost:8768/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'))
  await page.waitForFunction(() => !document.getElementById('status-widget').textContent.includes('確認中'))
  if (large) await page.addStyleTag({ content: 'html{font-size:125%}' })
  await page.evaluate(scene => { document.body.dataset.scene = scene; new MutationObserver(() => { if (document.body.dataset.scene !== scene) document.body.dataset.scene = scene }).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] }) }, scene)
  await page.waitForTimeout(500)
  const widget = await page.textContent('#status-widget')
  const boxes = await page.evaluate(() => { const rect = e => { if (!e) return null; for (let o = e; o; o = o.parentElement) if (+getComputedStyle(o).opacity === 0) return null; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null }; const ids = ['status-widget', 'form', 'message', 'send', 'stop', 'bubble', 'cards', 'trouble', 'character', 'greeting', 'clock', 'date']; return Object.fromEntries(ids.map(id => [id, rect(document.getElementById(id))])) })
  check(await page.locator('.stage #status-widget').count() === 1 && !!boxes['status-widget'], `${name}: widget not visible in stage`)
  for (const id of ['form', 'message', 'send', 'stop', 'bubble', 'cards', 'trouble', 'greeting', 'clock', 'date']) check(!overlap(boxes['status-widget'], boxes[id]), `${name}: widget overlaps ${id}`)
  if (viewport.width < 600 && scene !== 'relax') { const c = boxes.character; check(!overlap(boxes['status-widget'], { x: c.x + c.width * .2, y: c.y, width: c.width * .6, height: c.height }), `${name}: widget overlaps central character`) }
  await page.screenshot({ path: `${outDir}/${name}-closed.png` })
  await page.click('#status-widget'); const detail = await page.textContent('#status-detail'); const inside = await page.evaluate(() => { const p = document.getElementById('status-panel').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return p.top >= s.top - 1 && p.bottom <= s.bottom + 1 && p.left >= s.left - 1 && p.right <= s.right + 1 }); check(inside, `${name}: detail popover is clipped outside the stage`); await page.screenshot({ path: `${outDir}/${name}-open.png` }); await page.keyboard.press('Escape')
  check(await page.locator('#status-panel').isHidden(), `${name}: Escape did not close`)
  if (mode === 'fail') { check(widget.includes('取得できません'), `${name}: failure missing`); check(!/\d+%|0件/.test(widget + detail), `${name}: invented values`) }
  else { for (const id of ['claude_shared', 'codex_shared']) { const p = status.quota.pools.find(p => p.id === id), ws = p.windows.filter(w => w.usedPercent !== null && !['unavailable','unobserved','not_provided'].includes(w.state)), value = Math.max(...ws.map(w => w.usedPercent)); check(await page.locator(`[data-pool="${id}"] .gauge-value`).textContent() === `${value}%`, `${name}: ${id} value mismatch`) } const t = status.tasks.inProgress; check(await page.locator('.task-total').textContent() === String(t.total), `${name}: task total mismatch`); check(t.total === t.byAgent.reduce((n, a) => n + a.count, 0), `${name}: total differs from sum`); for (const a of t.byAgent) check(widget.includes(`${a.agent} ${a.count}`), `${name}: missing chip ${a.agent}`); for (const p of status.quota.pools) { check(detail.includes(p.label), `${name}: missing ${p.label}`); for (const w of p.windows) if (w.usedPercent !== null) check(detail.includes(`${w.label} ${w.usedPercent}%`), `${name}: missing ${w.label}`) } }
  out[name] = { widget, detail, boxes }; await ctx.close()
}
for (const [name, viewport] of [['pc', { width: 1280, height: 800 }], ['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) for (const scene of ['relax', 'talk', 'show']) await scenario(`${name}-${scene}`, viewport, 'ok', scene)
await scenario('fail-portrait', { width: 390, height: 844 }, 'fail')
await scenario('large-pc', { width: 1280, height: 800 }, 'ok', 'relax', true)
await b.close(); srv.close(); fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ out, failures }, null, 1)); console.log(JSON.stringify({ failures }, null, 1)); process.exit(failures.length ? 1 : 0)
