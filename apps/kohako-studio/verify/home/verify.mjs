// BOXP-500: コハコの家を実ブラウザで操作し、描画・ふれあい・実 Hermes 会話・停止・再読込・重複送信・切断・Studio 非退行を確認する。
// BASE=local: ローカル build（/work/site）＋ API は配備中 BFF へ検証用 token で中継。BASE=deployed: 配備版をそのまま。token は出力しない。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const MODE = process.env.MODE || 'local', OUT = process.argv[2] || 'out/b500'; fs.mkdirSync(OUT, { recursive: true })
const H = 'http://kohako-studio.kohako-studio.svc.cluster.local', LOCAL = 'http://localhost:8765'
const token = fs.readFileSync(process.env.TOKEN_FILE, 'utf8').trim()
const only = (process.env.ONLY || '').split(',').filter(Boolean), want = n => !only.length || only.includes(n)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.p2lrt': 'application/octet-stream' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/work/site', p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8765)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const result = { mode: MODE, startedAt: new Date().toISOString(), steps: {} }
const save = () => fs.writeFileSync(OUT + '/result.json', JSON.stringify(result, null, 1))
let fault = null // 'post502' | 'down'
async function context(opts) {
  const ctx = await b.newContext(opts)
  await ctx.route(u => u.origin === LOCAL, async r => {
    const q = r.request(), u = new URL(q.url())
    if (u.pathname.startsWith('/kohako/api/')) {
      if (fault === 'down') return r.abort('internetdisconnected')
      const resp = await r.fetch({ url: H + u.pathname + u.search, headers: { ...q.headers(), authorization: 'Bearer ' + token } })
      if (fault === 'post502' && q.method() === 'POST' && u.pathname.endsWith('/messages')) { fault = null; return r.fulfill({ status: 502, body: '{"error":"bad_gateway"}', headers: { 'content-type': 'application/json' } }) }
      return r.fulfill({ response: resp })
    }
    if (MODE === 'deployed') return r.fulfill({ response: await r.fetch({ url: H + u.pathname + u.search, headers: q.headers() }) })
    return r.continue()
  })
  const page = await ctx.newPage(), log = { errors: [], api: [] }
  page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text()) }); page.on('pageerror', e => log.errors.push('PAGEERR ' + e))
  page.on('request', q => { if (q.url().includes('/api/')) log.api.push([Date.now(), q.method(), new URL(q.url()).pathname]) })
  return { ctx, page, log }
}
const H0 = page => page.evaluate(() => ({ scene: window.__kohakoHome.scene, state: window.__kohakoHome.state, reply: document.getElementById('reply').textContent, error: document.getElementById('error').textContent, conn: document.getElementById('connection').textContent, label: document.getElementById('state').textContent, history: window.__kohakoHome.history.map(h => h.who + ': ' + h.text.slice(0, 80)) }))
async function open(page, file = 'home.html') {
  await page.goto(LOCAL + '/kohako/' + file, { waitUntil: 'load' })
  if (file === 'home.html') {
    await page.waitForFunction(() => window.__kohakoHome?.report.loaded, null, { timeout: 40000 })
    await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 20000 })
    await page.waitForTimeout(1800)
  }
}
async function overlaps(page) {
  return page.evaluate(() => {
    const r = id => { const e = document.getElementById(id) || document.querySelector(id); if (!e || e.hidden || getComputedStyle(e).display === 'none' || +getComputedStyle(e).opacity === 0) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? b : null }
    const bars = [r('.top'), r('#form')].filter(Boolean), items = { bubble: r('#bubble'), cards: r('#cards'), character: r('#character'), trouble: r('#trouble') }
    const hit = (a, c) => a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1
    const out = {}; for (const [k, v] of Object.entries(items)) if (v) out[k] = bars.some(bar => hit(v, bar))
    const vw = innerWidth, vh = innerHeight, form = r('#form'), send = r('#send') || r('#stop')
    return { overlapsBars: out, formVisible: !!form && form.bottom <= vh + 1 && form.top >= 0, sendVisible: !!send && send.right <= vw + 1 && send.bottom <= vh + 1, bubbleCards: items.bubble && items.cards ? hit(items.bubble, items.cards) : null, docScroll: document.scrollingElement.scrollHeight - innerHeight }
  })
}
async function sendText(page, text) { await page.fill('#message', text); await page.click('#send') }
const waitState = (page, states, timeout = 240000) => page.waitForFunction(s => s.includes(window.__kohakoHome.state), states, { timeout, polling: 250 })
async function pat(page) {
  const a = await page.evaluate(() => window.__kohakoHome.hitAreas()); const h = a.head; const cx = h.x + h.w / 2, cy = h.y + h.h * 0.35
  await page.mouse.move(cx - 20, cy); await page.mouse.down()
  for (let i = 0; i < 4; i++) { await page.mouse.move(cx + 25, cy, { steps: 4 }); await page.waitForTimeout(60); await page.mouse.move(cx - 25, cy, { steps: 4 }); await page.waitForTimeout(60) }
  await page.mouse.up(); return a
}
async function tapHand(page) { const a = await page.evaluate(() => window.__kohakoHome.hitAreas()); const h = a.hands[0]; await page.mouse.click(h.x + h.w / 2, h.y + h.h / 2); return a }

