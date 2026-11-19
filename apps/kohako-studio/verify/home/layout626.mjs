// BOXP-626: 発言前後の場面替わり・画面サイズ変更で、コハコと背景がどう時間変化するかを実ブラウザの全描画フレームで確かめる。
// BFF は完全にモック（token 不要）。CDP の screencast でフレームを集め、48×30 の格子の輝度で「一瞬だけ大きく変わって戻る」セル（点滅）と
// 隣り合うフレームの平均差（急な飛び）を数える。リグの canvas の作り直し回数はページ内で数える。
// 実行: Playwright 1.56.1 で `node layout626.mjs <build の dist> <出力先>`。`PW_WS=ws://host:port/` で起動済みの Playwright サーバーへ接続できる。
// `ONLY=pc,mobile,reduce` で絞れる。`EXPECT=0` で判定せず測定だけする（修正前の build の測定用）。失敗があれば終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'; fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, want = k => !ONLY || ONLY.includes(k), EXPECT = process.env.EXPECT !== '0'
const PORT = Number(process.env.PORT ?? 8826)
// BASE=http://kohako-studio.kohako-studio.svc で配備版の画面を開く（API は同じくモック。dist の引数は使わない）。
const BASE = process.env.BASE ?? `http://localhost:${PORT}`, HOST = new URL(BASE).hostname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(PORT)
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS) : await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const result = {}, failures = [], external = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const REPLY = 'はい、ご主人さま。今日もいっしょにがんばりましょう。いまの状況をまとめると、作業は順調に進んでいます。'

