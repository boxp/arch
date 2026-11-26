// BOXP-716: Keshin2D の試作（/kohako/keshin.html）と通常版の家（/kohako/home.html）を、同じ台本・同じ画面の大きさ・通常の速さで録画する。
// 仕様は vault の Projects/kohako-home/keshin2d-trial-716.md の K3。BFF は完全に模擬（token 不要）。合否は出さず、録画と時刻（meta.json）を出す。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node keshin716.mjs <候補の版の build の dist> <出力先> [A|B|phone]`（既定は全部）
//   A    : 待機 → 4 秒で送信 → 模擬の返事（3 回目の照会）→ 話す。家で測った「考えている」「話している」の時刻を、試作の台本へそのまま渡す。
//   B    : 座り切って 2 秒後から、マウスを 左 → 右 → 上 → まん中 へ 2 秒ずつ。家は playSeat('sit')、試作は「台本B」。
//   phone: 390x844 で A。
// 出力: <台本>-home.webm / <台本>-keshin.webm と meta.json（録画の始まりからの各時刻・秒）。左右に並べるのは compose716.sh。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const SITE = process.argv[2],
  OUT = process.argv[3],
  ONLY = process.argv[4]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
// この PC の中（127.0.0.1）だけで待ち受け、dist の外を指すパスは読まずに 404 を返す。
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
const browser = await chromium.connect(process.env.PW_WS ?? 'ws://127.0.0.1:39698/')
fs.mkdirSync(OUT, { recursive: true })
const errors = []
const REPLY = 'はい、こんにちは。今日はどんなお話をしましょうか。'
const PC = { width: 1280, height: 800 },
  PHONE = { width: 390, height: 844 }
const wait = (page, ms) => page.waitForTimeout(ms)
const until = async (page, f, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(f)) return true; await wait(page, 50) } return false }

async function open(viewport, dir, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile, recordVideo: { dir, size: viewport } }),
    page = await context.newPage(),
    born = Date.now()
  page.on('pageerror', (e) => errors.push(e.message))
  let polls = 0
  await context.route('**/kohako/api/v1/**', (r) => {
    const q = r.request(), p = new URL(q.url()).pathname.replace('/kohako/api/v1/', '')
    if (p === 'messages') { polls = 0; return r.fulfill({ status: 202, json: { requestId: 'verify-1', status: 'pending' } }) }
    if (p.startsWith('requests/')) return r.fulfill({ json: ++polls > 2 ? { requestId: 'verify-1', status: 'done', reply: { text: REPLY } } : { requestId: 'verify-1', status: 'pending' } })
    return r.fulfill({ json: p === 'me' ? { user: 'verify' } : p === 'conversation' && q.method() === 'GET' ? { enabled: true, stt: false } : {} })
  })
  return { context, page, born }
}
/** 録画の長さと実時間の差（ソフトウェア描画では録画が伸びる）を直せるよう、閉じるまでの実時間を残す。 */
const walls = {}
async function finish(o, file) {
  const video = o.page.video()
  walls[file] = (Date.now() - o.born) / 1000
  await o.context.close()
  await video.saveAs(path.join(OUT, file))
}
/** 家の状態の移り変わりを、ページの中で 50ms ごとに記録する（台本の始まり = 0 秒）。 */
const watchHome = (page) => page.evaluate(() => {
  const t0 = performance.now(), log = [], seen = { s: null, seat: null }
  window.__log = log
  setInterval(() => {
    const h = window.__kohakoHome, s = h?.state, seat = h?.report.seat?.phase ?? 'standing'
    if (s !== seen.s || seat !== seen.seat) { seen.s = s; seen.seat = seat; log.push({ t: +((performance.now() - t0) / 1000).toFixed(2), state: s, seat }) }
  }, 50)
})
const homeReady = (page) => until(page, () => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline' && window.__kohakoHome.stage?.report().seat?.textures === 'loaded', 90000)
const keshinReady = (page) => until(page, () => !!document.getElementById('k2d')?.contentWindow?.__k2d?.VIEW, 90000)
const meta = fs.existsSync(path.join(OUT, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8')) : {}
const save = () => fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ ...meta, walls: { ...(meta.walls ?? {}), ...walls }, errors }, null, 2))

