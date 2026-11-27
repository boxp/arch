// BOXP-738: 通常版の家（N, :18731）と待機中 30fps の候補版（C, :18732）を同条件で比べる。BOXP-730 の probe730c.mjs の方式を流用。
// Xvfb 上のヘッド付き Chrome 141（docker pw738, --cpus 4, GPU 無し = SwiftShader）へ生 CDP で接続。API は Fetch でモック。
// 実行: node idlefps738.mjs <出力先>   環境: PHASE_S(既定90) ONLY=a,b
// 静的配信: NDIST（通常版の web/dist）を :18731、CDIST（候補の web/dist）を :18732 の /kohako/ で配る（下の serve）。
// Chrome: docker run -d --name pw738 --network host --cpus 4 mcr.microsoft.com/playwright:v1.56.1-noble で Xvfb :99 を起こし、
//   chrome-linux/chrome --use-angle=swiftshader --enable-unsafe-swiftshader --remote-debugging-port=39731 をヘッド付きで起動しておく。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
// 最小の CDP クライアント（Playwright の可視化強制を避けるため）
async function cdp(port = 39731) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const wait = new Map(), handlers = []
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const [r, j] = wait.get(m.id); wait.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result) } else for (const h of handlers) h(m) })
  const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; wait.set(i, [r, j]); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })) })
  return { send, on: (h) => handlers.push(h), close: () => ws.close() }
}
async function openTab(c, url) {
  const { targetId } = await c.send('Target.createTarget', { url })
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true })
  const ev = async (expr) => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value
  return { targetId, sessionId, ev, send: (m, p) => c.send(m, p, sessionId) }
}
function serve(port, dir) {
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); let p = decodeURIComponent(u.pathname)
  if (!p.startsWith('/kohako/')) { r.writeHead(404); return r.end() }
  const f = path.join(dir, path.normalize(p.slice(8)))
  if (!f.startsWith(path.resolve(dir))) { r.writeHead(403); return r.end() }
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); r.end(b) })
}).listen(port, "127.0.0.1") }
if (process.env.NDIST) serve(18731, process.env.NDIST)
if (process.env.CDIST) serve(18732, process.env.CDIST)
const OUT = process.argv[2] ?? './out'; fs.mkdirSync(OUT, { recursive: true })
const PHASE_S = Number(process.env.PHASE_S ?? 90), WARM_S = 20
const ONLY = process.env.ONLY?.split(','), want = (k) => !ONLY || ONLY.includes(k)
const BASE = { N: 'http://localhost:18731/kohako/home.html', C: 'http://localhost:18732/kohako/home.html' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => { const s = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(s); fs.appendFileSync(`${OUT}/run.log`, s + '\n') }
function procs() {
  const sh = `for p in /proc/[0-9]*; do c=$(tr '\\0' ' ' < $p/cmdline 2>/dev/null); case "$c" in */chrome*) echo "$(cat $p/stat 2>/dev/null)|$(grep VmRSS $p/status 2>/dev/null)|$c";; esac; done`
  const by = {}
  for (const line of execFileSync('docker', ['exec', 'pw738', 'sh', '-c', sh], { encoding: 'utf8' }).split('\n')) {
    if (!line.trim()) continue
    const [stat, rss, cmd] = line.split('|'), f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const type = /--type=renderer/.test(cmd) ? 'renderer' : /--type=gpu-process/.test(cmd) ? 'gpu' : /--type=/.test(cmd) ? 'other' : 'browser'
    by[stat.split(' ')[0]] = { type, cpu: (Number(f[11] ?? 0) + Number(f[12])) / 100, rss: Number((rss ?? '').replace(/\D/g, '')) / 1024 }
  }
  return by
}
function diff(a, b, sec) {
  const agg = {}
  for (const [pid, p] of Object.entries(b)) { const g = (agg[p.type] ??= { cpuPct: 0, rssMiB: 0 }); const d = ((p.cpu - (a[pid]?.cpu ?? 0)) / sec) * 100; if (Number.isFinite(d)) g.cpuPct += d; g.rssMiB += p.rss }
  let c = 0, m = 0
  for (const g of Object.values(agg)) { g.cpuPct = +g.cpuPct.toFixed(1); g.rssMiB = Math.round(g.rssMiB); c += g.cpuPct; m += g.rssMiB }
  agg.total = { cpuPct: +c.toFixed(1), rssMiB: m }
  return agg
}
const NOTES = JSON.stringify({ items: Array.from({ length: 500 }, (_, i) => ({ eventId: `BOXP-${1000 + i}-x-done.report`, source: 'task-board', eventType: 'run.done', ticketId: `BOXP-${1000 + i}`, title: `BOXP-${1000 + i}: 計測用の通知タイトル`, body: 'あ'.repeat(480), createdAt: '2026-11-26T00:00:00Z', receivedAt: '2026-11-26T00:00:01Z', deliveries: 1, readAt: '2026-11-26T00:01:00Z', announcedAt: '2026-11-26T00:01:00Z' })), unread: 0 })
const instrument = `(() => { const c = (window.__probe = { raf: 0, draws: 0 }); const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => raf((t) => { c.raf++; f(t) });
  for (const P of [WebGLRenderingContext.prototype, window.WebGL2RenderingContext && WebGL2RenderingContext.prototype].filter(Boolean))
    for (const m of ['drawElements', 'drawArrays']) { const o = P[m]; P[m] = function (...a) { c.draws++; return o.apply(this, a) } } })()`
// コハコ本体の描き直し（player.draw）の回数を数える。p2l.js の start も候補の差し替えも this.draw() を呼ぶので、インスタンスに被せれば両方で数えられる。
const countFrames = (stub) => `(() => { const p = window.__kohakoHome.player; const d = ${stub ? '() => {}' : 'p.draw.bind(p)'}; window.__probe.frames = 0; p.draw = () => { window.__probe.frames++; d() }; 1 })()`
// BOXP-730 と同じ: 背景の無限 CSS アニメとすりガラスを止める（コハコの描画だけの負荷を見る比較用。アプリは変えずページ内だけ）
const noBgAnim = `.room *,.room *::before,.room *::after{animation:none!important}.top,.bar,.menu,.drawer{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`
const REPLY = 'はい、ご主人さま。計測中の返答です。'.repeat(6)
const c = await cdp()
const stats = { calls: {} }
let polls = 0, reqId = ''
c.on(async (m) => {
  if (m.method !== 'Fetch.requestPaused') return
  const { requestId, request } = m.params, u = new URL(request.url), p = u.pathname.split('/v1/')[1] ?? ''
  let status = 200, body
  if (p === 'me') body = { authenticated: true }
  else if (p === 'conversation') body = { enabled: true, stt: false }
  else if (p === 'notifications') body = NOTES
  else if (p.startsWith('conversation/transcript')) body = { rev: 'r1', items: [], active: null }
  else if (p === 'status') body = { schema: 'kohako-home-status/v1', items: [] }
  else if (p === 'messages') { reqId = JSON.parse(request.postData ?? '{}').requestId; polls = 0; status = 202; body = { requestId: reqId, status: 'pending' } }
  else if (p.startsWith('requests/')) { polls++; body = polls > 4 ? { requestId: reqId, status: 'done', reply: { text: REPLY } } : { requestId: reqId, status: 'pending' } }
  else body = {}
  const s = typeof body === 'string' ? body : JSON.stringify(body)
  stats.calls[p] = (stats.calls[p] ?? 0) + 1
  await c.send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(s).toString('base64') }, m.sessionId).catch(() => {})
})
const results = fs.existsSync(`${OUT}/result.json`) ? JSON.parse(fs.readFileSync(`${OUT}/result.json`, 'utf8')) : {}
async function home({ build, query = '', viewport = { width: 1440, height: 900 }, dpr = 2, stub = false, nobg = false }) {
  const t = await openTab(c, 'about:blank')
  await t.send('Page.enable'); await t.send('Runtime.enable')
  await t.send('Fetch.enable', { patterns: [{ urlPattern: '*/kohako/api/v1/*' }] })
  await t.send('Network.enable'); await t.send('Network.setBypassServiceWorker', { bypass: true })
  await t.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: dpr, mobile: false })
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: instrument })
  await t.send('Page.navigate', { url: BASE[build] + '?daypart=day&seat=off' + (query ? '&' + query : '') })
  for (let i = 0; i < 180; i++) { await sleep(500); if (await t.ev(`!!(window.__kohakoHome?.report.loaded && !document.querySelector('#send').disabled)`).catch(() => false)) break; if (i === 179) throw new Error('load timeout') }
  await t.ev(countFrames(stub))
  if (nobg) await t.ev(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(noBgAnim)}; document.head.append(s); 1 })()`)
  return t
}
const snap = (t) => t.ev('({...window.__probe, state: window.__kohakoHome.state, cap: window.__kohakoHome.report.frameCap ?? null})')
async function measure(name, t, sec, extra) {
  const pr0 = await snap(t), p0 = procs(), t0 = Date.now()
  await sleep(sec * 1000)
  const s = (Date.now() - t0) / 1000, p1 = procs(), pr1 = await snap(t)
  const r = { sec: +s.toFixed(1), ...extra, proc: diff(p0, p1, s), page: { rafPerSec: +((pr1.raf - pr0.raf) / s).toFixed(1), framesPerSec: +((pr1.frames - pr0.frames) / s).toFixed(1), drawCallsPerSec: +((pr1.draws - pr0.draws) / s).toFixed(1), state: pr1.state, cap: pr1.cap } }
  results[name] = r; log(name, JSON.stringify(r)); fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 1))
}
async function shot(t, name) { try { const { data } = await t.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64')) } catch {} }
const close = (t) => c.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {})
async function phase(name, opts) {
  if (!want(name)) return
  const t = await home(opts); await sleep(WARM_S * 1000); await shot(t, name)
  await measure(name, t, PHASE_S, { opts }); await close(t)
}
// 時間の流れ（候補版）: 0.25 秒ごとに描き直しの回数・状態・間引きの有無を記録し、1 秒ごとの描き直し回数にまとめる。
async function timeline(name, opts) {
  if (!want(name)) return
  const t = await home(opts); await sleep(WARM_S * 1000)
  const rows = [], marks = [], t0 = Date.now()
  let on = true
  ;(async () => { while (on) { const s = await snap(t).catch(() => null); if (s) rows.push({ ms: Date.now() - t0, frames: s.frames, state: s.state, capped: s.cap?.capped ?? null, vis: null }); await sleep(250) } })()
  const mark = (m) => { marks.push({ ms: Date.now() - t0, m }); log(name, 'mark', m) }
  mark('待機'); await sleep(6000)
  mark('マウスを動かす（2 秒）'); for (let i = 0; i < 20; i++) { await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300 + i * 30, y: 300 + (i % 4) * 40 }); await sleep(100) }
  mark('マウス停止'); await sleep(7000)
  mark('発言を送る')
  await t.ev(`(() => { const m = document.querySelector('#message'); m.focus(); m.value = 'こんにちは、計測中です'; m.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#send').click() })()`)
  for (let i = 0; i < 80; i++) { await sleep(250); const s = await snap(t); if (i > 8 && s.state === 'idle') break }
  mark('返事が終わって待機'); await sleep(6000)
  const b = await openTab(c, 'about:blank'); await c.send('Target.activateTarget', { targetId: b.targetId }); mark('裏タブ'); await sleep(8000)
  await c.send('Target.activateTarget', { targetId: t.targetId }); mark('前面に戻す'); await sleep(8000)
  await close(b)
  on = false; await sleep(400)
  const perSec = []
  for (let i = 4; i < rows.length; i += 4) perSec.push({ s: +(rows[i].ms / 1000).toFixed(1), fps: rows[i].frames - rows[i - 4].frames, state: rows[i].state, capped: rows[i].capped })
  results[name] = { opts, marks, perSec }; log(name, JSON.stringify({ marks, perSec })); fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 1))
  await close(t)
}
const LIGHT = { viewport: { width: 480, height: 480 }, dpr: 1 }
log('start phase', PHASE_S, 's')
// 負荷の比較（480x480・倍率1。この環境の自然な描き直しは約 17 回/秒なので、30 の上限は効かない。10 の上限で、描き直しを減らした時の下がり方を見る）
await phase('N_light', { build: 'N', ...LIGHT })
await phase('C_off_light', { build: 'C', query: 'idlefps=off', ...LIGHT })
await phase('C_light', { build: 'C', ...LIGHT })
await phase('C10_light', { build: 'C', query: 'idlefps=10', ...LIGHT })
await phase('N10_light_control', { build: 'N', query: 'idlefps=10', ...LIGHT })
// BOXP-730 と同じ PC 1440x900・倍率2
await phase('N_idle', { build: 'N' })
await phase('C_idle', { build: 'C' })
await phase('C10_idle', { build: 'C', query: 'idlefps=10' })
// 時間の流れ: 実描画で 10 の上限、描画の中身を空にして（GPU 代替の飽和を外し、画面の 60Hz で回る）既定の 30 の上限
// 背景アニメ・すりガラスを止めた条件（コハコの描画の分だけを比べる）
await phase('N_nobg_light', { build: 'N', nobg: true, ...LIGHT })
await phase('C_nobg_light', { build: 'C', nobg: true, ...LIGHT })
await phase('C10_nobg_light', { build: 'C', query: 'idlefps=10', nobg: true, ...LIGHT })
await phase('N_nobg_idle', { build: 'N', nobg: true })
await phase('C_nobg_idle', { build: 'C', nobg: true })
await phase('C10_nobg_idle', { build: 'C', query: 'idlefps=10', nobg: true })
await timeline('C10_timeline_light', { build: 'C', query: 'idlefps=10', ...LIGHT })
await timeline('C_timeline_stub', { build: 'C', stub: true, ...LIGHT })
await timeline('N_timeline_stub', { build: 'N', stub: true, ...LIGHT })
c.close(); log("done"); process.exit(0)
