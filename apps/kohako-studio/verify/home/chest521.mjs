// BOXP-521: 胸の揺れ（二次動作）を最終描画の画素で確かめる回帰検査。
// Playwright の時計を固定して少しずつ進め、各時刻で「揺れを描いた絵」と、同じ瞬間を揺れを外して描き直した絵（体の動きだけ）を撮って比べる。
// 胸の範囲の画素がどれだけずれたか（px）で揺れを測り、胸の外（顔・首・腕・帯・脚）は画素一致であることを確かめる。
// 確かめること: 身振り（joy / nod）で胸が遅れて揺れる、止めると待機の小さな揺れへ戻る、待機では目立って揺れない、
// 設定 OFF・動きを減らす（アプリ設定・OS の reduced-motion）では揺れない。PC と Pixel 7 相当で行う。
// 実行: Playwright 1.56.1 のコンテナで `node chest521.mjs <build の dist> <出力先>`（BFF は完全にモック、token 不要）。失敗があれば終了コード 1。
// 出力先に各ケースの連続フレーム（胸の拡大、揺れあり／なし）と並べた画像、result.json を保存する。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'; fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const PORT = Number(process.env.PORT ?? 8777)
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(PORT)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const result = {}, failures = [], external = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const r2 = x => Math.round(x * 100) / 100
// 胸の格子の範囲（web/src/live2d/chest.ts の CHEST_BOX）と、左右の胸の中心（モデル座標）。
const BOX = { x0: 452, y0: 470, x1: 692, y1: 646 }, BUSTS = [[524, 578], [620, 578]]
const STEP = 50, FRAMES = 40, DEV = 2 // 50ms ごとに 2 秒、2 倍の解像度で撮る

async function open(config, prefs, media) {
  const context = await browser.newContext({ ...config, deviceScaleFactor: DEV, reducedMotion: media ?? 'no-preference' }), page = await context.newPage()
  await context.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') { external.push(u.href); return r.abort() } return r.fallback() })
  await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
  await context.addInitScript(p => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), prefs)
  await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
  await page.goto(`http://localhost:${PORT}/kohako/home.html`)
  for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
  // 以後は時計を止め、runFor で進めた分だけ描画を進める（撮影や計算の待ち時間で動きが進まないように）。
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 200)
  await page.clock.runFor(1500)
  // モデル座標 → canvas の画素座標。
  const L = await page.evaluate(() => { const p = window.__kohakoHome.player, l = p.layout(), r = p.canvas.getBoundingClientRect(), k = p.canvas.width / r.width; return { scale: l.scale, k, left: l.left * k, top: l.top * k, cw: p.canvas.width, ch: p.canvas.height } })
  return { context, page, L, m2s: (x, y) => [L.left + x * L.scale * L.k, L.top + y * L.scale * L.k] }
}

// a の (cx,cy) 周りの窓が b のどこへずれたかを、±R 画素の整数ずれの差の二乗和が最小になる位置で求める（canvas の画素）。
function shiftOf(a, b, cx, cy, half, R = 10) {
  let best = [0, 0], bestE = Infinity, zero = 0
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let e = 0
    for (let y = cy - half; y < cy + half; y += 2) for (let x = cx - half; x < cx + half; x += 2) { const i = 4 * (y * a.w + x), j = 4 * ((y + dy) * b.w + x + dx); for (let k = 0; k < 3; k++) { const q = a.d[i + k] - b.d[j + k]; e += q * q } }
    if (dx === 0 && dy === 0) zero = e
    if (e < bestE) { bestE = e; best = [dx, dy] }
  }
  return bestE < zero ? best : [0, 0]
}
function diffCount(a, b, skip) { let n = 0; for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (skip?.(x, y)) continue; const i = 4 * (y * a.w + x); if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) > 24) n++ } return n }

