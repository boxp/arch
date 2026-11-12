// BOXP-516: カーソルの方向へ視線（目と頭の向き）が向くことを、最終描画の画素から確かめる回帰検査。
// 待機クリップも頭を数度〜10 度ほど揺らすので、左右・上下を交互に何度も置き直して瞳（青）の重心の平均を比べる。
// 実行: Playwright 1.56.1 のコンテナで `node lookfollow516.mjs <build の dist> <出力先>`（BFF は完全にモック、token 不要）。
// 失敗した項目があれば終了コード 1。各位置の顔の画像・連続フレームと測定値（result.json）を出力先に保存する。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'; fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8774)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const result = {}, failures = [], external = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length
const r1 = x => Math.round(x * 10) / 10
// 左右・上下それぞれの平均の差がこれ以上なら「向いて見える」とする（CSS px、顔の幅は PC で約 110px）。
const X_MIN = 3, Y_MIN = 1.5, OFF_MAX = 1.5

async function open(config, prefs) {
  const context = await browser.newContext(config), page = await context.newPage()
  await context.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') { external.push(u.href); return r.abort() } return r.fallback() })
  await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
  if (prefs) await context.addInitScript(p => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), prefs)
  await page.goto('http://localhost:8774/kohako/home.html'); await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, { timeout: 60000 }); await page.waitForTimeout(1500)
  const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head)
  const clip = { x: Math.round(a.x - a.w * 0.4), y: Math.round(a.y - 10), width: Math.round(a.w * 1.8), height: Math.round(a.h * 1.6) }
  // 瞳（青）の重心（clip 内の CSS px）。襟・帯の青を拾わないよう上 6 割だけを見る。
  const eyes = async file => {
    const png = await page.screenshot({ clip, scale: 'css' }); if (file) fs.writeFileSync(`${OUT}/${file}.png`, png)
    return page.evaluate(async ([b64, w, h]) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(bm, 0, 0); const d = g.getImageData(0, 0, w, h).data; let x = 0, y = 0, n = 0; for (let j = 0; j < h * 0.6; j++) for (let i = 0; i < w; i++) { const k = 4 * (j * w + i), r = d[k], gg = d[k + 1], bb = d[k + 2]; if (bb > 110 && bb > r + 45 && bb > gg + 25) { x += i; y += j; n++ } } return n > 8 ? { x: x / n, y: y / n, n } : null }, [png.toString('base64'), clip.width, clip.height])
  }
  const follow = () => page.evaluate(() => window.__kohakoHome.report.lookFollow ?? null)
  return { context, page, a, eyes, follow }
}

// 左右（上下）を交互に rounds 回置き直し、各位置で落ち着いた後に 3 枚ずつ瞳の位置を測る。
// 待機クリップの周期と交互の周期が揃うと偏るので、待ち時間を回ごとにずらす。まばたき中（瞳の画素が少ない）の枚は除く。
const JITTER = [0, 430, 170, 610, 290, 520, 80, 370]
async function alternate(o, name, pairs, rounds = 8) {
  const samples = Object.fromEntries(pairs.map(([k]) => [k, []])), follows = Object.fromEntries(pairs.map(([k]) => [k, []]))
  for (let i = 0; i < rounds; i++) for (const [j, [k, x, y]] of pairs.entries()) {
    await o.page.mouse.move(x, y, { steps: 4 }); await o.page.waitForTimeout(800 + JITTER[(i * 3 + j * 5) % JITTER.length])
    for (let n = 0; n < 3; n++) { const m = await o.eyes(i === rounds - 1 && n === 0 ? `${name}-${k}` : null); if (m) samples[k].push(m); await o.page.waitForTimeout(170) }
    follows[k].push(await o.follow())
  }
  const all = Object.values(samples).flat().map(m => m.n).sort((a, b) => a - b), median = all[Math.floor(all.length / 2)] ?? 0
  for (const k of Object.keys(samples)) samples[k] = samples[k].filter(m => m.n >= median * 0.75)
  return { samples, follows }
}

