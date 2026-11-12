// BOXP-517: 家の添付（画像/PDF/テキスト）を BFF の完全なモックで PC / Pixel 7 相当について確かめる。
// 選択→チップ表示→取消→未対応/超過の明示→添付付き送信（messages に attachments が載る）→履歴の 📎 表示、
// 入力欄・送信・停止が画面内に残ることを検査し、各状態の画像を残す。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、Playwright 1.56.1 で `node attach517.mjs /out`。失敗時は終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8797)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
const files = { img: { name: 'synthetic-517.png', mimeType: 'image/png', buffer: png }, pdf: { name: 'note.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') }, txt: { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('ID-517') }, exe: { name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }, big: { name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x61) } }
const results = {}, failures = []
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const r = results[device] = {}, posts = []
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage()
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  let n = 0
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: null })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'attachments') { const name = decodeURIComponent(req.headers()['x-kohako-filename'] || ''); if (name.endsWith('.pdf')) return json(422, { error: 'pdf_no_text' }); return json(201, { attachmentId: (++n).toString(16).padStart(32, 'a'), kind: 'text', name, size: 6, truncated: false }) }
    if (p === 'messages') { posts.push(JSON.parse(req.postData())); return json(202, { requestId: posts.at(-1).requestId, status: 'pending' }) }
    if (/^requests\//.test(p)) return json(200, { status: 'done', reply: { text: '添付を確認しました。' } })
    return json(200, {})
  })
  const check = (v, m) => { if (!v) failures.push(`${device}: ${m}`) }
  const shot = async name => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${device}-${name}.png` }) }
  const inside = id => page.evaluate(i => { const e = document.getElementById(i); if (!e || !e.checkVisibility()) return false; const b = e.getBoundingClientRect(); return b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 }, id)
  const error = () => page.evaluate(() => document.getElementById('error')?.textContent || '')
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    check(await inside('attach'), 'attach button visible in viewport')
    // 未対応・超過は明示しチップを作らない
    await page.setInputFiles('#attachment-file', [files.exe]); await page.waitForTimeout(300); r.unsupported = await error(); check(/未対応/.test(r.unsupported), `unsupported msg ${r.unsupported}`)
    await page.setInputFiles('#attachment-file', [files.big]); await page.waitForTimeout(300); r.oversize = await error(); check(/サイズ超過/.test(r.oversize), `oversize msg ${r.oversize}`)
    check(await page.locator('#attachment-chips > span').count() === 0, 'no chips for rejected files')
    // サーバ側で失敗（PDF 本文なし）は失敗チップ＋理由
    await page.setInputFiles('#attachment-file', [files.pdf]); await page.waitForTimeout(500); r.pdfError = await error(); check(/PDF/.test(r.pdfError), `pdf error ${r.pdfError}`)
    r.pdfChip = await page.locator('#attachment-chips').textContent(); check(/失敗/.test(r.pdfChip), 'pdf chip failed state'); await shot('failed-chip')
    await page.locator('#attachment-chips button').first().click(); check(await page.locator('#attachment-chips > span').count() === 0, 'cancel removes chip')
    // 画像とテキストを選び、1 件取り消してから送る
    await page.setInputFiles('#attachment-file', [files.img, files.txt]); await page.waitForTimeout(600)
    check(await page.locator('#attachment-chips > span').count() === 2, 'two chips'); await shot('chips')
    for (const id of ['message', 'send']) check(await inside(id), `${id} inside with chips`)
    await page.locator('#attachment-chips button').nth(1).click(); check(await page.locator('#attachment-chips > span').count() === 1, 'cancel one chip')
    await page.fill('#message', 'この画像を見て'); await page.click('#send'); await page.waitForTimeout(1500)
    r.posts = posts; check(posts.length === 1 && posts[0].attachments?.length === 1 && posts[0].text === 'この画像を見て', `message payload ${JSON.stringify(posts)}`)
    check(await page.locator('#attachment-chips > span').count() === 0, 'chips cleared after accept')
    r.history = await page.evaluate(() => document.getElementById('history-list').textContent); check(r.history.includes('📎 synthetic-517.png'), `history ${r.history}`)
    await shot('sent')
  } catch (e) { failures.push(`${device}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ failures }, null, 2)); process.exit(failures.length ? 1 : 0)
