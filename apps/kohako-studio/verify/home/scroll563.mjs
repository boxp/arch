// BOXP-563: 連続更新中の追従、読み返し、入力操作を実画面で確かめる。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8811)
const { createActivity } = await import(pathToFileURL(path.resolve(process.env.BFF_DIST || '/bff-dist', 'activity.js')).href)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join(site, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data)
  })
}).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), results = {}, failures = [], external = []
for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const checks = results[device] = {}, ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  const activity = createActivity(() => Date.now())
  let requestId = '', count = 0
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (req) => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
  await page.route('**/kohako/api/v1/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') { requestId = req.postDataJSON().requestId; return json(202, { requestId, status: 'pending' }) }
    if (p === 'approvals' || p.endsWith('/cancel')) return json(200, {})
    const step = /^requests\/[^/]+\/activity\/(t\d+)$/.exec(p)
    if (step) { const detail = activity.detail(step[1]); return detail ? json(200, detail) : json(404, { error: 'unknown_step' }) }
    if (p.startsWith('requests/')) { const snapshot = activity.snapshot(); return json(200, { requestId, status: 'pending', ...(snapshot ? { activity: snapshot } : {}) }) }
    return json(200, {})
  })
  const check = (name, ok) => { checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) failures.push(`${device}: ${name}`) }
  const add = async () => {
    const id = `c${++count}`, timestamp = Date.now() / 1000
    activity.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: id, preview: '実行中', timestamp })
    await page.waitForFunction((n) => document.querySelectorAll('.activity-steps > li').length >= n, count, { timeout: 8000 })
    await page.waitForTimeout(150)
    activity.attachArgs([{ id, name: 'terminal', args: { command: Array.from({ length: 8 }, (_, i) => `echo step-${count}-${i}`).join('\n') } }])
    activity.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: id, timestamp: timestamp + 0.2 })
    await page.waitForTimeout(1400)
    if (count > 1) await page.waitForFunction((n) => document.querySelector(`#activity-args-t${n} [data-key="command"] pre`), count, { timeout: 8000 })
  }
  const visible = () => page.evaluate(() => {
    const list = document.querySelector('.activity-steps'), row = list.lastElementChild, outer = document.querySelector(document.body.dataset.shape === 'portrait' ? '#chatlog' : '#bubble'), form = document.querySelector('#form')
    const a = row.getBoundingClientRect(), l = list.getBoundingClientRect(), o = outer.getBoundingClientRect(), f = form.getBoundingClientRect()
    const overlap = a.left < f.right && f.left < a.right && a.top < f.bottom && f.top < a.bottom
    return a.bottom <= l.bottom + 1 && a.top >= l.top - 1 && a.bottom <= o.bottom + 1 && a.top >= o.top - 1 && !overlap
  })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#message').fill('テスト'); await page.locator('#send').click(); await page.waitForTimeout(1250)
    await add(); await page.locator('.activity-head').click(); await page.waitForTimeout(300)
    await page.evaluate(() => { window.savedList = document.querySelector('.activity-steps'); window.savedRow = window.savedList.firstElementChild })
    await page.locator('#message').fill('更新中の入力'); await page.locator('#message').focus()
    let follows = true, focus = true
    for (let i = 1; i < 30; i++) { await add(); if (i % 5 === 0 || i === 29) follows &&= await visible(); focus &&= await page.evaluate(() => document.activeElement === document.querySelector('#message')) }
    check('連続更新の間ずっと最新の手順が見える', follows)
    check('手順一覧の要素は作り直されない', await page.evaluate(() => window.savedList === document.querySelector('.activity-steps') && window.savedRow === window.savedList.firstElementChild))
    await page.locator('.activity-steps').evaluate((e) => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -9999, bubbles: true })); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
    if (mobile) await page.locator('#chatlog').evaluate((e) => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -9999, bubbles: true })); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
    for (let i = 0; i < 5; i++) await add()
    check('上へ戻して読んでいる間は位置が動かない', await page.evaluate((portrait) => document.querySelector('.activity-steps').scrollTop <= 1 && (!portrait || document.querySelector('#chatlog').scrollTop <= 1), mobile))
    for (const selector of mobile ? ['#chatlog', '.activity-steps'] : ['.activity-steps']) await page.locator(selector).evaluate((e) => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })
    for (let i = 0; i < 3; i++) await add()
    check('末尾へ戻すと追従を再開する', await visible())
    // 1 回の照会の間に複数の道具が始まって終わる（重なる）場合。
    const before = count
    for (let i = 0; i < 6; i++) {
      const id = `c${++count}`, timestamp = Date.now() / 1000
      activity.apply({ event: 'tool.started', tool: 'terminal', tool_call_id: id, preview: '実行中', timestamp })
      activity.attachArgs([{ id, name: 'terminal', args: { command: Array.from({ length: 8 }, (_, j) => `echo burst-${count}-${j}`).join('\n') } }])
      if (i < 5) activity.apply({ event: 'tool.completed', tool: 'terminal', tool_call_id: id, timestamp: timestamp + 0.1 })
    }
    await page.waitForFunction((n) => document.querySelector(`#activity-args-t${n} [data-key="command"] pre`), count, { timeout: 8000 })
    await page.waitForTimeout(600)
    check('一度に 6 件重なっても最新の手順が見える', count === before + 6 && (await visible()))
    await page.screenshot({ path: path.join(out, `${device}-burst.png`) })
    await page.locator('.activity-head').click(); await page.locator('.activity-head').click()
    check('一覧を開いた時は最新の手順から見える', await visible())
    // 畳むと外側の枠が縮んで位置が戻る。これを利用者の操作と取り違えて追従が止まらないこと。
    let reopened = true
    for (let k = 0; k < 12; k++) { await page.locator('.activity-head').click(); await page.waitForTimeout(k % 3 * 120); await page.locator('.activity-head').click(); await page.waitForTimeout(k % 2 * 250); reopened &&= await visible() }
    check('閉じて開き直すことを繰り返しても最新の手順から見える', reopened)
    await page.locator('.activity-steps').evaluate((e) => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -9999, bubbles: true })); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
    await page.waitForTimeout(200)
    const stopped = await page.evaluate(() => document.querySelector('.activity-steps').scrollTop <= 1)
    await page.locator('.activity-head').click(); await page.locator('.activity-head').click(); await page.waitForTimeout(300)
    check('上へ戻して読んだ後に閉じて開き直しても最新の手順から見える', stopped && (await visible()))
    await page.locator('#message').focus()
    const controls = await page.evaluate(() => {
      const stop = document.querySelector('#stop'), r = stop.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return document.querySelector('#message').value === '更新中の入力' && stop.offsetWidth > 0 && !!top && (top === stop || stop.contains(top))
    })
    check('入力欄へ入力でき、停止ボタンが押せる位置にある', focus && controls)
    check('横にはみ出さない', await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth))
    check('ページエラーなし', errors.length === 0)
    check('外部通信なし', external.length === 0)
    await page.screenshot({ path: path.join(out, `${device}-running.png`) })
  } catch (e) { checks.exception = e.message; failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
