// BOXP-698: 浮く椅子へ腰かける試作の実ブラウザ検証。BFF は完全にモック（token 不要）。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node seat698.mjs <build の dist> <出力先> [check|sheets|record]`（既定は全部）
//   check : 時計を止めて規則を確かめる（仕様は vault の Projects/kohako-home/seat-spec.md）。失敗があれば終了コード 1。
//   sheets: 座る・座っている間・自分から立つ・座ったままの会話 を、等間隔のコマに並べた画像にする（目で見るため。合否は出さない）。
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

/** コマを 1 枚に並べる（背景つきの画面の切り抜き）。 */
async function sheet(page, name, n, every, cols = 8, before) {
  const frames = []
  for (let i = 0; i < n; i++) {
    if (before) await before(i)
    frames.push((await page.screenshot({ clip: CLIP, type: 'jpeg', quality: 88 })).toString('base64'))
    await page.clock.runFor(every)
  }
  const p2 = await page.context().newPage()
  const b64 = await p2.evaluate(async ([frames, cols, every, w, h]) => {
    const fw = 260, fh = Math.round((fw * h) / w), o = new OffscreenCanvas(cols * fw, Math.ceil(frames.length / cols) * fh), g = o.getContext('2d')
    g.font = '14px sans-serif'
    for (let i = 0; i < frames.length; i++) {
      const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${frames[i]}`)).blob()), x = (i % cols) * fw, y = Math.floor(i / cols) * fh
      g.drawImage(img, x, y, fw, fh); g.fillStyle = '#000a'; g.fillRect(x, y, 62, 20); g.fillStyle = '#fff'; g.fillText(`${((i * every) / 1000).toFixed(2)}s`, x + 4, y + 15)
    }
    const b = new Uint8Array(await (await o.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  }, [frames, cols, every, CLIP.width, CLIP.height])
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
