// BOXP-512: 背景の実ブラウザ検証。SITE/kohako に build を配置し node background512.mjs /out。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8795)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const check = (value, message) => { if (!value) throw new Error(message) }
const run = async (name, fn) => { try { await fn() } catch (e) { failures.push(`${name}: ${e.message}`) } }
const REPLY = '# 見出し\n\n**太字**と`code`です。\n\n- 一つ目\n- 二つ目\n\n<script>window.__xss=1</script>\n\n[危険](javascript:window.__xss=2) [安全](https://example.com/a)\n\n![外部画像](https://example.com/track.png)\n\n```\nconst a = 1\n```'
const devices = { pc: [{ width: 1280, height: 800 }, false], pixel7: [{ width: 412, height: 915 }, true], landscape: [{ width: 915, height: 412 }, true] }
async function setup(device, query = '', reduce = false) {
  const [viewport, mobile] = devices[device], posts = []
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  page.on('request', q => { const u = new URL(q.url()); if (u.hostname !== 'localhost') external.push(q.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [{ id: 'claude_shared', label: 'Claude', windows: [{ name: 'five_hour', label: '5時間', state: 'ok', usedPercent: 40, resetsAt: null, observedAt: null, status: null }] }] }, tasks: { state: 'ok', inProgress: { total: 2, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') { posts.push(req.postDataJSON()); return json(202, { status: 'accepted' }) }
    if (/^requests\//.test(p)) return json(200, { status: 'done', reply: { text: REPLY } })
    return json(200, {})
  })
  await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static${query}`)
  await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
  return { ctx, page, posts }
}
const states = page => page.evaluate(() => document.querySelector('.room').getAnimations({ subtree: true }).map(a => a.playState))
const translate = page => page.evaluate(() => getComputedStyle(document.querySelector('.petal.p1')).translate)
const snap = (page, name) => page.screenshot({ path: path.join(out, name) })
// PNG をブラウザの canvas でデコードする。輝度差は sRGB の加重平均で算出。
async function pixels(page, buffer, rect) {
  return page.evaluate(async ({ data, rect }) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const c = canvas.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0)
    const r = rect || { x: 0, y: 0, width: img.width, height: img.height }
    return Array.from(c.getImageData(Math.max(0, Math.floor(r.x)), Math.max(0, Math.floor(r.y)), Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height))).data)
  }, { data: buffer.toString('base64'), rect })
}
function luminance(rgb) { const c = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2] }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
async function textContrast(page, selector, bubble = false) {
  const info = await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, color: getComputedStyle(el).color, background: getComputedStyle(document.querySelector('#bubble')).backgroundColor } })
  const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  let bg
  if (bubble) bg = parse(info.background)
  else { const data = await pixels(page, await page.screenshot(), info.rect); bg = [0, 0, 0]; for (let i = 0; i < data.length; i += 4) for (let j = 0; j < 3; j++) bg[j] += data[i + j]; bg = bg.map(v => v / (data.length / 4)) }
  const fg = parse(info.color)
  return { rect: info.rect, foreground: fg, background: bg, ratio: contrast(fg, bg), method: bubble ? 'bubble background-color' : 'screenshot rectangle average' }
}
for (const device of Object.keys(devices)) {
  const r = results[device] = { screenshots: {}, motion: {}, contrast: {}, performance: {} }
  for (const mode of ['morning', 'day', 'evening', 'night', 'v1']) await run(`${device} ${mode}`, async () => {
    const { ctx, page } = await setup(device, mode === 'v1' ? '&bg=v1' : `&daypart=${mode}`)
    try { const actual = await page.evaluate(() => ({ daypart: document.body.dataset.daypart, bg: document.body.dataset.bg, circuit: !!document.querySelector('.circuit') })); r.screenshots[mode] = actual; check(mode === 'v1' ? actual.bg === 'v1' && actual.circuit : actual.daypart === mode, JSON.stringify(actual)); await page.waitForTimeout(1500); await snap(page, `${device}-${mode}.png`) } finally { await ctx.close() }
  })
  await run(`${device} motion/input/contrast`, async () => {
    const { ctx, page, posts } = await setup(device)
    try {
      const motion = r.motion
      await run(`${device} moving`, async () => { const s = await states(page), a = await translate(page); await page.waitForTimeout(1500); const b = await translate(page); motion.default = { states: s, translate: [a, b] }; check(s.includes('running') && a !== b, JSON.stringify(motion.default)) })
      await run(`${device} bg off`, async () => { await page.evaluate(() => document.querySelector('#pref-bg').click()); await page.waitForTimeout(300); const s = await states(page), a = await translate(page); await page.waitForTimeout(1200); const b = await translate(page), still = await page.evaluate(() => document.body.classList.contains('bg-still')); motion.off = { states: s, translate: [a, b], still }; check(still && s.length > 0 && s.every(x => x === 'paused') && a === b, JSON.stringify(motion.off)); await page.evaluate(() => document.querySelector('#pref-bg').click()) })
      await run(`${device} pref reduce`, async () => { await page.evaluate(() => document.querySelector('#pref-reduce').click()); await page.waitForTimeout(300); motion.prefReduce = await states(page); check(!motion.prefReduce.includes('running'), JSON.stringify(motion.prefReduce)); await page.evaluate(() => document.querySelector('#pref-reduce').click()) })
      await run(`${device} visibility`, async () => { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }); await page.waitForTimeout(300); const hidden = await states(page), marked = await page.evaluate(() => document.body.classList.contains('tab-hidden')); await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) }); await page.waitForTimeout(300); const resumed = await states(page); motion.visibility = { hidden, marked, resumed }; check(marked && hidden.length > 0 && hidden.every(x => x === 'paused') && resumed.includes('running'), JSON.stringify(motion.visibility)) })
      await run(`${device} bg off scene change`, async () => { await page.evaluate(() => document.querySelector('#pref-bg').click()); await page.waitForTimeout(300); const t = await page.evaluate(() => { const b = document.body, prev = b.dataset.scene, w = document.querySelector('.room-window'), x0 = w.getBoundingClientRect().x; b.dataset.scene = prev === 'talk' ? 'relax' : 'talk'; const x1 = w.getBoundingClientRect().x; const n = document.querySelector('.room').getAnimations({ subtree: true }).filter(a => a instanceof CSSTransition).length; b.dataset.scene = prev; return { still: b.classList.contains('bg-still'), transitions: n, x0, x1 } }); motion.offScene = t; check(t.still && t.transitions === 0, JSON.stringify(t)); await page.evaluate(() => document.querySelector('#pref-bg').click()) })
      await run(`${device} clock/date contrast`, async () => { check(await page.evaluate(() => document.body.dataset.scene === 'relax'), 'scene is not relax'); r.contrast.clock = await textContrast(page, '#clock'); r.contrast.date = await textContrast(page, '#date'); check(r.contrast.clock.ratio >= 3, JSON.stringify(r.contrast.clock)) })
      await run(`${device} input/pointer/reply contrast`, async () => { const pointer = await page.evaluate(() => { const room = document.querySelector('.room'), el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { pointerEvents: getComputedStyle(room).pointerEvents, centerInRoom: room.contains(el), center: el?.tagName } }); r.pointer = pointer; check(pointer.pointerEvents === 'none' && !pointer.centerInRoom, JSON.stringify(pointer)); const m = page.locator('#message'); await m.fill('背景検証'); await m.press('Shift+Enter'); await page.waitForFunction(() => document.querySelector('#reply h3')?.textContent === '見出し', null, { timeout: 20000 }); r.input = { posts, reply: await page.locator('#reply').innerText() }; check(posts.length === 1 && posts[0].text === '背景検証', JSON.stringify(posts)); r.contrast.reply = await textContrast(page, '#reply', true); check(r.contrast.reply.ratio >= 4.5, JSON.stringify(r.contrast.reply)) })
    } finally { await ctx.close() }
  })
  await run(`${device} OS reduced motion`, async () => { const { ctx, page } = await setup(device, '', true); try { r.motion.osReduce = await states(page); check(!r.motion.osReduce.includes('running'), JSON.stringify(r.motion.osReduce)) } finally { await ctx.close() } })
  await run(`${device} flashing`, async () => {
    const { ctx, page } = await setup(device)
    try {
      await page.waitForTimeout(4000) // 起動直後の場面切替（時計・吹き出し・丸窓の移動）が落ち着いてから測る
      const frames = [], times = []
      for (let i = 0; i < 30; i++) { const target = Date.now(); times.push(target); frames.push((await page.screenshot()).toString('base64')); await page.waitForTimeout(Math.max(0, 100 - (Date.now() - target))) }
      const differences = await page.evaluate(async frames => {
        let previous, maxMeanDifference = 0, maxFractionOver40 = 0, worst = 1, index = 0
        for (const frame of frames) {
          const img = new Image(); img.src = `data:image/png;base64,${frame}`; await img.decode()
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
          const c = canvas.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0); const data = c.getImageData(0, 0, img.width, img.height).data
          if (previous) { let sum = 0, count = 0; for (let j = 0; j < data.length; j += 4) { const diff = Math.abs(.2126 * (data[j] - previous[j]) + .7152 * (data[j + 1] - previous[j + 1]) + .0722 * (data[j + 2] - previous[j + 2])); sum += diff; if (diff > 40) count++ } maxMeanDifference = Math.max(maxMeanDifference, sum / (data.length / 4) / 255); const fraction = count / (data.length / 4); if (fraction >= maxFractionOver40) worst = index; maxFractionOver40 = Math.max(maxFractionOver40, fraction) }
          previous = data; index++
        }
        return { maxMeanDifference, maxFractionOver40, worst }
      }, frames)
      for (const k of [differences.worst - 1, differences.worst]) fs.writeFileSync(`${out}/${device}-flash-worst-${k === differences.worst ? 'b' : 'a'}.png`, Buffer.from(frames[k], 'base64'))
      r.flashing = { ...differences, frameIntervalsMs: times.slice(1).map((t, i) => t - times[i]) }; check(differences.maxMeanDifference < 2 / 255 && differences.maxFractionOver40 < .03, JSON.stringify(r.flashing))
    } finally { await ctx.close() }
  })
  if (device !== 'landscape') for (const mode of ['v2', 'v1', 'off']) await run(`${device} performance ${mode}`, async () => {
    const { ctx, page } = await setup(device, mode === 'v1' ? '&bg=v1' : '')
    try { if (mode === 'off') await page.evaluate(() => document.querySelector('#pref-bg').click()); await page.waitForTimeout(1000); const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable'); const before = await cdp.send('Performance.getMetrics'); const raf = await page.evaluate(() => new Promise(resolve => { const times = [], start = performance.now(); function frame(t) { times.push(t); if (t - start < 5000) requestAnimationFrame(frame); else resolve({ frames: times.length, averageIntervalMs: (times.at(-1) - times[0]) / (times.length - 1), elapsedMs: t - start }) } requestAnimationFrame(frame) })); const after = await cdp.send('Performance.getMetrics'); const get = (m, n) => m.metrics.find(x => x.name === n)?.value; const delta = Object.fromEntries(['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration'].map(n => [n, get(after, n) - get(before, n)])); r.performance[mode] = { ...delta, raf }; if (mode === 'v2') check(delta.LayoutDuration < .25, JSON.stringify(r.performance[mode])) } finally { await ctx.close() }
  })
}
results.externalRequests = external
if (external.length) failures.push(`external requests: ${external.length}`)
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ failures, external: external.length }))
await browser.close(); server.close(); process.exit(failures.length ? 1 : 0)
