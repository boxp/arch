// BOXP-605: 待機中のしぐさを実ブラウザで確かめる回帰検査。
// Playwright の時計を止めて 50ms ずつ進め、リグの評価済みパラメータ（頭・体の角度、視線、目の開き）と最終描画の canvas を読む。
// 確かめること: 待機に入ってすぐは何も出ない、各しぐさが実際に描画へ出て終わると待機クリップへ戻る、頭の角度が跳ばない、
// 時間経過で不規則に違うしぐさが出る（同じものが続かない・出ずっぱりにならない）、設定 OFF・動きを減らす（アプリ設定・OS）では出ない、
// ふれあい・会話・非表示で退く、顔の向きの上限（±15°）を超えない。
// 実行: Playwright 1.56.1 で `node idle605.mjs <build の dist> <出力先>`（BFF は完全にモック、token 不要）。失敗があれば終了コード 1。
// `PW_WS=ws://host:port/` で起動済みの Playwright サーバーへ接続できる。`ONLY=acts,natural,guards,interrupt,mobile` で絞れる。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2] ?? '/site', OUT = process.argv[3] ?? '/out'; fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, want = k => !ONLY || ONLY.includes(k)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const PORT = Number(process.env.PORT ?? 8779)
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(PORT)
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS) : await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const result = {}, failures = [], external = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const r1 = x => Math.round(x * 10) / 10
const IDS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleZ', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen']
const STEP = 50

async function open(config, prefs = {}, media) {
  const context = await browser.newContext({ ...config, reducedMotion: media ?? 'no-preference' }), page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await context.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') { external.push(u.href); return r.abort() } return r.fallback() })
  await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {} }) })
  await context.addInitScript(p => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), prefs)
  await page.clock.install({ time: new Date(process.env.AT ?? '2026-11-12T12:00:00+09:00') })
  await page.goto(`http://localhost:${PORT}/kohako/home.html`)
  for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 200)
  // 帰還の演出（着地 1 秒）が終わるまで進める。
  await page.clock.runFor(2500)
  return { context, page, errors }
}
// n 回 STEP ms ずつ進め、各時刻のパラメータと待機しぐさの状態を返す。
const sample = (page, n) => page.evaluate(async ([n, ids]) => { const h = window.__kohakoHome, p = h.player, idx = ids.map(id => p.parameters.indexOf(id)), out = []; return { n, ids, idx, out } }, [n, IDS]).then(async () => {
  const out = []
  for (let i = 0; i < n; i++) {
    await page.clock.runFor(STEP)
    out.push(await page.evaluate(ids => { const h = window.__kohakoHome, p = h.player, v = p.parameterValues(), s = h.stage.report(); return { v: ids.map(id => v[p.parameters.indexOf(id)]), idle: h.report.idle, held: !!h.report.petHeld, emotion: s.emotion, yaw: s.yaw, closed: s.petEyes } }, IDS))
  }
  return out
})
const col = (rows, id) => rows.map(r => r.v[IDS.indexOf(id)])
const maxStep = (xs) => xs.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - xs[i])), 0)
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') })
// キャラの顔まわりだけを canvas から切り出して保存する（背景の動きを拾わない）。
const faceShot = (page, name) => page.evaluate(async () => {
  const h = window.__kohakoHome; h.player.draw(); const c = h.player.canvas, a = h.hitAreas().head, r = c.getBoundingClientRect(), k = c.width / r.width
  const x = Math.max(0, (a.x - r.left - a.w * 0.6) * k), y = Math.max(0, (a.y - r.top - a.h * 0.3) * k), w = a.w * 2.2 * k, hh = a.h * 2.1 * k
  const o = new OffscreenCanvas(w, hh), g = o.getContext('2d'); g.fillStyle = '#a9a4e0'; g.fillRect(0, 0, w, hh); g.drawImage(c, x, y, w, hh, 0, 0, w, hh)
  const b = new Uint8Array(await (await o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s)
}).then(b => fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(b, 'base64')))

