// BOXP-698: 浮く椅子へ腰かける試作の実ブラウザ検証。BFF は完全にモック（token 不要）。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node seat698.mjs <build の dist> <出力先> [check|sheets|record]`（既定は全部）
//   check : 時計を止めて規則を確かめる（仕様は vault の Projects/kohako-home/seat-spec.md）。失敗があれば終了コード 1。
//   skirt : 上着の裾が硬い板として動くこと（S8.4。check にも含む）を、座る・立つの全コマの頂点で確かめる。太ももの絵に描き込まれた裾が画面に出ないこと（S8.9）も見る。
//   sheets: 座る・座っている間・自分から立つ・座ったままの会話 を、等間隔のコマに並べた画像にする（目で見るため。合否は出さない）。裾まわりの拡大（skirt-sit / skirt-stand）も出す。
//   record: 実時間の動画（時計は止めない）。座る → 座っている間 → マウス → 立つ、座る → 話しかけても座ったまま返事を聞く。
// BASE=<変更前の dist> を渡すと、座っていない間の描画が変更前と画素一致することも確かめる。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const SITE = process.argv[2],
  OUT = process.argv[3],
  ONLY = process.argv[4]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
// この PC の中（127.0.0.1）だけで待ち受け、dist の外を指すパスは読まずに 404 を返す。vite の dist（public が dist/kohako/ にある形）と、配備と同じ形のどちらも読める。
function serve(site) {
  const ROOT = fs.realpathSync(site)
  const inside = (url) => {
    try {
      const p = decodeURIComponent(new URL(url, 'http://x').pathname).replace(/^\/kohako\//, '/')
      if (p.includes('\0')) return null
      for (const base of [ROOT, path.join(ROOT, 'kohako')]) {
        const f = path.resolve(base, '.' + path.posix.normalize('/' + p))
        if (!fs.existsSync(f)) continue
        const real = fs.realpathSync(f)
        if (real.startsWith(ROOT + path.sep) && fs.statSync(real).isFile()) return real
      }
      return null
    } catch {
      return null
    }
  }
  const srv = http.createServer((q, r) => {
    const f = inside(q.url)
    if (!f) { r.writeHead(404); return r.end() }
    fs.readFile(f, (e, d) => {
      if (e) { r.writeHead(404); return r.end() }
      r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' })
      r.end(d)
    })
  }).listen(0, '127.0.0.1')
  return new Promise((res) => srv.on('listening', () => res({ srv, port: srv.address().port })))
}
const { srv, port } = await serve(SITE)
const base = process.env.BASE ? await serve(process.env.BASE) : null
const browser = await chromium.connect(process.env.PW_WS ?? 'ws://127.0.0.1:39698/')
fs.mkdirSync(OUT, { recursive: true })
const errors = [], failures = [], result = {}
const check = (ok, message) => { if (!ok) failures.push(message); return ok }
const CLIP = { x: 120, y: 60, width: 520, height: 700 }

async function open({ prefs = {}, media, query = '', p = port, video, viewport = { width: 1280, height: 800 }, dsf = 1, seed } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dsf, reducedMotion: media ?? 'no-preference', ...(video ? { recordVideo: { dir: video, size: viewport } } : {}) }),
    page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  // 会話の送信は受理して進行中のままにする（聞く・考えるの状態へ入る）。ほかは空の応答。
  await context.route('**/kohako/api/v1/**', (r) => {
    const q = r.request(), p = new URL(q.url()).pathname.replace('/kohako/api/v1/', '')
    return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' && q.method() === 'GET' ? { enabled: true, stt: false } : {} })
  })
  await context.addInitScript((v) => localStorage.setItem('kohako-home-prefs', JSON.stringify(v)), prefs)
  // 変更前との画素比較では、乱数を定数にする（まばたきなどの時刻をそろえる。乱数の列にすると、椅子の係が予定を決めるために 1 つ使うぶん、以後の列がずれて比較にならない）。
  if (seed != null) await context.addInitScript((s) => { Math.random = () => s }, seed)
  return { context, page, url: `http://127.0.0.1:${p}/kohako/home.html${query}` }
}
async function paused(o) {
  const { page } = o
  await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
  await page.goto(o.url)
  for (let i = 0; i < 600 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline')); i++) await page.clock.runFor(100)
  // 座り姿の絵（後から届く）が読めるまで待つ。読めない間は座らない決まり（S8.7）なので、待たないと座る確認が成り立たない。
  for (let i = 0; i < 300 && (await page.evaluate(() => window.__kohakoHome.stage?.report().seat?.textures)) === 'loading'; i++) await new Promise((r) => setTimeout(r, 100))
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 3000)
  await page.clock.runFor(8000)
}
/** 読み込みの間は時計を止めたままにする（読み込みにかかる実時間で、動きの位相が変わらないように）。画素比較用。 */
async function frozen(o) {
  const { page } = o
  await page.clock.install({ time: new Date('2026-11-12T12:00:00+09:00') })
  await page.clock.pauseAt(new Date('2026-11-12T12:00:01+09:00'))
  await page.goto(o.url)
  // 追加の腕の絵など、後から届く素材も読み終わるまで待つ（届く前後で描画が変わる）。
  for (let i = 0; i < 300 && !(await page.evaluate(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline' && window.__kohakoHome.stage?.report().parts?.textures === 'loaded')); i++) await new Promise((r) => setTimeout(r, 100))
  await new Promise((r) => setTimeout(r, 2500))
  // 読み込みの間も performance.now() だけは実時間で進み、最初の 1 コマの経過時間が回ごとに変わる。モデルの更新を固定の刻み（1/60 秒）にそろえる。
  // コマを取る時点も、時間ではなく更新の回数で決める（同じ 0.7 秒でも、描画の拍との位置で更新が 1 回多い・少ないがある）。
  await page.evaluate(() => { const p = window.__kohakoHome.player, update = p.update; window.__updates = 0; p.update = () => { window.__updates++; return update.call(p, 1 / 60) } })
}
/** モデルの更新が n 回になるまで時計を進める。 */
async function untilUpdates(page, n) {
  for (let i = 0; i < 4000 && (await page.evaluate(() => window.__updates)) < n; i++) await page.clock.runFor(4)
  return page.evaluate(() => window.__updates)
}
const seatOf = (page) => page.evaluate(() => {
  const h = window.__kohakoHome, p = h.player, bottom = (m) => { const v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, m), p.meshes[m].vertices * 2); let y = -1e9; for (let i = 1; i < v.length; i += 2) y = Math.max(y, v[i]); return y }
  h.player.draw()
  return { ...(h.report.seat ?? { phase: 'none', level: 0, chair: 0, offset: 0 }), state: h.state, frame: document.querySelector('[data-frame]')?.dataset.frame ?? null, scene: document.body.dataset.scene, idle: h.report.idle?.act ?? null, foot: bottom(27), viewY: p.view.y, stage: h.stage.report().seat }
})
/** ms ずつ進めて毎回の状態を集める。until が真になったら止める。 */
async function run(page, ms, step = 50, until) {
  const out = []
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(step)
    const s = await seatOf(page)
    out.push({ t: t + step, ...s })
    if (until?.(s)) break
  }
  return out
}
const sit = async (page) => {
  await page.evaluate(() => window.__kohakoHome.playSeat('sit'))
  const rows = await run(page, 40000, 50, (s) => s.phase === 'seated')
  return rows
}
/** 送信を受理して、返事を返さないままにする（聞いている → 考えている が続く）。これが無い模擬では送信が失敗の状態になる。 */
const pending = async (context) => {
  await context.route('**/kohako/api/v1/messages', (r) => r.fulfill({ status: 202, json: { requestId: 'verify-1', status: 'pending' } }))
  await context.route('**/kohako/api/v1/requests/**', (r) => r.fulfill({ json: { requestId: 'verify-1', status: 'pending' } }))
}
const talk = async (page) => {
  await page.locator('#message').fill('こんにちは')
  await page.locator('#send').click()
}

