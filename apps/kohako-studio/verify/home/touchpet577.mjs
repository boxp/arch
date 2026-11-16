// BOXP-577: スマホ・タブレットの指なでの回帰検査（Chromium の CDP touch）。BFF は完全にモック、token 不要。
// 実行: Playwright 1.56.1 のコンテナで `node touchpet577.mjs <build の dist> <出力先>`。失敗があれば終了コード 1。
// 端末ごとに (1) 頭の中央・頭の少し外（指の判定の内側）から横・縦・斜めに往復してなでると頭が寄り目を閉じ、離す／取り消すと戻る
// (2) 頭の外（体）から始めた指の操作はスクロールを止めない (3) PC のマウスは頭の少し外では反応しない（従来どおり）を確かめる。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'
fs.mkdirSync(OUT, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8774)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const failures = [], results = {}
const check = (ok, what) => { if (!ok) failures.push(what) }
const state = page => page.evaluate(() => { const r = window.__kohakoHome.report; return { z: +r.petFollow.headZ.toFixed(2), x: +r.petFollow.headX.toFixed(2), eyes: r.petEyes, ev: window.__ev.slice(), sy: scrollY } })

async function open(name, config) {
  const ctx = await browser.newContext(config), page = await ctx.newPage()
  await ctx.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); const data = p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {}; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }) })
  await page.goto('http://localhost:8774/kohako/home.html')
  await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, { timeout: 60000 })
  await sleep(2000)
  await page.evaluate(() => {
    window.__ev = []
    const rig = document.getElementById('rig')
    for (const t of ['pointerdown', 'pointercancel', 'pointerup']) rig.addEventListener(t, e => window.__ev.push(t), true)
    // 既定動作（スクロール）を止めたか。bubbling の最後で見る。
    window.addEventListener('touchstart', e => window.__ev.push(e.defaultPrevented ? 'touchstart:prevented' : 'touchstart:default'), { passive: true })
  })
  const head = await page.evaluate(() => window.__kohakoHome.hitAreas().head)
  return { ctx, page, head }
}

async function touchStroke(page, cdp, from, to, end = 'touchEnd') {
  const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
  await page.evaluate(() => { window.__ev = [] })
  await t('touchStart', [{ x: from[0], y: from[1] }])
  const during = []
  for (let k = 0; k < 4; k++) for (let i = 1; i <= 10; i++) { const s = k % 2 ? 1 - i / 10 : i / 10; await t('touchMove', [{ x: from[0] + (to[0] - from[0]) * s, y: from[1] + (to[1] - from[1]) * s }]); await sleep(25); if (i === 10) during.push(await state(page)) }
  await t(end, [])
  await sleep(100)
  const released = await state(page)
  // 戻り切るまでの時間（|角度| < 0.6° かつ開眼）。描画が遅い環境でも 4 秒以内に戻ればよい。
  const t0 = Date.now()
  let after = await state(page)
  while ((Math.abs(after.z) >= 0.6 || Math.abs(after.x) >= 0.6 || after.eyes) && Date.now() - t0 < 4000) { await sleep(100); after = await state(page) }
  after.ms = Date.now() - t0 + 100
  await sleep(300)
  return { during, released, after }
}

