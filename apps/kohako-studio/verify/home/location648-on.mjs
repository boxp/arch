// BOXP-648 TD-01: 共有 ON のまま測位が一時的に失敗する場面を、BFF モックと架空の位置（東京駅付近の公開地点）で確かめる。本人の実位置は使わない。
// 1) 高精度が時間切れでも低精度で取り直して ok を送る 2) 取り直しが全部失敗しても 10 分以内の直前の位置を取得時刻つきで送る
// 3) 拒否に変わったら直前の位置を送らない 4) 直前の位置が 10 分を超えたら送らない 5) 入力欄に触れた時点で取得を始める
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const site = process.env.SITE || '/site', port = Number(process.env.PORT || 8772), out = process.argv[2] || 'out/location648-on'
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/json' }
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(site, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), failures = [], log = []
const check = (ok, message) => { log.push(`${ok ? 'ok ' : 'NG '} ${message}`); if (!ok) failures.push(message) }
const origin = `http://localhost:${port}`
for (const [name, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['mobile', { width: 412, height: 915 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  // 架空の測位。window.__geo.mode で 'ok' | 'precise-timeout'（高精度だけ時間切れ）| 'fail'（全部時間切れ）| 'denied' を切り替え、時計は __clockSkew で進める。
  await ctx.addInitScript(() => {
    const realNow = Date.now.bind(Date); window.__skew = 0; Date.now = () => realNow() + window.__skew
    window.__geo = { mode: 'ok', calls: [] }
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (ok, ng, o) => { window.__geo.calls.push({ high: !!o?.enableHighAccuracy, at: Date.now() }); const m = window.__geo.mode; setTimeout(() => { if (m === 'denied') return ng({ code: 1 }); if (m === 'fail' || (m === 'precise-timeout' && o?.enableHighAccuracy)) return ng({ code: 3 }); ok({ coords: { latitude: 35.681236, longitude: 139.767125, accuracy: o?.enableHighAccuracy ? 20 : 900 }, timestamp: Date.now() }) }, 30) }, watchPosition: () => 0, clearWatch: () => {} } })
  })
  const page = await ctx.newPage(), bodies = []
  await ctx.route('**/kohako/api/v1/**', async route => { const p = new URL(route.request().url()).pathname.split('/v1/')[1], j = (code, data) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(503, {}); if (p === 'messages') { bodies.push(JSON.parse(route.request().postData())); return j(202, {}) } if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: '返答です', at: Date.now() } }); return j(404, {}) })
  const send = async text => { const before = bodies.length; await page.locator('#message').fill(text); await page.locator('#form').evaluate(e => e.requestSubmit()); for (let i = 0; i < 100 && bodies.length === before; i++) await page.waitForTimeout(200); await page.waitForFunction(() => !document.querySelector('#send').disabled || document.querySelector('#message').value === '', null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800); return bodies.at(-1) }
  const skew = ms => page.evaluate(ms => { window.__skew += ms }, ms)
  const mode = m => page.evaluate(m => { window.__geo.mode = m }, m)
  const tag = name
  try {
    await page.goto(`${origin}/kohako/home.html`); await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await page.locator('#settings-open').click(); await page.locator('#pref-location').check(); await page.waitForTimeout(800); await page.keyboard.press('Escape')
    let b = await send('ここの近くの温泉は？')
    check(b?.location?.status === 'ok' && b.location.accuracy === 20, `${tag}: first send ok precise`)
    // 3 分後、高精度だけ時間切れ → 低精度で取り直して ok。
    await skew(3 * 60_000); await mode('precise-timeout')
    b = await send('ここから米子駅はどう帰る？')
    check(b?.location?.status === 'ok' && b.location.accuracy === 900, `${tag}: precise timeout falls back to coarse ok (${b?.location?.status})`)
    // さらに 3 分後、取り直しが全部失敗 → 直前の位置（3 分前・10 分以内）を取得時刻つきで送る。
    await skew(3 * 60_000); await mode('fail')
    b = await send('現在地を共有できてませんか')
    const age = b?.location?.capturedAt ? (await page.evaluate(() => Date.now())) - b.location.capturedAt : -1
    check(b?.location?.status === 'ok' && age >= 3 * 60_000 && age < 4 * 60_000, `${tag}: transient failure keeps previous fix with its capture time (age ${Math.round(age / 1000)}s)`)
    check((await page.locator('#location-chip').textContent()).includes('⚠') && (await page.locator('#location-chip').getAttribute('title')).includes('取り直しに失敗したため、この位置を取得時刻つきで伝えます'), `${tag}: composer chip says refresh failed`)
    await page.screenshot({ path: `${out}/${name}-kept.png` })
    // 10 分を超えたら送らない（stale/timeout）。
    await skew(8 * 60_000)
    b = await send('今どこ？')
    check(b?.location?.status === 'timeout', `${tag}: previous fix older than 10 min is not sent (${b?.location?.status})`)
    // 取り直せた後に拒否へ変わったら、直前の位置は送らない。
    await mode('ok'); await skew(3 * 60_000); b = await send('もう一度')
    check(b?.location?.status === 'ok', `${tag}: recovers to ok`)
    await mode('denied'); await skew(3 * 60_000); b = await send('拒否後')
    check(b?.location?.status === 'denied', `${tag}: denial drops the previous fix (${b?.location?.status})`)
    // 入力欄に触れた時点で取得を始める（送信前に先行取得）。
    await mode('ok'); await skew(3 * 60_000)
    const callsBefore = await page.evaluate(() => window.__geo.calls.length)
    await page.locator('#message').evaluate(e => e.blur()); await page.locator('#message').focus(); await page.waitForTimeout(300)
    check((await page.evaluate(() => window.__geo.calls.length)) > callsBefore, `${tag}: focusing the composer starts acquisition`)
    // ブラウザ保存に座標が残らない。
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    check(!/35\.68|139\.76/.test(stored), `${tag}: no coordinates in storage`)
  } catch (e) { check(false, `${tag}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ failures, log }, null, 2))
console.log(log.join('\n')); console.log(failures.length ? `FAIL ${failures.length}` : 'all ok')
process.exit(failures.length ? 1 : 0)