const PC = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }
// 各しぐさで動くはずの値（符号つきの最小変化。左右のあるものは絶対値）。待機クリップ停止中の揺れ（頭 X ±6.7°）と区別するため、
// 揺れの小さい値（頭 Z・視線・目）か、しぐさ中の平均と直前の差で見る。
const EXPECT = {
  moon: r => { const ex = col(r, 'ParamEyeBallX'), ey = col(r, 'ParamEyeBallY'), ay = col(r, 'ParamAngleY'); return Math.max(...ex) > 0.35 && Math.max(...ey) > 0.2 && Math.max(...ay) > 3 },
  tilt: r => Math.max(...col(r, 'ParamAngleZ').map(Math.abs)) > 5,
  rest: r => Math.min(...col(r, 'ParamEyeLOpen')) < 0.05 && col(r, 'ParamEyeLOpen').filter(v => v < 0.1).length * STEP / 1000 > 2,
  smile: r => r.some(x => x.emotion === 'smile'),
  down: r => Math.min(...col(r, 'ParamEyeBallY')) < -0.35 && Math.min(...col(r, 'ParamAngleY')) < -5,
  aside: r => Math.max(...col(r, 'ParamEyeBallX').map(Math.abs)) > 0.45,
  still: r => { const on = r.filter(x => x.idle?.act === 'still'); return on.length * STEP / 1000 > 6.5 && on.every(x => x.held) && Math.max(...col(on.slice(40), 'ParamAngleX').map(Math.abs)) < 8 },
}

if (want('acts')) {
  const { context, page, errors } = await open(PC)
  const acts = await page.evaluate(() => window.__kohakoHome.idleActs)
  // 待機クリップだけの動き（比較の基準）。入ってすぐは何も出ない。
  const base = await sample(page, 120)
  check(base.every(x => !x.idle?.act && !x.held), '待機に入って 6 秒以内にしぐさが出た')
  const baseRate = Math.max(maxStep(col(base, 'ParamAngleX')), maxStep(col(base, 'ParamAngleZ')))
  await shot(page, 'pc-0-idle'); await faceShot(page, 'face-0-idle')
  result.acts = { baseline: { maxStepDeg: r1(baseRate), yaw: [r1(Math.min(...col(base, 'ParamAngleX'))), r1(Math.max(...col(base, 'ParamAngleX')))] } }
  for (const act of acts) {
    await page.evaluate(a => window.__kohakoHome.playIdle(a), act)
    // 始まるまで（頭が正面近くに来るのを待つ。最長 5 秒）。
    let pre = []
    for (let i = 0; i < 140; i++) { const [x] = await sample(page, 1); if (x.idle?.act) { pre.push(x); break } pre.push(x) }
    const started = pre.at(-1).idle?.act === act
    check(started, `${act}: 始まらない（${pre.at(-1).idle?.act}）`)
    const rows = [...pre.slice(-3)]
    let peakShot = false
    for (let i = 0; i < 400; i++) {
      const [x] = await sample(page, 1); rows.push(x)
      if (!peakShot && i === 36) { await faceShot(page, `face-${act}`); await shot(page, `pc-${act}`); peakShot = true }
      if (!x.idle?.act) break
    }
    // 終わった後 3 秒（クリップへの戻り）も跳ばないことを見る。
    const tail = await sample(page, 60); rows.push(...tail)
    const seconds = rows.filter(x => x.idle?.act === act).length * STEP / 1000
    const step = { x: maxStep(col(rows, 'ParamAngleX')), y: maxStep(col(rows, 'ParamAngleY')), z: maxStep(col(rows, 'ParamAngleZ')) }
    const yawMax = Math.max(...rows.map(x => Math.abs(x.yaw)))
    check(EXPECT[act](rows), `${act}: 描画の値に出ていない`)
    check(!rows.at(-1).idle?.act && !tail.at(-1).held, `${act}: 終わっても待機クリップへ戻らない`)
    check(tail.at(-1).emotion === 'neutral', `${act}: 表情が戻らない（${tail.at(-1).emotion}）`)
    check(Math.min(...col(tail.slice(20), 'ParamEyeLOpen')) >= 0 && Math.max(...col(tail, 'ParamEyeLOpen')) > 0.95, `${act}: 目が開かない`)
    // 50ms で 2.5° を超える跳びが無い（待機クリップ自体の最大は baseline）。
    check(Math.max(step.x, step.y, step.z) < 2.5, `${act}: 頭の角度が跳ぶ（50ms で ${r1(Math.max(step.x, step.y, step.z))}°）`)
    check(yawMax <= 15.01, `${act}: 顔の向きが上限を超えた（${r1(yawMax)}°）`)
    result.acts[act] = { started, seconds: r1(seconds), maxStepDeg: { x: r1(step.x), y: r1(step.y), z: r1(step.z) }, yawMax: r1(yawMax),
      range: Object.fromEntries(IDS.map(id => [id.replace('Param', ''), [r1(Math.min(...col(rows, id))), r1(Math.max(...col(rows, id)))]])) }
    // 次のしぐさまで少し待機クリップを流す。
    await sample(page, 40)
  }
  check(errors.length === 0, `acts: ページのエラー ${errors.join(' / ')}`)
  await context.close()
}

