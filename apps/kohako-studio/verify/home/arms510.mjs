// BOXP-510 TD-02: 腕を動かしたとき左右端で腕・袖が切れないことを、最終描画の画素で確かめる。
// BFF は完全にモック。各身振り（joy / greet / guide / halt / shyHand / tilt / nod）を再生しながら連続でスクリーンショットを撮り、
// キャラ以外を透明にした画像で「描画面（canvas）の左右端の列に不透明画素が接しているか」を数える。接していれば描画面で切れている。
// 画面端（舞台の左右端）に接する画素も数える（画面の外へはみ出して切れた分）。どちらも 0 でなければ失敗。BLEED=0 で修正前の描画面（余白なし）を再現する。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、`node arms510.mjs /out`。失敗があれば終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8773), bleed = process.env.BLEED !== '0', repeat = Math.max(1, Number(process.env.REPEAT || 3))
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const GESTURES = ['joy', 'greet', 'guide', 'halt', 'shyHand', 'tilt', 'nod']
const CASES = [
  { name: 'pc', viewport: { width: 1280, height: 800 }, mobile: false },
  { name: 'pc-narrow', viewport: { width: 1280, height: 800 }, mobile: false, resize: { width: 760, height: 800 } },
  { name: 'pc-viewer', viewport: { width: 1280, height: 800 }, mobile: false, viewer: true },
  { name: 'pc-history', viewport: { width: 1280, height: 800 }, mobile: false, drawer: 'history-open' },
  { name: 'pixel7', viewport: { width: 412, height: 915 }, mobile: true },
  { name: 'pixel7-land', viewport: { width: 915, height: 412 }, mobile: true },
  { name: 'pixel7-land-viewer', viewport: { width: 915, height: 412 }, mobile: true, viewer: true },
  { name: 'pixel7-land-settings', viewport: { width: 915, height: 412 }, mobile: true, drawer: 'settings-open' },
]
const only = process.env.ONLY?.split(',')

async function frameEdges(page) {
  // キャラ以外（背景・吹き出し・操作欄など）を一時的に透明にし、透過スクリーンショットで canvas の左右端の列を数える。
  const geo = await page.evaluate(() => {
    document.body.classList.add('arms-probe')
    const c = document.getElementById('rig').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(), ch = document.getElementById('character').getBoundingClientRect()
    return { canvas: { l: c.left, r: c.right, t: c.top, b: c.bottom }, stage: { l: s.left, r: s.right, t: s.top, b: s.bottom }, box: { l: ch.left, r: ch.right, t: ch.top, b: ch.bottom }, dpr: devicePixelRatio, frame: document.getElementById('character').dataset.frame, mini: document.getElementById('character').classList.contains('mini') }
  })
  const png = await page.screenshot({ omitBackground: true })
  const counts = await page.evaluate(async ({ b64, geo }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0)
    const sx = img.width / innerWidth, d = g.getImageData(0, 0, img.width, img.height).data
    const t = Math.max(0, Math.round(Math.max(geo.canvas.t, geo.box.t) * sx)), bt = Math.min(img.height, Math.round(Math.min(geo.canvas.b, geo.box.b, geo.stage.b) * sx))
    const col = x => { if (x < 0 || x >= img.width) return null; let n = 0; for (let y = t; y < bt; y++) if (d[(y * img.width + x) * 4 + 3] > 40) n++; return n }
    const span = () => { let lo = img.width, hi = -1; for (let y = t; y < bt; y++) for (let x = 0; x < img.width; x++) if (d[(y * img.width + x) * 4 + 3] > 40) { if (x < lo) lo = x; if (x > hi) hi = x } return hi < 0 ? null : { l: lo / sx, r: (hi + 1) / sx } }
    // canvas の端の列（画面内にある時だけ）と、舞台（画面）の端の列
    const cl = Math.round(geo.canvas.l * sx), cr = Math.round(geo.canvas.r * sx) - 1, inView = x => x > Math.round(geo.stage.l * sx) && x < Math.round(geo.stage.r * sx) - 1
    return { canvasLeft: inView(cl) ? col(cl) : null, canvasRight: inView(cr) ? col(cr) : null, stageLeft: col(Math.round(geo.stage.l * sx)), stageRight: col(Math.round(geo.stage.r * sx) - 1), drawn: span() }
  }, { b64: png.toString('base64'), geo })
  await page.evaluate(() => document.body.classList.remove('arms-probe'))
  return { ...geo, ...counts }
}

