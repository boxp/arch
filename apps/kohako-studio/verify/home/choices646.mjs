// BOXP-646: 会話の返答・家の通知（吹き出し）・受信箱で、選択肢が同じ規則のボタンになり、自由文も送れることを実ブラウザで検証する。
// BFF は完全にモック（外部通信なし）。SITE に build 済みの dist を /kohako として置いた親ディレクトリを渡す。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out',
  site = process.env.SITE || '/site',
  port = Number(process.env.PORT || 8846)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const server = http
  .createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    fs.readFile(path.join(site, p), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data)
    })
  })
  .listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const assert = (value, message) => { if (!value) throw new Error(message) }
const wait = async (fn, message, timeout = 12000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error(message)
}
// BOXP-644 で実際に届いた 1 行併記の書き方（従来はボタンにならなかった）。
const NOTICE_644 = 'ご主人さま、監修完了の報告です。\n\n次の一判断は、修正文案を実装へ進めるかです。\n\n**A：このおすすめで実装へ進む／B：監修結果を見てから決める**'
const NOTICE_STEPS = '次の操作をお試しください。\n1. 画面下の「→」を押します。\n2. 「Enter」を押して確定します。\n成功したか教えてください。'
const NOTICE_588 = '次はどれにしますか？\n- **A（推奨）：段階実装** — まず条件を項目化\n- **B：項目化まで**\n- **C：入力削減は見送り**'
const CHAT_CHOICES = '進め方は二通りあります。どちらにしますか？\n1. **いま更新する（おすすめ）**\n2. 来週まで待つ'
const CHAT_STEPS = '手順です。\n1. 設定を開く\n2. 保存する'