if (want('natural')) {
  // 何も指定せず 6 分流す。出たしぐさの並び・間・出ている割合を見る。
  const { context, page, errors } = await open(PC)
  const seen = []; let before = null, endedAt = null, onFrames = 0, total = 0, t = 0
  const gaps = []
  for (let i = 0; i < 72; i++) {
    const rows = await sample(page, 100)
    for (const x of rows) {
      t += STEP / 1000; total++
      const a = x.idle?.act ?? null
      if (a && a !== 'still') onFrames++
      if (a && !before) { seen.push({ at: r1(t), act: a }); if (endedAt !== null) gaps.push(r1(t - endedAt)) }
      if (!a && before) endedAt = t
      before = a
    }
  }
  result.natural = { seconds: r1(t), acts: seen, gaps, movingShare: r1((onFrames / total) * 100) / 100 }
  check(seen.length >= 6, `natural: 6 分でしぐさが ${seen.length} 回しか出ない`)
  check(seen[0]?.at >= 6, `natural: 最初のしぐさが早い（${seen[0]?.at} 秒）`)
  check(seen.every((s, i) => i === 0 || s.act !== seen[i - 1].act), 'natural: 同じしぐさが続いた')
  check(new Set(seen.map(s => s.act)).size >= 4, `natural: 種類が少ない（${[...new Set(seen.map(s => s.act))].join(',')}）`)
  check(gaps.every(g => g >= 11.5), `natural: 間が短い（${Math.min(...gaps)} 秒）`)
  check(onFrames / total < 0.3, `natural: 動いている割合が多い（${r1((onFrames / total) * 100)}%）`)
  check(errors.length === 0, `natural: ページのエラー ${errors.join(' / ')}`)
  await context.close()
}

if (want('guards')) {
  // 設定 OFF・動きを減らす（アプリ設定・OS）では、指定しても 2 分待っても出ない。
  result.guards = {}
  for (const [name, prefs, media] of [['off', { idleActs: false }], ['reduced', { reducedMotion: true }], ['osreduce', {}, 'reduce']]) {
    const { context, page, errors } = await open(PC, prefs, media)
    await page.evaluate(() => window.__kohakoHome.playIdle('tilt'))
    const rows = await sample(page, 2400 / 4) // 30 秒は細かく見る
    let any = rows.some(x => x.idle?.act || x.held)
    for (let i = 0; i < 9 && !any; i++) { await page.clock.runFor(10000); const [x] = await sample(page, 1); any = !!(x.idle?.act || x.held) }
    check(!any, `guards ${name}: しぐさが出た`)
    check(errors.length === 0, `guards ${name}: ページのエラー ${errors.join(' / ')}`)
    result.guards[name] = { any }
    await context.close()
  }
  // 設定の表示。
  const { context, page } = await open(PC)
  await page.click('#settings-open')
  const label = await page.evaluate(() => ({ checked: document.querySelector('#pref-idle').checked, text: document.querySelector('#pref-idle').closest('label').innerText }))
  check(label.checked && /待機中のしぐさ/.test(label.text), 'guards: 設定「待機中のしぐさ」が無い・既定 ON でない')
  await page.locator('#pref-idle').uncheck()
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('kohako-home-prefs')).idleActs === false), 'guards: 設定 OFF が保存されない')
  await shot(page, 'pc-settings')
  result.guards.setting = label
  await context.close()
}