// ページ内: 場面・形・枠の変化と、リグの canvas の大きさの変化を時刻つきで記録する（写しの canvas は数えない）。
const instrument = () => {
  const t0 = performance.now(), log = window.__layoutLog = []
  const put = (k, v) => log.push([performance.now() - t0, k, v])
  addEventListener('DOMContentLoaded', () => {
    const last = {}
    new MutationObserver(() => {
      const b = document.body, c = document.getElementById('character')
      for (const [k, v] of [['scene', b.dataset.scene], ['shape', b.dataset.shape], ['frame', c?.dataset.frame], ['kbd', b.dataset.kbd]]) if (last[k] !== v) { last[k] = v; put(k, v) }
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-scene', 'data-shape', 'data-frame', 'data-kbd'] })
  })
  const w = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', { get() { return w.get.call(this) }, set(v) { if (this.id === 'rig' && v !== w.get.call(this)) put('rig-width', v); w.set.call(this, v) } })
  // コハコの見える範囲（canvas の左右と .character の上下）。背景の点滅の集計からこの範囲（と直前の範囲）を除く。
  let lastRect = ''
  const watch = () => {
    const cv = document.getElementById('rig'), ch = document.getElementById('character')
    if (cv && ch && !cv.hidden) {
      const a = cv.getBoundingClientRect(), b = ch.getBoundingClientRect(), r = [Math.round(a.left), Math.round(b.top), Math.round(a.right), Math.round(b.bottom)], k = r.join()
      if (k !== lastRect) { lastRect = k; put('rect', r) }
    }
    requestAnimationFrame(watch)
  }
  requestAnimationFrame(watch)
  // 画面の時刻と screencast の時刻をそろえるための基準。
  window.__layoutT0 = Date.now() - performance.now() + t0
}

async function run(name, config, steps, media = 'no-preference') {
  const ctx = await browser.newContext({ ...config, reducedMotion: media, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  let reqId = '', polls = 0
  await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== HOST) { external.push(u.href); return r.abort() } return r.fallback() })
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') { reqId = req.postDataJSON().requestId; polls = 0; return json(202, { requestId: reqId, status: 'pending' }) }
    // 返答まで 12 回の照会（約 12 秒）待たせ、8 秒を超えた「作業中」の場面（上半身の枠）も通す。
    if (p.startsWith('requests/')) { polls++; return json(200, polls > 12 ? { requestId: reqId, status: 'done', reply: { text: REPLY } } : { requestId: reqId, status: 'pending' }) }
    return json(200, {})
  })
  await ctx.addInitScript(instrument)
  await ctx.addInitScript(() => localStorage.setItem('kohako-home-prefs', JSON.stringify({ idleActs: false })))
  await page.goto(`${BASE}/kohako/home.html?daypart=day`)
  await page.waitForFunction(() => window.__kohakoHome?.report.loaded && !document.querySelector('#send').disabled, null, { timeout: 60000 })
  await page.waitForTimeout(2500)
  const cdp = await ctx.newCDPSession(page), frames = [], marks = []
  cdp.on('Page.screencastFrame', async f => { frames.push({ t: f.metadata.timestamp * 1000, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
  const vp = page.viewportSize()
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: vp.width, maxHeight: vp.height })
  await page.waitForTimeout(600)
  const mark = async n => marks.push({ n, t: Date.now() })
  for (const s of steps) {
    if (s === 'send') {
      await mark('send'); await page.locator('#message').fill('こんにちは'); await page.locator('#send').click()
      await page.waitForFunction(() => document.querySelector('#reply').dataset.reply, null, { timeout: 40000 })
      await mark('reply'); await page.waitForTimeout(2000)
    } else { await mark(`resize ${s.join('x')}`); await page.setViewportSize({ width: s[0], height: s[1] }); await page.waitForTimeout(1000) }
  }
  await cdp.send('Page.stopScreencast'); await page.waitForTimeout(200)
  const info = await page.evaluate(() => ({ log: window.__layoutLog, t0: window.__layoutT0, morph: window.__kohakoHome.morph ?? null, ghosts: document.querySelectorAll('.morph-ghost').length }))
  // 画面の配置替え（場面・形・枠）ごとに、その後 0.6 秒間のリグ canvas の作り直し回数。
  const changes = info.log.filter(([, k]) => k !== 'rig-width' && k !== 'rect'), resizes = info.log.filter(([, k]) => k === 'rig-width')
  const perChange = changes.filter(([t]) => t > 2000).map(([t, k, v]) => ({ at: Math.round(t), what: `${k}=${v}`, rigResizes: resizes.filter(([u]) => u >= t - 50 && u < t + 600).length }))
  // フレームの解析は別ページで行う（ここで描画を止めないため）。
  const ana = await ctx.newPage(), GX = 48, GY = 30, grids = []
  for (const f of frames) grids.push(await ana.evaluate(async ([b64, GX, GY]) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(GX, GY), g = c.getContext('2d')
    g.drawImage(img, 0, 0, GX, GY); const d = g.getImageData(0, 0, GX, GY).data, o = []
    for (let i = 0; i < d.length; i += 4) o.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    return { o, w: img.width, h: img.height }
  }, [f.data, GX, GY]))
  const t0 = frames[0]?.t ?? 0, near = (t, ms) => marks.some(m => m.n.startsWith('resize') && t >= m.t - 100 && t < m.t + ms)
  // 各フレームの時刻に見えていた（直前 0.6 秒を含む）コハコの範囲。写しの溶け合い・まばたき・口の動きは背景の点滅に数えない。
  const rects = info.log.filter(([, k]) => k === 'rect').map(([t, , r]) => ({ t: info.t0 + t, r }))
  const charAt = t => { const out = []; for (let j = 0; j < rects.length; j++) { const next = rects[j + 1]?.t ?? Infinity; if (rects[j].t <= t + 100 && next >= t - 600) out.push(rects[j].r) } return out }
  const inChar = (rs, k, w, h) => { const x = ((k % GX) + 0.5) * w / GX, y = (Math.floor(k / GX) + 0.5) * h / GY; return rs.some(([l, tp, r, b]) => x >= l - w / GX && x <= r + w / GX && y >= tp - h / GY && y <= b + h / GY) }
  let flashCells = 0, charFlashCells = 0; const flashes = [], jumps = []
  for (let i = 1; i < grids.length; i++) {
    const a = grids[i - 1], b = grids[i], c = grids[i + 1]
    if (a.w !== b.w || a.h !== b.h) continue
    let sum = 0; for (let k = 0; k < b.o.length; k++) sum += Math.abs(b.o[k] - a.o[k])
    // 画面サイズを変えた直後のフレームは全体の配置が替わるので、急な飛びの集計から外す（点滅の集計には含める）。
    if (!near(frames[i].t, 400)) jumps.push({ i, ms: Math.round(frames[i].t - t0), d: +(sum / b.o.length).toFixed(2) })
    if (!c || c.w !== b.w || c.h !== b.h) continue
    let n = 0, m = 0; const rs = charAt(frames[i].t)
    for (let k = 0; k < b.o.length; k++) { const d1 = b.o[k] - a.o[k], d2 = c.o[k] - b.o[k]; if (Math.abs(d1) > 18 && Math.abs(d2) > 18 && Math.sign(d1) !== Math.sign(d2) && Math.abs(c.o[k] - a.o[k]) < Math.min(Math.abs(d1), Math.abs(d2)) / 2) { if (inChar(rs, k, b.w, b.h)) m++; else n++ } }
    charFlashCells += m
    if (n || m >= 15) { flashCells += n; flashes.push({ i, ms: Math.round(frames[i].t - t0), cells: n, charCells: m }) }
  }
  jumps.sort((x, y) => y.d - x.d)
  const keep = new Set([...flashes.map(f => f.i), ...jumps.slice(0, 4).map(j => j.i)].flatMap(i => [i - 1, i, i + 1]))
  fs.mkdirSync(path.join(OUT, name), { recursive: true })
  for (const i of keep) if (frames[i]) fs.writeFileSync(path.join(OUT, name, `f${String(i).padStart(4, '0')}-${Math.round(frames[i].t - t0)}ms.png`), Buffer.from(frames[i].data, 'base64'))
  const r = { frames: frames.length, durationMs: Math.round((frames.at(-1)?.t ?? 0) - t0), marks: marks.map(m => ({ ...m, ms: Math.round(m.t - t0) })), perChange, flashCells, charFlashCells, flashes, topJumps: jumps.slice(0, 6), morph: info.morph, ghostsLeft: info.ghosts, errors }
  await ctx.close()
  return r
}

