// BOXP-658: BFF を完全にモックして、受信箱・吹き出しからの通知返信が応答待ち中に送信待ちへ積まれ、
// 通常の発言と同じ FIFO で現 run の正常終了後に 1 件ずつ通知の返信 API へ送られることを実ブラウザで検証する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8865)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  fs.readFile(path.join(site, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data)
  })
}).listen(port)
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const assert = (value, message) => { if (!value) throw new Error(message) }
const wait = async (fn, message, timeout = 12000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error(message)
}
const notice = (id, n, extra = {}) => ({ eventId: `event-658-${id}`, source: 'task-board-report', eventType: 'ready', ticketId: 'BOXP-658', title: `通知${id}`, body: '本文\nA) はい\nB) いいえ', choices: ['A', 'B'], receivedAt: new Date(Date.now() - (10 - n) * 60000).toISOString(), readAt: new Date().toISOString(), announcedAt: new Date().toISOString(), ...extra })
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  results[device] = {}
  async function scenario(name, body, setup = {}) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
    const posts = [], replies = [], approvals = [], states = new Map(), log = []
    const items = setup.items ?? [notice('one', 1), notice('two', 2), notice('three', 3)]
    const replyMode = new Map()
    page.on('request', (req) => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
    const env = {
      slow: 0,
      lostTrackers: new Set(),
      page, posts, replies, approvals, states, items, replyMode, log,
      item: (id) => items.find((i) => i.eventId === `event-658-${id}`),
      submit: async (text) => { await page.locator('#message').fill(text); await page.locator('#send').click() },
      count: async (n) => wait(() => posts.length === n, `messages POST expected ${n}, got ${posts.length}`),
      replyCount: async (n) => wait(() => replies.length === n, `reply POST expected ${n}, got ${replies.length}`),
      // 受理済みの返信は同じ replyId で返信 API へ送り直して追跡を作り直す（新しい返信は作らない）ため、返信の数は replyId の種類で数える。
      distinct: () => new Set(replies.map((x) => x.replyId)).size,
      replyIds: async (n) => wait(() => new Set(replies.map((x) => x.replyId)).size === n, `distinct replyIds expected ${n}, got ${new Set(replies.map((x) => x.replyId)).size}`),
      rows: () => page.locator('#queue-list li'),
      settle: () => page.waitForTimeout(2200),
      done: (requestId) => states.set(requestId, { status: 'done', reply: { text: 'はい。' } }),
      openInbox: async () => { if (await page.locator('#inbox').isHidden()) await page.locator('#inbox-open').click() },
      select: async (id) => {
        await env.openInbox()
        await page.locator('#inbox-list .inbox-row').filter({ hasText: `通知${id}` }).click()
        await page.waitForFunction((t) => document.querySelector('#inbox-detail .detail-title')?.textContent === t, `通知${id}`)
      },
      detail: () => page.locator('#inbox-detail').innerText(),
      status: () => page.locator('#queue-status').textContent(),
      closeInbox: async () => { if (await page.locator('#inbox').isVisible()) await page.locator('#inbox-close').click() },
      screenshot: async (n) => page.screenshot({ path: `${out}/${device}-${n}.png` }),
    }
    await ctx.route('**/kohako/api/v1/**', async (route) => {
      const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1]
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {})
      if (p === 'me') return json(200, { authenticated: true })
      if (p === 'conversation') return json(200, { enabled: true, stt: false })
      if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
      if (p === 'notifications') { if (env.slow) await new Promise((r) => setTimeout(r, env.slow)); return json(200, { items, unread: items.filter((i) => !i.readAt).length }) }
      if (p === 'messages') { const data = req.postDataJSON(); posts.push(data); log.push(`message:${data.text}`); states.set(data.requestId, { status: 'pending' }); return json(202, { status: 'accepted' }) }
      if (p === 'approvals') { approvals.push(req.postDataJSON()); return json(202, {}) }
      const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
      if (m) {
        const id = decodeURIComponent(m[1]), item = items.find((i) => i.eventId === id)
        if (m[2] === 'reply') {
          const body = req.postDataJSON(); replies.push({ id, ...body }); log.push(`reply:${id}:${body.kind}:${body.value}`)
          const mode = replyMode.get(id); replyMode.delete(id)
          if (mode === 'lost') { // サーバーは受理したが応答が失われた（502）
            const requestId = `request-${id}`; item.reply = { ...body, requestId, status: 'submitted' }; states.set(requestId, { status: 'pending' })
            return json(502, {})
          }
          if (mode === 'hang') await new Promise((r) => setTimeout(r, 5000))
          else if (mode === 'busy_claimed') return json(429, { error: 'busy_claimed' })
          else if (mode === 'expired') return json(200, { requestId: `request-${id}`, status: 'submitted', tracking: 'expired' }) // 確認期限（23h）切れ: BFF は追跡を作り直さない
          else if (mode === 'unavailable') return json(200, { requestId: item.reply.requestId, status: 'submitted', tracking: 'unavailable' }) // 受理済みだが別 run の進行中で追跡を作り直せない
          if (mode && mode !== 'hang') return json(mode, mode === 429 ? { error: 'busy' } : mode === 401 ? { error: 'unauthenticated' } : {})
          if (!item) return json(404, { error: 'not_found' })
          if (item.reply && item.reply.replyId !== body.replyId) return json(409, { error: 'already_replied' })
          const requestId = `request-${id}`
          item.reply = { ...body, requestId, status: 'submitted' }
          states.set(requestId, { status: 'pending' })
          return json(202, { requestId, status: 'submitted' })
        }
        if (!item) return json(404, { error: 'not_found' })
        if (m[2] === 'read') item.readAt = new Date().toISOString()
        if (m[2] === 'announcing') return json(200, { claimed: true })
        if (m[2] === 'announced') { item.announcedAt = new Date().toISOString(); return json(200, { announced: true }) }
        return json(200, {})
      }
      const r = p.match(/^requests\/([^/]+)(\/cancel)?$/)
      if (r) { const id = decodeURIComponent(r[1]); if (!r[2]) log.push(`poll:${id}`); if (!r[2] && env.lostTrackers.has(id)) return json(404, { error: 'not_found' }); if (r[2]) { states.set(id, { status: 'failed', error: 'cancelled' }); return json(202, {}) } const s = states.get(id) || { status: 'pending' }; return json(200, s) }
      if (p === 'transcript') return json(200, { entries: [], active: null })
      return json(404, {})
    })
    const evidence = {}
    try {
      await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
      await page.waitForFunction(() => !document.querySelector('#send').disabled && !document.querySelector('#inbox-open').hidden, null, { timeout: 30000 })
      await body(env, evidence)
      results[device][name] = { pass: true, evidence }
    } catch (error) {
      const message = String(error.message || error); failures.push(`${device} ${name} ${message}`)
      results[device][name] = { pass: false, error: message, evidence, log }
      await page.screenshot({ path: `${out}/${device}-${name}-failure.png` }).catch(() => {})
    } finally { await ctx.close() }
  }

  // a: 応答待ち中の選択肢・自由文・通常発言が同じ FIFO に積まれ、正常終了後に 1 件ずつ、通知返信は返信 API へ送られる。
  await scenario('a-fifo-mixed', async (e, ev) => {
    await e.submit('最初'); await e.count(1)
    await e.select('one')
    await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click()
    await wait(async () => (await e.detail()).includes('送信待ち（未送信）'), 'queued detail')
    const d1 = await e.detail()
    assert(e.replies.length === 0, 'reply sent while busy')
    assert(!d1.includes('返信済み') && !d1.includes('・処理済み') && d1.includes('・既読'), `detail looks replied ${d1}`)
    assert(await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).count() === 0, 'choices still shown (duplicate possible)')
    await e.closeInbox()
    await e.submit('次の発言')
    await e.select('two')
    await e.page.locator('#inbox-detail textarea').fill('自由文の返信')
    await e.page.locator('#inbox-detail').getByRole('button', { name: '返信する' }).click()
    await wait(async () => (await e.detail()).includes('送信待ち（未送信）'), 'queued text detail')
    await e.closeInbox()
    const rows = await e.rows().allTextContents()
    assert(rows.length === 3 && rows[0].includes('通知「通知one」（BOXP-658）への選択: A') && rows[1].includes('次の発言') && rows[2].includes('通知「通知two」（BOXP-658）への返信: 自由文の返信'), `rows ${JSON.stringify(rows)}`)
    await e.screenshot('a-queued')
    ev.rows = rows; ev.detail = d1
    e.done(e.posts[0].requestId)
    await e.replyCount(1)
    assert(e.replies[0].id === 'event-658-one' && e.replies[0].kind === 'choice' && e.replies[0].value === 'A' && /^[0-9a-f-]{36}$/.test(e.replies[0].replyId), `reply1 ${JSON.stringify(e.replies[0])}`)
    await e.settle(); assert(e.posts.length === 1 && e.replies.length === 1, 'sent more than one while reply pending')
    const hist = await e.page.locator('#history-list').evaluate((el) => [...el.querySelectorAll('li')].map((li) => `${li.dataset.who}:${li.textContent}`))
    ev.history = hist
    assert(hist.some((h) => h.startsWith('あなた:') && h.includes('通知one') && h.includes('への選択: A')), `reply not followed in history ${JSON.stringify(hist)}`)
    e.done('request-event-658-one'); await e.count(2); assert(e.posts[1].text === '次の発言', 'second FIFO')
    e.done(e.posts[1].requestId); await e.replyCount(2)
    assert(e.replies[1].id === 'event-658-two' && e.replies[1].kind === 'text' && e.replies[1].value === '自由文の返信', 'reply2')
    e.done('request-event-658-two'); await e.settle()
    const order = e.log.filter((l) => !l.startsWith('poll:'))
    assert(order.join('|') === 'message:最初|reply:event-658-one:choice:A|message:次の発言|reply:event-658-two:text:自由文の返信', `order ${order.join('|')}`)
    assert(e.posts.every((p) => p.text !== 'A' && p.text !== '自由文の返信') && e.approvals.length === 0, 'reply sent as normal message or approval')
    ev.order = order
  })

  // b: 連打・同じ通知への重複は 1 件だけ。待機中の「A」は承認に使われない。取消で自由文は下書きへ戻る。
  await scenario('b-dup-approval-cancel', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    e.states.set(e.posts[0].requestId, { status: 'approval', approval: { approvalId: 'abc', summary: '確認', expiresAt: Date.now() + 60000 } })
    await e.page.locator('#approval').waitFor({ state: 'visible', timeout: 10000 })
    await e.select('one')
    await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).evaluate((b) => { for (let i = 0; i < 5; i++) b.click() })
    await e.page.waitForTimeout(300)
    assert(await e.rows().count() === 1, `duplicate rows ${await e.rows().count()}`)
    await e.select('two')
    await e.page.locator('#inbox-detail textarea').fill('OK')
    await e.page.locator('#inbox-detail').getByRole('button', { name: '返信する' }).click()
    await wait(async () => (await e.rows().count()) === 2, 'text queued')
    await e.settle()
    assert(e.approvals.length === 0 && e.replies.length === 0 && e.posts.length === 1, 'queued reply used for approval or sent')
    await e.page.locator('#inbox-detail').getByRole('button', { name: '取消' }).click()
    await wait(async () => (await e.page.locator('#inbox-detail textarea').count()) === 1, 'input back after cancel')
    const draft = await e.page.locator('#inbox-detail textarea').inputValue()
    assert(draft === 'OK' && await e.rows().count() === 1, `cancel draft=${draft}`)
    ev.draftAfterCancel = draft; ev.approvals = e.approvals.length
  })

  // i: 「すべて取消」でも通知への自由文の返信は、個別取消と同じくその通知の下書きへ戻る（本文を失わない）。
  await scenario('i-clear-all-restores-draft', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('two')
    await e.page.locator('#inbox-detail textarea').fill('一括取消でも残る返信')
    await e.page.locator('#inbox-detail').getByRole('button', { name: '返信する' }).click()
    await wait(async () => (await e.rows().count()) === 1, 'text queued')
    await e.closeInbox(); await e.submit('通常の後続'); await wait(async () => (await e.rows().count()) === 2, 'mixed queued')
    await e.page.locator('#queue-clear').click()
    await wait(async () => (await e.rows().count()) === 0, 'cleared')
    await e.select('two')
    await wait(async () => (await e.page.locator('#inbox-detail textarea').count()) === 1, 'input back after clear all')
    const draft = await e.page.locator('#inbox-detail textarea').inputValue()
    assert(draft === '一括取消でも残る返信' && e.replies.length === 0 && e.posts.length === 1, `clear-all draft=${draft}`)
    await e.screenshot('i-clear-all-draft')
    ev.draftAfterClearAll = draft
  })

  // c: 送る直前に通知状態を確かめ、別端末の先行返信（409 相当）・選択肢変更（400 相当）・通知消失（404 相当）では送らずに保留、取消で次へ進む。
  await scenario('c-stale-notice', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    for (const id of ['one', 'two', 'three']) { await e.select(id); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.detail()).includes('送信待ち'), `queued ${id}`) }
    await e.closeInbox()
    e.item('one').reply = { replyId: 'other-device-1', kind: 'choice', value: 'B', requestId: 'request-other', status: 'submitted' }
    e.item('two').choices = ['X', 'Y']
    e.items.splice(e.items.indexOf(e.item('three')), 1)
    e.done(e.posts[0].requestId)
    await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 15000 }); await e.settle()
    const s1 = await e.status(); assert(s1.includes('別の返信が先に') && e.replies.length === 0 && await e.rows().count() === 3, `409 hold ${s1}`)
    await e.screenshot('c-replied-hold')
    await e.rows().first().locator('button').click()
    await wait(async () => (await e.status()).includes('選択肢が変わり'), 'invalid hold'); const s2 = await e.status()
    await e.rows().first().locator('button').click()
    await wait(async () => (await e.status()).includes('見つからなく'), 'gone hold'); const s3 = await e.status()
    assert(e.replies.length === 0 && await e.rows().count() === 1, 'sent stale reply')
    ev.status = [s1, s2, s3]
  })

  // j: 送る直前の一覧で明示の choices が無く本文だけに選択肢がある通知でも、BFF と同じく本文の選択肢を有効とみなして送る（選択肢変更と誤判定しない）。
  await scenario('j-body-choices', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    delete e.item('one').choices
    e.done(e.posts[0].requestId)
    await e.replyCount(1)
    assert(e.replies[0].id === 'event-658-one' && e.replies[0].value === 'A', 'body choice reply target')
    await e.settle(); const s = await e.status()
    assert(!s.includes('選択肢が変わり'), `invalid hold ${s}`)
    ev.status = s; ev.reply = e.replies[0]
  })

  // d: 成否不明（502）・BFF busy（429）・認証切れ（401）は保留し、明示の再開で同じ replyId だけを再送する。後続の通常発言は自動送信しない。
  await scenario('d-unknown-busy-auth', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^B/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox(); await e.submit('後続')
    e.replyMode.set('event-658-one', 502)
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 }); await e.settle()
    const s1 = await e.status(); assert(s1.includes('同じ返信番号') && e.posts.length === 1 && e.replies.length === 1, `unknown hold ${s1}`)
    e.replyMode.set('event-658-one', 429)
    await e.page.locator('#queue-resume').click(); await e.replyCount(2); await e.settle()
    const s2 = await e.status(); assert(s2.includes('進行中') && e.posts.length === 1, `busy hold ${s2}`)
    e.replyMode.set('event-658-one', 401)
    await e.page.locator('#queue-resume').click(); await e.replyCount(3); await e.settle()
    const s3 = await e.status(); assert(s3.includes('認証') && e.posts.length === 1, `auth hold ${s3}`)
    const ids = new Set(e.replies.map((r) => r.replyId)); assert(ids.size === 1, 'replyId changed on resend')
    assert(await e.rows().count() === 2, 'queued items lost')
    const stored = await e.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    assert(!stored.includes('後続') && !stored.includes('通知「'), 'queued text persisted')
    ev.status = [s1, s2, s3]; ev.replyIds = [...ids]
  })

  // g: 返信 API の応答が失われても、受理済みなら送信済みとして扱う。成否不明の保留を取り消す時は受理を確かめ、受理済みなら取り消したと表示しない。
  await scenario('g-lost-response-cancel', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued one')
    await e.select('two'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 2, 'queued two')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 'lost')
    e.done(e.posts[0].requestId)
    await e.replyIds(1); await e.settle()
    const hist1 = await e.page.locator('#history-list').textContent()
    assert(!(await e.page.locator('#queue-resume').isVisible()) && !hist1.includes('確認できませんでした'), 'accepted reply was treated as unknown')
    e.done('request-event-658-one')
    await e.replyIds(2); e.done('request-event-658-two'); await e.settle()
    // 2 件目: 502（未受理）→ 成否不明で保留。その後サーバーへ遅れて届いた（受理済み）状態で「取消」→ 取り消せないと表示。
    e.replyMode.set('event-658-three', 502)
    await e.submit('実行2'); await e.count(2)
    await e.select('three'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^B/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued three')
    await e.closeInbox()
    e.done(e.posts[1].requestId)
    await e.replyIds(3); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    const last = e.replies[e.replies.length - 1]
    e.item('three').reply = { replyId: last.replyId, kind: last.kind, value: last.value, requestId: 'request-event-658-three', status: 'submitted' }
    e.states.set('request-event-658-three', { status: 'pending' })
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.page.locator('#history-list').textContent()).includes('取り消せませんでした'), 'accepted reply shown as cancelled')
    const hist2 = await e.page.locator('#history-list').textContent()
    assert(!/通知「通知three」.*を取り消しました（送っていません）/.test(hist2) && (await e.rows().count()) === 0 && e.distinct() === 3, 'cancel misreported')
    ev.history = hist2.split('\n').filter((l) => l.includes('通知')).slice(-4)
    await e.screenshot('g-lost-response-cancel')
  })

  // h: 一度送った通知返信（502 で成否不明）は、通知が未返信・受理途中に見えても取り消さない（先の要求が後から受理されうる）。
  //    「すべて取消」でも残す。同じ replyId が submit_failed の記録は同じ replyId の再送で実行されうるため、取消済みとは表示せず
  //    送信待ちから外して受信箱の記録へ委ねる（再送しない）。
  await scenario('h-attempted-cancel-failclosed', async (e, ev) => {
    e.replyMode.set('event-658-one', 502)
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued one')
    await e.closeInbox()
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    // 未返信に見える（none）→ 取り消さない
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.page.locator('#queue-note').textContent()).includes('取り消せません'), 'none refused')
    assert((await e.rows().count()) === 1, 'attempted reply removed while server shows none')
    // 受理途中（claimed）→「すべて取消」でも取り消さない
    const r = e.replies[0]
    e.item('one').reply = { replyId: r.replyId, kind: r.kind, value: r.value, requestId: 'request-event-658-one', status: 'claimed' }
    await e.page.locator('#queue-clear').click()
    await wait(async () => (await e.page.locator('#queue-note').textContent()).includes('取り消せません'), 'claimed refused')
    assert((await e.rows().count()) === 1, 'attempted reply removed while claimed')
    let hist = await e.page.locator('#history-list').textContent()
    assert(!/通知「通知one」.*を取り消しました/.test(hist), 'refused cancel reported as cancelled')
    // submit_failed（同じ replyId の再送で実行されうる）→ 送信待ちから外すが「取り消した」とは表示しない
    e.item('one').reply.status = 'submit_failed'
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.rows().count()) === 0, 'submit_failed not released')
    hist = await e.page.locator('#history-list').textContent()
    assert(hist.includes('取り消しにはなっていません') && !hist.includes('実行されないことを確認済み') && e.replies.length === 1, 'release after submit_failed')
    // 通知そのものが BFF から消えた（返信 API は not_found）→ 後から受理されないので取り消せる（送信待ちが詰まらない）。
    e.replyMode.set('event-658-two', 502)
    await e.submit('実行2'); await e.count(2)
    await e.select('two'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^B/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued two')
    await e.closeInbox()
    e.done(e.posts[1].requestId)
    await e.replyCount(2); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    e.items.splice(e.items.indexOf(e.item('two')), 1)
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.rows().count()) === 0, 'gone notice not cancellable')
    hist = await e.page.locator('#history-list').textContent()
    ev.history = hist.split('\n').filter((l) => l.includes('通知')).slice(-4)
    await e.screenshot('h-attempted-cancel-failclosed')
  })

  // l: 取消のための受理確認中は「再開」できず自動送信もしない（確認中に同じ replyId で再送・受理されて、古い確認結果で取り消されるのを防ぐ）。
  await scenario('l-cancel-check-locks-resume', async (e, ev) => {
    e.replyMode.set('event-658-one', 502)
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued one')
    await e.closeInbox()
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    const r = e.replies[0]
    e.item('one').reply = { replyId: r.replyId, kind: r.kind, value: r.value, requestId: 'request-event-658-one', status: 'submit_failed' }
    e.slow = 2500
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.page.locator('#queue-note').textContent()).includes('確認しています'), 'checking note')
    const disabled = await e.page.locator('#queue-resume').isDisabled()
    await e.page.locator('#queue-resume').click({ force: true }).catch(() => {})
    await e.page.waitForTimeout(500)
    assert(disabled && e.replies.length === 1, `resume during check: disabled=${disabled} replies=${e.replies.length}`)
    e.slow = 0
    await wait(async () => (await e.rows().count()) === 0, 'cancel after check')
    await e.settle()
    assert(e.replies.length === 1, 'reply resent after check')
    ev.resumeDisabledDuringCheck = disabled
    await e.screenshot('l-cancel-check-locks-resume')
  })

  // k: キューからの初回送信が BFF に 429 busy で断られた（claim 未保存）返信は「未送信」のまま。確認なしで取り消せ、不要な返信を送らずに先へ進める。
  await scenario('k-busy-first-cancel', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued one')
    await e.closeInbox(); await e.submit('後続')
    e.replyMode.set('event-658-one', 429)
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 }); await e.settle()
    assert((await e.status()).includes('進行中') && e.posts.length === 1, 'busy hold')
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.rows().count()) === 1, 'busy-rejected reply not cancellable')
    const hist = await e.page.locator('#history-list').textContent()
    assert(/通知「通知one」.*を取り消しました（送っていません）/.test(hist) && !(await e.page.locator('#queue-note').textContent()).includes('取り消せません'), `cancel note ${hist}`)
    await e.page.locator('#queue-resume').click(); await e.count(2)
    assert(e.posts[1].text === '後続' && e.replies.length === 1, 'queue did not advance or reply resent')
    ev.history = hist.split('\n').filter((l) => l.includes('通知')).slice(-3)
    await e.screenshot('k-busy-first-cancel')
  })

  // e: 吹き出しのお知らせから返信した時に、別端末の依頼が進行中で BFF が 429 busy を返したら、本文を失わず送信待ちへ積んで保留し、再開で同じ replyId を送る。
  //    （この画面で会話を始めると吹き出しの操作欄は閉じるので、画面内の応答待ち中は受信箱の詳細から積む: a〜d）。
  await scenario('e-bubble-busy', async (e, ev) => {
    await wait(async () => !(await e.page.locator('#notice-actions').isHidden()), 'bubble not announced', 20000)
    e.replyMode.set('event-658-bubble', 429)
    await e.page.locator('#notice-actions').getByRole('button', { name: /^A/ }).click()
    await wait(async () => (await e.rows().count()) === 1, 'bubble reply not queued after 429')
    const rows = await e.rows().allTextContents(), status = await e.status()
    assert(rows[0].includes('通知「通知bubble」（BOXP-658）への選択: A') && status.includes('進行中') && e.replies.length === 1, `bubble rows ${rows} ${status}`)
    await e.settle(); assert(e.replies.length === 1, 'auto resent after busy')
    await e.screenshot('e-bubble-queued')
    await e.page.locator('#queue-resume').click(); await e.replyCount(2)
    assert(e.replies[1].id === 'event-658-bubble' && e.replies[1].value === 'A' && e.replies[1].replyId === e.replies[0].replyId, 'bubble resend target/replyId')
    ev.rows = rows; ev.status = status; ev.replyIds = e.replies.map((r) => r.replyId)
  }, { items: [notice('bubble', 9, { readAt: undefined, announcedAt: undefined, receivedAt: new Date(Date.now() - 30000).toISOString() })] })

  // m: 送信待ちから取り出して送信中（一覧取得・返信 API の応答待ち）の最後の通知返信も、再読み込み前に確認を出す（queue は空でも結果未確定のため）。
  await scenario('m-reload-confirm-inflight', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 'hang')
    e.done(e.posts[0].requestId)
    await e.replyCount(1) // 送信待ちから取り出され、返信 API の応答待ち（キューは空・結果未確定）
    let unload = false
    e.page.once('dialog', async (d) => { unload = d.type() === 'beforeunload'; await d.dismiss() })
    await e.page.reload({ timeout: 3000 }).catch(() => {})
    assert(unload, 'reload during in-flight notice reply did not confirm')
    ev.unload = unload
  })

  // n: 成否不明で保留した返信が、再開時には同じ replyId で受理済み（submitted）になっていれば、選択肢が変わっていても受理済みとして追う（未送信の「選択肢変更」保留にしない・再送しない）。
  await scenario('n-resume-accepted-choices-changed', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 502)
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    const first = e.replies[0], it = e.item('one')
    it.reply = { replyId: first.replyId, kind: first.kind, value: first.value, requestId: 'request-event-658-one', status: 'submitted' }
    it.choices = ['X', 'Y']; it.body = '本文\nX) 別案\nY) 別案2'
    e.states.set('request-event-658-one', { status: 'pending' })
    await e.page.locator('#queue-resume').click()
    await wait(async () => (await e.rows().count()) === 0, 'accepted reply kept as unsent')
    await e.settle()
    const hist = await e.page.locator('#history-list').textContent()
    assert(e.distinct() === 1 && !(await e.page.locator('#queue-resume').isVisible()) && !hist.includes('選択肢が変わ'), `resume misjudged ${hist}`)
    ev.replies = e.replies.length
    await e.screenshot('n-resume-accepted')
  })

  // o: BFF が既存の claim への busy（busy_claimed）を返した返信は、受理済みの可能性があるため確認なしでは取り消さない（未返信に見えても取消を断る）。
  await scenario('o-busy-claimed-failclosed', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 'busy_claimed')
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.page.locator('#queue-note').textContent()).includes('取り消せません'), 'busy_claimed reply cancelled without check')
    const hist = await e.page.locator('#history-list').textContent()
    assert((await e.rows().count()) === 1 && !/通知「通知one」.*を取り消しました（送っていません）/.test(hist), 'cancelled claimed reply')
    ev.note = await e.page.locator('#queue-note').textContent()
    await e.screenshot('o-busy-claimed')
  })

  // p: 応答喪失後に通知は submitted だが、BFF の会話追跡が再起動などで受付番号を失っている（requests/{id} が 404）。
  //    「再開」で同じ replyId のまま返信 API へ送り、BFF が返した受付番号で応答を追える（新しい返信は作らない）。
  await scenario('p-resume-accepted-tracker-lost', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 502)
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    const first = e.replies[0], it = e.item('one')
    it.reply = { replyId: first.replyId, kind: first.kind, value: first.value, requestId: 'lost-tracker-one', status: 'submitted' }
    e.lostTrackers.add('lost-tracker-one')
    await e.page.locator('#queue-resume').click()
    await e.replyCount(2)
    await wait(() => e.log.includes('poll:request-event-658-one'), 'did not follow the re-attached request id')
    e.states.set('request-event-658-one', { status: 'done', reply: { text: '了解しました。' } })
    await wait(async () => (await e.page.locator('#history-list').textContent()).includes('了解しました。'), 'reply answer not shown')
    assert(e.distinct() === 1 && e.replies.every((x) => x.replyId === first.replyId) && (await e.rows().count()) === 0 && !e.log.includes('poll:lost-tracker-one'), `tracker lost misjudged ${e.log.join(',')}`)
    ev.replies = e.replies.length; ev.polls = e.log.filter((l) => l.startsWith('poll:'))
    await e.screenshot('p-resume-tracker-lost')
  })

  // r: 追跡を失った受理済み返信を再開したとき、BFF が別 run の進行中で追跡を作り直せず tracking: unavailable を返したら、
  //    受付成功として外さず（存在しない受付番号を追わない）送信待ちに残して保留し、次の「再開」で同じ replyId のまま追跡を作り直す。
  await scenario('r-resume-tracking-unavailable', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    e.replyMode.set('event-658-one', 502)
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    const first = e.replies[0], it = e.item('one')
    it.reply = { replyId: first.replyId, kind: first.kind, value: first.value, requestId: 'lost-tracker-one', status: 'submitted' }
    e.lostTrackers.add('lost-tracker-one')
    e.replyMode.set('event-658-one', 'unavailable')
    await e.page.locator('#queue-resume').click()
    await e.replyCount(2)
    await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    await e.settle()
    const hist = await e.page.locator('#history-list').textContent()
    assert((await e.rows().count()) === 1 && !e.log.includes('poll:lost-tracker-one') && /受け付けられている可能性があります/.test(hist) && !/通知「通知one」.*は送っていません/.test(hist), `unavailable treated as accepted ${e.log.join(',')} ${hist}`)
    ev.heldNote = hist.slice(-200)
    await e.screenshot('r-tracking-unavailable-held')
    await e.page.locator('#queue-resume').click()
    await e.replyCount(3)
    await wait(() => e.log.includes('poll:request-event-658-one'), 'did not follow after re-attach')
    e.states.set('request-event-658-one', { status: 'done', reply: { text: '了解しました。' } })
    await wait(async () => (await e.page.locator('#history-list').textContent()).includes('了解しました。'), 'reply answer not shown')
    assert(e.distinct() === 1 && e.replies.every((x) => x.replyId === first.replyId) && (await e.rows().count()) === 0, 'resume after unavailable misjudged')
    ev.replies = e.replies.length
  })

  // s: 返信 API が既存返信の確認期限切れ（tracking: expired）を返したら、受付成功として存在しない受付番号を追わず、
  //    送信待ちから外して「確認できない」と案内し、後続の通常発言は自動送信せず保留する（明示の再開で送る）。
  await scenario('s-tracking-expired', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    await e.closeInbox()
    await e.submit('その次'); await wait(async () => (await e.rows().count()) === 2, 'text queued')
    e.replyMode.set('event-658-one', 'expired')
    e.done(e.posts[0].requestId)
    await e.replyCount(1); await e.page.locator('#queue-resume').waitFor({ state: 'visible', timeout: 10000 })
    await e.settle()
    const hist = await e.page.locator('#history-list').textContent()
    assert(!e.log.includes('poll:request-event-658-one') && e.posts.length === 1 && (await e.rows().count()) === 1 && /確認期限（23時間）/.test(hist) && !/通知「通知one」.*を送りました/.test(hist), `expired treated as accepted ${e.log.join(',')} ${hist}`)
    ev.status = await e.status()
    await e.screenshot('s-tracking-expired-held')
    await e.page.locator('#queue-resume').click()
    await e.count(2)
    assert(e.posts[1].text === 'その次' && e.replies.length === 1, 'resume after expired misjudged')
  })

  // q: 受信箱に同じ replyId の claim（送信確認できず）が見えている通知で、会話中に「同じ返信を再送」すると送信待ちへ積まれるが、
  //    すでにサーバーへ送られ後から受理されうるため、取消で「送っていません」とせず確認なしでは取り消さない。
  await scenario('q-resend-claimed-queued-failclosed', async (e, ev) => {
    await e.page.evaluate(() => sessionStorage.setItem('kohako-reply-event-658-one', 'claimed-reply-one'))
    await e.submit('実行'); await e.count(1)
    await e.select('one')
    await e.page.locator('#inbox-detail').getByRole('button', { name: '同じ返信を再送' }).click()
    await wait(async () => (await e.rows().count()) === 1, 'resend not queued')
    await e.closeInbox()
    await e.rows().first().getByRole('button', { name: '送信待ち 1番目を取り消す' }).click()
    await wait(async () => (await e.page.locator('#queue-note').textContent()).includes('取り消せません'), 'claimed resend cancelled without check')
    const hist = await e.page.locator('#history-list').textContent()
    assert(e.replies.length === 0 && (await e.rows().count()) === 1 && !/通知「通知one」.*を取り消しました（送っていません）/.test(hist), `claimed resend misjudged ${hist}`)
    ev.note = await e.page.locator('#queue-note').textContent()
    await e.screenshot('q-resend-claimed')
  }, { items: [notice('one', 1, { reply: { replyId: 'claimed-reply-one', kind: 'choice', value: 'A', requestId: 'claimed-request-one', status: 'claimed' } }), notice('two', 2)] })

  // f: 再読み込み前の確認が通知返信にも効く。
  await scenario('f-reload-confirm', async (e, ev) => {
    await e.submit('実行'); await e.count(1)
    await e.select('one'); await e.page.locator('#inbox-detail').getByRole('button', { name: /^A/ }).click(); await wait(async () => (await e.rows().count()) === 1, 'queued')
    let unload = false
    e.page.once('dialog', async (d) => { unload = d.type() === 'beforeunload'; await d.accept() })
    await e.page.reload(); await e.page.waitForFunction(() => !document.querySelector('#send').disabled)
    assert(unload && e.replies.length === 0, 'reload did not confirm')
    ev.unload = unload
  })
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2)); process.exitCode = failures.length || external.length ? 1 : 0
