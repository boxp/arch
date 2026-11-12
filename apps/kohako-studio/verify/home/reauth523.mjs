// BOXP-523: 認証切れの手動再読込と退避復元を BFF モックで検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8823)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const results = {}, failures = [], assert = (v, m) => { if (!v) throw new Error(m) }
let browser
try {
  browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['mobile', { width: 412, height: 915 }, true]]) {
    results[device] = {}
    for (const scenario of ['a', 'b', 'c', 'd']) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
      let mode = scenario === 'b' ? 'abort' : scenario === 'a' ? 'ok' : 'auth', navigations = 0, meCalls = 0
      const posts = [], gets = []
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
      await ctx.route('**/kohako/api/v1/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
        if (p === 'me') { meCalls++; if (mode === 'abort') return route.abort(); if (mode === 'auth') return route.fulfill({ status: 302, headers: { location: 'https://example.cloudflareaccess.com/login' } }); return json(200, { authenticated: true }) }
        if (p === 'conversation') return json(200, { enabled: true, stt: false })
        if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
        if (p === 'messages') { posts.push(req.postDataJSON()); return json(202, {}) }
        if (p.startsWith('requests/')) { gets.push(p); if (mode === 'auth') return json(401, {}); return json(200, { status: 'pending' }) }
        return json(404, {})
      })
      const url = `http://localhost:${port}/kohako/home.html?acting=0&face=static`
      try {
        if (scenario === 'd') await ctx.addInitScript(() => sessionStorage.setItem('kohako-home-unconfirmed', JSON.stringify({ kind: 'text', text: '未確認', requestId: 'pending-523', expiresAt: Date.now() + 600000 })))
        await page.goto(url)
        if (scenario === 'a') { await page.waitForFunction(() => !document.querySelector('#send').disabled); await page.locator('#message').fill('実行'); await page.locator('#send').click(); await page.locator('#message').fill('待ち'); await page.locator('#send').click(); mode = 'auth' }
        await page.locator('#reconnect').waitFor({ state: 'visible', timeout: 15000 })
        if (scenario === 'b') {
          assert((await page.locator('#reconnect').textContent()) === '再接続', '通常切断のボタン'); const before = meCalls; await page.locator('#reconnect').click(); await page.waitForTimeout(700); assert(navigations === 1 && meCalls > before, '通常切断で再読込または再接続なし')
        } else {
          assert((await page.locator('#reconnect').textContent()) === '再認証のため再読み込み', '認証切れのボタン')
          await page.locator('#message').fill('下書き')
          if (scenario !== 'c') mode = 'ok'
          // 同じ家の HTML を再読込し、Access ログイン後の応答を模擬する。
          await page.route('**/kohako/home.html**', route => route.continue())
          await Promise.all([page.waitForNavigation(), page.locator('#reconnect').click()])
          if (scenario === 'c') { await page.locator('#error').waitFor(); assert((await page.locator('#error').textContent()).includes('再読み込みしても認証できませんでした。ログイン画面が開かない場合はブラウザで家のURLを開き直してください。'), '再認証失敗の案内なし'); await page.waitForTimeout(5000); assert(navigations === 2, `自動再読込 ${navigations}`) }
          else { await page.waitForFunction(() => !document.querySelector('#send').disabled); assert(await page.locator('#message').inputValue() === '下書き', '草稿未復元'); assert(await page.evaluate(() => sessionStorage.getItem('kohako-home-reauth')) === null, '退避が残存'); await page.waitForTimeout(500); assert(posts.length === (scenario === 'a' ? 1 : 0), '予期しない POST'); if (scenario === 'a') { assert((await page.locator('#queue-list').textContent()).includes('待ち'), 'キュー未復元'); assert(await page.locator('#queue-resume').isVisible(), 'キューが保留されていない') } if (scenario === 'd') assert(gets.some(x => x === 'requests/pending-523'), '未確認の GET 照会なし') }
        }
        results[device][scenario] = { pass: true, navigations, meCalls, posts: posts.length, gets }
      } catch (error) { const message = String(error.message || error); failures.push(`${device} ${scenario}: ${message}`); results[device][scenario] = { pass: false, error: message }; await page.screenshot({ path: `${out}/${device}-${scenario}-failure.png` }).catch(() => {}) }
      finally { await ctx.close() }
    }
  }
} catch (error) { failures.push(String(error.stack || error)) }
finally { await browser?.close(); server.close(); fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2)); console.log(JSON.stringify({ results, failures }, null, 2)); process.exitCode = failures.length ? 1 : 0 }
