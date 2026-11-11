// BOXP-500 P1: ポーリング中の一時 502 で追跡が消えないこと / 404 では終了することを BFF モックで確認
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site', p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8766)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}
async function scenario(name, plan) {
  const ctx = await b.newContext(), page = await ctx.newPage(), api = []
  let gets = 0, posts = 0
  await ctx.route('**/kohako/api/v1/**', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
    api.push(q.method() + ' ' + p)
    if (p === 'me') return j(200, { user: 'verify' })
    if (p === 'conversation') return j(200, { enabled: true, stt: false })
    if (p === 'messages') { posts++; return j(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) { gets++; const [s, o] = plan(gets); return j(s, o) }
    return j(404, {})
  })
  await page.goto('http://localhost:8766/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
  await page.fill('#message', 'テスト'); await page.press('#message', 'Enter').catch(() => {}); await page.evaluate(() => document.getElementById('form').requestSubmit())
  await page.waitForTimeout(14000)
  out[name] = await page.evaluate(() => ({ state: window.__kohakoHome.state, reply: document.getElementById('reply').textContent, error: document.getElementById('error').textContent, conn: document.getElementById('connection').textContent, inflight: sessionStorage.length, history: window.__kohakoHome.history.map(h => h.who + ': ' + h.text.slice(0, 60)) }))
  out[name].posts = posts; out[name].gets = gets
  await ctx.close()
}
// 502 x3 → pending → done
await scenario('transient502', n => n <= 3 ? [502, { error: 'bad_gateway' }] : n === 4 ? [200, { status: 'pending' }] : [200, { status: 'done', reply: { text: 'はい、ご主人さま。502 のあとでも届きました。' } }])
// 404 → 終了
await scenario('gone404', n => [404, { error: 'not_found' }])
console.log(JSON.stringify(out, null, 1))
await b.close(); srv.close()
