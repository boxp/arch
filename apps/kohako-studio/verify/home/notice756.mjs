// BOXP-756: 読み上げ ON/OFF で、家の画面の新着通知・会話の返答・通知返信の返答が読まれるか、
// 重ならないか・再読込で読み直さないか・止められるかを、BFF を完全にモックした実ブラウザで確かめる。
// 期待値は vault の Projects/kohako-home/notice-read-aloud-spec.md から取る。
// 前の案内は最大 20 秒（操作がなければ）押さえたままなので、次の案内までの待ちは長めに取る。
// usage: SITE=/site node notice756.mjs <outdir>（Playwright 1.56.1。外部通信はすべて遮断）
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8856)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
// 0.6 秒の無音 wav（合成音声の代わり）。
const wav = (() => { const rate = 8000, n = rate * 0.6, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b })()
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const t0 = Date.now(), T = () => Date.now() - t0
const items = [], tts = [], external = [], checks = {}, failures = [], errors = []
const replies = {}
let claimedBy = new Set()
const check = (name, ok, detail) => { checks[name] = ok ? 'PASS' : `FAIL${detail ? `: ${detail}` : ''}`; if (!ok) failures.push(name) }
await ctx.route(/^https?:\/\/(?!localhost)/, (route) => { external.push(route.request().url()); return route.abort() })
await ctx.route('**/kohako/api/v1/**', async (route) => {
  const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  if (p === 'me') return json(200, { authenticated: true })
  if (p === 'conversation') return json(200, { enabled: true, stt: false })
  if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
  if (p === 'tts' && req.method() === 'GET') return json(200, { available: true })
  if (p === 'tts') { tts.push({ at: T(), text: req.postDataJSON().text }); await new Promise((r) => setTimeout(r, 150)); return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }) }
  if (p === 'notifications') return json(200, { items, unread: items.filter((i) => !i.readAt).length })
  const m = /^notifications\/([^/]+)\/(read|handled|reply|announcing|announced)$/.exec(p)
  if (m) {
    const id = decodeURIComponent(m[1]), item = items.find((i) => i.eventId === id)
    if (m[2] === 'announcing') { const claimed = !item.announcedAt && !claimedBy.has(id); claimedBy.add(id); return json(200, { claimed }) }
    if (m[2] === 'announced') { item.announcedAt = new Date().toISOString(); return json(200, {}) }
    if (m[2] === 'read') { item.readAt = new Date().toISOString(); return json(200, {}) }
    if (m[2] === 'reply') { const body = req.postDataJSON(); item.reply = { ...body, requestId: 'r756-notice', status: 'submitted' }; replies['r756-notice'] = '承知しました。詳細は https://github.com/boxp/arch/pull/2 にまとめました。'; return json(200, item.reply) }
  }
  if (p === 'messages' && req.method() === 'POST') { const id = req.postDataJSON().requestId || 'r756-chat'; replies[id] = '今日の予定です。資料は [設計メモ](https://example.com/memo) と https://youtu.be/abc にあります。'; return json(202, { requestId: id, status: 'accepted' }) }
  const r = /^requests\/([^/]+)$/.exec(p)
  if (r && replies[r[1]]) return json(200, { requestId: r[1], status: 'done', reply: { text: replies[r[1]] } })
  return json(404, { error: 'not_found' })
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
const H = () => page.evaluate(() => ({ state: window.__kohakoHome.state, bubble: document.getElementById('reply').textContent, resume: !document.getElementById('resume-speech').hidden }))
const refresh = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
const waitState = (s, timeout = 40000) => page.waitForFunction((s) => window.__kohakoHome.state === s, s, { timeout })
const notify = (id, title, body) => { items.push({ eventId: `event-756-${id}`, source: 'hermes-cron', title, body, receivedAt: new Date().toISOString() }) }
const ttsText = (from) => tts.filter((x) => x.at >= from).map((x) => x.text).join('')
const open = async () => {
  await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
  await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
}
const setSpeech = (on) => page.evaluate((on) => { const s = document.getElementById('speech'); if (s.checked !== on) s.click() }, on)
try {
  await open()
  await setSpeech(true)
  // 1. ON: 新着通知の見出しと本文を読む。URL は読まない。
  let from = T()
  notify('a', '定期通知: 明日の予定', '10時に打合せがあります。資料は https://github.com/boxp/arch/pull/1 です。')
  await refresh()
  await waitState('speaking')
  await waitState('done')
  const a = ttsText(from)
  check('ON: 新着通知の見出しを読む', a.includes('定期通知: 明日の予定'), a)
  check('ON: 新着通知の本文を読む', a.includes('10時に打合せがあります。'), a)
  check('ON: URL を読まず「GitHub のリンク」と読む', !/https?:/.test(a) && a.includes('GitHub のリンク'), a)
  // 2. 読み上げ中に別の新着が届いても重ねない（読み終えてから次を案内して読む）。
  from = T()
  notify('b', '通知B', 'Bの本文です。'.repeat(6))
  await refresh()
  await waitState('speaking')
  const speakingB = T()
  notify('c', '通知C', 'Cの本文です。')
  await refresh()
  await page.waitForTimeout(2500)
  const duringB = await H()
  check('読み上げ中は次の新着を案内しない', !duringB.bubble.includes('通知C') && !ttsText(speakingB).includes('通知C'), JSON.stringify(duringB))
  await waitState('done', 30000)
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('通知C'), null, { timeout: 40000 })
  await waitState('done', 30000)
  const bTts = tts.filter((x) => x.at >= from && x.text.includes('B')), cTts = tts.filter((x) => x.at >= from && x.text.includes('通知C'))
  check('次の新着は前の読み上げの後に読む', cTts.length > 0 && cTts[0].at > Math.max(...bTts.map((x) => x.at)), JSON.stringify({ b: bTts.map((x) => x.at), c: cTts.map((x) => x.at) }))
  // 3. 再読込で案内済みの通知を読み直さない。
  from = T()
  await open()
  await setSpeech(true)
  await refresh()
  await page.waitForTimeout(4000)
  check('再読込で案内済みの通知を読み直さない', tts.filter((x) => x.at >= from).length === 0 && !(await H()).bubble.includes('お知らせが届いています'), JSON.stringify(tts.filter((x) => x.at >= from)))
  // 4. 止める: 読み上げ中の通知を「止める」で止め、続きを勝手に読まない。
  notify('d', '通知D', 'Dの本文です。'.repeat(10))
  await refresh()
  await waitState('speaking')
  await page.click('#hush')
  const stoppedAt = T()
  await page.waitForTimeout(2500)
  const afterHush = await H()
  check('止めると読み上げが終わり、勝手に再開しない', afterHush.state === 'done' && tts.filter((x) => x.at > stoppedAt + 300).length === 0, JSON.stringify({ afterHush, later: tts.filter((x) => x.at > stoppedAt + 300) }))
  check('止めた後は「続きから読む」を出す', afterHush.resume)
  // 4b. 「続きから読む」が出ている間の新着通知は表示だけ。
  from = T()
  notify('e', '通知E', 'Eの本文です。')
  await refresh()
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('通知E'), null, { timeout: 40000 })
  await page.waitForTimeout(1500)
  check('続きから読むが出ている間の新着は表示だけ', ttsText(from) === '', ttsText(from))
  // 5. OFF: 新着通知は表示するが読まない。
  await setSpeech(false)
  from = T()
  notify('f', '通知F', 'Fの本文です。')
  await refresh()
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('通知F'), null, { timeout: 40000 })
  await page.waitForTimeout(1500)
  check('OFF: 新着通知を表示し、読まない', ttsText(from) === '', ttsText(from))
  // 6. 会話の返答: ON で本文を読み、URL はラベル・サイト名で読む。
  await setSpeech(true)
  await page.evaluate(() => { const b = document.getElementById('notice-actions'); b.hidden = true })
  from = T()
  await page.fill('#message', '今日の予定は？')
  await page.click('#send')
  await waitState('speaking')
  await waitState('done', 30000)
  const chat = ttsText(from)
  check('会話の返答の本文を読む', chat.includes('今日の予定です。'), chat)
  check('会話の返答の URL はラベルとサイト名で読む', chat.includes('設計メモ') && chat.includes('YouTube のリンク') && !/https?:/.test(chat), chat)
  // 7. 通知への返信に対する返答: 返信して追った返答の本文を読む。
  from = T()
  notify('g', '通知G', 'どうしますか？\nA. 進める\nB. 止める')
  items.at(-1).choices = ['A', 'B']
  await refresh()
  await page.waitForFunction(() => !document.getElementById('notice-actions').hidden && document.getElementById('reply').textContent.includes('通知G'), null, { timeout: 40000 })
  await waitState('done', 30000)
  const replyFrom = T()
  await page.locator('#notice-actions button').first().click()
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('承知しました'), null, { timeout: 20000 })
  await waitState('done', 30000)
  const nr = ttsText(replyFrom)
  check('通知返信の返答の本文を読む', nr.includes('承知しました。') && nr.includes('GitHub のリンク') && !/https?:/.test(nr), nr)
  // 8. OFF のとき会話の返答は読まない。
  await setSpeech(false)
  from = T()
  await page.fill('#message', 'もう一度')
  await page.click('#send')
  await page.waitForFunction(() => document.getElementById('reply').textContent.includes('今日の予定です'), null, { timeout: 20000 })
  await page.waitForTimeout(1500)
  check('OFF: 会話の返答は読まない', ttsText(from) === '', ttsText(from))
  await page.screenshot({ path: path.join(out, 'notice756.png') })
} catch (e) {
  failures.push(`exception: ${e.message}`)
  await page.screenshot({ path: path.join(out, 'notice756-error.png') }).catch(() => {})
}
check('外部通信 0 件', external.length === 0, external.join(','))
check('ページのエラー 0 件', errors.length === 0, errors.join(' | '))
const result = { checks, failures, tts }
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1))
console.log(JSON.stringify({ checks, failures }, null, 1))
await browser.close(); server.close()
process.exit(failures.length ? 1 : 0)
