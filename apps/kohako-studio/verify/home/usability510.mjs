// BOXP-510: BFF を完全にモックし、Shift+Enter 送信・Enter 改行、受信箱/履歴の昇順、本文表示中の利用枠表示の非表示、
// Markdown の安全な描画、背景の動き（reduced-motion・設定 OFF で静止）を PC / Pixel 7 相当で確かめる。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、`node usability510.mjs /out`。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8772)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const assert = (v, m) => { if (!v) throw new Error(m) }
const wait = async (fn, m, t = 12000) => { const end = Date.now() + t; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)) } throw new Error(m) }
const REPLY = '# 見出し\n\n**太字**と`code`です。\n\n- 一つ目\n- 二つ目\n\n<script>window.__xss=1</script>\n\n[危険](javascript:window.__xss=2) [安全](https://example.com/a)\n\n![外部画像](https://example.com/track.png)\n\n```\nconst a = 1\n```'
const items = [
  { eventId: 'evt-new-000003', source: 'task-board-report', title: '新しい', body: '**最新**の通知', receivedAt: '2026-11-12T03:00:00Z' },
  { eventId: 'evt-old-000001', source: 'task-board-report', title: '古い', body: '- 項目A\n- 項目B', receivedAt: '2026-11-12T01:00:00Z' },
  { eventId: 'evt-mid-000002', source: 'task-board-report', title: '中間', body: '普通', receivedAt: '2026-11-12T02:00:00Z' },
]
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['mobile', { width: 412, height: 915 }, true]]) {
  const r = results[device] = {}
  for (const reduce of [false, true]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference' }), page = await ctx.newPage(), posts = []
    page.on('request', q => { const u = new URL(q.url()); if (u.hostname !== 'localhost') external.push(q.url()) })
    await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
    await ctx.route('**/kohako/api/v1/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
      if (p === 'me') return json(200, { authenticated: true })
      if (p === 'conversation') return json(200, { enabled: true, stt: false })
      if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [{ id: 'claude_shared', label: 'Claude', windows: [{ name: 'five_hour', label: '5時間', state: 'ok', usedPercent: 40, resetsAt: null, observedAt: null, status: null }] }] }, tasks: { state: 'ok', inProgress: { total: 2, complete: true, byAgent: [], conflicts: [] } } })
      if (p === 'notifications') return json(200, { items, unread: 3 })
      if (p === 'messages') { posts.push(req.postDataJSON()); return json(202, { status: 'accepted' }) }
      if (/^requests\//.test(p)) return json(200, { status: 'done', reply: { text: REPLY } })
      return json(200, {})
    })
    try {
      await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static`)
      await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
      // 背景の動き
      const petal = () => page.evaluate(() => getComputedStyle(document.querySelector('.p1')).translate)
      const a = await petal(); await page.waitForTimeout(1500); const b = await petal()
      if (reduce) { assert(a === b, `reduced motion moved ${a} ${b}`); r.reduceStill = { a, b }; await ctx.close(); continue }
      assert(a !== b, `background not moving ${a} ${b}`); await page.screenshot({ path: `${out}/${device}-bg-1.png` }); await page.waitForTimeout(3000); await page.screenshot({ path: `${out}/${device}-bg-2.png` })
      await page.evaluate(() => { const box = document.getElementById('pref-bg'); box.click() }); await page.waitForTimeout(300); const c = await petal(); await page.waitForTimeout(1200); const d = await petal()
      assert(c === d && await page.evaluate(() => document.body.classList.contains('bg-still')), `bg off still moving ${c} ${d}`)
      await page.evaluate(() => document.getElementById('pref-bg').click()); r.background = { moving: [a, b], off: [c, d] }
      // 入力
      const m = page.locator('#message'); await m.click(); await m.type('一行目'); await m.press('Enter'); await m.type('二行目')
      assert(posts.length === 0 && (await m.inputValue()) === '一行目\n二行目', `enter sent or no newline: ${posts.length} ${JSON.stringify(await m.inputValue())}`)
      await m.press('Shift+Enter'); await wait(() => posts.length === 1, 'shift+enter did not send'); assert(posts[0].text === '一行目\n二行目', 'sent text'); r.input = { sent: posts[0].text }
      // Markdown と状態表示
      await wait(() => page.evaluate(() => !!document.querySelector('#reply h3')), 'markdown heading not rendered', 20000)
      const md = await page.evaluate(() => ({ h: document.querySelector('#reply h3')?.textContent, strong: document.querySelector('#reply strong')?.textContent, li: document.querySelectorAll('#reply li').length, pre: document.querySelector('#reply pre')?.textContent, scripts: document.querySelectorAll('#reply script').length, imgs: document.querySelectorAll('#reply img').length, links: [...document.querySelectorAll('#reply a')].map(a => a.href), xss: window.__xss ?? null, literal: document.querySelector('#reply').textContent.includes('<script>'), message: document.body.dataset.message, widget: getComputedStyle(document.getElementById('status-widget')).display }))
      assert(md.h === '見出し' && md.strong === '太字' && md.li === 2 && md.pre === 'const a = 1' && md.scripts === 0 && md.imgs === 0 && md.xss === null && md.literal, `markdown ${JSON.stringify(md)}`)
      assert(md.links.every(h => h.startsWith('https://example.com/')) && md.links.length === 2, `links ${md.links}`)
      assert(md.message === '1' && md.widget === 'none', `status widget visible while message shown ${JSON.stringify(md)}`)
      r.markdown = md; await page.screenshot({ path: `${out}/${device}-markdown.png` })
      // 履歴は昇順で最下部
      await page.locator('#history-open').click(); await page.waitForTimeout(300)
      const hist = await page.evaluate(() => { const h = document.getElementById('history'); return { rows: [...document.querySelectorAll('#history-list li')].map(li => li.textContent.slice(0, 20)), bottom: h.scrollHeight - h.scrollTop - h.clientHeight } })
      const you = hist.rows.findIndex(t => t.startsWith('あなた')), kohako = hist.rows.findIndex(t => t.startsWith('コハコ'))
      assert(you >= 0 && kohako > you && hist.bottom <= 8, `history ${JSON.stringify(hist)}`); r.history = hist
      await page.screenshot({ path: `${out}/${device}-history.png` }); await page.locator('#history-close').click()
      // 受信箱は昇順
      await page.locator('#inbox-open').click(); await page.waitForFunction(() => document.querySelectorAll('#inbox-list button').length === 3)
      const order = await page.evaluate(() => [...document.querySelectorAll('#inbox-list button')].map(b => b.textContent.split('｜')[0]))
      assert(JSON.stringify(order) === JSON.stringify(['古い', '中間', '新しい']), `inbox order ${order}`)
      await page.locator('#inbox-list button').first().click(); await page.waitForFunction(() => document.querySelectorAll('#inbox-detail .md li').length === 2)
      r.inbox = { order }; await page.screenshot({ path: `${out}/${device}-inbox.png` })
    } catch (e) { failures.push(`${device}${reduce ? ' reduce' : ''}: ${e.message}`); await page.screenshot({ path: `${out}/${device}-failure.png` }).catch(() => {}) }
    await ctx.close()
  }
}
assert(true); results.externalRequests = external
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2)); console.log(JSON.stringify({ failures, external: external.length }))
await browser.close(); server.close(); process.exit(failures.length || external.length ? 1 : 0)