// 今の瞬間のキャラの描画面（canvas）を、揺れを描いたまま／揺れを外して描き直して読む（ばねの状態や時刻は進めない）。
// 画面のスクリーンショットではなく canvas を読むのは、背景や時計などの CSS の動きを拾わないため。clip は canvas の画素座標。
const grab = (page, clip) => page.evaluate(clip => {
  const h = window.__kohakoHome, c = h.player.canvas, want = h.prefs.chestSway && !(h.prefs.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches)
  const read = () => { h.player.draw(); const o = new OffscreenCanvas(clip.width, clip.height), g = o.getContext('2d'); g.drawImage(c, clip.x, clip.y, clip.width, clip.height, 0, 0, clip.width, clip.height); return g.getImageData(0, 0, clip.width, clip.height).data }
  const withChest = read(); h.stage.setChestMotion?.(false); const without = read(); h.stage.setChestMotion?.(want); h.player.draw()
  return [Array.from(withChest), Array.from(without)]
}, clip)
const toPng = (page, rgba, w, h) => page.evaluate(async ([d, w, h]) => { const o = new OffscreenCanvas(w, h); o.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); const b = new Uint8Array(await (await o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }, [rgba, w, h]).then(b => Buffer.from(b, 'base64'))

async function run(name, config, prefs, opts = {}) {
  if (ONLY && !ONLY.some(k => name === k)) return null
  const o = await open(config, prefs, opts.media), { page, L } = o, s = L.scale
  const box = (x0, y0, x1, y1) => { const [a0, b0] = o.m2s(x0, y0), [a1, b1] = o.m2s(x1, y1), x = Math.max(0, Math.floor(a0)), y = Math.max(0, Math.floor(b0)); return { x, y, width: Math.min(L.cw, Math.ceil(a1)) - x, height: Math.min(L.ch, Math.ceil(b1)) - y } }
  const clip = box(BOX.x0 - 30, BOX.y0 - 90, BOX.x1 + 30, BOX.y1 + 70), wide = box(150, 60, 1000, 1150)
  const px = L.k // canvas の 1 CSS px あたりの画素数
  const toDev = (mx, my, c) => { const [x, y] = o.m2s(mx, my); return [Math.round(x - c.x), Math.round(y - c.y)] }
  const inBox = c => { const [x0, y0] = toDev(BOX.x0 - 3, BOX.y0 - 3, c), [x1, y1] = toDev(BOX.x1 + 3, BOX.y1 + 3, c); return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 }
  const half = Math.max(8, Math.round(34 * s * px)), dir = `${OUT}/${name}`; fs.mkdirSync(dir, { recursive: true })
  let outside = 0
  const shot = async (label, keep, full) => {
    const area = full ? wide : clip, [da, db] = await grab(page, area), ia = { w: area.width, h: area.height, d: da }, ib = { w: area.width, h: area.height, d: db }
    if (full) { outside = Math.max(outside, diffCount(ia, ib, inBox(wide))); return null }
    const shifts = BUSTS.map(([mx, my]) => { const [x, y] = toDev(mx, my, clip); return shiftOf(ib, ia, x, y, half) })
    const chest = await page.evaluate(() => window.__kohakoHome.report.chest)
    if (keep) { fs.writeFileSync(`${dir}/${label}-with.png`, await toPng(page, da, area.width, area.height)); fs.writeFileSync(`${dir}/${label}-without.png`, await toPng(page, db, area.width, area.height)) }
    return { label, shift: shifts.map(([x, y]) => [r2(x / px), r2(y / px)]), shiftMax: r2(Math.max(...shifts.map(([x, y]) => Math.hypot(x, y))) / px), offset: chest?.offset?.map(r2) ?? null, shown: chest?.shown ?? null }
  }
  // 待機（触らない）: 0.4 秒ごとに 8 回。
  const idle = []; for (let i = 0; i < 8; i++) { await page.clock.runFor(400); idle.push(await shot(`idle-${i}`, i === 7)); if (i === 4) await shot('', false, true) }
  const gestures = {}
  for (const g of opts.gestures ?? ['joy', 'nod']) {
    await page.evaluate(g => window.__kohakoHome.stage.playGesture(g), g)
    const list = []
    for (let i = 0; i < FRAMES; i++) { await page.clock.runFor(STEP); list.push({ t: (i + 1) * STEP, ...await shot(`${g}-${String(i).padStart(2, '0')}`, true) }); if (i === 5 || i === 12) await shot('', false, true) }
    await page.clock.runFor((g === 'joy' ? 1800 : 1100) + 1500 - FRAMES * STEP) // 身振りの終わりから 1.5 秒後
    const settled = await shot(`${g}-settled`, true)
    gestures[g] = { maxShift: Math.max(...list.map(f => f.shiftMax)), maxOffset: r2(Math.max(...list.map(f => f.offset ? Math.hypot(...f.offset) : 0))), settledShift: settled.shiftMax, settledOffset: settled.offset, frames: list.map(f => [f.t, f.shiftMax, f.shift, f.offset]) }
  }
  // 連続フレームを横に並べる（上: 揺れあり、下: 同じ瞬間の揺れなし）。joy の 0.1 秒ごと。
  const files = (opts.gestures ?? ['joy'])[0] ? Array.from({ length: 14 }, (_, k) => `${(opts.gestures ?? ['joy'])[0]}-${String(1 + 2 * k).padStart(2, '0')}`) : []
  const sheet = await page.evaluate(async ({ pairs, w, h }) => { const c = new OffscreenCanvas(w * pairs.length, h * 2), g = c.getContext('2d'); for (let i = 0; i < pairs.length; i++) for (let k = 0; k < 2; k++) { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + pairs[i][k])).blob()); g.drawImage(bm, i * w, k * h, w, h) } const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }, { pairs: files.filter(f => fs.existsSync(`${dir}/${f}-with.png`)).map(f => [fs.readFileSync(`${dir}/${f}-with.png`).toString('base64'), fs.readFileSync(`${dir}/${f}-without.png`).toString('base64')]), w: clip.width, h: clip.height })
  fs.writeFileSync(`${OUT}/${name}-sheet.png`, Buffer.from(sheet, 'base64'))
  const chest = await page.evaluate(() => window.__kohakoHome.report.chest)
  result[name] = { scale: r2(s), pxPerCss: r2(px), chest, idleMax: Math.max(...idle.map(f => f.shiftMax)), idleOffsetMax: r2(Math.max(...idle.map(f => f.offset ? Math.hypot(...f.offset) : 0))), outsideDiffPixels: outside, gestures }
  await o.context.close()
  return result[name]
}

