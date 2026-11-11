// BOXP-500 TD-02 P1: 会話中（読み上げ中）や録音開始後には接触 event を送らず、平常時（done）には 1 回送ることを BFF モックで確認
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site', p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8767)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const out = {}
async function scenario(name, run) {
  const ctx = await b.newContext({ permissions: ['microphone'] }), page = await ctx.newPage(), posts = []
  await ctx.route('**/kohako/api/v1/**', async r => {
    const q = r.request(), p = new URL(q.url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === 'me') return j(200, { user: 'verify' })
    if (p === 'conversation') return j(200, { enabled: true, stt: true })
    if (p === 'messages') { posts.push(JSON.parse(q.postData() || '{}').kind || 'chat'); return j(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: 'はい、ご主人さま。今日はたくさんお話ししましょうね。ゆっくり読み上げますから、最後まで聞いてくださいね。'.repeat(3) } })
    return j(404, {})
  })
  await page.goto('http://localhost:8767/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
  await page.evaluate(() => { const s = document.getElementById('speech'); if (s) s.checked = false })
  out[name] = await run(page)
  out[name].posts = posts
  await ctx.close()
}
const pat = page => page.evaluate(() => { const m = document.getElementById('touch-menu'); if (m.hidden) document.getElementById('touch-open').click(); document.getElementById('touch-pat').click() })
// 平常時（接続直後）: なでる → 1.2 秒後に touch が 1 回送られる（対照）
await scenario('idle', async page => { const st = await page.evaluate(() => window.__kohakoHome.state); await pat(page); await page.waitForTimeout(4000); return { stateAtTouch: st } })
// 読み上げ中（speaking）: 会話の返答を受けて speaking の間になでる → touch は送られない
await scenario('speaking', async page => {
  await page.fill('#message', 'こんにちは'); await page.evaluate(() => document.getElementById('form').requestSubmit())
  await page.waitForFunction(() => window.__kohakoHome.state === 'speaking', null, { timeout: 15000 })
  const st = await page.evaluate(() => window.__kohakoHome.state); await pat(page); await page.waitForTimeout(3000)
  return { stateAtTouch: st, stateAfter: await page.evaluate(() => window.__kohakoHome.state) }
})
// なでた直後（デバウンス中）に録音を開始 → touch は送られない
await scenario('recordAfterTouch', async page => {
  await pat(page); await page.waitForTimeout(200)
  const box = await page.locator('#record').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.waitForTimeout(3000); const st = await page.evaluate(() => window.__kohakoHome.state)
  return { stateWhileHolding: st, recordLabel: await page.locator('#record').textContent() }
})
console.log(JSON.stringify(out, null, 1))
await b.close(); srv.close()