if (!ONLY || ONLY === 'check' || ONLY === 'base') {
 if (ONLY !== 'base') {
  // 1. 座る → 座っている → しぐさ・マウス → 自分から立つ
  {
    const o = await open(); await paused(o)
    const { page } = o
    const before = await seatOf(page)
    check(before.phase === 'standing' && before.level === 0 && before.chair === 0, `座る前が立ち姿でない ${JSON.stringify(before)}`)
    const rows = await sit(page), last = rows.at(-1), started = rows.findIndex((r) => r.phase === 'sitting')
    check(last?.phase === 'seated' && last.level === 1 && last.chair === 1, `座り切らない ${JSON.stringify(last)}`)
    check(rows.every((r) => r.chair >= r.level - 1e-9), 'S2: 椅子より先に座った形になったコマがある')
    check(rows.every((r, i) => i === 0 || r.level >= rows[i - 1].level - 1e-9), 'S2: 座る途中で座り具合が戻った')
    const took = (rows.length - started) * 50
    check(took >= 1000 && took <= 1500, `S2: 座る動きの長さが 1.25 秒前後でない（${took}ms）`)
    // S8.2: 立ち姿のひざから下は 213 上がる（拡大しない）。座り切った直後は腰を下ろした沈みが乗る前の頂点なので view とは別。
    const rise = before.foot - last.foot
    check(rise > 211 && rise < 215, `S8: 足の裏が上がる長さが 213 と違う（${rise.toFixed(1)}）`)
    check(last.stage.textures === 'loaded', `S8: 座り姿の絵が読めていない ${JSON.stringify(last.stage)}`)
    check(last.viewY > before.viewY, 'S2: 腰を下ろすぶん体が下がっていない')
    result.sit = { ms: took, footRise: +rise.toFixed(1), viewDrop: +(last.viewY - before.viewY).toFixed(2) }
    // 座っている間も待機のしぐさが出る
    await page.clock.runFor(1500)
    await page.evaluate(() => window.__kohakoHome.playIdle('tilt'))
    const acts = await run(page, 12000, 100, (s) => s.idle === 'tilt')
    check(acts.at(-1)?.idle === 'tilt' && acts.at(-1)?.phase === 'seated', 'S3: 座っている間に待機のしぐさ（小首をかしげる）が出ない')
    await run(page, 8000, 200, (s) => s.idle === null)
    // マウスを動かしても立たない
    await page.mouse.move(1100, 200); await page.mouse.move(1150, 220)
    const moved = await run(page, 3000, 100)
    check(moved.every((r) => r.phase === 'seated' && r.level === 1), 'S3: マウスを動かしたら立った')
    // 足のぶらぶら（座って 8〜13 秒の間に出る）と浮遊の上下
    const seated = await run(page, 14000, 100)
    const swings = seated.map((r) => r.stage.swingRight)
    check(Math.max(...swings) > 0.5 && Math.min(...swings) < -0.5, 'S3: 足のぶらぶらが出ない')
    check(seated.every((r) => Math.abs(r.stage.swingRight + r.stage.swingLeft) < 1e-9), 'S3: 左右の足が逆の拍でない')
    const offs = seated.map((r) => r.offset)
    check(Math.max(...offs) - Math.min(...offs) > 5 && Math.max(...offs) - Math.min(...offs) < 9, `S3: 浮遊の上下が約 ±4 でない（${(Math.max(...offs) - Math.min(...offs)).toFixed(2)}）`)
    // 自分から立つ
    await page.evaluate(() => window.__kohakoHome.playSeat('stand'))
    const up = await run(page, 20000, 50, (s) => s.phase === 'standing'), rising = up.filter((r) => r.phase === 'rising')
    check(up.at(-1)?.phase === 'standing', 'S4: 立ち切らない')
    check(rising.every((r) => r.chair >= r.level - 1e-9), 'S4: 立つ途中で椅子が先に消えた')
    check(rising.length * 50 >= 1200 && rising.length * 50 <= 1400, `S4: 立つ動きの長さが 1.3 秒でない（${rising.length * 50}ms）`)
    const after = await seatOf(page)
    check(Math.abs(after.foot - before.foot) < 0.01 && Math.abs(after.viewY - before.viewY) < 1e-6, `S4: 立った後に足・体の位置が元へ戻らない ${JSON.stringify([before.foot, after.foot, before.viewY, after.viewY])}`)
    result.stand = { ms: rising.length * 50 }
    await o.context.close()
  }
  // 2. 話しかけても立たない（S3.7・S3.8。TD-03）／動きを減らすへ変えたら急いで立つ（S5）／非表示ではすぐ立ち姿
  {
    const o = await open(); await paused(o)
    const { page } = o
    await pending(o.context)
    await sit(page); await page.clock.runFor(2000)
    await talk(page)
    // 模擬は返事を返さないので、聞いている → 考えている → 考えが長引いて作業中の場面（上半身だけの枠）まで進む。
    const rows = await run(page, 30000, 100), left = rows.findIndex((r) => r.state !== 'idle')
    check(left >= 0, `話しかけても状態が変わらない（${rows.at(-1)?.state}）`)
    check(rows.every((r) => r.phase === 'seated' && r.level === 1 && r.chair === 1), `S3.7: 話しかけたら立った ${JSON.stringify(rows.find((r) => r.phase !== 'seated'))}`)
    check(rows.every((r) => r.stage.level === 1), 'S3.7: 会話中に描画の座り具合が 1 でない')
    const upper = rows.filter((r) => r.frame === 'upper')
    check(upper.length > 0, `S3.8: 上半身だけの枠まで進まなかった（確認が成り立たない。場面 ${[...new Set(rows.map((r) => r.scene))]}）`)
    const offs = rows.slice(left).map((r) => r.offset)
    check(Math.max(...offs) - Math.min(...offs) > 5, 'S3.7: 会話中に浮き沈みが止まった')
    result.talkSeated = { stateChangedMs: (left + 1) * 100, states: [...new Set(rows.map((r) => r.state))], scenes: [...new Set(rows.map((r) => r.scene))], upperFrameMs: upper.length * 100 }
    await page.screenshot({ path: path.join(OUT, 'check-talk-upper-frame.png') })
    // S5: 座ったままの会話の途中で「動きを減らす」（OS）へ変えた → 0.4 秒で立ち姿・0.6 秒で椅子なし。
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const up = await run(page, 2000, 25), stood = up.findIndex((r) => r.level === 0), gone = up.findIndex((r) => r.chair === 0)
    check(stood >= 0 && (stood + 1) * 25 <= 450, `S5: 動きを減らすへ変えて 0.45 秒以内に立ち姿へ戻らない（${(stood + 1) * 25}ms）`)
    check(gone >= 0 && (gone + 1) * 25 <= 650, `S5: 椅子が 0.65 秒以内に消えない（${(gone + 1) * 25}ms）`)
    check(up.every((r) => r.chair >= r.level - 1e-9), 'S5: 急いで立つ途中で椅子が先に消えた')
    result.urgent = { standMs: (stood + 1) * 25, chairGoneMs: (gone + 1) * 25 }
    await o.context.close()
  }
  {
    const o = await open(); await paused(o)
    const { page } = o
    await sit(page); await page.clock.runFor(2000)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
    const back = await run(page, 3000, 100)
    check(back.every((r) => r.phase === 'standing' && r.level === 0 && r.chair === 0), 'S6: 非表示から戻った時に立ち姿でない')
    await o.context.close()
  }
  // 3. 座る途中で話しかける
  {
    const o = await open(); await paused(o)
    const { page } = o
    await page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    await run(page, 40000, 50, (s) => s.phase === 'sitting' && s.level > 0.3)
    await talk(page)
    const rows = await run(page, 3000, 25), left = rows.findIndex((r) => r.state !== 'idle')
    check(left >= 0, '座る途中に話しかけても状態が変わらない')
    check(rows.every((r, i) => i === 0 || r.level >= rows[i - 1].level - 1e-9), 'S3.9: 座る途中の会話で座り具合が戻った')
    check(rows.at(-1)?.phase === 'seated' && rows.at(-1)?.level === 1, `S3.9: 座る途中の会話で座り切らない ${JSON.stringify(rows.at(-1))}`)
    await o.context.close()
  }
  // 4. 出ない設定
  for (const [name, prefs, media, query, viewport] of [['待機中のしぐさ OFF', { idleActs: false }], ['動きを減らす', { reducedMotion: true }], ['OS の動きを減らす', {}, 'reduce'], ['?seat=off', {}, undefined, '?seat=off'], ['縦長の画面（上半身だけの枠）', {}, undefined, '', { width: 390, height: 844 }]]) {
    const o = await open({ prefs, media, query, ...(viewport ? { viewport } : {}) }); await paused(o)
    await o.page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    const rows = await run(o.page, 20000, 500)
    check(rows.every((r) => r.level === 0 && r.chair === 0 && (r.stage?.level ?? 0) === 0), `S1: ${name} で座った`)
    await o.context.close()
  }
  // 5. 何も指定しなければ 20〜40 秒で最初に座る（待機のしぐさの切れ目を待つぶん遅れることがある）
  {
    const o = await open(); await paused(o)
    const rows = await run(o.page, 80000, 250, (s) => s.phase === 'sitting')
    // 読み込み完了からの秒: paused() が進める 3 + 8 秒を足す。
    const at = 11 + rows.length * 0.25
    check(rows.at(-1)?.phase === 'sitting' && at >= 20 && at <= 60, `S1: 最初に座るのが 20〜40 秒（＋しぐさ待ち）でない（${at}s）`)
    result.firstSitSeconds = at
    await o.context.close()
  }
  }
  // 6. 座っていない間の描画は変更前と同じ
  if (base) {
    // アバターの canvas だけを比べる（背景の花びらなどは DOM で、乱数で動く）。同じ build 同士が一致することも確かめ、比較そのものが成り立つことを見る。
    const shot = async (p) => {
      const o = await open({ prefs: { idleActs: false }, p, seed: 0.37 }); await frozen(o)
      const hashes = []
      for (let i = 0; i < 6; i++) {
        const n = await untilUpdates(o.page, 480 + i * 40)
        if (n !== 480 + i * 40) hashes.push(`updates=${n}`)
        hashes.push(await o.page.evaluate(async () => {
          const h = window.__kohakoHome, c = h.player.canvas; h.player.draw()
          const o = new OffscreenCanvas(c.width, c.height), g = o.getContext('2d'); g.drawImage(c, 0, 0)
          const d = await crypto.subtle.digest('SHA-256', g.getImageData(0, 0, c.width, c.height).data)
          return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
        }))
      }
      await o.context.close(); return hashes.join(',')
    }
    const a = await shot(base.port), a2 = await shot(base.port), b = await shot(port)
    check(a === a2, 'S7: 変更前の build 同士で描画が一致しない（比較が成り立たない）')
    check(a === b, 'S7: 座っていない間の描画が変更前と画素一致しない')
    result.sameAsBase = { frames: 6, baseRepeatable: a === a2, same: a === b }
  }
}

