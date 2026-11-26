// BOXP-694: コハコの腕の動きを、実時間の動画（アバターだけ）に録る。動画を見て確かめる独立レビュー（BOXP-693 と同じ場面・同じ名前）へ渡す。
// 画面の UI（会話・通知・入力欄・時計）は CSS で隠し、左上に「経過秒 | 場面 [しぐさ・身振り・表情]」だけを出す。BFF は完全にモック（token 不要）。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node record694.mjs <配備版の home.html の URL | build の dist> <出力先>`
//   FFMPEG=<ffmpeg>（既定は Playwright 同梱）で、アバターの範囲への切り抜きと 0.25 倍のスロー版（時刻の刻みだけ 4 倍。コマは同じ）を作る。
//   ONLY=01,02,... で場面を絞れる。出力: <出力先>/NN-*.webm、NNx-*-slow4x.webm、recording-meta.json。
// 口パクは、アプリが話している間に毎コマ呼ぶ 2 つ（stage.setViseme と rig.lipSync）を同じ値で呼んで動かす（音声は流さない）。
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TARGET = process.argv[2],
  OUT = process.argv[3]
if (!TARGET || !OUT) throw new Error('usage: node record694.mjs <URL | dist> <out>')
fs.mkdirSync(OUT, { recursive: true })
const RAW = path.join(OUT, 'raw')
fs.mkdirSync(RAW, { recursive: true })
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null,
  want = (name) => !ONLY || ONLY.some((k) => name.startsWith(k))
const FFMPEG =
  process.env.FFMPEG ??
  (() => {
    const base = path.join(os.homedir(), '.cache/ms-playwright')
    const dir = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.startsWith('ffmpeg-')) : null
    return dir ? path.join(base, dir, 'ffmpeg-linux') : 'ffmpeg'
  })()

let server = null,
  url = TARGET
if (!/^https?:/.test(TARGET)) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  }
  // この PC の中（127.0.0.1）だけで待ち受け、dist の外を指すパス（%2f や .. を使ったもの）は読まずに 404 を返す。
  const root = fs.realpathSync(TARGET)
  const inside = (reqUrl) => {
    try {
      const p = decodeURIComponent(new URL(reqUrl, 'http://x').pathname).replace(/^\/kohako\//, '/')
      if (p.includes('\0')) return null
      const real = fs.realpathSync(path.resolve(root, '.' + path.posix.normalize('/' + p)))
      return real === root || real.startsWith(root + path.sep) ? real : null
    } catch {
      return null
    }
  }
  server = http
    .createServer((q, r) => {
      const file = inside(q.url)
      if (!file) {
        r.writeHead(404)
        return r.end()
      }
      fs.readFile(file, (e, d) => {
        if (e) {
          r.writeHead(404)
          return r.end()
        }
        r.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
        r.end(d)
      })
    })
    .listen(0, '127.0.0.1')
  await new Promise((r) => server.on('listening', r))
  url = `http://127.0.0.1:${server.address().port}/kohako/home.html`
}

const HIDE_CSS = `
  header.top, .status-anchor, .clock-face, #bubble, #chatlog, #viewer,
  footer, .composer, .menu, .drawer, .modal, #arrival-note {
    visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
  }
  #__rec_badge {
    position: fixed; left: 12px; top: 48px; z-index: 999999; background: rgba(10, 14, 24, 0.78); color: #f4f7ff;
    font: 600 14px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 4px 9px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.18); pointer-events: none; white-space: nowrap;
  }`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connect(process.env.PW_WS ?? 'ws://127.0.0.1:39694/')
const meta = { url, startedAt: new Date().toISOString(), viewport: [1280, 800], clips: {} }

