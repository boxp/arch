// BOXP-500 P1: ポーリング中の一時 502 や再読込後の初回照会の通信例外で追跡が消えないこと / 404 では終了することを BFF モックで確認
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site', p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8766)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}
async function scenario(name, plan, reload = null) {
  const ctx = await b.newContext(), page = await ctx.newPage(), api = []
  let gets = 0, posts = 0
  await ctx.route('**/kohako/api/v1/**', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
    api.push(q.method() + ' ' + p)
    if (p === 'me') return j(200, { user: 'verify' })
    if (p === 'conversation') return j(200, { enabled: true, stt: false })
    if (p === 'messages') { posts++; if (reload?.postHang && posts === 1) { await new Promise(res => setTimeout(res, 20000)); return j(202, { status: 'accepted' }).catch(() => {}) } return j(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) { gets++; const [s, o, wait] = plan(gets, reload); if (wait) await new Promise(res => setTimeout(res, wait)); if (s === 0) return r.abort('connectionreset'); return j(s, o) }
    return j(404, {})
  })
  await page.goto('http://localhost:8766/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
  await page.fill('#message', 'テスト'); await page.press('#message', 'Enter').catch(() => {}); await page.evaluate(() => document.getElementById('form').requestSubmit())
  if (reload) { await page.waitForTimeout(reload.postHang ? 1000 : 2500); gets = 0; reload.active = true; await page.reload(); await page.waitForFunction(() => /^(接続中|未認証)/.test(document.getElementById('connection').textContent), null, { timeout: 30000 })
    if (reload.submitAfterReload) { await page.waitForTimeout(2000); await page.fill('#message', '認証切れ中の送信'); out[name + ':sendDisabledAfter'] = await page.evaluate(() => document.getElementById('send').disabled); await page.evaluate(() => document.getElementById('form').requestSubmit()) }
    if (reload.submitDuringLookup) { await page.fill('#message', '割り込み'); out[name + ':sendDisabledDuringLookup'] = await page.evaluate(() => document.getElementById('send').disabled); await page.evaluate(() => document.getElementById('form').requestSubmit()) } }
  await page.waitForTimeout(14000)
  out[name] = await page.evaluate(() => ({ state: window.__kohakoHome.state, reply: document.getElementById('reply').textContent, error: document.getElementById('error').textContent, conn: document.getElementById('connection').textContent, inflight: sessionStorage.length, history: window.__kohakoHome.history.map(h => h.who + ': ' + h.text.slice(0, 60)) }))
  out[name].posts = posts; out[name].gets = gets
  await ctx.close()
}
// 502 x3 → pending → done
await scenario('transient502', n => n <= 3 ? [502, { error: 'bad_gateway' }] : n === 4 ? [200, { status: 'pending' }] : [200, { status: 'done', reply: { text: 'はい、ご主人さま。502 のあとでも届きました。' } }])
// 送信受理後に再読込し、再開時の初回照会が通信例外 → pending → done（P1: 送信可能に戻らず結果を受け取る）
await scenario('reloadAbort', (n, rl) => !rl.active ? [200, { status: 'pending' }] : n === 1 ? [0] : n === 2 ? [200, { status: 'pending' }] : [200, { status: 'done', reply: { text: '再読込のあとでも届きました、ご主人さま。' } }], { active: false })
// 再読込後の初回照会が遅い間に新規送信を試みる → 送信できず（POST 1 回のまま）、元の依頼の結果を受け取る（P1: requestId の上書き防止）
await scenario('reloadSlowLookup', (n, rl) => !rl.active ? [200, { status: 'pending' }] : n === 1 ? [200, { status: 'pending' }, 4000] : [200, { status: 'done', reply: { text: '元の依頼の返答です、ご主人さま。' } }], { active: false, submitDuringLookup: true })
// POST の応答前に再読込（BFF は受理済み）→ 再読込後の照会で受理済みと分かり再送せずに結果を受け取る（P1: 送信前に控えを保存）
await scenario('reloadBeforePostReply', (n, rl) => !rl.active ? [200, { status: 'pending' }] : n === 1 ? [200, { status: 'pending' }] : [200, { status: 'done', reply: { text: '送信直後の再読込でも届きました、ご主人さま。' } }], { active: false, postHang: true })
// POST の応答前に再読込し BFF 未受理（404）→ 自動再送せず本文を入力欄へ戻す（再送時は同じ受付番号）
await scenario('reloadBeforePostUnaccepted', (n, rl) => [404, { error: 'unknown_request' }], { active: false, postHang: true })
// 再読込後の初回照会が 401（認証切れ）→ 未認証表示とエラー、送信不可、控えは残す（P1: 送信を再有効化しない）
await scenario('reload401', (n, rl) => !rl.active ? [200, { status: 'pending' }] : [401, { error: 'unauthenticated' }], { active: false, submitAfterReload: true })
// POST 応答前に再読込し、受理状況の照会が 401（認証切れ）→ 未認証表示、送信不可、控え（unconfirmed）は残す
await scenario('reloadBeforePost401', (n, rl) => [401, { error: 'unauthenticated' }], { active: false, postHang: true, submitAfterReload: true })
// 404 → 終了
await scenario('gone404', n => [404, { error: 'not_found' }])
console.log(JSON.stringify(out, null, 1))
await b.close(); srv.close()
