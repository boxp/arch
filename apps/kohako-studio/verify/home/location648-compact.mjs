// BOXP-648 TD-02: 入力欄まわりの位置表示が小さく収まり、会話・入力欄を圧迫しないことを BFF モックと架空の位置（東京駅付近の公開地点）で確かめる。本人の実位置は使わない。
// PC・スマホ縦・スマホ横で、共有 OFF と比べて入力バーの高さが増えない／入力欄の幅を大きく削らない／はみ出さないこと、
// 共有中・取り直し失敗・未許可の状態が短い表示と注意色で分かること、押すと理由の全文が開閉すること、OFF で消えることを見る。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const site = process.env.SITE || '/site', port = Number(process.env.PORT || 8773), out = process.argv[2] || 'out/location648-compact'
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/json' }
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(site, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), failures = [], log = []
const check = (ok, message) => { log.push(`${ok ? 'ok ' : 'NG '} ${message}`); if (!ok) failures.push(message) }
const origin = `http://localhost:${port}`
const shapes = [['pc', { width: 1280, height: 800 }, false], ['pc-narrow', { width: 820, height: 600 }, false], ['mobile-portrait', { width: 412, height: 915 }, true], ['mobile-small', { width: 360, height: 740 }, true], ['mobile-landscape', { width: 915, height: 412 }, true]]
for (const [name, viewport, mobile] of shapes) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript(() => {
    const realNow = Date.now.bind(Date); window.__skew = 0; Date.now = () => realNow() + window.__skew
    window.__geo = { mode: 'ok' }
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (ok, ng, o) => { const m = window.__geo.mode; setTimeout(() => { if (m === 'denied') return ng({ code: 1 }); if (m === 'fail') return ng({ code: 3 }); ok({ coords: { latitude: 35.681236, longitude: 139.767125, accuracy: o?.enableHighAccuracy ? 20 : 900 }, timestamp: Date.now() }) }, 30) }, watchPosition: () => 0, clearWatch: () => {} } })
  })
  const page = await ctx.newPage(), bodies = []
  await ctx.route('**/kohako/api/v1/**', async route => { const p = new URL(route.request().url()).pathname.split('/v1/')[1], j = (code, data) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(503, {}); if (p === 'messages') { bodies.push(JSON.parse(route.request().postData())); return j(202, {}) } if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: '返答です', at: Date.now() } }); return j(404, {}) })
  const send = async text => { const before = bodies.length; await page.locator('#message').fill(text); await page.locator('#form').evaluate(e => e.requestSubmit()); for (let i = 0; i < 100 && bodies.length === before; i++) await page.waitForTimeout(200); await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); return bodies.at(-1) }
  const skew = ms => page.evaluate(ms => { window.__skew += ms }, ms)
  const mode = m => page.evaluate(m => { window.__geo.mode = m }, m)
  const toggle = async on => { await page.locator('#settings-open').click(); const box = page.locator('#pref-location'); on ? await box.check() : await box.uncheck(); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
  const layout = () => page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), f = document.querySelector('#form'), c = document.querySelector('#location-chip'), a = document.querySelector('#send')
    const h1 = f.getBoundingClientRect().height, was = c.hidden; c.hidden = true; const h0 = f.getBoundingClientRect().height; c.hidden = was
    return { cost: h1 - h0, portrait: document.body.dataset.shape === 'portrait', bar: r('#form').height, text: r('#message').width, overflow: f.scrollWidth - f.clientWidth, chip: c.hidden ? null : { w: r('#location-chip').width, h: r('#location-chip').height, top: r('#location-chip').top, text: c.textContent, shown: c.innerText.replace(/\s/g, ''), warn: c.classList.contains('warn'), title: c.title, expanded: c.getAttribute('aria-expanded') }, send: { top: r('#send').top, h: r('#send').height }, noteShown: !document.querySelector('#location-note').hidden, noteText: document.querySelector('#location-note').textContent } })
  const tag = name
  try {
    await page.goto(`${origin}/kohako/home.html`); await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await send('こんにちは')
    const base = await layout()
    check(base.chip === null && !base.noteShown, `${tag}: OFF shows no location UI`)
    await toggle(true); await send('ここの近くの温泉は？')
    let l = await layout()
    log.push(`   ${tag}: base bar ${Math.round(base.bar)} text ${Math.round(base.text)} / on bar ${Math.round(l.bar)} text ${Math.round(l.text)} chip ${l.chip && Math.round(l.chip.w)}x${l.chip && Math.round(l.chip.h)}`)
    check((l.portrait ? l.chip?.shown === '📍' : /^📍\d\d:\d\d$/.test(l.chip?.shown ?? '')) && !l.chip.warn, `${tag}: sharing shows short chip (${l.chip?.shown}${l.portrait ? ' / label hidden in portrait' : ''})`)
    check(l.cost <= 1, `${tag}: chip adds no row (cost ${l.cost})`)
    check(l.bar <= base.bar + 1, `${tag}: bar height not increased (${Math.round(base.bar)} -> ${Math.round(l.bar)})`)
    check(l.text >= base.text * 0.8, `${tag}: textarea keeps >=80% width (${Math.round(base.text)} -> ${Math.round(l.text)})`)
    check(l.overflow <= 0 && l.chip.w <= 110 && Math.abs(l.chip.h - l.send.h) <= 2, `${tag}: chip fits the button row (w ${Math.round(l.chip.w)}, overflow ${l.overflow})`)
    check(!l.noteShown && l.chip.title.includes('位置を共有中'), `${tag}: details hidden until tapped, available as title`)
    await page.screenshot({ path: `${out}/${name}-sharing.png` })
    await skew(3 * 60_000); await mode('fail'); await send('ここから米子駅はどう帰る？')
    l = await layout()
    check(l.chip.shown.endsWith('⚠') && l.chip.warn && l.chip.title.includes('取り直し失敗') && l.cost <= 1, `${tag}: refresh failure flagged compactly (${l.chip.shown})`)
    await page.locator('#location-chip').click(); await page.waitForTimeout(200)
    l = await layout()
    check(l.noteShown && l.noteText.includes('取り直し失敗') && l.chip.expanded === 'true', `${tag}: tapping chip opens full reason`)
    await page.screenshot({ path: `${out}/${name}-failed-open.png` })
    await page.locator('#location-chip').click(); await page.waitForTimeout(200)
    l = await layout()
    if (l.cost > 1) { await page.screenshot({ path: `${out}/${name}-closed.png` }); log.push(`   ${tag}: visible bar buttons ${await page.evaluate(() => [...document.querySelectorAll('#form>button')].filter(b => !b.hidden && b.offsetParent).map(b => b.id).join(','))}`) }
    check(!l.noteShown && l.chip.expanded === 'false' && l.cost <= 1, `${tag}: tapping again closes it, chip adds no row (cost ${l.cost})`)
    await mode('denied'); await skew(3 * 60_000); const b = await send('今どこ？')
    l = await layout()
    check(b?.location?.status === 'denied' && l.chip.shown === (l.portrait ? '📍⚠' : '📍未許可⚠') && l.chip.warn && l.cost <= 1 && l.chip.title.includes('許可されていません'), `${tag}: denied shown as warn chip (${l.chip.shown})`)
    await page.screenshot({ path: `${out}/${name}-denied.png` })
    await toggle(false)
    l = await layout()
    check(l.chip === null && !l.noteShown, `${tag}: OFF hides chip immediately`)
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    check(!/35\.68|139\.76/.test(stored), `${tag}: no coordinates in storage`)
  } catch (e) { check(false, `${tag}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ failures, log }, null, 2))
console.log(log.join('\n')); console.log(failures.length ? `FAIL ${failures.length}` : 'all ok')
process.exit(failures.length ? 1 : 0)
