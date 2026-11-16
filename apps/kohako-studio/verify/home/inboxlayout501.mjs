// BOXP-501: BFF を完全にモックし、多数の長い通知の配置と受信箱操作を検証する。
// SITE/kohako にビルドを置き、Playwright 1.56.1 で node inboxlayout501.mjs /out。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8797)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) })
}).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const failures = [], external = [], results = {}
const titles = [
  'BOXP-503: kohako-homeのWeb固有ツール制限を解除しTelegram同等の実ツール・承認経路を接続する',
  'BOXP-519: 完了票の古いrunの再生成可能dist/node_modulesを限定自動回収し容量効果を実測する',
  'BOXP501LongUnbrokenTitle0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  '短い通知', '定期処理の結果を確認してください',
]
const seed = () => Array.from({ length: 20 }, (_, n) => ({
  eventId: `evt-501-${String(n).padStart(6, '0')}`, source: n % 2 ? 'hermes-cron' : 'task-board-report',
  ticketId: `BOXP-${501 + n}`, title: titles[n % titles.length], body: `通知 ${n} の詳細です。`,
  receivedAt: new Date(Date.now() - (20 - n) * 60000).toISOString(),
  ...(n % 3 === 1 ? { readAt: new Date().toISOString() } : {}),
  ...(n % 3 === 2 ? { readAt: new Date().toISOString(), handledAt: new Date().toISOString() } : {}),
}))
for (const [device, viewport, mobile] of [
  ['tablet-landscape', { width: 1920, height: 1200 }, false], ['tablet-portrait', { width: 1200, height: 1920 }, false],
  ['phone-portrait', { width: 412, height: 915 }, true], ['phone-landscape', { width: 915, height: 412 }, true],
  ['pc', { width: 1440, height: 900 }, false],
]) {
  const items = seed(), calls = [], r = results[device] = { positions: {} }
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1]
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (req.method() !== 'GET') calls.push(`${req.method()} ${p}`)
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items, unread: items.filter(i => !i.readAt && !i.handledAt).length })
    const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
    if (m) { const item = items.find(i => i.eventId === decodeURIComponent(m[1])); if (item && m[2] === 'read') item.readAt ??= new Date().toISOString(); return json(200, { claimed: false, announced: true }) }
    return json(200, {})
  })
  const check = (ok, message) => { if (!ok) failures.push(`${device}: ${message}`) }
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled && !document.querySelector('#inbox-open').hidden, null, { timeout: 30000 })
    await page.locator('#inbox-open').click()
    await page.waitForFunction(() => document.querySelectorAll('#inbox-list .inbox-row').length === 20)
    await page.waitForTimeout(600)
    for (const [position, fraction] of [['start', 0], ['middle', 0.5], ['end', 1]]) {
      const metrics = await page.evaluate(async fraction => {
        const list = document.querySelector('#inbox-list')
        list.scrollTop = (list.scrollHeight - list.clientHeight) * fraction
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const rows = [...list.querySelectorAll('.inbox-row')], errors = [], epsilon = 1
        const rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > epsilon && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > epsilon
        const boxes = rows.map(rect)
        rows.forEach((row, i) => {
          const card = boxes[i], children = ['title', 'chip', 'time', 'state'].map(name => ({ name, el: row.querySelector(`.row-${name}`) }))
          for (let j = i + 1; j < rows.length; j++) if (overlap(card, boxes[j])) errors.push(`card ${i} overlaps card ${j}`)
          for (const child of children) {
            if (!child.el) { errors.push(`card ${i} missing ${child.name}`); continue }
            child.box = rect(child.el)
            const b = child.box
            if (b.left < card.left - epsilon || b.right > card.right + epsilon || b.top < card.top - epsilon || b.bottom > card.bottom + epsilon) errors.push(`card ${i} ${child.name} outside card`)
            if (b.height > card.height + epsilon) errors.push(`card ${i} ${child.name} taller than card`)
            for (let j = 0; j < rows.length; j++) if (j !== i && overlap(b, boxes[j])) errors.push(`card ${i} ${child.name} overlaps card ${j}`)
            if (child.name === 'title' && (child.el.scrollHeight > child.el.clientHeight + 1 || child.el.scrollWidth > child.el.clientWidth + 1)) errors.push(`card ${i} title clipped`)
          }
          for (let a = 0; a < children.length; a++) for (let b = a + 1; b < children.length; b++) if (children[a].box && children[b].box && overlap(children[a].box, children[b].box)) errors.push(`card ${i} ${children[a].name} overlaps ${children[b].name}`)
          const present = children.filter(c => c.box)
          if (present.length && Math.max(...present.map(c => c.box.bottom)) - Math.min(...present.map(c => c.box.top)) > card.height + epsilon) errors.push(`card ${i} content height exceeds card`)
        })
        return { count: rows.length, scrollTop: list.scrollTop, scrollMax: list.scrollHeight - list.clientHeight, errors }
      }, fraction)
      r.positions[position] = metrics
      check(metrics.count === 20, `${position}: expected 20 cards, got ${metrics.count}`)
      check(metrics.scrollMax > 0, `${position}: list does not scroll`)
      for (const error of metrics.errors) failures.push(`${device} ${position}: ${error}`)
      await page.screenshot({ path: path.join(out, `${device}-${position}.png`) })
    }
    await page.locator('#inbox-list .inbox-row').first().click()
    await page.waitForFunction(title => document.querySelector('#inbox-detail .detail-title')?.textContent === title, items[0].title)
    check(await page.locator('#inbox-list .inbox-row').first().getAttribute('aria-current') === 'true', 'selection missing')
    check(calls.includes(`POST notifications/${items[0].eventId}/read`), 'read request missing')
    await page.waitForFunction(() => document.querySelector('#inbox-list .inbox-row')?.dataset.state === 'read')
    await page.locator('#inbox-close').click()
    check(await page.evaluate(() => !document.querySelector('#inbox').checkVisibility()), 'close failed')
    r.calls = calls
  } catch (e) { failures.push(`${device}: ${e.message}`); await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ failures, external: external.length }, null, 2))
await browser.close(); server.close(); process.exit(failures.length || external.length ? 1 : 0)