for (const [device, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const checks = (results[device] = {})
  const check = (name, ok, evidence) => { checks[name] = { pass: !!ok, ...(evidence === undefined ? {} : { evidence: structuredClone(evidence) }) }; if (!ok) failures.push(`${device}: ${name}`) }
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }),
    page = await ctx.newPage()
  const posts = [], replies = [], approvals = [], states = new Map()
  const now = Date.now()
  // 受信箱: 選択肢は BFF が本文から補完した記号（A/B…）で届く。手順の番号付きは選択肢なし。
  const items = [
    { eventId: 'event-646-steps.report', source: 'task-board-report', eventType: 'blocked', ticketId: 'BOXP-634', title: '手順の通知', body: NOTICE_STEPS, receivedAt: new Date(now - 300000).toISOString(), readAt: new Date(now).toISOString() },
    { eventId: 'event-646-588.report', source: 'task-board-report', eventType: 'blocked', ticketId: 'BOXP-588', title: '三択の通知', body: NOTICE_588, choices: ['A', 'B', 'C'], receivedAt: new Date(now - 200000).toISOString(), readAt: new Date(now).toISOString() },
    { eventId: 'event-646-644.report', source: 'task-board-report', eventType: 'done', ticketId: 'BOXP-644', title: '監修完了', body: NOTICE_644, choices: ['A', 'B'], receivedAt: new Date(now - 1000).toISOString() },
  ]
  page.on('request', (req) => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
  await page.route('**/kohako/api/v1/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1]
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items, unread: items.filter((i) => !i.readAt).length })
    const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
    if (m) {
      const item = items.find((i) => i.eventId === decodeURIComponent(m[1]))
      if (m[2] === 'reply') {
        const body = req.postDataJSON(); replies.push({ id: item.eventId, ...body })
        await new Promise((r) => setTimeout(r, 300))
        item.reply = { ...body, requestId: `request-${item.eventId}`, status: 'submitted' }
        // 返信で始まった会話はすぐ終わらせる（後続の会話検証を待たせない）
        states.set(item.reply.requestId, { status: 'done', reply: { text: '承知しました。' } })
        return json(200, item.reply)
      }
      if (m[2] === 'read') item.readAt = new Date().toISOString()
      if (m[2] === 'announced') item.announcedAt = new Date().toISOString()
      return json(200, { claimed: m[2] === 'announcing' })
    }
    if (p === 'messages') { const data = req.postDataJSON(); posts.push(data); states.set(data.requestId, { status: 'pending' }); return json(202, { status: 'accepted' }) }
    if (p === 'approvals') { approvals.push(req.postDataJSON()); return json(202, {}) }
    const r = p.match(/^requests\/([^/]+)$/)
    if (r) return json(200, states.get(decodeURIComponent(r[1])) || { status: 'pending' })
    return json(404, {})
  })
  const done = (i, text) => states.set(posts[i].requestId, { status: 'done', reply: { text } })
  const idle = () => wait(() => page.evaluate(() => ['done', 'idle'].includes(window.__kohakoHome?.state)), 'not idle', 20000)
  const choiceButtons = () => page.locator('#reply-choices:not([hidden]) button')
  const send = async (text) => { await page.locator('#message').fill(text); await page.locator('#send').click() }
  const inViewport = (loc) => loc.evaluateAll((els, vw) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= vw + 1 && r.width > 0 }), viewport.width)
  // 実際に見えて押せるか（画面内で、中心点が他の要素に覆われていない）。
  const reachable = (loc) => loc.evaluateAll((els) => els.length > 0 && els.every((e) => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return r.width > 0 && y >= 0 && y <= innerHeight && x >= 0 && x <= innerWidth && e.contains(document.elementFromPoint(x, y)) }))
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })

    // 1. 家の通知（吹き出し）: 1 行併記の選択肢がボタンになり、自由文欄も並ぶ（BOXP-568 の受信箱と同じ形）。
    await page.locator('#notice-actions:not([hidden])').waitFor({ timeout: 20000 })
    const noticeButtons = await page.locator('#notice-actions button').allTextContents()
    check('通知吹き出し: 選択肢ボタン（説明付き）', noticeButtons.includes('A：このおすすめで実装へ進む') && noticeButtons.includes('B：監修結果を見てから決める'), noticeButtons)
    check('通知吹き出し: 自由文欄も併設', (await page.locator('#notice-actions textarea').count()) === 1 && noticeButtons.includes('返信する'))
    check('通知吹き出し: ボタンが画面内で押せる', (await inViewport(page.locator('#notice-actions button'))) && (await reachable(page.locator('#notice-actions button', { hasText: 'A：' }))))
    await page.screenshot({ path: path.join(out, `${device}-notice.png`) })
    await page.locator('#notice-actions button', { hasText: 'A：このおすすめで実装へ進む' }).dblclick()
    await page.waitForTimeout(800)
    check('通知吹き出し: 選択は記号 A を一度だけ送信（元 event 付き）', replies.length === 1 && replies[0].id === 'event-646-644.report' && replies[0].kind === 'choice' && replies[0].value === 'A', replies)
    await idle().catch(() => {})

    // 2. 受信箱: 選択肢のある通知は説明付きボタン＋自由文、手順の番号付きはボタンなし＋自由文。
    await page.locator('#inbox-open').click()
    const select = async (title) => { await page.locator('#inbox-list .inbox-row').filter({ hasText: title }).click(); await page.waitForFunction((t) => document.querySelector('#inbox-detail .detail-title')?.textContent === t, title) }
    await select('三択の通知')
    const inboxButtons = await page.locator('#inbox-detail button').allTextContents()
    check('受信箱: 三択が説明付きボタン', ['A：（推奨）段階実装 — まず条件を項目化', 'B：項目化まで', 'C：入力削減は見送り'].every((t) => inboxButtons.includes(t)), inboxButtons)
    check('受信箱: 自由文欄も併設', (await page.locator('#inbox-detail textarea').count()) === 1)
    check('受信箱: ボタンが画面内で押せる', (await inViewport(page.locator('#inbox-detail button'))) && (await reachable(page.locator('#inbox-detail button', { hasText: 'A：' }))))
    await page.screenshot({ path: path.join(out, `${device}-inbox.png`) })
    await select('手順の通知')
    const stepButtons = await page.locator('#inbox-detail button').allTextContents()
    check('受信箱: 手順の番号はボタンにしない', !stepButtons.some((t) => /^[12]：/.test(t)) && (await page.locator('#inbox-detail textarea').count()) === 1, stepButtons)
    await page.locator('#inbox-detail textarea').fill('成功しました')
    await page.locator('#inbox-detail button', { hasText: '返信する' }).click()
    await page.waitForTimeout(700)
    check('受信箱: 自由文は text で送信', replies.some((r) => r.id === 'event-646-steps.report' && r.kind === 'text' && r.value === '成功しました'), replies)
    if (await page.locator('#inbox').isVisible()) await page.locator('#inbox-close').click().catch(() => {})
    await idle().catch(() => {})

    // 3. 会話: 選択を求める返答の下に選択肢ボタン。押すと「1：説明」を通常の発言として一度だけ送り、下書きは消さない。
    const base = posts.length
    await send('更新について相談'); await wait(() => posts.length === base + 1, 'chat post')
    done(base, CHAT_CHOICES)
    await choiceButtons().first().waitFor({ timeout: 15000 })
    const chatButtons = await choiceButtons().allTextContents()
    check('会話: 返答の選択肢がボタンになる', chatButtons.length === 2 && chatButtons[0] === '1：いま更新する（おすすめ）' && chatButtons[1] === '2：来週まで待つ', chatButtons)
    await page.waitForTimeout(600)
    check('会話: ボタンが画面内で押せる（覆われていない）', await inViewport(choiceButtons()) && (await reachable(choiceButtons())))
    await page.screenshot({ path: path.join(out, `${device}-chat.png`) })
    await page.locator('#message').fill('下書き')
    await choiceButtons().first().evaluate((b) => { b.click(); b.click(); b.click() })
    await wait(() => posts.length === base + 2, 'choice post', 20000)
    await page.waitForTimeout(2200)
    check('会話: 選択は通常の発言として一度だけ送信', posts.length === base + 2 && posts[base + 1].text === '1：いま更新する（おすすめ）', posts.map((p) => p.text))
    check('会話: 入力欄の下書きを保持', (await page.locator('#message').inputValue()) === '下書き')
    check('会話: 送信後はボタンを閉じる', (await choiceButtons().count()) === 0)
    check('会話: 承認 API は呼ばない', approvals.length === 0)
    done(base + 1, 'わかりました。いま更新しますね。')
    await idle()
    check('会話: 選択肢のない返答にはボタンなし', (await choiceButtons().count()) === 0)

    // 4. 会話: 手順の番号付きはボタンにしない。前の返答のボタンは次の発言で閉じ、別の依頼へ結び付けない。
    await page.locator('#message').fill('')
    await send('手順を教えて'); await wait(() => posts.length === base + 3, 'steps post')
    done(base + 2, CHAT_STEPS); await idle()
    check('会話: 手順の番号はボタンにしない', (await choiceButtons().count()) === 0)
    await send('もう一度相談'); await wait(() => posts.length === base + 4, 'second post')
    done(base + 3, CHAT_CHOICES); await choiceButtons().first().waitFor({ timeout: 15000 })
    const stale = choiceButtons().first()
    await send('自由文で答えます'); await wait(() => posts.length === base + 5, 'free text post')
    check('会話: 自由文で答えるとボタンは閉じ、選択は送らない', (await choiceButtons().count()) === 0 && posts[base + 4].text === '自由文で答えます', posts.map((p) => p.text))
    await stale.evaluate((b) => b.click()).catch(() => {})
    await page.waitForTimeout(1500)
    check('会話: 閉じた古いボタンからは送信しない', posts.length === base + 5, posts.map((p) => p.text))
    done(base + 4, 'はい。'); await idle()

    // 5. くつろぎ（返答から約 60 秒）に入っても、未回答の選択肢ボタンは見えて押せる。
    await send('最後の相談'); await wait(() => posts.length === base + 6, 'last post')
    done(base + 5, CHAT_CHOICES); await choiceButtons().first().waitFor({ timeout: 15000 })
    // 箇条書きの返答は結果カードも開く（場面が show のまま）ので、閉じてからくつろぎを待つ。
    if (await page.locator('#cards-close').isVisible()) await page.locator('#cards-close').click()
    await wait(() => page.evaluate(() => document.body.dataset.scene === 'relax'), 'relax not reached', 90000)
    await page.waitForTimeout(800)
    check('くつろぎ中も選択肢ボタンが見えて押せる', (await reachable(choiceButtons())) && (await page.evaluate(() => getComputedStyle(document.getElementById('bubble')).opacity === '1')))
    await page.screenshot({ path: path.join(out, `${device}-relax.png`) })
    await choiceButtons().nth(1).click(); await wait(() => posts.length === base + 7, 'relax choice post')
    check('くつろぎ中の選択も通常の発言で送信', posts[base + 6].text === '2：来週まで待つ', posts.map((p) => p.text))
  } catch (e) {
    checks.exception = { pass: false, evidence: e.message }; failures.push(`${device}: ${e.message}`)
    await page.screenshot({ path: path.join(out, `${device}-failure.png`) }).catch(() => {})
  }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2)); process.exitCode = failures.length || external.length ? 1 : 0