const pc = { viewport: { width: 1280, height: 800 } }, pixel = { ...devices['Pixel 7'] }
for (const [name, config] of [['pc', pc], ['pixel7', pixel]]) {
  const r = await run(name, config, { chestSway: true, bgMotion: false }); if (!r) continue
  check(r.chest?.ready === true, `${name}: 胸の格子が作られていない (${JSON.stringify(r.chest)})`)
  // スマホはキャラの描画が小さい（PC の約 0.6 倍）ので、各身振りで 1 画素以上（0.5px 以上）、少なくとも 1 つの身振りで 0.75px 以上ずれることを求める。
  check(Math.max(...Object.values(r.gestures).map(x => x.maxShift)) >= 0.75, `${name}: 胸の揺れが最終描画で見えない（最大 ${Math.max(...Object.values(r.gestures).map(x => x.maxShift))}px、0.75px 以上が必要）`)
  for (const [g, x] of Object.entries(r.gestures)) {
    check(x.maxShift >= 0.5, `${name} ${g}: 胸の揺れが最終描画で見えない（最大 ${x.maxShift}px、0.5px 以上が必要）`)
    check(x.settledShift <= 0.5, `${name} ${g}: 止めて 1.5 秒後も揺れが残る（${x.settledShift}px）`)
  }
  check(r.idleMax <= 0.5, `${name}: 待機（触らない）で胸が目立って揺れる（${r.idleMax}px）`)
  check(r.outsideDiffPixels <= 4, `${name}: 胸の外の画素が揺れで変わる（${r.outsideDiffPixels} 画素）`)
}
// 設定 OFF と動きを減らす（アプリ設定・OS）では揺れない。
for (const [name, prefs, media] of [['off', { chestSway: false, bgMotion: false }], ['reduced', { chestSway: true, reducedMotion: true }], ['osreduce', { chestSway: true, bgMotion: false }, 'reduce']]) {
  const r = await run(name, pc, prefs, { media, gestures: ['joy'] }); if (!r) continue
  const offsets = [...r.gestures.joy.frames.map(f => f[3]), r.chest?.offset].filter(Boolean)
  check(r.gestures.joy.maxShift === 0 && r.idleMax === 0, `${name}: 揺れが止まっていない（最大 ${r.gestures.joy.maxShift}px、待機 ${r.idleMax}px）`)
  check(offsets.every(v => Math.hypot(...v) === 0) && r.chest?.shown === false, `${name}: 胸の変位が 0 でない`)
}
check(external.length === 0, `外部通信 ${external.length} 件`)
result.external = external; result.failures = failures
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 1))
console.log(JSON.stringify({ failures, summary: Object.fromEntries(Object.entries(result).filter(([k]) => !['external', 'failures'].includes(k)).map(([k, v]) => [k, { scale: v.scale, idleMax: v.idleMax, idleOffsetMax: v.idleOffsetMax, outside: v.outsideDiffPixels, gestures: Object.fromEntries(Object.entries(v.gestures).map(([g, x]) => [g, { maxShift: x.maxShift, maxOffset: x.maxOffset, settled: x.settledShift }])) }])), external: external.length }, null, 1))
await browser.close(); srv.close()
process.exit(failures.length ? 1 : 0)
