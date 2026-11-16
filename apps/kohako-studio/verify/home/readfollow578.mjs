// BOXP-578: 音声を模擬し、読み上げ位置の追従と手動操作を実画面で確認する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8812)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) })
}).listen(port)
function wav(text) {
  const samples = Math.floor(8000 * Math.min(2.5, Math.max(0.5, text.length * 0.15))), b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}
const paragraph = '今日は庭の花を見ながら、ゆっくりお話ししましょう。小さな出来事も大切に覚えています。'
const reply = Array.from({ length: 36 }, (_, i) => i % 6 === 0 ? `\n\n- ${i}番目のお話です。${paragraph}` : `\n\n${i}番目のお話です。${paragraph}`).join('')
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] }), results = {}, failures = [], external = []
for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const checks = results[device] = {}, ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  let requestId = ''
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await page.route('**/kohako/api/v1/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'tts' && req.method() === 'GET') return json(200, { available: true })
    if (p === 'tts') return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(req.postDataJSON().text) })
    if (p === 'messages') { requestId = req.postDataJSON().requestId; return json(202, { status: 'accepted' }) }
    if (/^requests\/[^/]+$/.test(p)) return json(200, { requestId, status: 'done', reply: { text: reply } })
    return json(200, {})
  })
  const check = (name, ok, evidence = undefined) => { checks[name] = { pass: !!ok, ...(evidence === undefined ? {} : { evidence }) }; if (!ok) failures.push(`${device}: ${name}`) }
  const snapshot = () => page.evaluate(() => {
    const scroller = document.querySelector(document.body.dataset.shape === 'portrait' ? '#chatlog' : '#bubble'), h = CSS.highlights.get('kohako-reading'), range = h && [...h][0], r = range?.getClientRects()[0], s = scroller.getBoundingClientRect()
    return { text: range?.toString(), top: scroller.scrollTop, visible: !!r && r.top >= s.top - 1 && r.top < s.bottom, button: !document.querySelector('#read-follow').hidden }
  })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('label[for="speech"], label:has(#speech)').click()
    await page.locator('#message').fill('長いお話をお願いします'); await page.locator('#send').click()
    await page.waitForFunction(() => CSS.highlights?.has('kohako-reading'), null, { timeout: 15000 })
    const first = await snapshot(); await page.waitForTimeout(6000); const advanced = await snapshot()
    check('highlight_advances', !!first.text && first.text !== advanced.text, { first, advanced })
    await page.waitForFunction(() => document.querySelector(document.body.dataset.shape === 'portrait' ? '#chatlog' : '#bubble').scrollTop > 10, null, { timeout: 30000 })
    const scrolled = await snapshot()
    check('visible_and_scrolled', scrolled.visible && scrolled.top > first.top, scrolled)
    const selector = mobile ? '#chatlog' : '#bubble', box = await page.locator(selector).boundingBox()
    if (mobile) {
      const cdp = await ctx.newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height / 3
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let n = 1; n <= 8; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + n * 20 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -500) }
    await page.waitForTimeout(700); const paused = await snapshot(); await page.waitForTimeout(3200); const held = await snapshot()
    check('manual_scroll_pauses', paused.button && held.button && paused.top < scrolled.top && Math.abs(held.top - paused.top) < 2, { paused, held })
    await page.locator('#read-follow').click(); await page.waitForTimeout(300); const resumed = await snapshot(); await page.waitForTimeout(5000); const tracked = await snapshot()
    check('button_resumes', !resumed.button && resumed.visible && tracked.visible && tracked.top > resumed.top, { resumed, tracked })
    await page.locator('#hush').click(); const stopped = await snapshot()
    check('hush_clears', !stopped.text && !stopped.button && await page.locator('#resume-speech').isVisible(), stopped)
    await page.locator('#resume-speech').click(); await page.waitForFunction(() => CSS.highlights?.has('kohako-reading')); const restart = await snapshot(); await page.waitForTimeout(4000); const restartLater = await snapshot()
    check('resume_speech_follows', restart.visible && restartLater.visible && restartLater.text !== restart.text, { restart, restartLater })
    await page.waitForFunction(() => window.__kohakoHome.state !== 'speaking', null, { timeout: 120000 })
    check('end_clears', !(await snapshot()).text)
    check('page_errors', errors.length === 0, errors); check('external_requests', external.length === 0, external)
    await page.screenshot({ path: path.join(out, `${device}.png`) })
  } catch (e) { checks.exception = String(e.message); failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
