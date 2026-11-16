// BOXP-565: 同じ本人の 2 端末（storage を共有しない独立した browser context: PC と Pixel 7 縦）で、会話履歴・進行中の実行状態・
// 停止・承認が共有され、同じ会話の続きを話せること、二重実行しないこと、草稿や承認を勝手に送らないことを検証する。
// API は BFF の実コード（app.ts / conversation.ts をビルドしたもの）が応答し、Hermes だけをこのスクリプトが代役する。
// 使い方: (bff で) npx tsc -p tsconfig.json --outDir <dir>（<dir>/node_modules から bff/node_modules を解決できること）
//        → BFF_DIST=<dir> SITE=<site> node sync565.mjs <out>
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = process.argv[2] || '/out',
  site = process.env.SITE || '/site',
  port = Number(process.env.PORT || 8815)
const { createApp } = await import(pathToFileURL(path.resolve(process.env.BFF_DIST || '/bff-dist', 'app.js')).href)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }

/** Hermes の代役。run は検証側が finish するまで終わらない。stop・approve の回数を数える。 */
function backend() {
  const runs = [],
    stops = [],
    approvals = []
  const hermes = {
    run: (requestId, input, session, _instructions, onApproval, _retry, onRun) =>
      new Promise((resolve) => {
        const run = { requestId, input, session, resolve, onApproval, runId: `run-${runs.length + 1}`, ended: false }
        runs.push(run)
        onRun?.(run.runId)
      }),
    watch: () => new Promise(() => {}),
    stop: async (runId) => {
      stops.push(runId)
      const run = runs.find((r) => r.runId === runId)
      if (run && !run.ended) {
        run.ended = true
        run.resolve({ status: 'failed', error: 'stopped' })
      }
      return 'ok'
    },
    approve: async (runId, choice) => {
      approvals.push({ runId, choice })
      runs.find((r) => r.runId === runId)?.onApproval?.(runId, null)
      return 'ok'
    },
  }
  const app = createApp({ authenticate: async () => 'owner', hermes })
  return {
    app,
    runs,
    stops,
    approvals,
    finish: (i, text) => {
      runs[i].ended = true
      runs[i].resolve({ status: 'done', text })
    },
    ask: (i) =>
      runs[i].onApproval(runs[i].runId, { description: 'テスト操作', command: 'echo hi', choices: ['once', 'deny'], requestId: 'p1', generation: 1 }),
  }
}
let current = backend()
const server = http
  .createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (p === '/kohako/api/v1/status') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } }))
    }
    if (p.startsWith('/kohako/api/') || p === '/healthz') return current.app(req, res)
    fs.readFile(path.join(site, p), (err, data) => {
      if (err) {
        res.writeHead(404)
        return res.end()
      }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] })
const results = {},
  failures = []
