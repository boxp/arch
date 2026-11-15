// BOXP-547: 受信箱更新時の返信下書きを実ブラウザで検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8807)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const items = ['A', 'B', 'choice', 'replied'].map((id, n) => ({ eventId: `event-547-${id}`, source: 'task-board-report', title: `通知${id}`, body: '本文', receivedAt: new Date(Date.now() - (5 - n) * 60000).toISOString(), readAt: new Date().toISOString(), ...(id === 'choice' ? { choices: ['選択肢'] } : {}), ...(id === 'replied' ? { reply: { replyId: 'old', kind: 'text', value: '済', requestId: 'old-request', status: 'submitted' } } : {}) }))
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
    if (m) { const item = items.find(i => i.eventId === decodeURIComponent(m[1])); if (m[2] === 'reply') { const body = req.postDataJSON(); calls.push({ id: m[1], ...body }); item.reply = { ...body, requestId: 'request-547', status: 'submitted' }; return json(200, item.reply) } if (m[2] === 'read') item.readAt = new Date().toISOString(); return json(200, { claimed: false }) }
    return json(200, {})
  })
  const check = (name, ok) => { checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) failures.push(`${device}: ${name}`) }
  const select = async title => { await page.locator('#inbox-list .inbox-row').filter({ hasText: title }).click(); await page.waitForFunction(t => document.querySelector('#inbox-detail .detail-title')?.textContent === t, title) }
  const refresh = async () => { const response = page.waitForResponse(r => r.url().endsWith('/notifications') && r.request().method() === 'GET'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await response; await page.waitForTimeout(100) }
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled && !document.querySelector('#inbox-open').hidden, null, { timeout: 30000 })
    await page.locator('#inbox-open').click(); await select('通知A')
    const input = page.locator('#inbox-detail textarea'), a = '日本語の返信本文です', b = '通知Bの下書き'
    await input.fill(a); await input.focus(); await input.evaluate(e => { e.setSelectionRange(2, 5); window.savedInput = e })
    items.push({ eventId: 'event-547-new', source: 'test', title: '新しい通知', body: '新着', receivedAt: new Date().toISOString(), readAt: new Date().toISOString() }); await refresh()
    check('新着更新で本文・要素・フォーカス・選択範囲を保持', await input.evaluate((e, value) => e.value === value && e === window.savedInput && document.activeElement === e && e.selectionStart === 2 && e.selectionEnd === 5, a))
    check('新着が一覧に表示', await page.locator('#inbox-list .inbox-row').filter({ hasText: '新しい通知' }).count() === 1)
    items[0].handledAt = new Date().toISOString(); await refresh()
    check('処理済み更新で本文・要素・フォーカスを保持', await input.evaluate((e, value) => e.value === value && e === window.savedInput && document.activeElement === e, a))
    check('処理済みメタ表示', (await page.locator('#inbox-detail .detail-meta').innerText()).includes('処理済み'))
    if (await input.inputValue() !== a) await input.fill(a)
    await select('通知B'); check('Bは空', await input.inputValue() === ''); await input.fill(b); await select('通知A')
    check('Aの下書き復元', await input.inputValue() === a)
    if (await input.inputValue() !== a) await input.fill(a)
    await page.getByRole('button', { name: '返信する' }).click(); await page.waitForFunction(() => document.querySelector('#inbox').hidden); await page.locator('#inbox-open').click(); await page.waitForFunction(() => document.querySelector('#inbox-detail')?.textContent.includes('返信済み'))
    check('Aだけに正しい本文を送信', calls.some(c => c.id === 'event-547-A' && c.value === a) && !calls.some(c => c.id === 'event-547-B'))
    await select('通知B'); check('Bの下書き保持', await input.inputValue() === b)
    await select('通知choice'); await page.getByRole('button', { name: '選択肢', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#inbox').hidden); await page.locator('#inbox-open').click(); await page.waitForFunction(() => document.querySelector('#inbox-detail')?.textContent.includes('返信済み'))
    check('選択肢送信', calls.some(c => c.id === 'event-547-choice' && c.kind === 'choice' && c.value === '選択肢'))
    await select('通知replied'); check('返信済み表示', (await page.locator('#inbox-detail').innerText()).includes('返信済み。受付番号: old-request'))
  } catch (e) { checks.exception = e.message; failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2)); process.exitCode = failures.length || external.length ? 1 : 0
