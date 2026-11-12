// BOXP-512 TD-01: ヘッダーと、ヘッダーから開くメニュー（読み上げ・ふれあい・受信箱・履歴・設定・Studio リンク）を
// BFF の完全なモックで PC / Pixel 7 相当縦 / スマホ横 について開閉・操作・主要状態・画面内への収まりを確かめ、各状態の画像を残す。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、`node menus512.mjs /out`。EMPTY=1 で通知 0 件の状態を撮る。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8796)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const REPLY = '今日の予定は **3件** です。\n\n- 10:00 定例\n- 14:00 レビュー\n\n無理のない範囲で進めましょうね。'
const now = Date.now(), iso = m => new Date(now - m * 60000).toISOString()
const seed = () => [
  { eventId: 'evt-old-000001-aaaa', source: 'task-board-report', ticketId: 'BOXP-498', title: '確認依頼', body: 'デプロイ前に確認してください。\n\n- 項目A\n- 項目B', receivedAt: iso(190), readAt: iso(100), handledAt: iso(90) },
  { eventId: 'evt-mid-000002-bbbb', source: 'task-board-report', ticketId: 'BOXP-506', title: '配備しました', body: '**配備完了**。PC とスマホで確認済みです。', receivedAt: iso(75), readAt: iso(30) },
  { eventId: 'evt-new-000003-cccc', source: 'task-board-report', ticketId: 'BOXP-512', title: '相談があります', body: 'どちらにしますか？', choices: ['このまま進める', '昼だけにする'], receivedAt: iso(4) },
]
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true], ['landscape', { width: 915, height: 412 }, true]]) {
  const r = results[device] = {}, items = process.env.EMPTY ? [] : seed(), calls = []
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage()
  page.on('request', q => { if (new URL(q.url()).hostname !== 'localhost') external.push(q.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (req.method() !== 'GET') calls.push(`${req.method()} ${p}`)
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items, unread: items.filter(i => !i.readAt && !i.handledAt).length })
    const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
    if (m) { const i = items.find(x => x.eventId === decodeURIComponent(m[1])); if (i && m[2] === 'read') i.readAt ??= new Date().toISOString(); if (i && m[2] === 'handled') i.handledAt = new Date().toISOString(); if (m[2] === 'reply') return json(200, { status: 'submitted', requestId: 'req-reply-0001' }); return json(200, { claimed: false, announced: true }) }
    if (p === 'messages') return json(202, { status: 'accepted' })
    if (/^requests\//.test(p)) return json(200, { status: 'done', reply: { text: REPLY } })
    return json(200, {})
  })
  const check = (v, m) => { if (!v) failures.push(`${device}: ${m}`) }
  const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${device}-${name}.png` }) }
  const shown = id => page.evaluate(i => document.getElementById(i).checkVisibility(), id)
  // 面が画面内に収まり、横にはみ出さないこと
  const fits = async id => { await page.waitForTimeout(400); return page.evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 && document.scrollingElement.scrollWidth <= innerWidth + 1 }, id) } // 開く動き（0.26 秒）が終わってから測る
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.waitForTimeout(1500)
    // ヘッダー: 表示中の項目は画面内・押せる大きさ・名前が読める
    r.header = await page.evaluate(() => [...document.querySelectorAll('.top .nav-item')].filter(e => e.checkVisibility()).map(e => { const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), w: Math.round(b.width), h: Math.round(b.height), inside: b.left >= 0 && b.right <= innerWidth + 1 } }))
    check(r.header.length >= 4 && r.header.every(i => i.inside && i.h >= 34 && i.w >= 34 && i.text), `header items ${JSON.stringify(r.header)}`)
    r.headerHeight = await page.evaluate(() => Math.round(document.querySelector('.top').getBoundingClientRect().height)); check(r.headerHeight <= (device === 'pixel7' ? 110 : 64), `header height ${r.headerHeight}`)
    await shot('header')
    // 読み上げ: 見た目を変えても checkbox として切り替わる
    await page.locator('label.toggle').click(); check(await page.evaluate(() => document.getElementById('speech').checked), 'speech toggle on'); await page.locator('label.toggle').click(); check(!await page.evaluate(() => document.getElementById('speech').checked), 'speech toggle off')
    // ふれあい: 開く→ aria-expanded → Esc で閉じる、項目を押すと反応の吹き出し
    await page.locator('#touch-open').click(); check(await shown('touch-menu') && await fits('touch-menu') && await page.getAttribute('#touch-open', 'aria-expanded') === 'true', 'touch menu open'); await shot('touch')
    await page.keyboard.press('Escape'); check(!await shown('touch-menu') && await page.getAttribute('#touch-open', 'aria-expanded') === 'false', 'touch menu esc')
    await page.locator('#touch-open').click(); await page.locator('#touch-pat').click(); await page.waitForTimeout(600); r.touchLive = await page.evaluate(() => document.getElementById('touch-live').textContent); await page.keyboard.press('Escape')
    // 設定: 開閉・焦点・スイッチの保存・Esc
    await page.locator('#settings-open').click(); check(await shown('settings') && await fits('settings'), 'settings open/fits'); check(await page.evaluate(() => document.activeElement?.id) === 'settings-close', 'settings focus on close'); await shot('settings')
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('kohako-home-prefs')))
    await page.locator('#pref-pinned').click(); await page.locator('#pref-subtle').click(); await page.locator('#pref-bg').click()
    const after = await page.evaluate(() => ({ prefs: JSON.parse(localStorage.getItem('kohako-home-prefs')), still: document.body.classList.contains('bg-still') }))
    check(after.prefs.pinned === !before.pinned && after.prefs.intensity === 'subtle' && after.prefs.bgMotion === false && after.still, `settings switches ${JSON.stringify(after)}`)
    await page.locator('#pref-pinned').click(); await page.locator('#pref-subtle').click(); await page.locator('#pref-bg').click()
    await page.focus('#pref-reduce'); await page.keyboard.press('Space'); check(await page.evaluate(() => document.body.classList.contains('reduce')), 'switch by keyboard'); await page.keyboard.press('Space'); r.settings = after
    await page.evaluate(() => { const d = document.getElementById('settings'); d.scrollTop = d.scrollHeight }); await shot('settings-bottom')
    await page.locator('#settings-close').click(); check(!await shown('settings') && await page.evaluate(() => document.activeElement?.id) === 'settings-open', 'settings close returns focus')
    await page.locator('#settings-open').click(); await page.keyboard.press('Escape'); check(!await shown('settings'), 'settings esc')
    // 履歴: 空→会話後は あなた/コハコ の順、最下部、Markdown の箇条書きが残る
    await page.locator('#history-open').click(); check(await shown('history') && await fits('history'), 'history open/fits'); await shot('history-empty'); await page.locator('#history-close').click()
    const m = page.locator('#message'); await m.click(); await m.type('今日の予定は？'); await m.press('Shift+Enter')
    await page.waitForFunction(() => !!document.querySelector('#reply li'), null, { timeout: 20000 }); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(800)
    await page.locator('#history-open').click(); await page.waitForTimeout(300)
    r.history = await page.evaluate(() => { const h = document.getElementById('history'), rows = [...document.querySelectorAll('#history-list>li')]; return { who: rows.map(li => li.dataset.who), starts: rows.map(li => li.textContent.slice(0, 4)), bullets: document.querySelectorAll('#history-list>li .md li').length, bulletStyle: getComputedStyle(document.querySelector('#history-list>li .md li')).display, bottom: h.scrollHeight - h.scrollTop - h.clientHeight, mineRight: rows[0].getBoundingClientRect().right > rows[1].getBoundingClientRect().right } })
    check(r.history.who.join() === 'あなた,コハコ' && r.history.starts[0].startsWith('あなた') && r.history.bullets === 2 && r.history.bulletStyle === 'list-item' && r.history.bottom <= 8 && r.history.mineRight, `history ${JSON.stringify(r.history)}`)
    await shot('history'); await page.locator('#history-close').click()
    // 受信箱
    await page.waitForFunction(() => !document.getElementById('inbox-open').hidden, null, { timeout: 10000 })
    r.badge = await page.evaluate(() => ({ text: document.getElementById('inbox-badge').textContent, label: document.getElementById('inbox-open').getAttribute('aria-label') }))
    await page.locator('#inbox-open').click(); await page.waitForTimeout(600); check(await shown('inbox') && await fits('inbox'), 'inbox open/fits'); await shot('inbox')
    if (process.env.EMPTY) { check(r.badge.text === '' && await page.locator('#inbox-list .empty').count() === 1, `inbox empty ${JSON.stringify(r.badge)}`) }
    else {
      check(r.badge.text === '1' && r.badge.label.includes('未読 1 件'), `badge ${JSON.stringify(r.badge)}`)
      r.rows = await page.evaluate(() => [...document.querySelectorAll('#inbox-list button')].map(b => ({ title: b.textContent.split('｜')[0], state: b.dataset.state, text: b.textContent })))
      check(r.rows.map(x => x.title).join() === '確認依頼,配備しました,相談があります' && r.rows.map(x => x.state).join() === 'handled,read,unread' && r.rows[2].text.includes('未読') && r.rows[2].text.includes('BOXP-512'), `inbox rows ${JSON.stringify(r.rows)}`)
      await page.locator('#inbox-list button').nth(2).click(); await page.waitForFunction(() => document.querySelector('#inbox-detail .detail-title')?.textContent === '相談があります')
      check(await page.getAttribute('#inbox-list button:nth-of-type(3)', 'aria-current') === 'true' && calls.includes('POST notifications/evt-new-000003-cccc/read'), 'inbox select marks read'); await shot('inbox-choice')
      await page.locator('#inbox-detail button', { hasText: 'このまま進める' }).click(); await page.waitForFunction(() => document.getElementById('inbox').hidden || /受付/.test(document.getElementById('inbox-detail').textContent), null, { timeout: 8000 })
      check(calls.includes('POST notifications/evt-new-000003-cccc/reply'), 'choice reply posted'); if (!await shown('inbox')) await page.locator('#inbox-open').click()
      await page.locator('#inbox-list button').nth(1).click(); await page.waitForFunction(() => !!document.querySelector('#inbox-detail textarea')); await page.evaluate(() => { const d = document.getElementById('inbox'); d.scrollTop = d.scrollHeight }); await shot('inbox-text')
      await page.locator('#inbox-detail button', { hasText: '処理済みにする' }).click(); await page.waitForFunction(() => document.querySelector('#inbox-list button:nth-of-type(2)')?.dataset.state === 'handled', null, { timeout: 8000 }); check(calls.includes('POST notifications/evt-mid-000002-bbbb/handled'), 'handled posted')
    }
    r.push = await page.evaluate(() => [...document.querySelectorAll('#push-on,#push-off')].map(b => b.checkVisibility() && b.getBoundingClientRect().height >= 40)); check(r.push.every(Boolean), 'push buttons visible')
    await page.locator('#inbox-close').click(); check(!await shown('inbox'), 'inbox close')
    r.studioLink = await page.evaluate(() => { const a = document.querySelector('.top a.link'); return { href: a.getAttribute('href'), visible: a.checkVisibility() } }); check(r.studioLink.href === 'studio.html' && r.studioLink.visible === (device === 'pc'), `studio link ${JSON.stringify(r.studioLink)}`)
    r.calls = calls
  } catch (e) { failures.push(`${device}: ${e.message}`); await page.screenshot({ path: `${out}/${device}-failure.png` }).catch(() => {}) }
  await ctx.close()
}
results.externalRequests = external
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2)); console.log(JSON.stringify({ failures, external: external.length }))
await browser.close(); server.close(); process.exit(failures.length || external.length ? 1 : 0)