const save = () => fs.writeFileSync(path.join(OUT, 'seat698.json'), JSON.stringify({ result, failures, errors }, null, 2))
save()

// 3. 上着の裾は硬い板として動く（S8.4。TD-04）。立ち姿の頂点 → いまの頂点が、板ごとに 1 つの 1 次変換で表せること（折れ・たわみが無い）を全コマで見る。
if (!ONLY || ONLY === 'check' || ONLY === 'skirt') {
  const o = await open(); await paused(o)
  const { page } = o
  const skirtOf = () => page.evaluate(() => {
    const h = window.__kohakoHome, p = h.player
    p.draw()
    const v = {}
    for (const m of [24, 25]) v[m] = Array.from(new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, m), p.meshes[m].vertices * 2))
    const n = p.rt.p2l_render_commands(p.rig, p.commandsPointer, p.commandCapacity)
    return { level: h.report.seat?.level ?? 0, phase: h.report.seat?.phase, v, order: Array.from(new Int32Array(p.rt.memory.buffer, p.commandsPointer, n)) }
  })
  /** 立ち姿の頂点 a → いまの頂点 b への最小二乗の 1 次変換と、そこからの外れの最大（モデル座標の長さ）。 */
  const fit = (a, b) => {
    const n = a.length / 2
    let sx = 0, sy = 0
    for (let i = 0; i < n; i++) { sx += a[2 * i]; sy += a[2 * i + 1] }
    const mx = sx / n, my = sy / n
    let xx = 0, xy = 0, yy = 0
    const r = [[0, 0, 0], [0, 0, 0]]
    for (let i = 0; i < n; i++) {
      const x = a[2 * i] - mx, y = a[2 * i + 1] - my
      xx += x * x; xy += x * y; yy += y * y
      for (const k of [0, 1]) { r[k][0] += x * b[2 * i + k]; r[k][1] += y * b[2 * i + k]; r[k][2] += b[2 * i + k] }
    }
    const det = xx * yy - xy * xy, m = r.map(([px, py, pc]) => [(px * yy - py * xy) / det, (py * xx - px * xy) / det, pc / n])
    let worst = 0
    for (let i = 0; i < n; i++) {
      const x = a[2 * i] - mx, y = a[2 * i + 1] - my
      worst = Math.max(worst, Math.hypot(m[0][0] * x + m[0][1] * y + m[0][2] - b[2 * i], m[1][0] * x + m[1][1] * y + m[1][2] - b[2 * i + 1]))
    }
    const at = (x, y) => [m[0][0] * (x - mx) + m[0][1] * (y - my) + m[0][2], m[1][0] * (x - mx) + m[1][1] * (y - my) + m[1][2]]
    return { worst, at }
  }
  const HINGE = { 24: [688, 790], 25: [458, 790] }
  const stand = await skirtOf()
  const seen = { worst: 0, hinge: 0, frames: 0 }, hems = []
  const watch = async (what, done) => {
    await page.evaluate((w) => window.__kohakoHome.playSeat(w), what)
    for (let t = 0; t < 40000; t += 25) {
      await page.clock.runFor(25)
      const now = await skirtOf()
      if (now.level > 0 && now.level < 1) {
        seen.frames++
        for (const m of [24, 25]) {
          const q = fit(stand.v[m], now.v[m]), h = q.at(...HINGE[m])
          seen.worst = Math.max(seen.worst, q.worst)
          seen.hinge = Math.max(seen.hinge, Math.hypot(h[0] - HINGE[m][0], h[1] - HINGE[m][1]))
        }
        // 裾の下端（いちばん下の頂点の高さ）
        hems.push({ what, level: now.level, y: Math.max(...now.v[25].filter((_, i) => i % 2 === 1)) })
      }
      if (now.phase === done) return now
    }
    return null
  }
  const seated = await watch('sit', 'seated')
  check(seated?.level === 1, '裾: 座り切らない')
  check(seen.frames >= 30, `裾: 座る途中のコマが足りない（${seen.frames}）`)
  if (seated) {
    for (const m of [24, 25]) {
      const q = fit(stand.v[m], seated.v[m]), h = q.at(...HINGE[m])
      seen.worst = Math.max(seen.worst, q.worst)
      seen.hinge = Math.max(seen.hinge, Math.hypot(h[0] - HINGE[m][0], h[1] - HINGE[m][1]))
    }
    // 描く順: 太もも・ひざから下の絵（足した層）のすぐ手前に左の裾、その次が右の裾（裾は絵の手前）。
    const i25 = seated.order.indexOf(25), i24 = seated.order.indexOf(24), added = (c) => c > 31 && !stand.order.includes(c)
    check(i25 >= 3 && i24 === i25 + 1 && [1, 2, 3].every((k) => added(seated.order[i25 - k])), `S8.4: 座っている間の描く順で、裾が絵の手前にない ${JSON.stringify(seated.order.slice(Math.max(0, i25 - 4), i25 + 3))}`)
  }
  await page.clock.runFor(2000)
  const stood = await watch('stand', 'standing')
  check(stood?.level === 0, '裾: 立ち切らない')
  if (stood) for (const m of [24, 25]) check(fit(stand.v[m], stood.v[m]).worst < 1.5, `S7: 立った後に裾の層 ${m} が立ち姿の形へ戻らない`)
  // 線は 2.5: 頂点は体の動き（息・腰を下ろす時の揺れ）でも少し変形し、同じ build でも回によって 0.8〜1.9 になる（硬い板にする前は 38.1）。板そのものの決まりは単体テストで厳密に見る。
  check(seen.worst < 2.5, `S8.4 ②: 裾の板が折れている・たわんでいる（1 つの 1 次変換からの外れ 最大 ${seen.worst.toFixed(2)}）`)
  // 支点の写り先のずれは合否にしない: 頂点は体の動き（腰を下ろす時の体の揺れなど）ごと動くので、体が動いたぶんもここに入る。支点が動かないこと（S8.4 ①）は単体テストで見る。
  const sitHems = hems.filter((r) => r.what === 'sit')
  check(sitHems.every((r, i) => i === 0 || r.y <= sitHems[i - 1].y + 0.5), 'S8.4 ④: 座る途中で裾の下端が下がったコマがある')
  result.skirt = { frames: seen.frames, affineResidualMax: +seen.worst.toFixed(3), hingeWithBodyMoveMax: +seen.hinge.toFixed(3), hemFrom: +(sitHems[0]?.y ?? 0).toFixed(1), hemTo: +(sitHems.at(-1)?.y ?? 0).toFixed(1) }
  await o.context.close()
  save()
  // S8.9・S8.10 (a)（TD-05）: 太ももの絵に描き込まれた裾は、どのコマでも画面に出ない。絵の「残す線」（S8.10。S8.9 の折れ線より 8 内側）より外の画素を真緑に塗った絵へ差し替えて開き、座る・座っている・立つの画面に緑が出ないことを見る（線の内側に残っていた縁取りと紫も含む）。
  {
    const EDGE = [[0, 260], [58, 252], [68, 238], [103, 205], [124, 184], [150, 169], [190, 154], [226, 143], [238, 136], [352, 136]]
    const m = await open(), mp = await m.context.newPage()
    await mp.goto(m.url.replace('home.html', 'live2d/seat/seat-hips-thighs.png'))
    const marked = await mp.evaluate(async (edge) => {
      const img = new Image(); img.src = location.href; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height)
      const limit = (y) => { let i = 1; while (i < edge.length - 1 && y > edge[i][0]) i++; const [y0, x0] = edge[i - 1], [y1, x1] = edge[i]; return x0 + (x1 - x0) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0))) + 8 * Math.max(0, Math.min(1, (238 - y) / 12)) }
      let n = 0
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = 4 * (y * c.width + x)
        if (d.data[i + 3] > 0 && Math.min(x, c.width - 1 - x) < limit(y)) { d.data[i] = 0; d.data[i + 1] = 255; d.data[i + 2] = 0; d.data[i + 3] = 255; n++ }
      }
      g.putImageData(d, 0, 0)
      return { png: c.toDataURL('image/png').split(',')[1], n, size: [c.width, c.height] }
    }, EDGE)
    await m.context.close()
    check(marked.size[0] === 659 && marked.size[1] === 352 && marked.n > 30000, `S8.9: 絵の大きさ・裾の画素数が想定と違う ${JSON.stringify([marked.size, marked.n])}`)
    const g = await open({ dsf: 2 })
    await g.context.route('**/seat-hips-thighs.png', (r) => r.fulfill({ contentType: 'image/png', body: Buffer.from(marked.png, 'base64') }))
    await paused(g)
    const REMNANT_CLIP = { x: 120, y: 280, width: 520, height: 300 }
    /** 画面の切り抜きの中の緑（半透明で混ざったものも含む）の画素数。 */
    const greens = async () => {
      const shot = (await g.page.screenshot({ clip: REMNANT_CLIP, type: 'png' })).toString('base64')
      return g.page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
        const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
        const d = x.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 60 && d[i + 1] > d[i + 2] + 60) n++
        return n
      }, shot)
    }
    const seen = { frames: 0, worst: 0, at: null }
    const look = async (label) => { const n = await greens(); seen.frames++; if (n > seen.worst) { seen.worst = n; seen.at = label } }
    check((await greens()) === 0, 'S8.9: 立ち姿の画面に緑がある（数え方の誤り）')
    await g.page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    for (let t = 0; t < 60000; t += 50) { await g.page.clock.runFor(50); const s = await seatOf(g.page); if (s.phase === 'sitting') await look(`sit ${s.level.toFixed(2)}`); if (s.phase === 'seated') break }
    check(seen.frames >= 15, `S8.9: 座る途中のコマが足りない（${seen.frames}）`)
    // 座っている間（浮き沈み・足のぶらぶら・待機のしぐさで体が動く間も）
    for (let i = 0; i < 12; i++) { await g.page.clock.runFor(500); await look(`seated ${i}`) }
    await g.page.evaluate(() => window.__kohakoHome.playIdle('tilt'))
    for (let i = 0; i < 12; i++) { await g.page.clock.runFor(250); await look(`tilt ${i}`) }
    await g.page.clock.runFor(4000)
    await g.page.evaluate(() => window.__kohakoHome.playSeat('stand'))
    for (let t = 0; t < 30000; t += 50) { await g.page.clock.runFor(50); const s = await seatOf(g.page); if (s.phase === 'rising') await look(`stand ${s.level.toFixed(2)}`); if (s.phase === 'standing') break }
    check(seen.worst === 0, `S8.9: 絵に描き込まれた裾が画面に出ている（最大 ${seen.worst} 画素、${seen.at}。見たコマ ${seen.frames}）`)
    result.skirtRemnant = { frames: seen.frames, greenMax: seen.worst, at: seen.at, markedPixels: marked.n }
    await g.context.close()
    save()
  }
  // S8.10 (b)（TD-05 の再指摘）: 太ももの絵を切った境目は、いつも裾の板の下にある。残す線のすぐ内側 12 画素（塗り足しの色を選ぶ画素）を真緑にした絵へ差し替えると、塗り足し（幅 40）も緑になる。
  // 画面の各行で緑が横に続く長さ（絵の画素に直す）が 12 + 30 以下 = 塗り足しの外の 10 画素以上は板の下に隠れている（板と太ももの間に隙間が無い）ことを、座る・座っている・視線の追従・待機のしぐさ・立つで見る。
  {
    const EDGE = [[0, 260], [58, 252], [68, 238], [103, 205], [124, 184], [150, 169], [190, 154], [226, 143], [238, 136], [352, 136]]
    const m = await open(), mp = await m.context.newPage()
    await mp.goto(m.url.replace('home.html', 'live2d/seat/seat-hips-thighs.png'))
    const png = await mp.evaluate(async (edge) => {
      const img = new Image(); img.src = location.href; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height)
      const limit = (y) => { let i = 1; while (i < edge.length - 1 && y > edge[i][0]) i++; const [y0, x0] = edge[i - 1], [y1, x1] = edge[i]; return x0 + (x1 - x0) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0))) + 8 * Math.max(0, Math.min(1, (238 - y) / 12)) }
      for (let y = 0; y < 238; y++) for (let k = 0; k < 12; k++) for (const x of [Math.ceil(limit(y)) + k, c.width - 1 - Math.ceil(limit(y)) - k]) d.data.set([0, 255, 0, 255], 4 * (y * c.width + x))
      g.putImageData(d, 0, 0)
      return c.toDataURL('image/png').split(',')[1]
    }, EDGE)
    await m.context.close()
    const g = await open({ dsf: 2 })
    await g.context.route('**/seat-hips-thighs.png', (r) => r.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }))
    await paused(g)
    const SEAM_CLIP = { x: 120, y: 280, width: 520, height: 300 }
    /** 画面の切り抜きの各行で、真緑が横に続く最長の長さ（絵の画素）。 */
    const run = async () => {
      const shot = (await g.page.screenshot({ clip: SEAM_CLIP, type: 'png' })).toString('base64')
      return g.page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
        const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
        const d = x.getImageData(0, 0, c.width, c.height).data
        let best = 0
        for (let y = 0; y < c.height; y++) { let n = 0; for (let px = 0; px < c.width; px++) { const i = 4 * (y * c.width + px); if (d[i + 1] > d[i] + 60 && d[i + 1] > d[i + 2] + 60) { n++; if (n > best) best = n } else n = 0 } }
        const p = window.__kohakoHome.player, canvas = document.getElementById('rig')
        return best / ((canvas.clientHeight * p.view.zoom) / p.height) / (img.width / 520)
      }, shot)
    }
    const seen = { frames: 0, worst: 0, at: null, least: 1e9 }
    const look = async (label) => { const n = await run(); seen.frames++; seen.least = Math.min(seen.least, n); if (n > seen.worst) { seen.worst = n; seen.at = label } }
    check((await run()) === 0, 'S8.10: 立ち姿の画面に緑がある（数え方の誤り）')
    await g.page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    for (let t = 0; t < 60000; t += 50) { await g.page.clock.runFor(50); const s = await seatOf(g.page); if (s.phase === 'sitting' && s.level >= 0.8) await look(`sit ${s.level.toFixed(2)}`); if (s.phase === 'seated') break }
    for (let i = 0; i < 12; i++) { await g.page.clock.runFor(500); await look(`seated ${i}`) }
    // 視線の追従（体ごと左右・上下へ向く）
    for (const [x, y] of [[60, 400], [1250, 400], [400, 20], [400, 790], [640, 400]]) { await g.page.mouse.move(x, y, { steps: 4 }); for (let i = 0; i < 4; i++) { await g.page.clock.runFor(400); await look(`look ${x},${y} ${i}`) } }
    // 待機のしぐさ（全種）
    for (const act of await g.page.evaluate(() => window.__kohakoHome.idleActs)) {
      await g.page.evaluate((a) => window.__kohakoHome.playIdle(a), act)
      for (let t = 0; t < 15000; t += 100) { await g.page.clock.runFor(100); if ((await seatOf(g.page)).idle === act) break }
      for (let i = 0; i < 8; i++) { await g.page.clock.runFor(400); await look(`${act} ${i}`) }
      for (let t = 0; t < 15000; t += 200) { await g.page.clock.runFor(200); if ((await seatOf(g.page)).idle === null) break }
    }
    await g.page.clock.runFor(1000)
    await g.page.evaluate(() => window.__kohakoHome.playSeat('stand'))
    for (let t = 0; t < 30000; t += 50) { await g.page.clock.runFor(50); const s = await seatOf(g.page); if (s.phase === 'rising' && s.level >= 0.8) await look(`stand ${s.level.toFixed(2)}`); if (s.phase === 'standing') break }
    check(seen.frames >= 100, `S8.10: 見たコマが足りない（${seen.frames}）`)
    check(seen.worst > 3, `S8.10: 緑がほとんど見えない（差し替えが効いていない。最大 ${seen.worst.toFixed(1)}）`)
    check(seen.worst <= 42.5, `S8.10 (b): 塗り足しの外の端が裾の板の下から出かかっている（緑の続く長さ 最大 ${seen.worst.toFixed(1)} 画素 > 42、${seen.at}。見たコマ ${seen.frames}）`)
    result.thighSeam = { frames: seen.frames, greenRunMax: +seen.worst.toFixed(1), greenRunMin: +seen.least.toFixed(1), at: seen.at, limit: 42 }
    await g.context.close()
    save()
  }
}