const assert = (value, message) => {
  if (!value) throw new Error(message)
}
const wait = async (fn, message, timeout = 15000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timeout: ${message}`)
}
const SHAPES = { pc: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }, pixel7: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } }
/** 1 端末 = 独立した browser context（cookie・localStorage・sessionStorage を共有しない）。 */
async function device(name, shape, { transcript404 = false } = {}) {
  const ctx = await browser.newContext({ ...SHAPES[shape], serviceWorkers: 'block' }),
    page = await ctx.newPage()
  const d = { name, shape, ctx, page, posts: [], approvals: [], cancels: 0, external: [], errors: [] }
  page.on('pageerror', (e) => d.errors.push(String(e)))
  page.on('request', (q) => {
    const u = new URL(q.url())
    if (u.origin !== `http://localhost:${port}`) return d.external.push(u.origin)
    if (q.method() !== 'POST') return
    if (u.pathname.endsWith('/v1/messages')) d.posts.push(q.postDataJSON())
    else if (u.pathname.endsWith('/v1/approvals')) d.approvals.push(q.postDataJSON())
    else if (u.pathname.endsWith('/cancel')) d.cancels++
  })
  if (transcript404) await ctx.route('**/kohako/api/v1/conversation/transcript*', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }))
  d.open = async () => {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static`)
    await page.waitForFunction(() => document.querySelector('#connection')?.textContent?.startsWith('接続中'), null, { timeout: 30000 })
  }
  d.history = () => page.evaluate(() => [...document.querySelectorAll('#history-list li')].map((li) => ({ who: li.dataset.who, text: li.querySelector('.md')?.textContent ?? '' })))
  d.count = async (who, text) => (await d.history()).filter((x) => x.who === who && x.text.includes(text)).length
  d.has = (who, text) => async () => (await d.count(who, text)) >= 1
  d.submit = async (text) => {
    await page.locator('#message').fill(text)
    await page.locator('#send').click()
  }
  d.visible = (selector) => page.locator(selector).isVisible()
  d.state = () => page.locator('#state').textContent()
  d.shot = (label) => page.screenshot({ path: path.join(out, `${label}-${name}-${shape}.png`) })
  await d.open()
  return d
}
async function scenario(id, title, body) {
  current = backend()
  const devices = [],
    evidence = {}
  const open = async (...args) => {
    const d = await device(...args)
    devices.push(d)
    return d
  }
  try {
    await body(current, open, evidence)
    const errors = devices.flatMap((d) => d.errors),
      external = [...new Set(devices.flatMap((d) => d.external))]
    assert(!errors.length, `ページエラー ${JSON.stringify(errors)}`)
    assert(!external.length, `外部通信 ${JSON.stringify(external)}`)
    results[id] = { title, pass: true, evidence }
  } catch (error) {
    const message = String(error.message || error)
    failures.push(`${id} ${message}`)
    results[id] = { title, pass: false, error: message, evidence }
    for (const d of devices) await d.shot(`${id}-failure`).catch(() => {})
  } finally {
    for (const d of devices) await d.ctx.close()
  }
}

await scenario('a', '後から開いた別端末に、発言と返答の履歴が出る', async (be, open, ev) => {
  const A = await open('A', 'pc')
  await A.submit('こんにちは、端末Aです')
  await wait(() => be.runs.length === 1, 'A の依頼が Hermes へ届く')
  be.finish(0, 'はい、ご主人さま。Aへの返答です。')
  await wait(A.has('コハコ', 'Aへの返答です'), 'A に返答')
  const B = await open('B', 'pixel7')
  await wait(B.has('あなた', 'こんにちは、端末Aです'), 'B に A の発言')
  await wait(B.has('コハコ', 'Aへの返答です'), 'B に返答')
  ev.historyB = await B.history()
  ev.postsB = B.posts.length
  assert(B.posts.length === 0, 'B は何も送信していない')
  assert((await B.count('コハコ', 'Aへの返答です')) === 1, 'B の返答は 1 回だけ')
  // 初回の取り込みでは吹き出しを差し替えない（あいさつのまま）。
  ev.bubbleB = await B.page.locator('#reply').textContent()
  await A.shot('a')
  await B.shot('a')
})

await scenario('b', '進行中の依頼が別端末にも作業中として出て、返答は各端末 1 回だけ出る', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('時間のかかる依頼')
  await wait(() => be.runs.length === 1, '依頼が届く')
  await wait(B.has('あなた', '時間のかかる依頼'), 'B に進行中の発言')
  await wait(() => B.visible('#stop'), 'B に停止ボタン')
  ev.stateB = await B.state()
  await wait(B.has('お知らせ', '別の端末から送られた依頼の続きを追っています'), 'B が追跡を知らせる')
  await B.shot('b-running')
  be.finish(0, '終わりました、ご主人さま。')
  await wait(A.has('コハコ', '終わりました'), 'A に返答')
  await wait(B.has('コハコ', '終わりました'), 'B に返答')
  await new Promise((r) => setTimeout(r, 7000)) // 次の同期を挟んでも重複しない
  ev.replies = { A: await A.count('コハコ', '終わりました'), B: await B.count('コハコ', '終わりました') }
  ev.users = { A: await A.count('あなた', '時間のかかる依頼'), B: await B.count('あなた', '時間のかかる依頼') }
  assert(ev.replies.A === 1 && ev.replies.B === 1, `返答の重複 ${JSON.stringify(ev.replies)}`)
  assert(ev.users.A === 1 && ev.users.B === 1, `発言の重複 ${JSON.stringify(ev.users)}`)
  assert(B.posts.length === 0 && be.runs.length === 1, 'B は送信せず、実行は 1 回')
  ev.bubbleB = await B.page.locator('#reply').textContent()
  assert(ev.bubbleB.includes('終わりました'), 'B の吹き出しにも返答')
  await B.shot('b-done')
})

await scenario('c', '別端末から同じ会話の続きを話せる（同じ Hermes session・発言ごとに実行 1 回）', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('好きな色は青です')
  await wait(() => be.runs.length === 1, '1 件目')
  be.finish(0, '青ですね、覚えました。')
  await wait(B.has('コハコ', '青ですね'), 'B に 1 件目の返答')
  await B.submit('さっきの色は何でしたか')
  await wait(() => be.runs.length === 2, '2 件目が Hermes へ')
  await wait(A.has('あなた', 'さっきの色は何でしたか'), 'A に B の発言')
  await wait(() => A.visible('#stop'), 'A に停止ボタン（B の依頼を追跡）')
  be.finish(1, '青でした、ご主人さま。')
  await wait(A.has('コハコ', '青でした'), 'A に 2 件目の返答')
  await wait(B.has('コハコ', '青でした'), 'B に 2 件目の返答')
  ev.sessions = be.runs.map((r) => r.session)
  ev.posts = { A: A.posts.map((p) => p.text), B: B.posts.map((p) => p.text) }
  assert(ev.sessions[0] === ev.sessions[1], '同じ Hermes session で続きになる')
  assert(be.runs.length === 2 && A.posts.length === 1 && B.posts.length === 1, '発言ごとに送信 1 回')
  assert((await A.count('コハコ', '青でした')) === 1 && (await B.count('コハコ', '青でした')) === 1, '返答は 1 回ずつ')
  await A.shot('c')
  await B.shot('c')
})

await scenario('d', '同時送信しても二重実行せず、本文を失わず、勝手に再送しない', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  // d1: B がまだ A の依頼を知らないうちに送る → BFF が 429 で拒否、本文は入力欄へ戻り、B は A の依頼を追う。
  await A.submit('先に送った依頼')
  await wait(() => be.runs.length === 1, 'A の依頼')
  await B.submit('ほぼ同時の依頼')
  await wait(() => B.posts.length === 1, 'B が送信を試みる')
  await wait(() => B.visible('#stop'), 'B は A の依頼の追跡へ移る')
  ev.d1 = { runs: be.runs.length, composerB: await B.page.locator('#message').inputValue(), queueB: await B.page.locator('#queue-list li').allTextContents() }
  assert(be.runs.length === 1, '2 件目は実行されない')
  assert(ev.d1.composerB === 'ほぼ同時の依頼' || ev.d1.queueB.some((x) => x.includes('ほぼ同時の依頼')), 'B の本文が残る')
  // 同じ受付番号の再送は冪等（実行は増えない）。
  const again = await A.page.evaluate(async (payload) => (await fetch('/kohako/api/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, views: true }) })).status, A.posts[0])
  ev.d1.resendStatus = again
  assert(again === 202 && be.runs.length === 1, '同じ受付番号の再送で実行は増えない')
  be.finish(0, '先の依頼が終わりました。')
  await wait(B.has('コハコ', '先の依頼が終わりました'), 'B に返答')
  await new Promise((r) => setTimeout(r, 7000))
  ev.d1.afterRuns = be.runs.length
  ev.d1.composerAfter = await B.page.locator('#message').inputValue()
  if (ev.d1.composerB === 'ほぼ同時の依頼') {
    assert(be.runs.length === 1 && ev.d1.composerAfter === 'ほぼ同時の依頼', '入力欄へ戻った本文は自動で再送しない')
    await B.page.locator('#message').fill('')
  }
  await B.shot('d1')
  // d2: A の依頼を追跡中の B が書いた発言は送信待ちに積まれ、A の完了後に 1 回だけ送られる。
  const base = be.runs.length
  await A.submit('二つ目の依頼')
  await wait(() => be.runs.length === base + 1, '二つ目の依頼')
  await wait(() => B.visible('#stop'), 'B が追跡')
  const postsBefore = B.posts.length
  await B.submit('追跡中に書いた発言')
  await wait(async () => (await B.page.locator('#queue-list li').count()) === 1, 'B の送信待ちに積まれる')
  assert(B.posts.length === postsBefore && be.runs.length === base + 1, '進行中は送らない')
  await B.shot('d2-queued')
  be.finish(base, '二つ目が終わりました。')
  await wait(() => be.runs.length === base + 2, 'B の送信待ちが送られる')
  await wait(A.has('あなた', '追跡中に書いた発言'), 'A に B の発言')
  be.finish(base + 1, '三つ目が終わりました。')
  await wait(A.has('コハコ', '三つ目が終わりました'), 'A に返答')
  await wait(B.has('コハコ', '三つ目が終わりました'), 'B に返答')
  await new Promise((r) => setTimeout(r, 6000))
  ev.d2 = { runs: be.runs.map((r) => (typeof r.input === 'string' ? r.input : '')), postsB: B.posts.map((p) => p.text) }
  assert(be.runs.length === base + 2, '送信待ちは 1 回だけ送られる')
  assert(B.posts.filter((p) => p.text === '追跡中に書いた発言').length === 1, 'B の送信は 1 回')
})

await scenario('e', '承認待ちが両端末に出て、どちらも自動では答えず、片方の回答が 1 回だけ届く', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('確認が必要な依頼')
  await wait(() => be.runs.length === 1, '依頼')
  await wait(() => B.visible('#stop'), 'B が追跡')
  be.ask(0)
  await wait(() => A.visible('#approval'), 'A に承認')
  await wait(() => B.visible('#approval'), 'B に承認')
  ev.summaryB = await B.page.locator('#approval-summary').textContent()
  await new Promise((r) => setTimeout(r, 6000))
  assert(be.approvals.length === 0 && !A.approvals.length && !B.approvals.length, '自動では回答しない')
  await A.shot('e-approval')
  await B.shot('e-approval')
  const approvalId = await A.page.evaluate(async (id) => (await (await fetch(`/kohako/api/v1/requests/${id}`)).json()).approval?.approvalId, A.posts[0].requestId)
  await B.page.locator('#deny').click()
  await wait(() => be.approvals.length === 1, '拒否が届く')
  await wait(async () => !(await A.visible('#approval')), 'A の承認表示が消える')
  ev.screenApprovals = { A: A.approvals.length, B: B.approvals.map((x) => x.choice) }
  assert(A.approvals.length === 0 && B.approvals.length === 1, '画面から送られた回答は B の 1 回')
  // 古い承認を別の端末から別の選択で送っても通らない（この試験送信は検証側が A のページから直接送る）。
  const stale = await A.page.evaluate(async (body) => (await fetch('/kohako/api/v1/approvals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, { requestId: A.posts[0].requestId, approvalId, choice: 'once' })
  ev.staleStatus = stale
  ev.approvals = be.approvals
  assert(stale === 409 && be.approvals.length === 1 && be.approvals[0].choice === 'deny', '回答は拒否 1 回だけ')
  be.finish(0, '実行せずに終えました。')
  await wait(A.has('コハコ', '実行せずに終えました'), 'A に返答')
  await wait(B.has('コハコ', '実行せずに終えました'), 'B に返答')
})

await scenario('f', '別端末から停止でき、両端末が停止を表示する', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('止める依頼')
  await wait(() => be.runs.length === 1, '依頼')
  await wait(() => B.visible('#stop'), 'B に停止ボタン')
  await B.page.locator('#stop').click()
  await wait(() => be.stops.length >= 1, '停止が届く')
  await wait(A.has('お知らせ', '依頼を止めました'), 'A が停止を表示')
  await wait(B.has('お知らせ', '依頼を止めました'), 'B が停止を表示')
  await new Promise((r) => setTimeout(r, 6000))
  ev.stops = be.stops.length
  ev.cancels = { A: A.cancels, B: B.cancels }
  ev.notices = { A: (await A.history()).filter((x) => x.who === 'お知らせ').map((x) => x.text), B: (await B.history()).filter((x) => x.who === 'お知らせ').map((x) => x.text) }
  assert(be.stops.length === 1 && A.cancels === 0 && B.cancels === 1, '停止は 1 回')
  assert(!(await A.visible('#stop')) && !(await B.visible('#stop')), '両端末で作業中表示が終わる')
  assert(ev.notices.A.filter((x) => /止め/.test(x)).length === 1 && ev.notices.B.filter((x) => /止め/.test(x)).length === 1, '停止の知らせは 1 回ずつ')
  // 停止後も同じ会話で続けられる。
  await A.submit('停止後の続き')
  await wait(() => be.runs.length === 2, '続きの依頼')
  be.finish(1, '続けます。')
  await wait(B.has('コハコ', '続けます'), 'B に続きの返答')
  await A.shot('f')
  await B.shot('f')
})

await scenario('g', '未送信の草稿は共有も送信もされず、再読み込みで履歴が戻っても再送しない', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('履歴に残る発言')
  await wait(() => be.runs.length === 1, '依頼')
  be.finish(0, '履歴に残る返答。')
  await wait(B.has('コハコ', '履歴に残る返答'), 'B に返答')
  await A.page.locator('#message').fill('Aの下書き（未送信）')
  await new Promise((r) => setTimeout(r, 7000))
  ev.composerB = await B.page.locator('#message').inputValue()
  assert(ev.composerB === '' && (await B.count('あなた', 'Aの下書き')) === 0, '草稿は B に出ない')
  assert(be.runs.length === 1, '草稿は送信されない')
  await B.page.reload()
  await B.page.waitForFunction(() => document.querySelector('#connection')?.textContent?.startsWith('接続中'), null, { timeout: 30000 })
  await wait(B.has('あなた', '履歴に残る発言'), '再読み込み後の B に発言')
  await wait(B.has('コハコ', '履歴に残る返答'), '再読み込み後の B に返答')
  await new Promise((r) => setTimeout(r, 6000))
  ev.afterReload = { postsB: B.posts.length, runs: be.runs.length, replies: await B.count('コハコ', '履歴に残る返答') }
  assert(B.posts.length === 0 && be.runs.length === 1 && ev.afterReload.replies === 1, '再読み込みで再送・重複しない')
  // 送った端末 A を再読み込みしても同じ。
  await A.page.reload()
  await A.page.waitForFunction(() => document.querySelector('#connection')?.textContent?.startsWith('接続中'), null, { timeout: 30000 })
  await wait(A.has('コハコ', '履歴に残る返答'), '再読み込み後の A に返答')
  assert(A.posts.length === 1 && be.runs.length === 1, 'A の再読み込みでも再送しない')
  await B.shot('g')
})

await scenario('h', '進行中に再読み込みした端末も、再送せずに続きを追う', async (be, open, ev) => {
  const A = await open('A', 'pc'),
    B = await open('B', 'pixel7')
  await A.submit('再読み込みをまたぐ依頼')
  await wait(() => be.runs.length === 1, '依頼')
  await wait(() => B.visible('#stop'), 'B が追跡')
  await B.page.reload()
  await A.page.reload()
  for (const d of [A, B]) {
    await d.page.waitForFunction(() => document.querySelector('#connection')?.textContent?.startsWith('接続中'), null, { timeout: 30000 })
    await wait(() => d.visible('#stop'), `${d.name} が再読み込み後も追跡`)
  }
  be.finish(0, '再読み込み後の返答。')
  for (const d of [A, B]) await wait(d.has('コハコ', '再読み込み後の返答'), `${d.name} に返答`)
  await new Promise((r) => setTimeout(r, 6000))
  ev.counts = { A: [await A.count('あなた', '再読み込みをまたぐ依頼'), await A.count('コハコ', '再読み込み後の返答')], B: [await B.count('あなた', '再読み込みをまたぐ依頼'), await B.count('コハコ', '再読み込み後の返答')] }
  ev.runs = be.runs.length
  assert(be.runs.length === 1 && A.posts.length === 1 && B.posts.length === 0, '再送なし')
  assert(ev.counts.A.join() === '1,1' && ev.counts.B.join() === '1,1', `重複 ${JSON.stringify(ev.counts)}`)
})

await scenario('i', '履歴 API が無い古い BFF（404）でも、エラーを出さず従来どおり会話できる', async (be, open, ev) => {
  const A = await open('A', 'pc', { transcript404: true })
  await new Promise((r) => setTimeout(r, 6000))
  ev.errorBefore = await A.page.locator('#error').textContent()
  await A.submit('古いBFFでの発言')
  await wait(() => be.runs.length === 1, '依頼')
  be.finish(0, '古いBFFでの返答。')
  await wait(A.has('コハコ', '古いBFFでの返答'), '返答')
  ev.errorAfter = await A.page.locator('#error').textContent()
  assert(!ev.errorBefore && !ev.errorAfter, 'エラー表示なし')
  assert((await A.count('あなた', '古いBFFでの発言')) === 1 && (await A.count('コハコ', '古いBFFでの返答')) === 1, '発言と返答は 1 回ずつ')
})

await browser.close()
server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ pass: !failures.length, failures, results }, null, 1))
for (const [id, r] of Object.entries(results)) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${id} ${r.title}${r.pass ? '' : ` — ${r.error}`}`)
process.exit(failures.length ? 1 : 0)
