// BOXP-764: 時計を止めて 1/FPS 秒ずつ進め、全身の範囲を JPEG のコマに書き出す（30fps で並べると通常速度の動画になる）。
// node tidy764-frames.mjs <site> <outdir> <query> <seconds>  env: FPS=30, MOUSE_AT=秒（手そろえの開始からの秒でマウスを動かす）
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const [SITE, OUT, QUERY, SEC] = process.argv.slice(2), FPS = +(process.env.FPS ?? 30), MOUSE_AT = process.env.MOUSE_AT ? +process.env.MOUSE_AT : null
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const ROOT = fs.realpathSync(SITE)
const inside = (url) => { try { const p = decodeURIComponent(new URL(url, 'http://x').pathname).replace(/^\/kohako\//, '/'); const f = path.resolve(ROOT, '.' + path.posix.normalize('/' + p)); const real = fs.realpathSync(f); return real === ROOT || real.startsWith(ROOT + path.sep) ? real : null } catch { return null } }
const srv = http.createServer((q, r) => { const f = inside(q.url); if (!f) { r.writeHead(404); return r.end() } fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d) }) }).listen(0, '127.0.0.1')
await new Promise(r => srv.on('listening', r)); const PORT = srv.address().port
const browser = await chromium.connect(process.env.PW_WS ?? "ws://127.0.0.1:39694/")
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }), page = await context.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
await page.goto(`http://127.0.0.1:${PORT}/kohako/home.html${QUERY}`)
for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 3000)
await page.clock.runFor(8000)
await page.evaluate(() => window.__kohakoHome.playIdle('tidy'))
let t = 0; const step = 1000 / FPS
for (let i = 0; i < 400 && !(await page.evaluate(() => window.__kohakoHome.report.idle?.act === 'tidy')); i++) { await page.clock.runFor(step); t += step }
const t0 = t
await page.evaluate(() => {
  const h = window.__kohakoHome, c = h.player.canvas, a = h.hitAreas().head, r = c.getBoundingClientRect(), k = c.width / r.width
  const box = { x: (a.x + a.w / 2 - r.left - a.w * 1.75) * k, y: (a.y - r.top - a.h * 0.25) * k, w: a.w * 3.5 * k, h: a.h * 3.9 * k }
  const W = 480, H = Math.round(W * box.h / box.w / 2) * 2, o = new OffscreenCanvas(W, H), g = o.getContext('2d')
  window.__rec = { box, o, g, W, H }
})
fs.mkdirSync(OUT, { recursive: true })
const N = Math.round(+SEC * FPS), events = []
let last = null
for (let i = 0; i < N; i++) {
  const sec = i / FPS
  if (MOUSE_AT !== null && sec >= MOUSE_AT && sec - 1 / FPS < MOUSE_AT) { await page.mouse.move(300, 300); await page.mouse.move(320, 310); events.push({ sec, e: 'mouse' }) }
  const r = await page.evaluate(async (label) => {
    const h = window.__kohakoHome, R = window.__rec; h.player.draw()
    R.g.fillStyle = '#a9a4e0'; R.g.fillRect(0, 0, R.W, R.H)
    R.g.drawImage(h.player.canvas, R.box.x, R.box.y, R.box.w, R.box.h, 0, 0, R.W, R.H)
    R.g.fillStyle = '#fff'; R.g.font = '16px sans-serif'; R.g.fillText(label, 8, 22)
    const b = new Uint8Array(await (await R.o.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()); let s = ''; for (let j = 0; j < b.length; j += 0x8000) s += String.fromCharCode(...b.subarray(j, j + 0x8000))
    const st = h.stage.report()
    return { b64: btoa(s), act: h.report.idle?.act ?? null, set: !!st.idleArmSet, sw: st.armSwitch?.phase ?? null }
  }, `${process.env.LABEL ?? ''} ${sec.toFixed(2)}s`)
  fs.writeFileSync(path.join(OUT, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(r.b64, 'base64'))
  const k = `${r.act}/${r.set}/${r.sw}`
  if (k !== last) { events.push({ sec, e: k }); last = k }
  await page.clock.runFor(step)
}
fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify({ query: QUERY, fps: FPS, startedAfterMs: t0, events, errors }, null, 1))
console.log(JSON.stringify({ events, errors }))
await browser.close(); srv.close()