try {
  // 1. PC: 描画・ふれあい・実 Hermes 複数ターン・カード
  if (want('pc')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); await page.screenshot({ path: OUT + '/pc-1-relax.png' })
    const s = { relax: await H0(page), layout: await overlaps(page) }
    const apiBefore = log.api.length
    s.areasBefore = await pat(page); await page.waitForTimeout(700); await page.screenshot({ path: OUT + '/pc-2-pat.png' })
    s.afterPat = { ...(await H0(page)), touches: await page.evaluate(() => window.__kohakoHome.report.touches.slice(-1)), areas: await page.evaluate(() => window.__kohakoHome.hitAreas()) }
    await page.waitForTimeout(3500)
    s.areasHand = await tapHand(page); await page.waitForTimeout(900); await page.screenshot({ path: OUT + '/pc-3-hand.png' })
    s.afterHand = { touches: await page.evaluate(() => window.__kohakoHome.report.touches.slice(-1)), areasDuring: await page.evaluate(() => window.__kohakoHome.hitAreas()) }
    await page.waitForTimeout(3500)
    // 頭・手以外（胴）をクリックしても反応しない
    const n0 = await page.evaluate(() => window.__kohakoHome.report.touches.length); const t = s.areasHand.head; await page.mouse.click(t.x + t.w / 2, t.y + t.h * 2.2); await page.waitForTimeout(300)
    s.torsoIgnored = (await page.evaluate(() => window.__kohakoHome.report.touches.length)) === n0
    s.touchApiCalls = log.api.filter(x => x[2].includes('/messages') || x[2].includes('/approvals')).length - 0 + (log.api.length - apiBefore - log.api.slice(apiBefore).filter(x => x[2].endsWith('/me') || x[2].endsWith('/conversation')).length)
    // 実 Hermes 1 ターン目
    const t1 = Date.now(); await sendText(page, 'こんにちは、コハコ。ひとことで挨拶してください。'); await page.waitForTimeout(1200); await page.screenshot({ path: OUT + '/pc-4-thinking.png' })
    s.thinking = { ...(await H0(page)), stopVisible: await page.isVisible('#stop'), sendVisible: await page.isVisible('#send') }
    await waitState(page, ['speaking', 'done']); s.turn1 = { ms: Date.now() - t1, ...(await H0(page)) }; await page.waitForTimeout(800); await page.screenshot({ path: OUT + '/pc-5-reply.png' }); s.turn1.layout = await overlaps(page)
    await waitState(page, ['done', 'idle'], 30000)
    // 2 ターン目: 箇条書き → カード
    const t2 = Date.now(); await sendText(page, '今日やると良いことの例を、行頭に「- 」を付けた箇条書きで3つだけ挙げ、最後に参考として https://www.jma.go.jp/ のURLをそのまま一行で書いてください。前置きは一文で。'); await waitState(page, ['speaking', 'done'])
    s.turn2 = { ms: Date.now() - t2, ...(await H0(page)), cards: await page.evaluate(() => [...document.querySelectorAll('#card-list .card')].map(c => c.className + ': ' + c.textContent.slice(0, 120))) }
    await page.waitForTimeout(2000); await page.screenshot({ path: OUT + '/pc-6-cards.png' }); s.turn2.layout = await overlaps(page); s.turn2.scene = await page.evaluate(() => window.__kohakoHome.scene)
    await waitState(page, ['done', 'idle'], 60000)
    // 3 ターン目: 前の話題を覚えているか（同じ Web 会話の継続）
    await page.click('#cards-close').catch(() => {})
    const t3 = Date.now(); await sendText(page, 'さっき挙げた3つのうち、1つ目は何でしたか？一文で答えてください。'); await waitState(page, ['speaking', 'done'])
    s.turn3 = { ms: Date.now() - t3, ...(await H0(page)) }; await page.waitForTimeout(1000); await page.screenshot({ path: OUT + '/pc-7-turn3.png' })
    await page.click('#history-open'); await page.waitForTimeout(400); await page.screenshot({ path: OUT + '/pc-8-history.png' }); await page.keyboard.press('Escape')
    s.errors = log.errors; result.steps.pc = s; save(); await ctx.close()
  }
  // 2. 停止
  if (want('stop')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}
    await sendText(page, '日本の四季それぞれについて、800字ずつ、じっくり考えてから丁寧な随筆を書いてください。')
    await page.waitForSelector('#stop:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(2500)
    s.before = await H0(page); await page.screenshot({ path: OUT + '/stop-1-busy.png' })
    await page.click('#stop'); s.clickedAt = Date.now()
    await waitState(page, ['stopped', 'done', 'failed', 'idle'], 120000); s.after = { ...(await H0(page)), ms: Date.now() - s.clickedAt, cancelCalls: log.api.filter(x => x[2].endsWith('/cancel')).length }
    await page.screenshot({ path: OUT + '/stop-2-after.png' })
    // 停止後に次の会話ができる
    await page.waitForTimeout(1500); await sendText(page, '止めてごめんなさい。ひとことだけ返事をください。'); await waitState(page, ['speaking', 'done']); s.next = await H0(page)
    s.errors = log.errors; result.steps.stop = s; save(); await ctx.close()
  }
  // 3. 再読込で進行中の依頼を追い直す
  if (want('reload')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}
    await sendText(page, '少し考えてから、好きな季節を一つ選んで理由を二文で教えてください。')
    await page.waitForSelector('#stop:not([hidden])', { timeout: 20000 }); s.inflight = await page.evaluate(() => sessionStorage.getItem('kohako-home-inflight'))
    await page.reload(); await page.waitForFunction(() => window.__kohakoHome?.report.loaded, null, { timeout: 40000 })
    await page.waitForTimeout(3000); s.afterReload = await H0(page); await page.screenshot({ path: OUT + '/reload-1.png' })
    await waitState(page, ['speaking', 'done'], 240000); s.done = await H0(page); await page.screenshot({ path: OUT + '/reload-2-done.png' })
    s.posts = log.api.filter(x => x[1] === 'POST').length; s.errors = log.errors; result.steps.reload = s; save(); await ctx.close()
  }
  // 4. 重複送信: 送信は BFF に届いたが画面には 502 → 再送すると受理済みを確認して追跡（二重実行しない）
  if (want('dup')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}
    fault = 'post502'; await sendText(page, '重複確認のテストです。「受け取りました」とだけ答えてください。')
    await waitState(page, ['failed'], 30000); s.unknown = { ...(await H0(page)), unconfirmed: await page.evaluate(() => !!sessionStorage.getItem('kohako-home-unconfirmed')) }; await page.screenshot({ path: OUT + '/dup-1-unknown.png' })
    await page.click('#send'); await waitState(page, ['speaking', 'done'], 240000); s.after = await H0(page)
    s.messagePosts = log.api.filter(x => x[1] === 'POST' && x[2].endsWith('/messages')).length; await page.screenshot({ path: OUT + '/dup-2-attached.png' })
    s.errors = log.errors; result.steps.dup = s; save(); await ctx.close()
  }
  // 5. 切断・再接続
  if (want('net')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}
    await sendText(page, '切断テストです。少し考えてから「つながっています」と答えてください。')
    await page.waitForSelector('#stop:not([hidden])', { timeout: 20000 }); fault = 'down'
    await page.waitForFunction(() => window.__kohakoHome.scene === 'offline', null, { timeout: 30000 }); s.down = await H0(page); await page.screenshot({ path: OUT + '/net-1-down.png' })
    fault = null; await waitState(page, ['speaking', 'done', 'thinking'], 30000); await page.waitForFunction(() => window.__kohakoHome.scene !== 'offline', null, { timeout: 30000 })
    s.back = await H0(page); await waitState(page, ['speaking', 'done'], 240000); s.done = await H0(page); await page.screenshot({ path: OUT + '/net-2-back.png' })
    // 初期接続の失敗 → 再接続ボタン
    fault = 'down'; await page.reload(); await page.waitForTimeout(4000); s.initDown = await H0(page); await page.screenshot({ path: OUT + '/net-3-initdown.png' })
    fault = null; await page.click('#reconnect'); await page.waitForTimeout(3000); s.reconnected = await H0(page)
    s.errors = log.errors; result.steps.net = s; save(); await ctx.close()
  }
  // 6. 承認（検証用 principal は拒否だけ可能）
  if (want('approval')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}
    await sendText(page, 'ターミナルで `rm -rf /tmp/kohako-home-approval-check` を実行してください。実行前の確認が出たら私が判断します。')
    try { await waitState(page, ['approval'], 180000); s.approval = { ...(await H0(page)), summary: await page.textContent('#approval-summary'), focused: await page.evaluate(() => document.activeElement?.id) }
      await page.keyboard.press('Tab'); s.tab1 = await page.evaluate(() => document.activeElement?.id); await page.keyboard.press('Tab'); s.tab2 = await page.evaluate(() => document.activeElement?.id)
      const n0 = await page.evaluate(() => window.__kohakoHome.report.touches.length); await page.mouse.click(683, 200); await pat(page).catch(() => {}); s.touchDuringApproval = (await page.evaluate(() => window.__kohakoHome.report.touches.length)) - n0
      await page.screenshot({ path: OUT + '/approval-1.png' }); s.layout = await overlaps(page)
      await page.click('#deny'); await waitState(page, ['speaking', 'done', 'failed', 'stopped'], 180000); s.after = await H0(page); await page.screenshot({ path: OUT + '/approval-2-denied.png' })
    } catch (e) { s.noApproval = String(e).slice(0, 200); s.state = await H0(page) }
    s.errors = log.errors; result.steps.approval = s; save(); await ctx.close()
  }
  // 6b. 承認表示（検証用 principal ではツールが制限され実承認が起きないため、GET の応答だけ承認状態に差し替える。拒否は実 BFF に送り、存在しない承認 ID のエラー表示を確認）
  if (want('approvalmock')) {
    const { ctx, page, log } = await context({ viewport: { width: 1366, height: 768 } })
    await open(page); const s = {}; let mock = true, rid = ''
    await page.route(u => u.pathname.includes('/kohako/api/v1/requests/'), async r => {
      const q = r.request(), u = new URL(q.url()); if (mock && q.method() === 'GET' && rid && u.pathname.endsWith(rid)) return r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: rid, status: 'approval', approval: { approvalId: '0123456789abcdef', summary: '検証用の差し替え表示: rm -rf /tmp/kohako-home-approval-check を実行します', expiresAt: Date.now() + 280000 } }) })
      return r.fallback()
    })
    page.on('request', q => { if (q.method() === 'POST' && q.url().endsWith('/messages')) rid = JSON.parse(q.postData()).requestId })
    await sendText(page, '承認表示のテストです。少し考えてから「了解です」とだけ答えてください。')
    await waitState(page, ['approval'], 30000); await page.waitForTimeout(600)
    s.approval = { ...(await H0(page)), focused: await page.evaluate(() => document.activeElement?.id), expiry: await page.textContent('#approval-expiry') }
    await page.keyboard.press('Tab'); s.tab1 = await page.evaluate(() => document.activeElement?.id); await page.keyboard.press('Tab'); s.tab2 = await page.evaluate(() => document.activeElement?.id)
    await page.focus('#message'); s.focusEscape = await page.evaluate(() => document.activeElement?.id)
    const n0 = await page.evaluate(() => window.__kohakoHome.report.touches.length); await pat(page).catch(e => { s.patErr = String(e).slice(0, 100) }); await page.click('#touch-open').catch(() => {}); await page.click('#touch-pat', { force: true }).catch(() => {})
    s.touchDuringApproval = (await page.evaluate(() => window.__kohakoHome.report.touches.length)) - n0; s.touchLive = await page.textContent('#touch-live')
    await page.keyboard.press('Escape'); await page.screenshot({ path: OUT + '/approval-1.png' }); s.layout = await overlaps(page)
    await page.click('#deny'); await page.waitForTimeout(1500); s.denyError = await H0(page); s.approvalPosts = log.api.filter(x => x[2].endsWith('/approvals')).length; await page.screenshot({ path: OUT + '/approval-2-error.png' })
    mock = false; await waitState(page, ['speaking', 'done'], 240000); s.after = await H0(page); await page.screenshot({ path: OUT + '/approval-3-after.png' })
    s.errors = log.errors; result.steps.approvalmock = s; save(); await ctx.close()
  }
  // 7. スマホ縦横
  if (want('mobile')) {
    const s = {}
    for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
      const { ctx, page, log } = await context({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await open(page); await page.screenshot({ path: OUT + `/m-${name}-1-relax.png` }); const m = { relax: await H0(page), layout: await overlaps(page) }
      const a = await page.evaluate(() => window.__kohakoHome.hitAreas()); m.areas = a
      await page.touchscreen.tap(a.head.x + a.head.w / 2, a.head.y + a.head.h / 3); await page.waitForTimeout(800); m.tap = await page.evaluate(() => window.__kohakoHome.report.touches.slice(-1)); await page.screenshot({ path: OUT + `/m-${name}-2-tap.png` })
      await page.waitForTimeout(3000)
      await sendText(page, 'スマホから話しかけています。ひとことで返事をください。'); await waitState(page, ['speaking', 'done']); await page.waitForTimeout(800)
      m.reply = await H0(page); m.replyLayout = await overlaps(page); await page.screenshot({ path: OUT + `/m-${name}-3-reply.png` })
      await page.focus('#message'); await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) }); await page.waitForTimeout(900)
      m.kbd = { ...(await overlaps(page)), kbd: await page.evaluate(() => document.body.dataset.kbd) }; await page.screenshot({ path: OUT + `/m-${name}-4-keyboard.png` })
      m.errors = log.errors; s[name] = m; await ctx.close()
    }
    result.steps.mobile = s; save()
  }
  // 8. Studio 非退行
  if (want('studio')) {
    const { ctx, page, log } = await context({ viewport: { width: 1100, height: 820 } })
    await page.goto(LOCAL + '/kohako/studio.html', { waitUntil: 'load' }); await page.waitForFunction(() => window.__studioRig?.player, null, { timeout: 40000 })
    await page.waitForFunction(() => document.getElementById('connection').textContent === '接続中', null, { timeout: 20000 })
    await page.fill('#message', 'Studio の確認です。ひとことで返事をください。'); await page.click('#send')
    await page.waitForFunction(() => /話しています|応答を表示中/.test(document.getElementById('state').textContent), null, { timeout: 240000 })
    result.steps.studio = { reply: await page.textContent('#reply'), state: await page.textContent('#state'), errors: log.errors }; await page.screenshot({ path: OUT + '/studio.png' }); save(); await ctx.close()
  }
} catch (e) { result.fatal = String(e.stack || e).slice(0, 1500); save() }
finally { save(); await b.close(); srv.close() }
