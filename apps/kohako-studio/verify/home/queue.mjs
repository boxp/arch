// BOXP-508: BFF を完全にモックして送信待ちの動作を検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', port = 8771
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join('/site', p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data)
  })
}).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = []
const assert = (value, message) => { if (!value) throw new Error(message) }
const wait = async (fn, message, timeout = 12000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)) }
  throw new Error(message)
}
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['mobile', { width: 412, height: 915 }, true]]) {
  results[device] = {}
  async function scenario(letters, body) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage()
    const posts = [], gets = [], approvals = [], states = new Map()
    let failText = null, lookup404 = null
    const env = { page, posts, gets, approvals, states, setFail: text => { failText = text }, set404: id => { lookup404 = id },
      set: (i, status, extra = {}) => states.set(posts[i].requestId, { status, ...extra }),
      screenshot: async name => page.screenshot({ path: `${out}/${device}-${name}.png` }),
      submit: async (text, method = 'button') => { await page.locator('#message').fill(text); if (method === 'enter') await page.locator('#message').press('Enter'); else await page.locator('#send').click() },
      count: async n => wait(() => posts.length === n, `POST count expected ${n}, got ${posts.length}`),
      rows: () => page.locator('#queue-list li'),
      settle: () => page.waitForTimeout(2200),
      done: i => states.set(posts[i].requestId, { status: 'done', reply: { text: 'はい。' } }),
    }
    await ctx.route('**/kohako/api/v1/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1]
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (p === 'me') return json(200, { authenticated: true })
      if (p === 'conversation') return json(200, { enabled: true, stt: false })
      if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
      if (p === 'messages') { const data = req.postDataJSON(); posts.push(data); if (data.text === failText) { failText = null; return json(502, {}) } states.set(data.requestId, { status: 'pending' }); return json(202, { status: 'accepted' }) }
      if (p === 'approvals') { approvals.push(req.postDataJSON()); return json(202, {}) }
      const match = p.match(/^requests\/([^/]+)(\/cancel)?$/)
      if (match) { const id = decodeURIComponent(match[1]); if (match[2]) { states.set(id, { status: 'failed', error: 'cancelled' }); return json(202, {}) } gets.push(id); if (lookup404 === id) { lookup404 = null; return json(404, {}) } const state = states.get(id) || { status: 'pending' }; if (state.http) return json(state.http, { error: 'unauthenticated' }); return json(200, state) }
      return json(404, {})
    })
    const evidence = {}
    try {
      await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static`)
      await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
      await body(env, evidence)
      for (const letter of letters) if (!results[device][letter]) results[device][letter] = { pass: true, evidence }
    } catch (error) {
      const message = String(error.message || error); failures.push(`${device} ${letters.join('/')} ${message}`)
      for (const letter of letters) if (!results[device][letter]) results[device][letter] = { pass: false, error: message, evidence }
      await page.screenshot({ path: `${out}/${device}-${letters.join('')}-failure.png` }).catch(() => {})
    } finally { await ctx.close() }
  }
  const mark = (letter, ev) => { results[device][letter] = { pass: true, evidence: ev } }
  await scenario(['a','b','c','l'], async (e, ev) => {
    await e.submit('最初'); await e.count(1)
    await e.submit('一番', 'button'); await e.submit('二番', 'enter'); await e.submit('三番', 'button')
    const rows = await e.rows().allTextContents(); assert(rows.length === 3 && rows.every((r,i) => r.includes(`${i+1}番目・未送信`) && r.includes(['一番','二番','三番'][i])), `queue rows ${JSON.stringify(rows)}`)
    assert(e.posts.length === 1 && await e.page.locator('#message').inputValue() === '' && await e.page.locator('#send').textContent() === 'キューに追加', 'pending submit behavior')
    await e.screenshot('a'); mark('a', { rows, posts: e.posts.map(p => p.text) })
    const rects = await e.page.evaluate(() => Object.fromEntries(['queue','send','stop','message'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x:r.x,y:r.y,w:r.width,h:r.height }] })))
    const q = rects.queue, overlaps = r => q.x < r.x+r.w && r.x < q.x+q.w && q.y < r.y+r.h && r.y < q.y+q.h
    assert(q.x >= 0 && q.y >= 0 && q.x+q.w <= viewport.width && q.y+q.h <= viewport.height && ['send','stop','message'].every(id => !overlaps(rects[id])), `layout ${JSON.stringify(rects)}`); mark('l', rects)
    await e.rows().nth(1).locator('button').click(); const remaining = await e.rows().allTextContents(); assert(remaining.length === 2 && remaining[0].includes('一番') && remaining[1].includes('三番'), `cancel ${remaining}`); mark('b', { remaining })
    e.done(0); await wait(() => e.page.evaluate(() => window.__kohakoHome.state === 'speaking'), 'speaking state not observed'); assert(e.posts.length === 1, 'sent during speaking'); await e.count(2); assert(e.posts[1].text === '一番', 'first FIFO'); await e.settle(); assert(e.posts.length === 2, 'sent more than one while pending'); assert((await e.page.locator('#history-list').textContent()).includes('一番'), 'accepted history')
    e.done(1); await e.count(3); await e.settle(); assert(e.posts.map(p => p.text).join(',') === '最初,一番,三番', 'FIFO order or duplicate'); mark('c', { posts: e.posts.map(p => ({ text:p.text, requestId:p.requestId })) })
  })
  await scenario(['d','e'], async (e) => {
    await e.submit('実行'); await e.count(1); await e.page.locator('#message').fill('連打')
    await e.page.locator('#send').evaluate(el => { for (let i=0;i<5;i++) el.click() })
    assert(await e.rows().count() === 1, 'repeated clicks duplicated queue')
    await e.page.locator('#message').fill('Enter連打'); await e.page.locator('#message').evaluate(el => { for (let i=0;i<5;i++) el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true })) })
    assert(await e.rows().count() === 2 && e.posts.length === 1, 'repeated Enter duplicated queue or POST'); const rapidRows = await e.rows().allTextContents()
    await e.page.locator('#message').fill('変換中'); await e.page.locator('#message').evaluate(el => { el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', isComposing:true, bubbles:true, cancelable:true })); el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:229, bubbles:true, cancelable:true })) })
    assert(await e.rows().count() === 2 && e.posts.length === 1 && await e.page.locator('#message').inputValue() === '変換中', 'IME Enter submitted'); mark('e', { rows:2, posts:1, input:'変換中' }); e.done(0); await e.count(2); e.done(1); await e.count(3); await e.settle(); assert(e.posts.map(p => p.text).join(',') === '実行,連打,Enter連打', 'duplicate POST after repeated input'); mark('d', { rows:rapidRows, finalPosts:e.posts.map(p => p.text) })
  })
  await scenario(['f'], async e => { await e.submit('実行'); await e.count(1); await e.submit('保留'); e.set(0,'failed'); await e.page.locator('#queue-resume').waitFor({ state:'visible', timeout:10000 }); await e.settle(); const status = await e.page.locator('#queue-status').textContent(); assert(status.includes('失敗') && e.posts.length === 1, `failure hold ${status}`); await e.page.locator('#queue-resume').click(); await e.count(2); assert(e.posts[1].text === '保留', 'resume text'); return Object.assign(results[device], { f:{ pass:true,evidence:{ status, posts:e.posts.map(p=>p.text) } } }) })
  await scenario(['g'], async e => { await e.submit('実行'); await e.count(1); await e.submit('停止後'); await e.page.locator('#stop').click(); await e.page.locator('#queue-resume').waitFor({ state:'visible', timeout:10000 }); await e.settle(); const status = await e.page.locator('#queue-status').textContent(); assert(status.includes('停止') && e.posts.length === 1, `stop hold ${status}`); mark('g',{status,posts:e.posts.length}) })
  await scenario(['h'], async e => { await e.submit('実行'); await e.count(1); await e.submit('OK'); e.set(0,'approval',{ approval:{ approvalId:'abc', summary:'確認', expiresAt:Date.now()+60000 } }); await e.page.locator('#approval').waitFor({state:'visible',timeout:10000}); await e.settle(); assert(e.approvals.length === 0 && e.posts.length === 1, 'approval sent unexpectedly'); e.done(0); await e.count(2); assert(e.posts[1].text === 'OK' && e.approvals.length === 0, 'OK was not a normal message'); mark('h',{posts:e.posts.map(p=>p.text),approvals:e.approvals.length}) })
  await scenario(['i'], async e => { await e.submit('実行'); await e.count(1); await e.submit('不明'); e.setFail('不明'); e.done(0); await e.count(2); await wait(async () => (await e.page.locator('#queue-list').textContent()).includes('受理未確認'), 'unconfirmed row'); await e.settle(); assert(e.posts.length === 2, 'unconfirmed automatically resent'); const id=e.posts[1].requestId; e.set404(id); await e.page.locator('#queue-resume').click(); await e.count(3); assert(e.posts[2].requestId === id && e.posts[2].text === '不明' && e.gets.includes(id), '404 resend ID or lookup'); mark('i',{requestId:id,posts:e.posts.map(p=>({text:p.text,requestId:p.requestId})),gets:e.gets}) })
  await scenario(['j'], async e => { await e.submit('実行'); await e.count(1); for(let i=1;i<=5;i++) await e.submit(`待ち${i}`); await e.submit('六件目'); const note=await e.page.locator('#queue-note').textContent(); assert(await e.rows().count()===5 && note.includes('5 件') && await e.page.locator('#message').inputValue()==='六件目', `limit ${note}`); await e.screenshot('j'); const input = await e.page.locator('#message').inputValue(); await e.page.locator('#message').evaluate(el => { el.value = '長'.repeat(501) }); await e.page.locator('#form').evaluate(el => el.requestSubmit()); assert((await e.page.locator('#queue-note').textContent()).includes('500') && (await e.page.locator('#message').inputValue()).length === 501, '500 character limit'); const stored = await e.page.evaluate(() => JSON.stringify({ local: {...localStorage}, session: {...sessionStorage} })); assert(!stored.includes('待ち1') && !stored.includes('待ち2'), 'queued text persisted'); let unload = false; e.page.once('dialog', async dialog => { unload = dialog.type() === 'beforeunload'; await dialog.accept() }); await e.page.reload(); await e.page.waitForFunction(() => !document.querySelector('#send').disabled); assert(unload && await e.rows().count() === 0, 'reload did not confirm and clear queue'); mark('j',{note,input,rows:5,tooLong:501,unload,queueAfterReload:0}) })
  await scenario(['m'], async e => { await e.submit('実行'); await e.count(1); e.done(0); await wait(() => e.page.evaluate(() => window.__kohakoHome.state === 'speaking'), 'speaking state not observed'); await e.submit('読み上げ中'); await e.page.waitForTimeout(300); const speaking = await e.page.evaluate(() => window.__kohakoHome.state); assert(e.posts.length === 1 && speaking === 'speaking' && await e.rows().count() === 1, `sent during speaking state=${speaking} posts=${e.posts.length}`); await e.count(2); assert(e.posts[1].text === '読み上げ中', 'queued after speaking'); mark('m',{stateAfterSubmit:speaking,posts:e.posts.map(p=>p.text)}) })
  await scenario(['n'], async e => { await e.submit('実行'); await e.count(1); await e.submit('通信後'); await e.page.context().setOffline(true); await e.page.locator('#queue-resume').waitFor({state:'visible',timeout:10000}); const offStatus=await e.page.locator('#queue-status').textContent(); assert(offStatus.includes('接続'), `offline hold ${offStatus}`); e.done(0); await e.page.context().setOffline(false); await wait(() => e.page.evaluate(() => ['done','idle'].includes(window.__kohakoHome.state)), 'reply not received after reconnect', 20000); await e.settle(); assert(e.posts.length === 1 && await e.page.locator('#queue-resume').isVisible(), `auto-sent after reconnect posts=${e.posts.length}`); const status=await e.page.locator('#queue-status').textContent(); await e.page.locator('#queue-resume').click(); await e.count(2); assert(e.posts[1].text === '通信後', 'resume after reconnect'); mark('n',{offStatus,statusAfterReconnect:status,posts:e.posts.map(p=>p.text)}) })
  await scenario(['k'], async e => { await e.submit('実行'); await e.count(1); await e.submit('認証後'); e.states.set(e.posts[0].requestId,{http:401}); await e.page.locator('#queue-resume').waitFor({state:'visible',timeout:10000}); await e.settle(); const status=await e.page.locator('#queue-status').textContent(); assert(status.includes('認証') && e.posts.length===1, `401 hold ${status}`); mark('k',{status,posts:e.posts.length}) })
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ results, failures }, null, 2)); process.exitCode = failures.length ? 1 : 0