async function desktop(name, config, prefs, expectFollow, scale = 1) {
  if (ONLY && !ONLY.includes(name)) return
  const o = await open(config, prefs), { page, a } = o, vp = page.viewportSize(), cx = a.x + a.w / 2, cy = a.y + a.h * 0.45, out = { head: a, viewport: vp }
  const lr = await alternate(o, name, [['left', 4, cy], ['right', vp.width - 4, cy]])
  const ud = await alternate(o, name, [['up', cx, 4], ['down', cx, vp.height - 4]])
  const avg = (s, k, axis) => s.samples[k].length ? mean(s.samples[k].map(m => m[axis])) : NaN
  out.eyeX = { left: r1(avg(lr, 'left', 'x')), right: r1(avg(lr, 'right', 'x')) }; out.eyeY = { up: r1(avg(ud, 'up', 'y')), down: r1(avg(ud, 'down', 'y')) }
  out.dx = r1(out.eyeX.right - out.eyeX.left); out.dy = r1(out.eyeY.down - out.eyeY.up)
  out.followLeft = lr.follows.left.at(-1); out.followRight = lr.follows.right.at(-1)
  if (expectFollow) {
    check(out.dx >= X_MIN * scale, `${name}: カーソル右と左で瞳の位置が ${X_MIN}px 以上変わらない (${out.dx}px)`)
    check(out.dy >= Y_MIN * scale, `${name}: カーソル下と上で瞳の位置が ${Y_MIN}px 以上変わらない (${out.dy}px)`)
    check(lr.follows.left.every(f => f?.active && f.current.x < -0.5 * scale) && lr.follows.right.every(f => f?.active && f.current.x > 0.5 * scale), `${name}: 追従の向きが左右に合わない`)
    // 四隅: 斜めでも合成した向きが 1 を超えない（首を伸ばしすぎない）。画像も保存する。
    out.corners = {}
    for (const [k, x, y] of [['tl', 2, 2], ['tr', vp.width - 2, 2], ['bl', 2, vp.height - 2], ['br', vp.width - 2, vp.height - 2]]) {
      await page.mouse.move(x, y, { steps: 4 }); await page.waitForTimeout(900); await o.eyes(`${name}-corner-${k}`)
      const f = await o.follow(); out.corners[k] = f && { x: r1(f.current.x * 100) / 100, y: r1(f.current.y * 100) / 100 }
      check(f && Math.hypot(f.current.x, f.current.y) <= 1.001 && Math.abs(f.current.x) > 0.4 * scale && Math.abs(f.current.y) > 0.4 * scale, `${name}: 角 ${k} の向きが範囲外 ${JSON.stringify(f?.current)}`)
    }
    // 急に反対側へ動かしても、毎フレームの変化が小さく滑らかに向き直る（首を振り回さない）。
    await page.mouse.move(4, cy, { steps: 2 }); await page.waitForTimeout(1000)
    // 急に反対へ動かしても一瞬で振り切らず（左 -0.5 → 右 +0.5 に 120ms 以上）、1.5 秒以内に向き直る。
    await page.evaluate(() => { window.__trace = []; const t0 = performance.now(); const f = () => { const c = window.__kohakoHome.report.lookFollow?.current; if (c) window.__trace.push([performance.now() - t0, c.x]); if (performance.now() - t0 < 1800) requestAnimationFrame(f) }; requestAnimationFrame(f) })
    await page.mouse.move(vp.width - 4, cy, { steps: 1 })
    const frames = []; for (let i = 0; i < 6; i++) { await page.waitForTimeout(120); frames.push(await o.eyes(`${name}-turn-${i}`)) }
    await page.waitForTimeout(600)
    const trace = await page.evaluate(() => window.__trace), at = v => trace.find(([, x]) => x >= v)?.[0], from = [...trace].reverse().find(([, x]) => x <= -0.5 * scale)?.[0] ?? 0
    out.turn = { crossMs: Math.round((at(0.5 * scale) ?? Infinity) - from), settleMs: Math.round(at(0.9 * scale) ?? Infinity), frames: frames.map(m => m && r1(m.x)), samples: trace.length }
    check(out.turn.crossMs >= 120, `${name}: 反対側へ一瞬で振り切る (${out.turn.crossMs}ms)`)
    check(out.turn.settleMs <= 1500, `${name}: 向き直りが遅すぎる (${out.turn.settleMs}ms)`)
    // 窓の外へ出たら 2 秒以内に中立へ戻る。
    await page.mouse.move(cx, cy - 300 > 0 ? cy - 300 : 2, { steps: 2 }); await page.waitForTimeout(800)
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })))
    await page.waitForTimeout(2000); const left = await o.follow(); await o.eyes(`${name}-leave`)
    out.leave = left; check(left && !left.active && left.weight < 0.01, `${name}: 窓の外へ出た後に中立へ戻らない ${JSON.stringify(left)}`)
    // 戻ったら再び追従する（離脱から復帰）。
    await page.mouse.move(vp.width - 4, cy, { steps: 3 }); await page.waitForTimeout(900); const back = await o.follow()
    check(back?.active && back.current.x > 0.5, `${name}: 窓へ戻った後に追従を再開しない`)
    // 非アクティブ（blur）でも中立へ。
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(1500); const blur = await o.follow()
    check(blur && !blur.active && blur.weight < 0.01, `${name}: blur 後に中立へ戻らない`)
    // マウスで頭をなでている間は追従を退かせ、505 のなで追従（頭の傾き）を優先する。
    const hx = a.x + a.w * 0.5, hy = a.y + a.h * 0.3
    await page.mouse.move(hx, hy); await page.waitForTimeout(600); await page.mouse.down()
    for (let i = 0; i < 6; i++) { await page.mouse.move(hx + 25, hy, { steps: 4 }); await page.mouse.move(hx - 25, hy, { steps: 4 }) }
    const petting = await page.evaluate(() => ({ look: window.__kohakoHome.report.lookFollow, pet: window.__kohakoHome.report.petFollow }))
    await page.mouse.up(); out.petting = petting
    check(petting.look && !petting.look.active && petting.look.weight < 0.05, `${name}: なで中に視線追従が退かない ${JSON.stringify(petting.look)}`)
    check(Math.abs(petting.pet.headZ) > 3, `${name}: なで中の頭の傾き（505）が出ない ${JSON.stringify(petting.pet)}`)
  } else {
    check(Math.abs(out.dx) < OFF_MAX + 1.5, `${name}: 無効なのに左右で瞳が動く (${out.dx}px)`)
    check([...lr.follows.left, ...lr.follows.right].every(f => !f || !f.active), `${name}: 無効なのに追従が有効`)
  }
  result[name] = out; console.log(name, JSON.stringify({ dx: out.dx, dy: out.dy, turn: out.turn && { crossMs: out.turn.crossMs, settleMs: out.turn.settleMs } }))
  await o.context.close()
}