for (const c of CASES) {
  if (only && !only.includes(c.name)) continue
  const ctx = await browser.newContext({ viewport: c.viewport, isMobile: c.mobile, hasTouch: c.mobile, deviceScaleFactor: c.mobile ? 2.625 : 1 }), page = await ctx.newPage()
  const r = results[c.name] = { gestures: {} }
  page.on('request', q => { const u = new URL(q.url()); if (u.hostname !== 'localhost') external.push(q.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await ctx.route('**/kohako/api/v1/**', route => {
    const p = new URL(route.request().url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    return json(200, {})
  })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0`)
    await page.addStyleTag({ content: 'body.arms-probe,body.arms-probe *{background:transparent!important;box-shadow:none!important;border-color:transparent!important;color:transparent!important;text-shadow:none!important}body.arms-probe .room,body.arms-probe .bubble,body.arms-probe .top,body.arms-probe .bar,body.arms-probe .drawer,body.arms-probe .status-anchor,body.arms-probe .clock-face,body.arms-probe .menu,body.arms-probe .cards,body.arms-probe .viewer,body.arms-probe #face{visibility:hidden!important}body.arms-probe #rig{visibility:visible!important}' })
    await page.waitForFunction(() => window.__kohakoHome?.report?.loaded && window.__kohakoHome.stage, null, { timeout: 60000 })
    if (!bleed) await page.evaluate(() => { const ch = document.getElementById('character'); ch.style.setProperty('--rig-bleed', '0px'); ch.style.setProperty('--rig-bleed-upper', '0px'); document.getElementById('rig').removeAttribute('data-bleed') })
    if (c.drawer) { await page.locator(`#${c.drawer}`).click(); await page.waitForTimeout(400) }
    if (c.viewer) { await page.evaluate(() => { document.body.dataset.viewer = 'open'; window.dispatchEvent(new Event('resize')) }); await page.waitForTimeout(800) } // ビューアーを開いた時の狭い枠（横向き 22%）
    if (c.resize) { await page.setViewportSize(c.resize); await page.waitForTimeout(600) }
    await page.waitForTimeout(800)
    r.rest = await frameEdges(page)
    for (const g of GESTURES) {
      // 撮影の位相で最大の振りを取り逃がさないよう、同じ身振りを repeat 回（既定 3）再生し、回ごとに撮影開始を 20ms ずつずらす。
      const frames = []
      for (let k = 0; k < repeat; k++) {
        await page.evaluate(g => window.__kohakoHome.stage.playGesture(g), g)
        if (k) await page.waitForTimeout(20 * k)
        const t0 = Date.now()
        while (Date.now() - t0 < 2200) { frames.push(await frameEdges(page)); await page.waitForTimeout(60) }
        await page.waitForTimeout(300)
      }
      const max = k => Math.max(0, ...frames.map(f => f[k] ?? 0)), widest = frames.reduce((a, f) => f.drawn && (!a || f.drawn.r - f.drawn.l > a.drawn.r - a.drawn.l) ? f : a, null)
      const g0 = r.gestures[g] = { frames: frames.length, canvasLeftMax: max('canvasLeft'), canvasRightMax: max('canvasRight'), stageLeftMax: max('stageLeft'), stageRightMax: max('stageRight'), widest: widest && { drawn: widest.drawn, box: widest.box, canvas: widest.canvas, frame: widest.frame, mini: widest.mini } }
      // 余白なしの枠（.character の箱）より外へ描けた幅: 修正が効いている（以前なら切れていた部分が見える）ことの記録
      if (widest?.drawn) g0.beyondBox = { left: Math.max(0, widest.box.l - widest.drawn.l), right: Math.max(0, widest.drawn.r - widest.box.r) }
      if (g0.stageLeftMax > 0 || g0.stageRightMax > 0) failures.push(`${c.name} ${g}: 画面の端で切れた（左 ${g0.stageLeftMax} 右 ${g0.stageRightMax} 画素行）`)
      if (g0.canvasLeftMax > 0 || g0.canvasRightMax > 0) failures.push(`${c.name} ${g}: 描画面の端で切れた（左 ${g0.canvasLeftMax} 右 ${g0.canvasRightMax} 画素行）`)
      await page.waitForTimeout(300)
      if (g === 'joy' || g === 'greet') { // 腕が最も外へ出る区間の実画面（普段の見た目のまま）
        await page.evaluate(g => window.__kohakoHome.stage.playGesture(g), g); await page.waitForTimeout(g === 'joy' ? 650 : 900)
        await page.screenshot({ path: `${out}/${c.name}-${g}${bleed ? '' : '-nobleed'}.png` }); await page.waitForTimeout(1800)
      }
    }
    // 操作欄が押せる（広げた描画面がクリックを奪わない）
    const hit = await page.evaluate(() => ['message', 'send', 'stop'].map(id => { const e = document.getElementById(id); if (!e || !e.checkVisibility()) return [id, 'hidden']; const b = e.getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return [id, top === e || e.contains(top) ? 'ok' : top?.closest('#character') ? 'character' : `covered:${top?.id || top?.className || 'none'}`] }))
    r.hit = Object.fromEntries(hit)
    // 引き出し（履歴・設定）が開いている時は引き出しが上に重なるのが仕様。キャラの描画面が上に来た時だけ失敗にする。
    for (const [id, v] of hit) if (v === 'character' || (!c.drawer && v !== 'ok' && v !== 'hidden')) failures.push(`${c.name}: #${id} が押せない（上に ${v}）`)
  } catch (e) { failures.push(`${c.name}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
const report = { bleed, results, failures, external }
fs.writeFileSync(`${out}/arms510${bleed ? '' : '-nobleed'}.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ bleed, failures, external: external.length, summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.gestures).map(([g, x]) => [g, [x.canvasLeftMax, x.canvasRightMax, x.stageLeftMax, x.stageRightMax, x.beyondBox && Math.round(x.beyondBox.left) + '/' + Math.round(x.beyondBox.right)]]))])) }, null, 1))
process.exit(failures.length ? 1 : 0)