const phones = (process.env.DEVS || 'iPhone 15,iPhone 15 landscape,iPad Pro 11,iPad Pro 11 landscape,Pixel 7,Galaxy Tab S4').split(',')
for (const d of phones) {
  const { ctx, page, head } = await open(d, devices[d]), cdp = await ctx.newCDPSession(page)
  const cx = head.x + head.w / 2, cy = head.y + head.h / 2, ax = head.w * 0.3, ay = head.h * 0.25
  // 頭の矩形の上・右の外側 8px（指の判定の内側）。
  const outsideTop = [cx, head.y - 8], outsideRight = [head.x + head.w + 8, cy]
  const r = {}
  r.horizontal = await touchStroke(page, cdp, [cx - ax, cy], [cx + ax, cy])
  r.vertical = await touchStroke(page, cdp, [cx, cy - ay], [cx, cy + ay])
  r.diagonal = await touchStroke(page, cdp, [cx - ax, cy - ay], [cx + ax, cy + ay])
  r.edgeTop = await touchStroke(page, cdp, outsideTop, [outsideTop[0] + ax, outsideTop[1] + ay])
  r.edgeRight = await touchStroke(page, cdp, outsideRight, [outsideRight[0] - ax, outsideRight[1]])
  r.cancel = await touchStroke(page, cdp, [cx - ax, cy], [cx + ax, cy], 'touchCancel')
  for (const [k, v] of Object.entries(r)) {
    const last = v.during.at(-1)
    check(v.during.every(s => Math.abs(s.z) >= 3) && last.eyes, `${d}:${k}: なで中に頭が寄らない・目を閉じない ${JSON.stringify(v.during)}`)
    check(!v.released.eyes, `${d}:${k}: 離して/取り消して 0.1 秒で目が開かない`)
    check(Math.abs(v.after.z) < 0.6 && Math.abs(v.after.x) < 0.6 && !v.after.eyes, `${d}:${k}: 離して 4 秒以内に戻らない ${JSON.stringify(v.after)}`)
    check(k === 'cancel' || !v.released.ev.includes('pointercancel'), `${d}:${k}: 途中で pointercancel（スクロールへ切替）`)
    check(v.during[0].ev.includes('touchstart:prevented'), `${d}:${k}: 頭の上の指でスクロールが止まらない`)
  }
  // 体（頭の下）から始めた指はスクロールを止めない。
  await page.evaluate(() => { window.__ev = [] })
  const bodyY = head.y + head.h * 2.2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: bodyY }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  r.body = await state(page)
  check(r.body.ev.includes('touchstart:default'), `${d}: 体の上の指でスクロールが止まる ${JSON.stringify(r.body.ev)}`)
  await page.screenshot({ path: `${OUT}/${d.replace(/ /g, '_')}.png` })
  results[d] = { head, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.during ? { during: v.during.map(s => [s.z, s.eyes]), released: [v.released.z, v.released.eyes], after: [v.after.z, v.after.eyes, v.after.ms] } : v])) }
  console.log(d, JSON.stringify(results[d]))
  await ctx.close()
}

// PC: マウスは頭の矩形の外では反応しない（指の広げた判定はマウスに効かない）。頭の中では従来どおり反応する。
{
  const { ctx, page, head } = await open('pc', { viewport: { width: 1280, height: 800 } })
  const cx = head.x + head.w / 2, cy = head.y + head.h / 2, ax = head.w * 0.3
  const mouse = async (from, to) => { await page.mouse.move(...from); await page.mouse.down(); for (let k = 0; k < 4; k++) for (let i = 1; i <= 10; i++) { const s = k % 2 ? 1 - i / 10 : i / 10; await page.mouse.move(from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s); await sleep(25) } const during = await state(page); await page.mouse.up(); await sleep(1600); return { during, after: await state(page) } }
  const inHead = await mouse([cx - ax, cy], [cx + ax, cy])
  const outside = await mouse([head.x + head.w + 8, cy], [head.x + head.w + 8 - ax, cy])
  check(Math.abs(inHead.during.z) >= 3 && inHead.during.eyes && Math.abs(inHead.after.z) < 0.6 && !inHead.after.eyes, `pc: 頭の上のマウスなでが従来どおり動かない ${JSON.stringify(inHead)}`)
  check(Math.abs(outside.during.z) < 0.3 && !outside.during.eyes, `pc: 頭の外のマウスで反応した ${JSON.stringify(outside)}`)
  results.pc = { head, inHead: [inHead.during.z, inHead.during.eyes, inHead.after.z], outside: [outside.during.z, outside.during.eyes] }
  console.log('pc', JSON.stringify(results.pc))
  await ctx.close()
}
fs.writeFileSync(`${OUT}/touchpet577.json`, JSON.stringify({ results, failures }, null, 1))
console.log(failures.length ? `FAIL ${failures.length}\n${failures.join('\n')}` : 'PASS')
await browser.close(); process.exit(failures.length ? 1 : 0)
