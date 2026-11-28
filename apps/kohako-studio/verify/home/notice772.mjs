// BOXP-772: 通知からのジャンプが一度だけ行われることを実ブラウザで検証する（BFF は完全にモック）。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8812)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const base = `http://localhost:${port}/kohako/home.html`
for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const items = ['A', 'B'].map((id, n) => ({ eventId: `event-772-${id}`, source: 'task-board-report', title: `通知${id}`, body: `本文${id}`, receivedAt: new Date(Date.now() - (3 - n) * 60000).toISOString() }))
  const reads = [], replies = [], checks = results[device] = {}
  let failList = 0, failAnnounce = 0, fail500 = null, failListAfterRead = false
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await page.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') { if (failList > 0) { failList--; return json(500, { error: 'boom' }) } return json(200, { items, unread: 0 }) }
    const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
    if (m) {
      const id = decodeURIComponent(m[1]), item = items.find(i => i.eventId === id)
      if (fail500 === m[2]) { fail500 = null; return json(500, { error: 'internal' }) }
      if (m[2] === 'announced' && failAnnounce > 0) { failAnnounce--; return route.abort('internetdisconnected') }
      if (m[2] === 'read') { reads.push(id); item.readAt = new Date().toISOString(); if (failListAfterRead) { failListAfterRead = false; failList = 1 } }
      if (m[2] === 'reply') { const body = req.postDataJSON(); replies.push({ id, ...body }); item.reply = { ...body, requestId: 'request-772', status: 'submitted' }; return json(200, item.reply) }
      return json(200, { claimed: false })
    }
    return json(200, {})
  })
  const check = (name, ok) => { checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) failures.push(`${device}: ${name}`) }
  const count = id => reads.filter(r => r === id).length
  const ready = () => page.waitForFunction(() => !document.querySelector('#send').disabled && !document.querySelector('#inbox-open').hidden, null, { timeout: 30000 })
  const detailTitle = () => page.evaluate(() => document.querySelector('#inbox-detail .detail-title')?.textContent ?? null)
  const inboxHidden = () => page.evaluate(() => document.querySelector('#inbox').hidden)
  const resume = async () => { const response = page.waitForResponse(r => r.url().endsWith('/notifications') && r.request().method() === 'GET'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await response; await page.waitForTimeout(300) }
  const select = async title => { await page.locator('#inbox-list .inbox-row').filter({ hasText: title }).click(); await page.waitForFunction(t => document.querySelector('#inbox-detail .detail-title')?.textContent === t, title) }
  try {
    // 1. 通知 A を押して新しく開いた
    await page.goto(`${base}?acting=0&notification=event-772-A&face=static&daypart=day#top`)
    const lengthAtLoad = await page.evaluate(() => history.length)
    await ready()
    await page.waitForFunction(() => document.querySelector('#inbox-detail .detail-title')?.textContent === '通知A', null, { timeout: 10000 })
    await page.waitForTimeout(300)
    const url1 = new URL(page.url())
    check('初回: 通知Aを開く', !(await inboxHidden()) && count('event-772-A') === 1)
    check('初回: notification だけ外れ他のパラメータと # は残る', url1.search === '?acting=0&face=static&daypart=day' && url1.hash === '#top')
    check('初回: 履歴を増やさない', (await page.evaluate(() => history.length)) === lengthAtLoad)
    // 2. 受信箱を閉じて別アプリへ行き戻る（同じタブの再利用）
    await page.locator('#inbox-close').click()
    await resume(); await resume()
    check('表示復帰: 勝手に再表示しない', (await inboxHidden()) && count('event-772-A') === 1)
    // 3. 再読み込み（PWA の再起動も同じ URL から始まる）
    await page.reload(); await ready(); await page.waitForTimeout(800)
    check('再読み込み: 勝手に再表示しない', (await inboxHidden()) && count('event-772-A') === 1)
    // 4. 受信箱から明示的に開け、返信先が変わらない
    await page.locator('#inbox-open').click(); await select('通知A'); await select('通知B')
    check('明示: 受信箱から A・B を開ける', count('event-772-A') === 2 && count('event-772-B') === 1)
    const input = page.locator('#inbox-detail textarea'); await input.fill('Bへの返信')
    await page.getByRole('button', { name: '返信する' }).click()
    await page.waitForFunction(() => document.querySelector('#inbox').hidden, null, { timeout: 10000 })
    check('返信: 開いている通知Bに紐づく', replies.length === 1 && replies[0].id === 'event-772-B' && replies[0].value === 'Bへの返信')
    // 5. 開いたままの家で通知 B を押した（SW からの open-notification）
    const swAvailable = await page.evaluate(() => !!navigator.serviceWorker)
    if (swAvailable) {
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-notification', eventId: 'event-772-A' } })))
      await page.waitForFunction(() => !document.querySelector('#inbox').hidden && document.querySelector('#inbox-detail .detail-title')?.textContent === '通知A', null, { timeout: 10000 })
      check('開いたまま: SW の通知で A を開き URL は変えない', new URL(page.url()).search === '?acting=0&face=static&daypart=day')
      await page.locator('#inbox-close').click(); await resume()
      check('開いたまま: その後の表示復帰で再表示しない', await inboxHidden())
    } else checks['開いたまま（SW 経路）'] = 'SKIP: navigator.serviceWorker なし'
    // 6. 一覧取得が一度失敗した場合は、次に取れた時に一度だけ開く
    const before = count('event-772-B')
    failList = 1
    await page.goto(`${base}?notification=event-772-B&acting=0`); await page.waitForTimeout(1500)
    check('取得失敗: まだ開かず URL も残す', count('event-772-B') === before && new URL(page.url()).searchParams.get('notification') === 'event-772-B')
    await resume(); await page.waitForFunction(() => document.querySelector('#inbox-detail .detail-title')?.textContent === '通知B' && !location.search.includes('notification'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300)
    check('取得失敗後: 次の取得で B を 1 度開き URL から外す', count('event-772-B') === before + 1 && (await detailTitle()) === '通知B' && new URL(page.url()).search === '?acting=0')
    await page.locator('#inbox-close').click(); await resume()
    check('取得失敗後: 以降は再表示しない', (await inboxHidden()) && count('event-772-B') === before + 1)
    // 7. 一覧は取れたが、開く途中（案内済みの送信）が通信失敗した場合は、消費せず次に取れた時に開く
    const beforeA = count('event-772-A')
    failAnnounce = 1
    await page.goto(`${base}?notification=event-772-A&acting=0`); await page.waitForTimeout(1500)
    check('開く途中の失敗: まだ開かず URL も残す', failAnnounce === 0 && count('event-772-A') === beforeA && new URL(page.url()).searchParams.get('notification') === 'event-772-A')
    await resume(); await page.waitForFunction(() => document.querySelector('#inbox-detail .detail-title')?.textContent === '通知A' && !location.search.includes('notification'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300)
    check('開く途中の失敗後: 次の取得で A を 1 度開き URL から外す', count('event-772-A') === beforeA + 1 && (await detailTitle()) === '通知A' && new URL(page.url()).search === '?acting=0')
    await page.locator('#inbox-close').click(); await resume()
    check('開く途中の失敗後: 以降は再表示しない', (await inboxHidden()) && count('event-772-A') === beforeA + 1)
    // 8. 案内済み・既読の送信が JSON 付きの HTTP 500 を返した場合も、受信箱を開かず消費せず、次に取れた時に開く
    for (const kind of ['announced', 'read']) {
      const beforeB = count('event-772-B')
      fail500 = kind
      await page.goto(`${base}?notification=event-772-B&acting=0`); await page.waitForTimeout(1500)
      check(`${kind} が 500: 受信箱を開かず URL も残す`, fail500 === null && (await inboxHidden()) && count('event-772-B') === beforeB && new URL(page.url()).searchParams.get('notification') === 'event-772-B')
      await resume(); await page.waitForFunction(() => document.querySelector('#inbox-detail .detail-title')?.textContent === '通知B' && !location.search.includes('notification'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300)
      check(`${kind} が 500 の後: 次の取得で B を開き URL から外す`, count('event-772-B') === beforeB + 1 && !(await inboxHidden()) && new URL(page.url()).search === '?acting=0')
      await page.locator('#inbox-close').click(); await resume()
      check(`${kind} が 500 の後: 以降は再表示しない`, (await inboxHidden()) && count('event-772-B') === beforeB + 1)
    }
    // 9. 開いたままの家への SW 通知でも、開く途中（案内済み・既読・既読後の一覧再取得）の失敗では受信箱を開かず保留し、次の取得で開く
    if (swAvailable) {
      for (const kind of ['announced', 'read', 'refetch']) {
        // 直前に通知 A を選んだ状態で閉じておく（再取得失敗時に A の詳細のまま開かないことも見る）
        await page.goto(`${base}?acting=0`); await ready(); await page.locator('#inbox-open').click(); await select('通知A'); await page.locator('#inbox-close').click()
        const beforeB = count('event-772-B')
        if (kind === 'refetch') failListAfterRead = true; else fail500 = kind
        await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-notification', eventId: 'event-772-B' } })))
        await page.waitForTimeout(1500)
        check(`SW ${kind} 失敗: 受信箱を開かない`, fail500 === null && failList === 0 && !failListAfterRead && (await inboxHidden()))
        await resume(); await page.waitForFunction(() => !document.querySelector('#inbox').hidden && document.querySelector('#inbox-detail .detail-title')?.textContent === '通知B', null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300)
        check(`SW ${kind} 失敗後: 次の取得で B を開く`, !(await inboxHidden()) && (await detailTitle()) === '通知B' && count('event-772-B') >= beforeB + 1 && new URL(page.url()).search === '?acting=0')
        const afterB = count('event-772-B')
        await page.locator('#inbox-close').click(); await resume()
        check(`SW ${kind} 失敗後: 以降は再表示しない`, (await inboxHidden()) && count('event-772-B') === afterB)
      }
    }
    await page.screenshot({ path: path.join(out, `${device}-final.png`) })
  } catch (e) { checks.exception = e.message; failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2)); process.exitCode = failures.length || external.length ? 1 : 0