/** コマを 1 枚に並べる（背景つきの画面の切り抜き）。 */
async function sheet(page, name, n, every, cols = 8, before, clip = CLIP, fw = 260) {
  const frames = []
  for (let i = 0; i < n; i++) {
    if (before) await before(i)
    frames.push((await page.screenshot({ clip, type: 'jpeg', quality: 88 })).toString('base64'))
    await page.clock.runFor(every)
  }
  const p2 = await page.context().newPage()
  const b64 = await p2.evaluate(async ([frames, cols, every, w, h, fw]) => {
    const fh = Math.round((fw * h) / w), o = new OffscreenCanvas(cols * fw, Math.ceil(frames.length / cols) * fh), g = o.getContext('2d')
    g.font = '14px sans-serif'
    for (let i = 0; i < frames.length; i++) {
      const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${frames[i]}`)).blob()), x = (i % cols) * fw, y = Math.floor(i / cols) * fh
      g.drawImage(img, x, y, fw, fh); g.fillStyle = '#000a'; g.fillRect(x, y, 62, 20); g.fillStyle = '#fff'; g.fillText(`${((i * every) / 1000).toFixed(2)}s`, x + 4, y + 15)
    }
    const b = new Uint8Array(await (await o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  }, [frames, cols, every, clip.width, clip.height, fw])
  await p2.close()
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'))
}
if (!ONLY || ONLY === 'sheets') {
  const o = await open({ dsf: 2 }); await paused(o)
  const { page } = o
  await page.screenshot({ path: path.join(OUT, 'standing.png'), clip: CLIP })
  await page.evaluate(() => window.__kohakoHome.playSeat('sit'))
  await run(page, 40000, 20, (s) => s.phase === 'sitting')
  await sheet(page, 'sit', 24, 80)
  await page.clock.runFor(1000)
  await page.screenshot({ path: path.join(OUT, 'seated.png'), clip: CLIP })
  await page.clock.runFor(5500)
  await sheet(page, 'seated-dangle', 16, 250)
  await page.evaluate(() => window.__kohakoHome.playIdle('tidy'))
  await run(page, 12000, 100, (s) => s.idle === 'tidy')
  await page.clock.runFor(2500)
  await page.screenshot({ path: path.join(OUT, 'seated-tidy.png'), clip: CLIP })
  await run(page, 12000, 200, (s) => s.idle === null)
  await page.evaluate(() => window.__kohakoHome.playSeat('stand'))
  await run(page, 20000, 20, (s) => s.phase === 'rising')
  await sheet(page, 'stand', 24, 70)
  await sit(page); await page.clock.runFor(2000)
  await talk(page)
  await sheet(page, 'seated-talk', 16, 400)
  await o.context.close()
  // 裾まわりの拡大（S8.4。TD-04）: 座る・立つを 0.06 秒刻みで。
  {
    const z = await open({ dsf: 2 }); await paused(z)
    const SKIRT_CLIP = { x: 150, y: 310, width: 460, height: 230 }
    await z.page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    await run(z.page, 40000, 20, (s) => s.phase === 'sitting')
    await sheet(z.page, 'skirt-sit', 24, 60, 4, undefined, SKIRT_CLIP, 460)
    await z.page.clock.runFor(1500)
    await z.page.evaluate(() => window.__kohakoHome.playSeat('stand'))
    await run(z.page, 20000, 20, (s) => s.phase === 'rising')
    await sheet(z.page, 'skirt-stand', 24, 60, 4, undefined, SKIRT_CLIP, 460)
    await z.context.close()
  }
}
if (!ONLY || ONLY === 'record') {
  const dir = path.join(OUT, 'video-tmp')
  const wait = (page, ms) => page.waitForTimeout(ms)
  const until = async (page, f, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(f)) return true; await wait(page, 100) } return false }
  const meta = {}
  for (const scene of ['01-sit-seated-stand', '02-sit-talk-seated']) {
    const o = await open({ query: '?seat=now', video: dir }), { page } = o, t0 = Date.now(), mark = (k) => { (meta[scene] ??= {})[k] = +((Date.now() - t0) / 1000).toFixed(2) }
    // 録画では、送信に返事が返る模擬にする（受理 → 3 回目の照会で返事）。規則の確認（check）は進行中のままの模擬。
    let polls = 0
    await o.context.route('**/kohako/api/v1/messages', (r) => { polls = 0; return r.fulfill({ status: 202, json: { requestId: 'verify-1', status: 'pending' } }) })
    await o.context.route('**/kohako/api/v1/requests/**', (r) => r.fulfill({ json: ++polls > 2 ? { requestId: 'verify-1', status: 'done', reply: { text: 'はい、こんにちは。座ったままでお話ししますね。' } } : { requestId: 'verify-1', status: 'pending' } }))
    await page.goto(o.url)
    check(await until(page, () => window.__kohakoHome?.report.seat?.phase === 'sitting'), `${scene}: 実時間で座り始めない`); mark('sit')
    check(await until(page, () => window.__kohakoHome?.report.seat?.phase === 'seated', 5000), `${scene}: 実時間で座り切らない`); mark('seated')
    if (scene.startsWith('01')) {
      await wait(page, 16000); mark('mouse')
      await page.mouse.move(1100, 200, { steps: 10 }); await page.mouse.move(900, 400, { steps: 10 })
      await wait(page, 6000); mark('stand')
      await page.evaluate(() => window.__kohakoHome.playSeat('stand'))
      check(await until(page, () => window.__kohakoHome?.report.seat?.phase === 'standing', 30000), `${scene}: 実時間で立ち切らない`); mark('standing')
      await wait(page, 2500)
    } else {
      await wait(page, 5000); mark('talk')
      await talk(page)
      check(await until(page, () => !!document.querySelector('#reply')?.dataset.reply, 30000), `${scene}: 模擬の返事が表示されない`); mark('reply')
      await wait(page, 6000)
      check(await page.evaluate(() => window.__kohakoHome?.report.seat?.phase === 'seated' && window.__kohakoHome.report.seat.level === 1), `${scene}: 返事の後に座ったままでない`); mark('still-seated')
    }
    mark('end')
    const video = page.video()
    await o.context.close()
    // 別ホストのブラウザ（PW_WS）でも取れるよう、saveAs で手元へ写す。
    await video.saveAs(path.join(OUT, `${scene}.webm`))
  }
  fs.rmSync(dir, { recursive: true, force: true })
  fs.writeFileSync(path.join(OUT, 'recording-meta.json'), JSON.stringify({ note: '時刻は読み込み開始からの秒（実時間）。動画はそれより 1〜2 秒早く始まる（ブラウザの画面を作った時点から録る）ので、動画の中の時刻はそのぶん後ろへずれる。画面は 1280x800 の家の画面そのまま（API は模擬、未ログイン）。', scenes: meta }, null, 2))
  result.record = meta
}
if (errors.length) failures.push(`ページのエラー: ${errors.join(' / ')}`)
save()
console.log(JSON.stringify({ result, failures }, null, 2))
await browser.close(); srv.close(); base?.srv.close()
process.exit(failures.length ? 1 : 0)