if (want('interrupt')) {
  result.interrupt = {}
  // ふれあい（メニューの「なでる」）で退く。反応の表情は消さない。
  {
    const { context, page, errors } = await open(PC)
    await page.evaluate(() => window.__kohakoHome.playIdle('moon'))
    let rows = []; for (let i = 0; i < 140; i++) { const [x] = await sample(page, 1); rows.push(x); if (x.idle?.act) break }
    rows.push(...await sample(page, 40))
    const before = rows.at(-1)
    await page.evaluate(() => document.querySelector('#touch-pat').click())
    const after = await sample(page, 40)
    const all = [...rows.slice(-10), ...after]
    const goneAt = after.findIndex(x => !x.idle?.act)
    check(before.idle?.act === 'moon', 'interrupt touch: しぐさが始まっていない')
    check(goneAt >= 0 && goneAt * STEP <= 1000, `interrupt touch: 1 秒以内に退かない（${goneAt * STEP}ms）`)
    check(after[4].emotion !== 'neutral' || after[10].emotion !== 'neutral', 'interrupt touch: ふれあいの表情が消えた')
    check(Math.max(maxStep(col(all, 'ParamAngleX')), maxStep(col(all, 'ParamAngleY')), maxStep(col(all, 'ParamAngleZ'))) < 2.5, 'interrupt touch: 頭の角度が跳ぶ')
    check(Math.abs(after.at(-1).v[IDS.indexOf('ParamEyeBallX')]) < 0.05, 'interrupt touch: 視線が戻らない')
    check(errors.length === 0, `interrupt touch: ページのエラー ${errors.join(' / ')}`)
    result.interrupt.touch = { goneMs: goneAt * STEP, emotion: after[10].emotion }
    await context.close()
  }
  // マウスを動かすと退き、カーソルを目で追う（追従）へ戻る。
  {
    const { context, page } = await open(PC)
    await page.evaluate(() => window.__kohakoHome.playIdle('down'))
    for (let i = 0; i < 140; i++) { const [x] = await sample(page, 1); if (x.idle?.act) break }
    await sample(page, 40)
    await page.mouse.move(1100, 200); await page.mouse.move(1150, 220)
    const after = await sample(page, 40)
    const goneAt = after.findIndex(x => !x.idle?.act)
    const follow = await page.evaluate(() => window.__kohakoHome.report.lookFollow)
    check(goneAt >= 0 && goneAt * STEP <= 1000, `interrupt mouse: 1 秒以内に退かない（${goneAt * STEP}ms）`)
    check(follow.active && follow.current.x > 0.3, `interrupt mouse: カーソル追従へ戻らない（${JSON.stringify(follow)}）`)
    // 動かした直後（4 秒）は新しいしぐさを始めない。
    await page.evaluate(() => window.__kohakoHome.playIdle('tilt'))
    const quiet = await sample(page, 20)
    check(quiet.every(x => !x.idle?.act), 'interrupt mouse: 操作の直後にしぐさが始まった')
    result.interrupt.mouse = { goneMs: goneAt * STEP, follow: r1(follow.current.x) }
    await context.close()
  }
  // 非表示になったら捨て、戻ってもまとめて出さない。
  {
    const { context, page } = await open(PC)
    await page.evaluate(() => window.__kohakoHome.playIdle('tilt'))
    for (let i = 0; i < 140; i++) { const [x] = await sample(page, 1); if (x.idle?.act) break }
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.clock.runFor(60000)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
    const back = await sample(page, 100)
    check(back.slice(20).every(x => !x.idle?.act && !x.held), 'interrupt hidden: 戻った直後にしぐさが出た・クリップが止まったまま')
    result.interrupt.hidden = { actsAfterReturn: back.filter(x => x.idle?.act).length }
    await context.close()
  }
}

if (want('mobile')) {
  // スマホ（縦）でも出て、終わると戻る。
  const { context, page, errors } = await open({ ...devices['Pixel 7'] })
  result.mobile = {}
  for (const act of ['moon', 'rest']) {
    await page.evaluate(a => window.__kohakoHome.playIdle(a), act)
    const rows = []; for (let i = 0; i < 140; i++) { const [x] = await sample(page, 1); rows.push(x); if (x.idle?.act) break }
    for (let i = 0; i < 400; i++) { const [x] = await sample(page, 1); rows.push(x); if (i === 36) { await shot(page, `pixel7-${act}`) } if (!x.idle?.act) break }
    rows.push(...await sample(page, 60))
    check(EXPECT[act](rows), `mobile ${act}: 描画の値に出ていない`)
    check(!rows.at(-1).held, `mobile ${act}: 待機クリップへ戻らない`)
    result.mobile[act] = { seconds: r1(rows.filter(x => x.idle?.act === act).length * STEP / 1000) }
  }
  check(errors.length === 0, `mobile: ページのエラー ${errors.join(' / ')}`)
  await context.close()
}

check(external.length === 0, `外部への通信: ${external.slice(0, 3).join(', ')}`)
result.failures = failures
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await browser.close(); srv.close()
process.exit(failures.length ? 1 : 0)
