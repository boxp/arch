// BOXP-663: 開き直した時（端末がバックグラウンドから戻る・GPU のメモリ逼迫）に WebGL のコンテキストが失われても、
// コハコが消えたまま・canvas が白く残ったままにならず、静止画で姿を保ち、コンテキストが戻れば動く姿に復帰することを確かめる。
// BFF は完全にモック（token 不要）。コンテキストの喪失と復帰は WEBGL_lose_context で起こす（実機の喪失と同じ webglcontextlost / restored が届く）。
// 実行: Playwright 1.56.1 で `node context663.mjs <build の dist> <出力先>`。`BASE=` で配備版の画面を開ける（API はモック）。
// `ONLY=mobile,pc,norestore,hidden` で絞れる。`EXPECT=0` は判定せず測定だけ（修正前の build との比較用）。失敗があれば終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'; fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, want = k => !ONLY || ONLY.includes(k), EXPECT = process.env.EXPECT !== '0'
const PORT = Number(process.env.PORT ?? 8863)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`, HOST = new URL(BASE).hostname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(PORT)
const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS) : await chromium.launch(launch)
const result = {}, failures = []
const check = (ok, what) => { if (!ok) failures.push(what) }

// ページ内: 見えているコハコ（canvas か静止画）と、canvas の中身（描けているか）を読む。
const probe = () => {
  const h = window.__kohakoHome, cv = document.getElementById('rig'), face = document.getElementById('face')
  const gl = h?.player?.gl
  let painted = null
  if (gl && !gl.isContextLost() && !cv.hidden) {
    h.player.draw()
    const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, px = new Uint8Array(4 * 64)
    let n = 0
    for (let i = 0; i < 64; i++) { gl.readPixels(Math.floor(w * (0.3 + 0.4 * (i % 8) / 7)), Math.floor(hh * (0.2 + 0.6 * Math.floor(i / 8) / 7)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px.subarray(i * 4)); if (px[i * 4 + 3] > 0) n++ }
    painted = n
  }
  return { rigHidden: cv.hidden, faceHidden: face.hidden, faceLoaded: face.complete && face.naturalWidth > 0, lost: gl ? gl.isContextLost() : null, painted, mode: document.getElementById('face-mode').textContent, report: { lost: h.report.contextLost ?? 0, restored: h.report.contextRestored ?? 0 } }
}
const visible = p => (!p.rigHidden && p.lost === false && p.painted > 0) || (p.rigHidden && !p.faceHidden && p.faceLoaded)

async function run(name, config, { restore = true, hidden = false } = {}) {
  const ctx = await browser.newContext({ ...config, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== HOST) return r.abort(); return r.fallback() })
  await ctx.route('**/kohako/api/v1/**', async route => {
    const p = new URL(route.request().url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    return json(200, {})
  })
  await ctx.addInitScript(() => localStorage.setItem('kohako-home-prefs', JSON.stringify({ idleActs: false })))
  await page.goto(`${BASE}/kohako/home.html?daypart=day`)
  await page.waitForFunction(() => window.__kohakoHome?.report.loaded, null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true })
  const r = { steps: {} }
  r.steps.before = await page.evaluate(probe); await page.screenshot({ path: path.join(dir, '1-before.png') })
  // 失う。hidden の時は「画面を離れている間に失い、戻ってから復帰する」流れにする。
  if (hidden) await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.evaluate(() => { window.__lose = window.__kohakoHome.player.gl.getExtension('WEBGL_lose_context'); window.__lose.loseContext() })
  await page.waitForTimeout(800)
  r.steps.lost = await page.evaluate(probe); await page.screenshot({ path: path.join(dir, '2-lost.png') })
  if (hidden) await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')) })
  if (restore) { await page.evaluate(() => window.__lose.restoreContext()); await page.waitForTimeout(3000) } else await page.waitForTimeout(3000)
  r.steps.after = await page.evaluate(probe); await page.screenshot({ path: path.join(dir, '3-after.png') })
  r.errors = errors
  result[name] = r
  if (EXPECT) {
    check(visible(r.steps.before), `${name}: 最初にコハコが見えていない`)
    check(visible(r.steps.lost), `${name}: 喪失中にコハコが見えていない（${JSON.stringify(r.steps.lost)}）`)
    check(!(r.steps.lost.lost && !r.steps.lost.rigHidden), `${name}: 失われた canvas が表示されたまま`)
    check(visible(r.steps.after), `${name}: 戻った後にコハコが見えていない（${JSON.stringify(r.steps.after)}）`)
    if (restore) check(!r.steps.after.rigHidden && r.steps.after.painted > 0, `${name}: 復帰後に動く姿へ戻っていない`)
    check(!errors.length, `${name}: ページのエラー ${errors.join(' / ')}`)
  }
  await ctx.close()
}

const phone = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
if (want('mobile')) await run('mobile', phone)
if (want('pc')) await run('pc', { viewport: { width: 1200, height: 800 } })
if (want('norestore')) await run('norestore', phone, { restore: false })
if (want('hidden')) await run('hidden', phone, { hidden: true })
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ result, failures }, null, 2))
console.log(JSON.stringify({ failures }, null, 2))
await browser.close(); srv.close()
process.exit(failures.length ? 1 : 0)