// 横幅を変えたとき（リサイズ・横長）も、顔の位置を取り直して向きが合う。
async function resize() {
  if (ONLY && !ONLY.includes('resize')) return
  const o = await open({ viewport: { width: 1280, height: 800 } }), { page } = o
  await page.setViewportSize({ width: 860, height: 760 }); await page.waitForTimeout(1500)
  const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head), cx = a.x + a.w / 2, cy = a.y + a.h * 0.45
  await page.mouse.move(cx + 120, cy, { steps: 3 }); await page.waitForTimeout(900); const right = await o.follow()
  await page.mouse.move(cx - 120, cy, { steps: 3 }); await page.waitForTimeout(900); const left = await o.follow(); await o.eyes('resize-left')
  result.resize = { head: a, right, left }
  check(right?.current.x > 0.15 && left?.current.x < -0.15, `resize: 縮めた後に顔の左右で向きが合わない ${JSON.stringify({ right, left })}`)
  await o.context.close()
}

// スマホ（touch）: hover を要求せず、タップやスクロールで視線追従が動かない。頭のなでは従来どおり。
async function mobile() {
  if (ONLY && !ONLY.includes('pixel7')) return
  const o = await open(devices['Pixel 7']), { page, a } = o, out = {}
  await page.touchscreen.tap(20, 300); await page.waitForTimeout(500); out.tap = await o.follow()
  await page.mouse.wheel(0, 200); await page.waitForTimeout(400); out.scroll = await o.follow()
  const cdp = await page.context().newCDPSession(page), hx = a.x + a.w / 2, hy = a.y + a.h * 0.3
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hx, y: hy }] })
  for (let i = 0; i < 8; i++) for (const dx of [-20, 20]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hx + dx, y: hy }] })
  await page.waitForTimeout(200); out.pet = await page.evaluate(() => window.__kohakoHome.report.petFollow); out.during = await o.follow()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await o.eyes('pixel7-after-pet')
  check([out.tap, out.scroll, out.during].every(f => !f || !f.active), `pixel7: touch で視線追従が有効になった ${JSON.stringify(out)}`)
  check(Math.abs(out.pet.headZ) > 3, `pixel7: なでで頭が傾かない ${JSON.stringify(out.pet)}`)
  result.pixel7 = out; await o.context.close()
}

// 瞳の画素が十分あるよう、PC は画面倍率 2 で描画する（測定は CSS px）。
const pc = (width, height, extra = {}) => ({ viewport: { width, height }, deviceScaleFactor: 2, ...extra })
await desktop('pc', pc(1280, 800), null, true)
await desktop('wide', pc(1920, 900), null, true)
await desktop('narrow', pc(820, 720), null, true)
await desktop('subtle', pc(1280, 800), { intensity: 'subtle' }, true, 0.6)
await desktop('off', pc(1280, 800), { follow: false }, false)
await desktop('reduced', pc(1280, 800, { reducedMotion: 'reduce' }), null, false)
await resize(); await mobile()
check(external.length === 0, `外部通信: ${external.join(', ')}`)
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ result, failures, external }, null, 2))
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS'); await browser.close(); srv.close(); process.exit(failures.length ? 1 : 0)
