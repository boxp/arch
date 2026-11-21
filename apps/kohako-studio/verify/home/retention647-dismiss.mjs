// BOXP-647: 実時間で relax 後の返答保持を検証する。BFF はすべてモック。
import { chromium } from 'playwright'
import { createStaticServer } from './retention647-static.mjs'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8847)
fs.mkdirSync(out, { recursive: true })
const server = createStaticServer(site).listen(port, '127.0.0.1')
const browser = process.env.CDP ? await chromium.connectOverCDP(process.env.CDP) : await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const short = '短い返答です。\n\nA: 案1\nB: 案2', long = '長い返答です。\n\n[リンク](https://example.com)\n\n' + Array.from({ length: 45 }, (_, i) => `段落 ${i + 1}：いつでも読み返せる長い返答です。`).join('\n\n') + '\n\nA: 案1\nB: 案2'
await Promise.all(['pc', 'mobile', 'landscape'].flatMap((device) => ['short', 'long'].map(async (size) => {
  const label = `${device}-${size}`, checks = results[label] = {}, mobile = device !== 'pc', content = size === 'short' ? short : long
  const ctx = await browser.newContext({ viewport: device === 'landscape' ? { width: 915, height: 412 } : mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage(), errors = []
  let count = 0
  const touchIds = new Set()
  const check = (name, ok) => { checks[name] = !!ok; if (!ok) failures.push(`${label}: ${name}`) }
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', req => { if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort())
  await page.route(`http://127.0.0.1:${port}/**`, async route => {
    const response = await fetch(route.request().url())
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  await page.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'messages') { const body = req.postDataJSON(); if (body.kind === 'touch') touchIds.add(body.requestId); else count++; return json(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) return json(200, { status: 'done', reply: { text: touchIds.has(p.split('/')[1]) ? 'ふれあいの返答' : count === 1 ? content : '次の返答です。\n\nA: 案1\nB: 案2' } })
    return json(200, {})
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#speech').uncheck({ force: true })
    await page.locator('#message').fill('確認'); await page.locator('#send').click()
    await page.waitForFunction(text => document.querySelector('#reply').textContent.includes(text), content.slice(0, 7), { timeout: 20000 })
    const delivered = Date.now(), scroll = device === 'mobile' ? '#chatlog' : '#bubble'
    if (size === 'long') await page.locator(scroll).evaluate(e => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true })); e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
    await page.waitForTimeout(67000)
    check('67秒以上経過', Date.now() - delivered >= 67000)
    if (size === 'short') check('relaxへ移行', await page.locator('body').getAttribute('data-scene') === 'relax')
    check('返答の表示状態', await page.evaluate(() => document.body.dataset.message === '1'))
    check('返信が見える', await page.locator('#reply').isVisible() && await page.locator('#bubble').evaluate(e => getComputedStyle(e).opacity === '1' && getComputedStyle(e).pointerEvents !== 'none'))
    check('時計と利用枠が重ならない', await page.evaluate(() => getComputedStyle(document.querySelector('.clock-face')).opacity === '0' && getComputedStyle(document.querySelector('.status-anchor')).display === 'none'))
    if (size === 'long') {
      check('スクロール位置維持', await page.locator(scroll).evaluate(e => e.scrollTop <= 2 && e.scrollHeight > e.clientHeight))
      await page.locator(scroll).evaluate(e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })
      check('末尾へスクロール可能', await page.locator(scroll).evaluate(e => e.scrollTop > 0 && e.scrollTop + e.clientHeight >= e.scrollHeight - 2))
    }
    await page.locator('#reply').click()
    check('内側クリックで保持', await page.locator('#bubble').isVisible())
    if (size === 'long') {
      await page.locator('#reply a').evaluate(a => a.addEventListener('click', event => event.preventDefault(), { once: true }))
      await page.locator('#reply a').click()
      check('リンク操作で保持', await page.locator('#bubble').isVisible())
    }
    await page.locator('#reply').evaluate(e => { const range = document.createRange(); range.selectNodeContents(e); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) })
    await page.locator('#reply').dispatchEvent('pointerdown', { bubbles: true })
    await page.locator('#reply').dispatchEvent('click', { bubbles: true })
    check('本文選択で保持', await page.locator('#bubble').isVisible())
    await page.evaluate(() => getSelection().removeAllRanges())
    check('選択肢が表示される', await page.locator('#reply-choices button').count() === 2)
    await page.screenshot({ path: path.join(out, `${label}-before.png`) })
    if (mobile) await page.touchscreen.tap(5, 200)
    else await page.mouse.click(5, 200)
    await page.waitForTimeout(500)
    check('外側で閉じる', !(await page.locator('#bubble').isVisible()) && await page.locator('body').getAttribute('data-message') === '0')
    check('利用枠表示とヒット', await page.locator('.status-widget').evaluate(e => { const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return r.width > 0 && r.height > 0 && !!hit && e.contains(hit) }))
    await page.screenshot({ path: path.join(out, `${label}-dismissed.png`) })
    await page.locator('#touch-open').click()
    await page.locator('#touch-pat').click()
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('ふれあいの返答'), null, { timeout: 20000 })
    await page.waitForFunction(text => document.querySelector('#reply').textContent.includes(text), content.slice(0, 7), { timeout: 12000 })
    check('ふれあい復元後も閉じたまま', !(await page.locator('#bubble').isVisible()))
    await page.locator('#history-open').click(); check('履歴に返信', (await page.locator('#history-list').textContent()).includes(content.slice(0, 7))); await page.locator('#history-close').click()
    await page.locator('#speech').check({ force: true }); await page.locator('#speech').uncheck({ force: true })
    check('設定切替で保持を失わない', await page.locator('#bubble').getAttribute('data-retained') === '1')
    await page.locator('#message').fill('次へ'); check('入力可能', await page.locator('#message').inputValue() === '次へ'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('次の返答です。'), null, { timeout: 20000 })
    check('次の返信へ置換', (await page.locator('#reply').textContent()).startsWith('次の返答です。') && await page.locator('#bubble').isVisible())
    check('新しい返答を保持', await page.locator('#bubble').getAttribute('data-retained') === '1')
    const choiceRequest = page.waitForResponse(response => response.url().endsWith('/messages') && response.request().method() === 'POST')
    await page.locator('#reply-choices button').first().click()
    await choiceRequest
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('次の返答です。') && document.querySelector('#bubble').dataset.retained === '1', null, { timeout: 20000 })
    check('選択肢で送信して返答を表示', count >= 3 && await page.locator('#bubble').isVisible())
    check('ページエラーなし', errors.length === 0)
  } catch (e) { failures.push(`${label}: ${e.message}`); checks.exception = e.message; await page.screenshot({ path: path.join(out, `${label}-failure.png`) }).catch(() => {}) }
  await ctx.close()
})))
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