async function open({ fromLoad = false, prefs = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec694-')),
    start = Date.now()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  })
  await context.addInitScript((css) => {
    const inject = () => {
      if (!document.getElementById('__rec_css')) {
        const s = document.createElement('style')
        s.id = '__rec_css'
        s.textContent = css
        ;(document.head || document.documentElement).appendChild(s)
      }
      if (!document.getElementById('__rec_badge') && document.body) {
        const d = document.createElement('div')
        d.id = '__rec_badge'
        d.textContent = '00.0s | init'
        document.body.appendChild(d)
        window.__recT0 = performance.now()
        window.__recLabel = 'init'
        const tick = () => {
          const el = document.getElementById('__rec_badge')
          if (el) {
            const s = (performance.now() - window.__recT0) / 1000,
              h = window.__kohakoHome,
              act = h?.report?.idle?.act || '',
              st = h?.stage?.report?.() || {}
            const extra = [
              act && `act:${act}`,
              st.gesture && st.gesture !== 'none' && `g:${st.gesture}`,
              st.emotion && st.emotion !== 'neutral' && `e:${st.emotion}`,
            ]
              .filter(Boolean)
              .join(' ')
            el.textContent = `${s.toFixed(1)}s | ${window.__recLabel}${extra ? ` [${extra}]` : ''}`
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject)
    else inject()
    setTimeout(inject, 50)
  }, HIDE_CSS)
  if (prefs) await context.addInitScript((p) => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), prefs)
  const page = await context.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await context.route('**/kohako/api/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^.*\/kohako\/api\/v1\//, '')
    return r.fulfill({
      json: p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : {},
    })
  })
  const events = []
  const mark = async (label) => {
    events.push({ t: Math.round((Date.now() - start) / 100) / 10, label, badge: await page.evaluate(() => Math.round((performance.now() - window.__recT0) / 100) / 10).catch(() => null) })
    await page.evaluate((l) => (window.__recLabel = l), label).catch(() => {})
  }
  await page.goto(url)
  if (fromLoad) await mark('arrival')
  await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, {
    timeout: 120000,
  })
  // 時刻の札を、切り抜く範囲（アバターの中心から左右 300）の左上へ置く。
  await page.evaluate(() => {
    const a = window.__kohakoHome.hitAreas().head,
      x = Math.max(0, Math.min(1280 - 600, Math.round(a.x + a.w / 2 - 300)))
    document.getElementById('__rec_badge').style.left = `${x + 12}px`
  })
  return { context, page, errors, start, events, mark }
}
async function finish(name, { context, page, errors, start, events }) {
  const rect = await page.evaluate(() => {
    const h = window.__kohakoHome,
      a = h.hitAreas().head
    return { cx: a.x + a.w / 2, top: a.y, w: a.w, h: a.h }
  })
  const raw = path.join(RAW, `${name}.webm`),
    video = page.video(),
    closedAt = Date.now()
  await page.close()
  await video.saveAs(raw)
  await context.close()
  // アバターの範囲（頭の幅の約 4 倍 × 全身）へ切り抜く。左上の時刻の札が入るよう、左端は画面の左端に合わせる。
  const w = 600,
    x = Math.max(0, Math.min(1280 - w, Math.round(rect.cx - w / 2))),
    crop = `crop=${w}:720:${x}:40`
  const out = path.join(OUT, `${name}.webm`)
  // Playwright の録画は、コマの届き方によって実時間より長くなる（ソフトウェア描画で約 1.1 倍）。録画した実時間（画面を作ってから閉じるまで）に
  // 合わせて時刻の刻みを縮め、動画の 1 秒が実際の 1 秒になるようにする。コマは作り直さない。札の経過秒で確かめられる。
  const seconds = Math.round((closedAt - start) / 100) / 10,
    recorded = duration(raw),
    scale = seconds / recorded
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error', '-itsscale', scale.toFixed(5), '-i', raw,
    '-vf', crop, '-r', '25', '-c:v', 'libvpx', '-b:v', '2M', out,
  ]) // biome-ignore format: 引数の並び
  for (const e of events) e.video = e.t
  meta.clips[name] = {
    file: out,
    seconds,
    recordedSeconds: recorded,
    timeScale: Math.round(scale * 1000) / 1000,
    crop,
    errors,
    events,
    slow: [],
  }
  console.log(`CLIP ${name}: ${meta.clips[name].seconds}s errors=${errors.length}`)
}
/** 動画の長さ（秒）。 */
function duration(file) {
  let text = ''
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    text = String(e.stderr ?? '')
  }
  const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/)
  if (!m) throw new Error(`動画の長さを読めません: ${file}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
/** 録った動画の [from, to] 秒（動画の時刻）を、時刻の刻みだけ 4 倍にして書き出す（コマは作り直さない）。 */
function slow(name, slowName, from, to) {
  const clip = meta.clips[name]
  if (!clip) return
  const cut = path.join(RAW, `${slowName}-cut.webm`),
    out = path.join(OUT, `${slowName}-slow4x.webm`),
    a = Math.max(0, from)
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error', '-ss', String(a), '-t', String(to - a), '-i', clip.file,
    '-c:v', 'libvpx', '-b:v', '2M', cut,
  ]) // biome-ignore format: 引数の並び
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-itsscale', '4', '-i', cut, '-c', 'copy', out])
  clip.slow.push({ file: out, from: a, to })
}
/** 出来事の、動画の中での時刻（秒）。 */
const at = (name, label) => meta.clips[name]?.events.find((e) => e.label === label)?.video
const idleAct = (page) => page.evaluate(() => window.__kohakoHome?.report?.idle?.act ?? null)
async function waitAct(page, ok, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (ok(await idleAct(page))) return true
    await sleep(100)
  }
  return false
}
async function idleSequence(name, acts) {
  const c = await open()
  await c.mark('settle')
  await sleep(3000)
  for (const act of acts) {
    await waitAct(c.page, (a) => !a)
    await c.mark(`queue:${act}`)
    await c.page.evaluate((a) => window.__kohakoHome.playIdle(a), act)
    await waitAct(c.page, (a) => a === act)
    await c.mark(`start:${act}`)
    await waitAct(c.page, (a) => !a)
    await c.mark(`end:${act}`)
    await sleep(1200)
  }
  await finish(name, c)
}
/** 話している間にアプリが毎コマ呼ぶ 2 つを横取りし、同じ呼び方で口を動かす。 */
const takeMouth = (page) =>
  page.evaluate(() => {
    const h = window.__kohakoHome,
      st = h.stage,
      p = h.player
    window.__sv = st.setViseme.bind(st)
    st.setViseme = () => {}
    window.__ls = p.lipSync.bind(p)
    p.lipSync = () => {}
  })
const VOWELS = [
  { open: 0.9, width: 1.0 },
  { open: 0.3, width: 1.12 },
  { open: 0.7, width: 0.85 },
  { open: 0.55, width: 1.06 },
  { open: 0.3, width: 0.8 },
  { open: 0.06, width: 1.0 },
  { open: 0.9, width: 1.0 },
  { open: 0.0, width: 1.0 },
]
async function talk(page, ms) {
  const end = Date.now() + ms
  for (let i = 0; Date.now() < end; i++) {
    await page.evaluate((v) => {
      window.__sv(v)
      window.__ls(v.open)
    }, VOWELS[i % VOWELS.length])
    await sleep(130)
  }
  await page.evaluate(() => {
    window.__sv(null)
    window.__ls(0)
  })
}

if (want('01')) {
  const c = await open({ fromLoad: true })
  await c.mark('landing-to-base-idle')
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    const a = await idleAct(c.page)
    if (a) await c.mark(`natural-act:${a}`)
  }
  await finish('01-arrival-and-base-idle', c)
}
if (want('02')) {
  await idleSequence('02-idle-605-redo3', ['stretch', 'tidy']) // sway（体を揺らす）は BOXP-698 TD-03 で廃止
  const n = '02-idle-605-redo3'
  slow(n, '02a-stretch', at(n, 'start:stretch') - 0.3, at(n, 'start:stretch') + 3.2)
  slow(n, '02b-tidy', at(n, 'start:tidy') - 0.3, at(n, 'end:tidy') + 0.4)
}
if (want('03')) {
  await idleSequence('03-idle-arm-and-cute', ['wave', 'mouth', 'shy', 'giggle', 'tilt', 'smile'])
  const n = '03-idle-arm-and-cute'
  slow(n, '03a-wave', at(n, 'start:wave') - 0.3, at(n, 'end:wave') + 0.6)
  slow(n, '03b-mouth', at(n, 'start:mouth') - 0.3, at(n, 'end:mouth') + 0.6)
  slow(n, '03c-giggle', at(n, 'start:giggle') - 0.2, at(n, 'start:giggle') + 2.4)
}
if (want('04')) await idleSequence('04-idle-head-gaze', ['moon', 'rest', 'down', 'aside', 'still'])
if (want('05')) {
  // 会話の演技の間に待機しぐさが割り込まないよう、この場面だけ設定「待機中のしぐさ」を OFF にする。
  const c = await open({ prefs: { idleActs: false } }),
    n = '05-conversation-acting'
  await c.mark('settle')
  await sleep(2500)
  await takeMouth(c.page)
  const seq = [
    { label: 'conv:nod+smile+talk', emotion: 'smile', gesture: 'nod', talk: 1800, hold: 400 },
    { label: 'conv:tilt+surprised', emotion: 'surprised', gesture: 'tilt', talk: 0, hold: 2100 },
    { label: 'conv:joy+smileClosed', emotion: 'smileClosed', gesture: 'joy', talk: 0, hold: 2400 },
    { label: 'conv:greet+smile+talk', emotion: 'smile', gesture: 'greet', talk: 2400, hold: 600 },
    { label: 'conv:guide+smile+talk', emotion: 'smile', gesture: 'guide', talk: 2800, hold: 800 },
    { label: 'conv:halt+serious', emotion: 'serious', gesture: 'halt', talk: 0, hold: 3300 },
    { label: 'conv:shyHand+troubled+talk', emotion: 'troubled', gesture: 'shyHand', talk: 3200, hold: 1100 },
    { label: 'conv:shy+talk', emotion: 'shy', gesture: 'none', talk: 1800, hold: 600 },
  ]
  for (const item of seq) {
    await c.mark(item.label)
    await c.page.evaluate(({ emotion, gesture }) => {
      const s = window.__kohakoHome.stage
      s.setEmotion(emotion)
      if (gesture !== 'none') s.playGesture(gesture)
    }, item)
    if (item.talk) await talk(c.page, item.talk)
    await sleep(item.hold)
    await c.page.evaluate(() => window.__kohakoHome.stage.reset())
    await c.mark(`${item.label}:reset`)
    await sleep(900)
  }
  await finish(n, c)
  slow(n, '05a-joy', at(n, 'conv:joy+smileClosed') - 0.2, at(n, 'conv:joy+smileClosed:reset') + 0.9)
  slow(n, '05b-greet-guide', at(n, 'conv:greet+smile+talk') - 0.2, at(n, 'conv:guide+smile+talk:reset') + 0.9)
  slow(n, '05c-halt-shyhand', at(n, 'conv:halt+serious') - 0.2, at(n, 'conv:shyHand+troubled+talk:reset') + 0.9)
}
if (want('06')) {
  const c = await open(),
    { page } = c
  await c.mark('settle')
  await sleep(3000)
  await c.mark('lookfollow:sweep')
  for (const [x, y, steps] of [
    [60, 140, 8],
    [540, 140, 12],
    [300, 620, 10],
    [300, 80, 10],
  ]) {
    await page.mouse.move(x, y, { steps })
    await sleep(900)
  }
  const hit = await page.evaluate(() => window.__kohakoHome.hitAreas()),
    hx = hit.head.x + hit.head.w / 2,
    hy = hit.head.y + hit.head.h / 2
  await c.mark('touch:head-pet')
  await page.mouse.move(hx - 28, hy)
  await page.mouse.down()
  for (let k = 0; k < 3; k++) {
    await page.mouse.move(hx + 28, hy, { steps: 8 })
    await sleep(160)
    await page.mouse.move(hx - 28, hy, { steps: 8 })
    await sleep(160)
  }
  await c.mark('touch:head-pet-release')
  await page.mouse.up()
  await sleep(2600)
  await c.mark('touch:head-tap')
  await page.mouse.click(hx, hy)
  await sleep(2000)
  const hand = hit.hands[0]
  if (hand) {
    await c.mark('touch:hand-tap')
    await page.mouse.click(hand.x + hand.w / 2, hand.y + hand.h / 2)
    await sleep(3800)
  }
  await finish('06-touch-look-interrupts', c)
  const n = '06-touch-look-interrupts'
  if (hand) slow(n, '06a-hand-tap', at(n, 'touch:hand-tap') - 0.2, at(n, 'touch:hand-tap') + 3.6)
}
if (want('07')) {
  const c = await open(),
    { page } = c,
    n = '07-mid-act-interrupts'
  await c.mark('settle')
  await sleep(3000)
  await waitAct(page, (a) => !a)
  await page.evaluate(() => window.__kohakoHome.playIdle('wave'))
  await waitAct(page, (a) => a === 'wave')
  await c.mark('wave:active')
  await sleep(1300)
  await c.mark('wave:mouse-interrupt')
  await page.mouse.move(100, 220, { steps: 6 })
  await page.mouse.move(500, 220, { steps: 8 })
  await sleep(1800)
  await c.mark('cooldown-wait')
  await sleep(5000)
  await waitAct(page, (a) => !a)
  await page.evaluate(() => window.__kohakoHome.playIdle('tidy'))
  await waitAct(page, (a) => a === 'tidy')
  await c.mark('tidy:active')
  await sleep(2400)
  const hit = await page.evaluate(() => window.__kohakoHome.hitAreas()),
    hx = hit.head.x + hit.head.w / 2,
    hy = hit.head.y + hit.head.h / 2
  await c.mark('tidy:pet-interrupt')
  await page.mouse.move(hx - 26, hy)
  await page.mouse.down()
  for (let k = 0; k < 2; k++) {
    await page.mouse.move(hx + 26, hy, { steps: 6 })
    await sleep(150)
    await page.mouse.move(hx - 26, hy, { steps: 6 })
    await sleep(150)
  }
  await page.mouse.up()
  await c.mark('tidy:pet-release')
  await sleep(2200)
  await finish(n, c)
  slow(n, '07a-interrupt-wave', at(n, 'wave:mouse-interrupt') - 0.4, at(n, 'wave:mouse-interrupt') + 1.6)
  slow(n, '07b-interrupt-tidy', at(n, 'tidy:pet-interrupt') - 0.4, at(n, 'tidy:pet-interrupt') + 1.8)
}

meta.finishedAt = new Date().toISOString()
fs.writeFileSync(path.join(OUT, 'recording-meta.json'), JSON.stringify(meta, null, 2))
await browser.close()
server?.close()
if (!process.env.KEEP_RAW) fs.rmSync(RAW, { recursive: true, force: true })
const errors = Object.values(meta.clips).flatMap((c) => c.errors)
console.log(`DONE clips=${Object.keys(meta.clips).length} pageerrors=${errors.length}`)
process.exit(errors.length ? 1 : 0)
