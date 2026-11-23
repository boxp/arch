// BOXP-677: PDF 添付 30 MiB と失敗の表示を、本物の nginx（配備イメージの nginx.conf と web build）と本物の BFF コード
// （bff/dist の createApp・添付・会話。認証と Hermes だけ置き換え）で PC / Pixel 7 相当について確かめる。
// 30 MiB ちょうどの PDF が届いて本文を読めること、上限超え・形式・本文なし・壊れ・一部読取・BFF 停止・通信断が
// 入力欄の上に日本語で次の手順付きで出ること、一部読取が Hermes に「読んだ範囲だけ」と伝わることを検査し、画像を残す。
// 使い方は docs/attach677.md。失敗時は終了コード 1。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const out = process.argv[2] || '/out'
const base = process.env.BASE || 'http://127.0.0.1:8080/kohako/home.html'
const bffPort = Number(process.env.BFF_PORT || 8788)
const dist = path.resolve(process.env.BFF_DIST || new URL('../../bff/dist', import.meta.url).pathname)
fs.mkdirSync(out, { recursive: true })
const MIB = 1024 * 1024

const { createApp } = await import(path.join(dist, 'app.js'))
const { createConversation } = await import(path.join(dist, 'conversation.js'))
const { createAttachments } = await import(path.join(dist, 'attachments.js'))
const runs = []
const hermes = {
  run: async (...args) => {
    runs.push(args)
    return { status: 'done', text: '添付を読みました。' }
  },
  stop: async () => 'ok',
  approve: async () => 'ok',
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kohako-677-'))
let server
// 会話と添付の保存は再起動をまたいで同じものを使う（配備の BFF もデータディレクトリに保存して引き継ぐ）。
const app = createApp({
  authenticate: async () => 'owner',
  conversations: {
    owner: createConversation({ now: Date.now, hermes, prefix: 'kohako-web' }),
    verifier: createConversation({ now: Date.now, hermes, prefix: 'kohako-verify' }),
  },
  attachments: createAttachments(dataDir),
})
const startBff = () =>
  new Promise((resolve) => {
    server = http.createServer(app)
    server.listen(bffPort, '127.0.0.1', resolve)
  })
await startBff()

/** ページ数・本文・末尾の詰め物でサイズを指定した合成 PDF（bff/src/attachments-large.test.ts と同じ作り）。 */
function pdf(pages, padTo = 0, text = true) {
  const parts = [], offsets = []
  let len = 0
  const push = (b) => { parts.push(b); len += b.length }
  push(Buffer.from('%PDF-1.4\n'))
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  for (let p = 1; p <= pages; p++) {
    const s = text ? `BT /F1 10 Tf 20 700 Td (page ${p} ID-677) Tj ET` : ''
    objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (p - 1) * 2} 0 R >>`), Buffer.from(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`))
  }
  objs.forEach((o, i) => { offsets.push(len); push(Buffer.from(`${i + 1} 0 obj\n`)); push(o); push(Buffer.from('\nendobj\n')) })
  const xref = len
  push(Buffer.from(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  const body = Buffer.concat(parts)
  if (padTo <= body.length) return body
  const pad = Buffer.alloc(padTo - body.length, 0x20)
  pad[0] = 0x25
  pad[pad.length - 1] = 0x0a
  return Buffer.concat([body, pad])
}
const file = (name, buffer, mimeType = 'application/pdf') => ({ name, mimeType, buffer })
const files = {
  max: file('max-30MiB.pdf', pdf(3, 30 * MIB)),
  over: file('over-30MiB.pdf', pdf(1, 30 * MIB + 1)),
  pages: file('pages-31.pdf', pdf(31)),
  scan: file('scan.pdf', pdf(1, 0, false)),
  broken: file('broken.pdf', Buffer.from('%PDF-1.4\nbroken')),
  exe: file('tool.exe', Buffer.from('MZ'), 'application/octet-stream'),
  small: file('small.pdf', pdf(2)),
}

// 中継（nginx）の上限: 画面の検査を迂回して送った場合も JSON の理由が返ること。
const direct = async (bytes) => {
  const r = await fetch(new URL('api/v1/attachments', base), { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-kohako-filename': 'direct.pdf', 'x-kohako-request': '1' }, body: pdf(1, bytes) })
  return { status: r.status, body: await r.text() }
}
const results = { direct: { at30: await direct(30 * MIB), over30: await direct(30 * MIB + 1), over31: await direct(31 * MIB + 1) } }
const failures = []
if (results.direct.at30.status !== 201) failures.push(`direct 30MiB ${JSON.stringify(results.direct.at30)}`)
for (const k of ['over30', 'over31']) if (results.direct[k].status !== 413 || !results.direct[k].body.includes('too_large')) failures.push(`direct ${k} ${JSON.stringify(results.direct[k])}`)

const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const r = (results[device] = {})
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage()
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort())
  const check = (v, m) => { if (!v) failures.push(`${device}: ${m}`) }
  const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${device}-${name}.png` }) }
  const note = () => page.evaluate(() => { const e = document.getElementById('attachment-note'); return e && !e.hidden && e.checkVisibility() ? e.textContent : '' })
  const inside = (id) => page.evaluate((i) => { const e = document.getElementById(i); if (!e || !e.checkVisibility()) return false; const b = e.getBoundingClientRect(); return b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 }, id)
  const chips = () => page.locator('#attachment-chips').textContent()
  const add = async (f, wait = 'text') => { await page.setInputFiles('#attachment-file', [f]); await page.waitForFunction((w) => !document.getElementById('attachment-chips').textContent.includes('アップロード中') && (w !== 'note' || !document.getElementById('attachment-note').hidden), wait, { timeout: 60000 }) }
  const clear = async () => { while (await page.locator('#attachment-chips button').count()) await page.locator('#attachment-chips button').first().click() }
  try {
    await page.goto(`${base}?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    // 30 MiB ちょうど: 送れて本文を読める（成功と本文読取済を区別して表示）
    const t0 = Date.now()
    await add(files.max)
    r.maxMs = Date.now() - t0
    r.maxChip = await chips(); check(/本文読取済（3ページ）/.test(r.maxChip), `30MiB chip ${r.maxChip}`); check(/30\.0 MiB/.test(r.maxChip), `30MiB size shown ${r.maxChip}`)
    check(!(await note()), 'no note for full read'); await shot('max-30MiB'); await clear()
    // 30 MiB + 1 バイト: 画面で止め、サイズとバイト数と次の手順を出す
    await add(files.over, 'note'); r.over = await note(); check(/30 MiB（31,457,280 バイト）/.test(r.over) && /31,457,281 バイト/.test(r.over) && /添付し直して/.test(r.over), `over note ${r.over}`)
    check((await page.locator('#attachment-chips > span').count()) === 0, 'no chip for oversize'); await shot('over-30MiB')
    for (const id of ['attachment-note', 'message', 'send']) check(await inside(id), `${id} inside viewport with note`)
    // 未対応形式
    await add(files.exe, 'note'); r.unsupported = await note(); check(/対応していない/.test(r.unsupported), `unsupported ${r.unsupported}`)
    // 本文なし・壊れた PDF は BFF が理由を返し、失敗チップ＋理由
    await add(files.scan, 'note'); r.scan = await note(); check(/文字を読み取れません/.test(r.scan) && /画像/.test(r.scan), `scan ${r.scan}`); check(/失敗/.test(await chips()), 'scan chip failed'); await shot('scan'); await clear()
    check(!(await note()), 'note cleared after cancel')
    await add(files.broken, 'note'); r.broken = await note(); check(/壊れているか/.test(r.broken), `broken ${r.broken}`); await clear()
    // 一部読取: 成功扱いにせず、範囲と次の手順を注意として出す
    await add(files.pages, 'note'); r.partialChip = await chips(); r.partial = await note()
    check(/一部のみ読取/.test(r.partialChip), `partial chip ${r.partialChip}`); check(/全31ページのうち先頭30ページだけ/.test(r.partial), `partial note ${r.partial}`); await shot('partial')
    // BFF 停止中（nginx が 503 bff_unavailable）
    await new Promise((res) => server.close(res)); server.closeAllConnections?.()
    await add(files.small, 'note'); r.down = await note(); check(/再起動中/.test(r.down), `bff down ${r.down}`); await startBff()
    await page.locator('#attachment-chips button').last().click()
    // 通信断
    await page.route('**/api/v1/attachments', (route) => route.abort('internetdisconnected'))
    await add(files.small, 'note'); r.offline = await note(); check(/通信状態を確認/.test(r.offline), `offline ${r.offline}`); await shot('offline')
    await page.unroute('**/api/v1/attachments'); await page.locator('#attachment-chips button').last().click()
    // 一部読取の PDF を送ると Hermes に「読んだ範囲だけ」と伝わる
    const before = runs.length
    await page.fill('#message', 'このPDFを要約して'); await page.click('#send')
    await page.waitForFunction(() => document.getElementById('attachment-chips').children.length === 0, null, { timeout: 20000 })
    await page.waitForTimeout(1500)
    const sent = JSON.stringify(runs.slice(before).map((x) => x[1]))
    r.hermesPartialNote = /全31ページのうち先頭30ページだけ/.test(sent) && /page 30 ID-677/.test(sent) && !/page 31 ID-677/.test(sent)
    check(r.hermesPartialNote, `hermes input ${sent.slice(0, 400)}`)
    check(!(await note()), 'note cleared after send')
    await shot('sent')
  } catch (e) {
    failures.push(`${device}: ${e.message}`)
    await shot('error').catch(() => {})
  }
  await ctx.close()
}
await browser.close()
server.close()
fs.rmSync(dataDir, { recursive: true, force: true })
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ failures, maxMs: { pc: results.pc?.maxMs, pixel7: results.pixel7?.maxMs }, direct: Object.fromEntries(Object.entries(results.direct).map(([k, v]) => [k, v.status])) }, null, 2))
process.exit(failures.length ? 1 : 0)
