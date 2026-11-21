// BOXP-648: 現在地の共有（許可/拒否/取得失敗/共有停止）を BFF モックと架空の位置で確かめる。本人の実位置は使わない。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const site = process.env.SITE || '/site', port = Number(process.env.PORT || 8771), out = process.argv[2] || 'out/location648'
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/json' }
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(site, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), failures = [], log = []
const check = (ok, message) => { log.push(`${ok ? 'ok ' : 'NG '} ${message}`); if (!ok) failures.push(message) }
// 架空の位置（東京駅付近の公開地点）。
const FAKE = { latitude: 35.681236, longitude: 139.767125, accuracy: 30 }
const origin = `http://localhost:${port}`
for (const [name, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['mobile', { width: 412, height: 915 }, true]]) {
  for (const scenario of ['granted', 'denied', 'unavailable']) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, ...(scenario === 'granted' ? { geolocation: FAKE, permissions: ['geolocation'] } : {}) })
    if (scenario === 'unavailable')
      // 端末が位置を出せない場合（POSITION_UNAVAILABLE）を、許可済みのまま getCurrentPosition の失敗で再現する。
      await ctx.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, ng) => setTimeout(() => ng({ code: 2, message: 'x' }), 50), watchPosition: () => 0, clearWatch: () => {} } }) })
    const page = await ctx.newPage(), bodies = []
    await ctx.route('**/kohako/api/v1/**', async route => { const p = new URL(route.request().url()).pathname.split('/v1/')[1], j = (code, data) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(503, {}); if (p === 'messages') { bodies.push(JSON.parse(route.request().postData())); return j(202, {}) } if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: '返答です', at: Date.now() } }); return j(404, {}) })
    const send = async text => { const before = bodies.length; await page.locator('#message').fill(text); await page.locator('#form').evaluate(e => e.requestSubmit()); for (let i = 0; i < 60 && bodies.length === before; i++) await page.waitForTimeout(200); await page.waitForFunction(() => !document.querySelector('#send').disabled || document.querySelector('#message').value === '', null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800); return bodies.at(-1) }
    const tag = `${name}/${scenario}`
    try {
      await page.goto(`${origin}/kohako/home.html`); await page.waitForFunction(() => !document.querySelector('#send').disabled)
      // 既定 OFF: 位置は取得せず off を送る。
      check(await page.locator('#location-note').isHidden(), `${tag}: note hidden by default`)
      let b = await send('こんにちは')
      check(b && JSON.stringify(b.location) === '{"status":"off"}', `${tag}: default off sent ${JSON.stringify(b?.location)}`)
      // 設定で ON（本人の操作）。
      await page.locator('#settings-open').click(); await page.locator('#pref-location').check(); await page.waitForTimeout(1500)
      const status = await page.locator('#location-status').textContent()
      if (scenario === 'granted') check(status.includes('位置を共有中') && status.includes('精度約30m') && !/35\.6|139\.7/.test(status), `${tag}: status ${status}`)
      if (scenario === 'denied') check(status.includes('許可されていません'), `${tag}: status ${status}`)
      if (scenario === 'unavailable') check(status.includes('取得できませんでした'), `${tag}: status ${status}`)
      await page.screenshot({ path: `${out}/${name}-${scenario}-settings.png` })
      await page.locator('#settings-close').click()
      check(await page.locator('#location-note').isVisible(), `${tag}: note visible when on`)
      b = await send('近くでお昼を食べられるところは？')
      if (scenario === 'granted') check(b?.location?.status === 'ok' && b.location.lat === 35.68124 && b.location.lon === 139.76713 && b.location.accuracy === 30 && Math.abs(Date.now() - b.location.capturedAt) < 120000, `${tag}: ok sent ${JSON.stringify(b?.location && { ...b.location, lat: 'x', lon: 'x' })}`)
      else check(b && JSON.stringify(b.location) === JSON.stringify({ status: scenario }) , `${tag}: miss sent ${JSON.stringify(b?.location)}`)
      await page.screenshot({ path: `${out}/${name}-${scenario}-composer.png` })
      // 端末に座標が保存されていない（localStorage/sessionStorage）。
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
      check(!/35\.68|139\.76/.test(stored), `${tag}: coordinates not stored`)
      // 共有停止: OFF にした直後の送信から off。
      await page.locator('#settings-open').click(); await page.locator('#pref-location').uncheck(); await page.locator('#settings-close').click()
      check(await page.locator('#location-note').isHidden(), `${tag}: note hidden after stop`)
      b = await send('いまどこにいると思う？')
      check(b && JSON.stringify(b.location) === '{"status":"off"}', `${tag}: off after stop ${JSON.stringify(b?.location)}`)
      // 現場（見てきて）には位置を添えない。
      const n = bodies.length; await page.locator('#settings-open').click(); await page.locator('#pref-location').check(); await page.locator('#settings-close').click(); await page.locator('#visit').click(); for (let i = 0; i < 30 && bodies.length === n; i++) await page.waitForTimeout(200)
      check(bodies.length > n && bodies.at(-1).location === undefined, `${tag}: visit has no location`)
    } catch (e) { failures.push(`${tag}: ${e.message}`) } finally { await ctx.close() }
  }
}
// 同じ端末の 2 タブ: 片方で共有を OFF にしたら、もう片方の送信も off になる。
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, geolocation: FAKE, permissions: ['geolocation'] }), bodies = []
  await ctx.route('**/kohako/api/v1/**', async route => { const p = new URL(route.request().url()).pathname.split('/v1/')[1], j = (code, data) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(503, {}); if (p === 'messages') { bodies.push(JSON.parse(route.request().postData())); return j(202, {}) } if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: '返答です', at: Date.now() } }); return j(404, {}) })
  const a = await ctx.newPage(), b = await ctx.newPage()
  const send = async (page, text) => { const before = bodies.length; await page.locator('#message').fill(text); await page.locator('#form').evaluate(e => e.requestSubmit()); for (let i = 0; i < 60 && bodies.length === before; i++) await page.waitForTimeout(200); await page.waitForTimeout(800); return bodies.at(-1) }
  try {
    for (const page of [a, b]) { await page.goto(`${origin}/kohako/home.html`); await page.waitForFunction(() => !document.querySelector('#send').disabled) }
    await a.bringToFront(); await a.locator('#settings-open').click(); await a.locator('#pref-location').check(); await a.locator('#settings-close').click(); await a.waitForTimeout(1500)
    await b.bringToFront(); let r = await send(b, '近くに何がある？')
    check(r?.location?.status === 'ok', `two-tabs: other tab follows on ${r?.location?.status}`)
    await a.bringToFront(); await a.locator('#settings-open').click(); await a.locator('#pref-location').uncheck(); await a.locator('#settings-close').click(); await a.waitForTimeout(300)
    await b.bringToFront()
    check(await b.locator('#location-note').isHidden(), 'two-tabs: other tab note hidden after stop')
    r = await send(b, 'いまどこ？')
    check(r && JSON.stringify(r.location) === '{"status":"off"}', `two-tabs: other tab off after stop ${JSON.stringify(r?.location)}`)
    // storage イベントを取りこぼした場合（保存値だけ OFF）も、送信直前の読み直しで off。
    await a.locator('#settings-open').click(); await a.locator('#pref-location').check(); await a.locator('#settings-close').click(); await a.waitForTimeout(1500)
    await b.evaluate(() => { const p = JSON.parse(localStorage.getItem('kohako-home-prefs')); localStorage.setItem('kohako-home-prefs', JSON.stringify({ ...p, location: false })) })
    r = await send(b, 'ここはどこ？')
    check(r && JSON.stringify(r.location) === '{"status":"off"}', `two-tabs: stored off honored at send ${JSON.stringify(r?.location)}`)
  } catch (e) { failures.push(`two-tabs: ${e.message}`) } finally { await ctx.close() }
}
await browser.close(); server.close(); fs.writeFileSync(`${out}/result.json`, JSON.stringify({ failures, log }, null, 2)); console.log(log.join('\n')); console.log(JSON.stringify({ failures }, null, 2)); process.exitCode = failures.length ? 1 : 0
