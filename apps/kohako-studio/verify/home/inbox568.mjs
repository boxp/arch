// BOXP-547: 受信箱更新時の返信下書きを実ブラウザで検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8808)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const items = ['A', 'B', 'choice', 'failed', 'mixed'].map((id, n) => ({ eventId: `event-568-${id}`, source: 'task-board-report', ticketId: 'BOXP-568', title: `通知${id}`, body: '本文', choices: ['選択肢'], receivedAt: new Date(Date.now() - (5 - n) * 60000).toISOString(), readAt: new Date().toISOString() }))
  const calls = [], checks = results[device] = {}, ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await page.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items, unread: 0 })
    const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
    if (m) { const item = items.find(i => i.eventId === decodeURIComponent(m[1])); if (m[2] === 'reply') { const body = req.postDataJSON(); calls.push({ id: m[1], ...body }); await new Promise(r => setTimeout(r, 300)); item.reply = { ...body, requestId: 'request-568', status: m[1].endsWith('failed') && calls.filter(c => c.id === m[1]).length === 1 ? 'submit_failed' : 'submitted' }; return json(200, item.reply) } if (m[2] === 'read') item.readAt = new Date().toISOString(); return json(200, { claimed: false }) }
    return json(200, {})
  })
  const check = (name, ok) => { checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) failures.push(`${device}: ${name}`) }
  const select = async title => { await page.locator('#inbox-list .inbox-row').filter({ hasText: title }).click(); await page.waitForFunction(t => document.querySelector('#inbox-detail .detail-title')?.textContent === t, title) }
  const refresh = async () => { const response = page.waitForResponse(r => r.url().endsWith('/notifications') && r.request().method() === 'GET'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await response; await page.waitForTimeout(100) }
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled && !document.querySelector('#inbox-open').hidden, null, { timeout: 30000 })
    await page.locator('#inbox-open').click(); await select('通知A')
    const input = page.locator('#inbox-detail textarea')
    check('選択肢と自由文欄', await input.count() === 1 && await page.getByRole('button', { name: '選択肢', exact: true }).count() === 1)
    if (!await input.count()) throw Error('選択肢付き通知に自由文欄がない')
    await input.fill('下書き'); await input.focus(); await input.evaluate(e => { e.setSelectionRange(1, 2); window.savedInput = e }); await refresh()
    check('更新で下書き・フォーカス・選択範囲を保持', await input.evaluate(e => e.value === '下書き' && e === window.savedInput && document.activeElement === e && e.selectionStart === 1 && e.selectionEnd === 2))
    await select('通知B'); await input.fill('別の下書き'); await select('通知A'); check('通知切替で下書き復元', await input.inputValue() === '下書き')
    await input.fill('   '); await page.getByRole('button', { name: '返信する' }).click(); check('空白のみは送信しない', calls.length === 0)
    await input.fill('選択肢'); await page.getByRole('button', { name: '返信する' }).dblclick(); await page.waitForTimeout(600)
    check('同じラベルも text で一度だけ送信', calls.length === 1 && calls[0].id === 'event-568-A' && calls[0].kind === 'text' && calls[0].value === '選択肢')
    if (await page.locator('#inbox').isHidden()) await page.locator('#inbox-open').click()
    await select('通知B'); check('他通知の下書き保持', await input.inputValue() === '別の下書き')
    await select('通知choice'); await page.getByRole('button', { name: '選択肢', exact: true }).click(); await page.waitForTimeout(600)
    check('選択肢は choice', calls.some(c => c.id === 'event-568-choice' && c.kind === 'choice' && c.value === '選択肢'))
    if (await page.locator('#inbox').isHidden()) await page.locator('#inbox-open').click()
    await select('通知mixed'); await input.fill('自由文'); await page.evaluate(() => { const detail = document.querySelector('#inbox-detail'); [...detail.querySelectorAll('button')].find(b => b.textContent === '返信する').click(); [...detail.querySelectorAll('button')].find(b => b.textContent === '選択肢').click() }); await page.waitForTimeout(600)
    check('自由文と選択肢の同時操作を抑止', calls.filter(c => c.id === 'event-568-mixed').length === 1 && calls.find(c => c.id === 'event-568-mixed').kind === 'text')
    if (await page.locator('#inbox').isHidden()) await page.locator('#inbox-open').click()
    await select('通知failed'); await input.fill('再送本文'); await page.getByRole('button', { name: '返信する' }).click(); await page.waitForTimeout(600); await refresh()
    await page.getByRole('button', { name: '同じ返信を再送' }).dblclick(); await page.waitForTimeout(600)
    const retries = calls.filter(c => c.id === 'event-568-failed')
    check('失敗後は同一 replyId・内容で一度だけ再送', retries.length === 2 && retries[0].replyId === retries[1].replyId && retries.every(c => c.kind === 'text' && c.value === '再送本文'))

  } catch (e) { checks.exception = e.message; failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2)); process.exitCode = failures.length || external.length ? 1 : 0
