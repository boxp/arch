// BOXP-647: 実時間で relax 後の返答保持を検証する。BFF はすべてモック。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8847)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) })
}).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const short = '短い返答です。', long = Array.from({ length: 45 }, (_, i) => `段落 ${i + 1}：いつでも読み返せる長い返答です。`).join('\n\n')
await Promise.all(['pc', 'mobile', 'landscape'].flatMap((device) => ['short', 'long'].map(async (size) => {
  const label = `${device}-${size}`, checks = results[label] = {}, mobile = device !== 'pc', content = size === 'short' ? short : long
  const ctx = await browser.newContext({ viewport: device === 'landscape' ? { width: 915, height: 412 } : mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  let count = 0
  const check = (name, ok) => { checks[name] = !!ok; if (!ok) failures.push(`${label}: ${name}`) }
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await page.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') { count++; return json(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) return json(200, { status: 'done', reply: { text: count === 1 ? content : '次の返答です。' } })
    return json(200, {})
  })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#speech').uncheck({ force: true })
    await page.locator('#message').fill('確認'); await page.locator('#send').click()
    await page.waitForFunction(text => document.querySelector('#reply').textContent.includes(text), content.slice(0, 10), { timeout: 20000 })
    const delivered = Date.now(), scroll = device === 'mobile' ? '#chatlog' : '#bubble'
    if (size === 'long') await page.locator(scroll).evaluate(e => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true })); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
    await page.waitForTimeout(67000)
    check('67秒以上経過', Date.now() - delivered >= 67000)
    check('relax と表示状態', await page.evaluate(() => document.body.dataset.scene === 'relax' && document.body.dataset.message === '1'))
    check('返信が見える', await page.locator('#reply').isVisible() && await page.locator('#bubble').evaluate(e => getComputedStyle(e).opacity === '1' && getComputedStyle(e).pointerEvents !== 'none'))
    check('時計と利用枠が重ならない', await page.evaluate(() => getComputedStyle(document.querySelector('.clock-face')).opacity === '0' && getComputedStyle(document.querySelector('.status-anchor')).display === 'none'))
    if (size === 'long') {
      check('スクロール位置維持', await page.locator(scroll).evaluate(e => e.scrollTop <= 2 && e.scrollHeight > e.clientHeight))
      await page.locator(scroll).evaluate(e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })
      check('末尾へスクロール可能', await page.locator(scroll).evaluate(e => e.scrollTop > 0 && e.scrollTop + e.clientHeight >= e.scrollHeight - 2))
    }
    await page.screenshot({ path: path.join(out, `${label}.png`) })
    await page.locator('#history-open').click(); check('履歴に返信', (await page.locator('#history-list').textContent()).includes(content.slice(0, 10))); await page.locator('#history-close').click()
    await page.locator('#speech').check({ force: true }); await page.locator('#speech').uncheck({ force: true })
    check('設定切替で保持を失わない', await page.locator('#bubble').getAttribute('data-retained') === '1')
    await page.locator('#speech').check({ force: true })
    await page.locator('#message').fill('次へ'); check('入力可能', await page.locator('#message').inputValue() === '次へ'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('次の返答です。'), null, { timeout: 20000 })
    check('次の返信へ置換', await page.locator('#reply').textContent() === '次の返答です。')
    check('読み上げありの返信は保持対象外', await page.locator('#bubble').getAttribute('data-retained') === null)
    await page.locator('#speech').uncheck({ force: true })
    check('読み上げ停止で古い保持を復活させない', await page.locator('#bubble').getAttribute('data-retained') === null)
    check('ページエラーなし', errors.length === 0)
  } catch (e) { failures.push(`${label}: ${e.message}`); checks.exception = e.message; await page.screenshot({ path: path.join(out, `${label}-failure.png`) }).catch(() => {}) }
  await ctx.close()
})))
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
