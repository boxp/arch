// BOXP-764 探索用: 待機しぐさを止めた家で、任意の腕セット（手そろえ候補）を当てて手元を撮る。
// node tidy764-poses.mjs <site> <out.png> '<JSON [{label, right:{up,fo,ha}, left:{...}}]>'  BOX=x,y,w,h
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2], OUT = process.argv[3], P = JSON.parse(process.argv[4])
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const ROOT = fs.realpathSync(SITE)
const inside = (url) => { try { const p = decodeURIComponent(new URL(url, 'http://x').pathname).replace(/^\/kohako\//, '/'); const f = path.resolve(ROOT, '.' + path.posix.normalize('/' + p)); const real = fs.realpathSync(f); return real === ROOT || real.startsWith(ROOT + path.sep) ? real : null } catch { return null } }
const srv = http.createServer((q, r) => { const f = inside(q.url); if (!f) { r.writeHead(404); return r.end() } fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d) }) }).listen(0, '127.0.0.1')
await new Promise(r => srv.on('listening', r)); const PORT = srv.address().port
const browser = await chromium.connect(process.env.PW_WS ?? "ws://127.0.0.1:39694/")
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }), page = await context.newPage()
page.on('pageerror', e => console.log('pageerror', e.message))
await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
await context.addInitScript(() => localStorage.setItem('kohako-home-prefs', JSON.stringify({ idleActs: false })))
await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
await page.goto(`http://127.0.0.1:${PORT}/kohako/home.html`)
for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 3000)
await page.clock.runFor(8000)
const B = (process.env.BOX ?? '-0.8,2.2,1.6,1.3').split(',').map(Number), FW = +(process.env.FW ?? 400), COLS = +(process.env.COLS ?? 4)
await page.evaluate(([B, n, cols, fw]) => {
  const h = window.__kohakoHome, s = h.stage, c = h.player.canvas, a = h.hitAreas().head, r = c.getBoundingClientRect(), k = c.width / r.width
  window.__set = s.setIdleArmSet.bind(s); s.setIdleArmSet = () => {}
  const box = { x: (a.x + a.w / 2 - r.left + a.w * B[0]) * k, y: (a.y - r.top + a.h * B[1]) * k, w: a.w * B[2] * k, h: a.h * B[3] * k }
  const fh = Math.round(fw * box.h / box.w), o = new OffscreenCanvas(cols * fw, Math.ceil(n / cols) * fh), g = o.getContext('2d')
  g.fillStyle = '#a9a4e0'; g.fillRect(0, 0, o.width, o.height); g.font = '14px sans-serif'
  window.__strip = { o, g, box, fw, fh, cols, i: 0 }
}, [B, P.length, COLS, FW])
for (const p of P) {
  await page.evaluate(p => window.__set(p.right ? { right: p.right, left: p.left } : null), p)
  await page.clock.runFor(700)
  await page.evaluate(label => { const s = window.__strip, h = window.__kohakoHome; h.player.draw(); const x = (s.i % s.cols) * s.fw, y = Math.floor(s.i / s.cols) * s.fh
    s.g.drawImage(h.player.canvas, s.box.x, s.box.y, s.box.w, s.box.h, x, y, s.fw, s.fh); s.g.fillStyle = '#fff'; s.g.fillText(label, x + 4, y + 16); s.i++ }, p.label)
  await page.evaluate(() => window.__set(null)); await page.clock.runFor(500)
}
const b64 = await page.evaluate(async () => { const b = new Uint8Array(await (await window.__strip.o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) })
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, Buffer.from(b64, 'base64'))
await browser.close(); srv.close()