const PC = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
const MOBILE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
const judge = (name, r, { reduce = false } = {}) => {
  check(!r.errors.length, `${name}: ページのエラー ${r.errors.join(' / ')}`)
  // 点滅セルは測定値として残す（swiftshader の 15〜20fps の取得では、まばたき・口の動き・リサイズ後に動く月窓も拾うため合否にしない）。
  for (const c of r.perChange) check(c.rigResizes <= 1, `${name}: ${c.what} の後 0.6 秒でリグ canvas を ${c.rigResizes} 回作り直した`)
  // 動きを減らす設定では配置替えは即時（飛ぶのが仕様）なので、急な飛びは見ない。
  if (!reduce) check((r.topJumps[0]?.d ?? 0) < 12, `${name}: 場面替わりでフレーム間の急な飛び ${r.topJumps[0]?.d}（12 未満を期待）`)
  check(r.ghostsLeft === 0, `${name}: 写しが残っている`)
  if (reduce) check(r.morph?.count === 0, `${name}: 動きを減らす設定で写しを使った`)
  // PC の作業中への出入り（全身⇄上半身）は写しで移す。画面サイズの変更（リサイズ・回転）は写しを使わず即時。
  else if (name === 'pc') check((r.morph?.count ?? 0) >= 2, `${name}: 枠の替わる配置替えで写しを使っていない`)
}
if (want('pc')) { result.pc = await run('pc', PC, ['send', [1200, 800], [1000, 700], [800, 600], [1440, 900]]); if (EXPECT) judge('pc', result.pc) }
if (want('mobile')) { result.mobile = await run('mobile', MOBILE, ['send', [915, 412], [412, 915]]); if (EXPECT) judge('mobile', result.mobile) }
if (want('reduce')) { result.reduce = await run('reduce', PC, ['send', [800, 600], [1440, 900]], 'reduce'); if (EXPECT) judge('reduce', result.reduce, { reduce: true }) }
check(!external.length, `外部への通信 ${external.join(' ')}`)
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ result, failures, external }, null, 1))
for (const [k, r] of Object.entries(result)) console.log(k, JSON.stringify({ frames: r.frames, flashCells: r.flashCells, charFlashCells: r.charFlashCells, bigCharFlash: Math.max(0, ...r.flashes.map(f => f.charCells)), maxRigResizes: Math.max(0, ...r.perChange.map(c => c.rigResizes)), changes: r.perChange.map(c => `${c.what}:${c.rigResizes}`).join(' '), topJump: r.topJumps[0], morph: r.morph }))
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS')
await browser.close(); srv.close()
process.exit(failures.length ? 1 : 0)