async function scriptA(name, viewport, mobile) {
  const dir = path.join(OUT, 'raw')
  // 家: 待機 4 秒 → 送信 → 返事 → 話し終わって 3 秒。
  {
    const o = await open(viewport, dir, mobile), { page } = o
    await page.goto(`http://127.0.0.1:${port}/kohako/home.html?seat=off`)
    await homeReady(page); await wait(page, 2000)
    const start = (Date.now() - o.born) / 1000
    await watchHome(page)
    await wait(page, 4000)
    await page.locator('#message').fill('こんにちは')
    await page.locator('#send').click()
    await until(page, () => window.__kohakoHome.state === 'speaking', 30000)
    await until(page, () => window.__kohakoHome.state !== 'speaking', 30000)
    await wait(page, 3000)
    const log = await page.evaluate(() => window.__log)
    const first = (s) => log.find((r) => r.state === s)?.t ?? null
    const speakAt = first('speaking'), speakEnd = log.find((r) => speakAt !== null && r.t > speakAt && r.state !== 'speaking')?.t ?? null
    meta[name] = { home: { start, log, thinkAt: first('thinking'), speakAt, speakFor: speakEnd && speakAt ? +(speakEnd - speakAt).toFixed(2) : null, length: log.at(-1)?.t + 3 } }
    await finish(o, `${name}-home.webm`)
  }
  // 試作: 同じ時刻で 聞いている → 考えている → 話している。
  {
    const h = meta[name].home, o = await open(viewport, dir, mobile), { page } = o
    await page.goto(`http://127.0.0.1:${port}/kohako/keshin.html?rec=1`)
    await keshinReady(page); await wait(page, 2000)
    const start = (Date.now() - o.born) / 1000
    await page.evaluate((a) => window.__keshin.runA(a), { sendAt: 4, thinkAt: h.thinkAt ?? 4.5, speakAt: h.speakAt ?? 7, speakFor: h.speakFor ?? 5 })
    await wait(page, (h.length ?? 16) * 1000)
    meta[name].keshin = { start }
    await finish(o, `${name}-keshin.webm`)
  }
  save()
}

async function scriptB() {
  const name = 'B', dir = path.join(OUT, 'raw'), LOOKS = [[-0.9, 0], [0.9, 0], [0, -0.9], [0, 0]]
  const px = ([x, y]) => [Math.round(((x + 1) / 2) * PC.width), Math.round(((y + 1) / 2) * PC.height)]
  {
    const o = await open(PC, dir), { page } = o
    await page.goto(`http://127.0.0.1:${port}/kohako/home.html`)
    await homeReady(page); await wait(page, 2000)
    await page.mouse.move(...px([0, 0]))
    const start = (Date.now() - o.born) / 1000, t0 = Date.now()
    await watchHome(page)
    await page.evaluate(() => window.__kohakoHome.playSeat('sit'))
    await until(page, () => window.__kohakoHome.report.seat?.phase === 'seated', 10000)
    const seatedAt = (Date.now() - t0) / 1000
    await wait(page, 2000)
    for (const l of LOOKS) { await page.mouse.move(...px(l), { steps: 8 }); await wait(page, 2000) }
    await wait(page, 1000)
    meta[name] = { home: { start, seatedAt, log: await page.evaluate(() => window.__log), length: (Date.now() - t0) / 1000 } }
    await finish(o, `${name}-home.webm`)
  }
  {
    const o = await open(PC, dir), { page } = o
    await page.goto(`http://127.0.0.1:${port}/kohako/keshin.html?rec=1`)
    await keshinReady(page); await wait(page, 2000)
    const start = (Date.now() - o.born) / 1000, t0 = Date.now()
    await page.evaluate(() => window.__keshin.runB())
    await until(page, () => window.__keshin.state().seat.phase === 'seated', 10000)
    const seatedAt = (Date.now() - t0) / 1000
    await wait(page, Math.max(0, meta[name].home.length - seatedAt) * 1000)
    meta[name].keshin = { start, seatedAt }
    await finish(o, `${name}-keshin.webm`)
  }
  save()
}

if (!ONLY || ONLY === 'A') await scriptA('A', PC)
if (!ONLY || ONLY === 'B') await scriptB()
if (!ONLY || ONLY === 'phone') await scriptA('phone', PHONE, true)
save()
console.log(JSON.stringify({ errors }, null, 2))
await browser.close()
srv.close()
