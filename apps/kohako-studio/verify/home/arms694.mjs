// BOXP-694: 腕の動き 1 回ぶんを、時計を止めて等間隔のコマに切り出し、1 枚に並べる（切替の途中のコマを目で見るため）。
// 0.1 秒に満たない切替（二重腕・肘の絵の替わり目・T 字の通過）は、実時間の動画では 1〜2 コマしか写らないので、こちらで全コマを確かめる。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node arms694.mjs <build の dist> <出力.png> '<JSON>'`（BFF は完全にモック、token 不要）
// JSON: { kind: 'idle' | 'gesture', name, emotion?, speak?: true, from?: ms, every?: ms, n?, cols?, fw?,
//         then?: { at: ms, gesture?, reset?: true, mouse?: true }, zoom?: 'arm' | 'face' }
//   kind=idle は待機しぐさ（playIdle）、gesture は会話の身振り（stage.playGesture）。speak は話している間の口パクを動かす。
//   then は途中の割込み（別の身振り・解除・マウス移動）。BOX="x,y,w,h"（頭の幅・高さを単位、頭の中心・上端から）で切り出す範囲を変えられる。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2], OUT = process.argv[3], C = JSON.parse(process.argv[4])
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(0)
await new Promise(r => srv.on('listening', r)); const PORT = srv.address().port
const browser = await chromium.connect(process.env.PW_WS ?? 'ws://127.0.0.1:39694/')
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }), page = await context.newPage()
page.on('pageerror', e => console.log('pageerror', e.message))
await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
if (C.kind !== 'idle') await context.addInitScript(p => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), { idleActs: false })
await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
await page.goto(`http://localhost:${PORT}/kohako/home.html`)
for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 3000)
await page.clock.runFor(8000)
const N = C.n ?? 24, EVERY = C.every ?? 100, COLS = C.cols ?? 12, FW = C.fw ?? 200
if (C.kind === 'idle') {
  await page.evaluate(a => window.__kohakoHome.playIdle(a), C.name)
  let started = false
  for (let i = 0; i < 400 && !started; i++) { await page.clock.runFor(50); started = await page.evaluate(a => window.__kohakoHome.report.idle?.act === a, C.name) }
  if (!started) console.log('did not start')
} else {
  await page.evaluate(c => { const s = window.__kohakoHome.stage; if (c.emotion) s.setEmotion(c.emotion); if (c.name) s.playGesture(c.name) }, C)
}
await page.evaluate(b => { window.__BOX = b }, process.env.BOX ?? ''); await page.evaluate(([n, cols, fw, zoom]) => {
  const h = window.__kohakoHome, c = h.player.canvas, a = h.hitAreas().head, r = c.getBoundingClientRect(), k = c.width / r.width
  const B = (window.__BOX ?? "").split(",").map(Number); const box = B.length === 4 ? { x: (a.x + a.w / 2 - r.left + a.w * B[0]) * k, y: (a.y - r.top + a.h * B[1]) * k, w: a.w * B[2] * k, h: a.h * B[3] * k } : zoom === "arm"
    ? { x: (a.x + a.w / 2 - r.left - a.w * 1.5) * k, y: (a.y - r.top + a.h * 0.9) * k, w: a.w * 3.0 * k, h: a.h * 2.7 * k }
    : zoom === 'face'
    ? { x: (a.x + a.w / 2 - r.left - a.w * 0.9) * k, y: (a.y - r.top + a.h * 0.1) * k, w: a.w * 1.8 * k, h: a.h * 1.6 * k }
    : { x: (a.x + a.w / 2 - r.left - a.w * 1.75) * k, y: (a.y - r.top - a.h * 0.25) * k, w: a.w * 3.5 * k, h: a.h * 3.9 * k }
  const fh = Math.round(fw * box.h / box.w), o = new OffscreenCanvas(cols * fw, Math.ceil(n / cols) * fh), g = o.getContext('2d')
  g.fillStyle = '#a9a4e0'; g.fillRect(0, 0, o.width, o.height); g.font = '14px sans-serif'
  window.__strip = { o, g, box, fw, fh, cols, i: 0 }
}, [N, COLS, FW, C.zoom ?? 'full'])
if (C.speak) await page.evaluate(() => { const h = window.__kohakoHome, st = h.stage, p = h.player; window.__sv = st.setViseme.bind(st); st.setViseme = () => {}; window.__ls = p.lipSync.bind(p); p.lipSync = () => {} })
const vowels = [{ open: 0.9, width: 1.0 }, { open: 0.3, width: 1.12 }, { open: 0.7, width: 0.85 }, { open: 0.55, width: 1.06 }, { open: 0.3, width: 0.8 }, { open: 0.06, width: 1.0 }, { open: 0.9, width: 1.0 }, { open: 0.0, width: 1.0 }]
let t = 0, vi = 0
const advance = async ms => {
  // 口パクは 130ms ごとに母音を替える（693 の録画と同じ）
  let left = ms
  while (left > 0) {
    const step = Math.min(left, 10)
    if (C.speak && Math.floor(t / 130) !== Math.floor((t + step) / 130)) { const v = vowels[vi++ % vowels.length]; await page.evaluate(x => { window.__sv(x); window.__ls(x.open) }, v) }
    if (C.then && t < C.then.at && t + step >= C.then.at) await page.evaluate(th => { const h = window.__kohakoHome, s = h.stage; if (th.reset) s.reset(); if (th.gesture) s.playGesture(th.gesture); if (th.mouse) window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, bubbles: true })) }, C.then)
    await page.clock.runFor(step); t += step; left -= step
  }
}
if (C.from) await advance(C.from)
for (let i = 0; i < N; i++) {
  await page.evaluate(label => { const s = window.__strip, h = window.__kohakoHome; h.player.draw(); const x = (s.i % s.cols) * s.fw, y = Math.floor(s.i / s.cols) * s.fh
    s.g.drawImage(h.player.canvas, s.box.x, s.box.y, s.box.w, s.box.h, x, y, s.fw, s.fh); s.g.fillStyle = '#fff'; s.g.fillText(label, x + 4, y + 16); s.i++ }, `${(t / 1000).toFixed(2)}s`)
  await advance(EVERY)
}
const b64 = await page.evaluate(async () => { const b = new Uint8Array(await (await window.__strip.o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) })
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, Buffer.from(b64, 'base64'))
console.log('report', JSON.stringify(await page.evaluate(() => { const r = window.__kohakoHome.stage.report(); return { parts: r.parts, gesture: r.gesture } })))
await browser.close(); srv.close()
