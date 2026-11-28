// BOXP-773: 家の入力欄への貼り付けで添付待ちに入ることを、BFF のモックで PC / Pixel 7 相当について確かめる。
// 本物のクリップボード（Ctrl+V）で画像と文字を貼り、合成の paste イベントで PDF・未対応・超過・Excel 型（文字+画像）・
// 本体なし（Files だけ）を貼る。貼り付けでは送信しないこと、取消、本人の送信で messages に attachments が載ること、
// 既存の 📎 選択が壊れていないことを検査し、各状態の画像を残す。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、Playwright 1.56.1 で `node paste773.mjs /out`。失敗時は終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8798)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = []
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const r = results[device] = {}, posts = [], uploads = []
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, permissions: ['clipboard-read', 'clipboard-write'] }), page = await ctx.newPage()
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  let n = 0
  await ctx.route('**/kohako/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (s, d) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(d) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: null })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'attachments') { const name = decodeURIComponent(req.headers()['x-kohako-filename'] || ''); uploads.push({ name, type: req.headers()['content-type'], size: req.postDataBuffer()?.length }); return json(201, { attachmentId: (++n).toString(16).padStart(32, 'a'), kind: name.endsWith('.png') ? 'image' : 'text', name, size: 6, truncated: false }) }
    if (p === 'messages') { posts.push(JSON.parse(req.postData())); return json(202, { requestId: posts.at(-1).requestId, status: 'pending' }) }
    if (/^requests\//.test(p)) return json(200, { status: 'done', reply: { text: '添付を確認しました。' } })
    return json(200, {})
  })
  const check = (v, m) => { if (!v) failures.push(`${device}: ${m}`) }
  const shot = async name => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${device}-${name}.png` }) }
  const note = () => page.evaluate(() => document.getElementById('attachment-note')?.textContent || '')
  const chips = () => page.locator('#attachment-chips > span').count()
  const clearChips = async () => { while (await chips()) await page.locator('#attachment-chips button').first().click() }
  // 合成の paste（DataTransfer に任意の型・ファイルを載せる）。defaultPrevented を返す。
  const synth = spec => page.evaluate(({ text, files, typesOnly }) => {
    const dt = new DataTransfer()
    if (text !== undefined) dt.setData('text/plain', text)
    for (const f of files || []) dt.items.add(new File([f.big ? new Uint8Array(f.big) : f.body], f.name, { type: f.type }))
    let data = dt
    if (typesOnly) data = { types: typesOnly, files: [], items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => null }], getData: () => '' }
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    if (typesOnly) Object.defineProperty(ev, 'clipboardData', { value: data })
    document.getElementById('message').dispatchEvent(ev)
    return ev.defaultPrevented
  }, spec)
  // スクリーンショット相当: canvas に描いた PNG を本物のクリップボードへ書く
  const copyScreenshot = () => page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = '#4a8'; g.fillRect(0, 0, 64, 48); g.fillStyle = '#fff'; g.fillText('773', 8, 28); const b = await new Promise(res => c.toBlob(res, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]) })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    const key = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
    // 1) 本物のクリップボード: 文字はそのまま入力欄に入り、添付しない
    await page.evaluate(() => navigator.clipboard.writeText('ふつうの文字'))
    await page.focus('#message'); await page.keyboard.press(key); await page.waitForTimeout(300)
    r.textPaste = await page.inputValue('#message'); check(r.textPaste === 'ふつうの文字', `text paste ${r.textPaste}`)
    check(await chips() === 0 && uploads.length === 0, 'text paste adds no attachment')
    await page.fill('#message', '')
    // 2) 本物のクリップボード: スクリーンショット相当の PNG を貼ると添付待ちへ。送信はしない
    await copyScreenshot()
    await page.focus('#message'); await page.keyboard.press(key); await page.waitForTimeout(800)
    r.imageChip = await page.locator('#attachment-chips').textContent(); check(await chips() === 1 && /✓/.test(r.imageChip), `image paste chip ${r.imageChip}`)
    check(uploads.at(-1)?.type === 'image/png', `image upload type ${JSON.stringify(uploads.at(-1))}`)
    check(posts.length === 0, 'paste does not send'); check(await page.inputValue('#message') === '', 'no filename text inserted')
    await shot('image-pasted')
    // 3) 取消
    await page.locator('#attachment-chips button').first().click(); check(await chips() === 0, 'cancel pasted chip')
    // 4) 合成: PDF ファイル（ファイルマネージャのコピー相当）
    r.pdfPrevented = await synth({ files: [{ name: 'memo.pdf', type: 'application/pdf', body: '%PDF-1.4\n' }] }); await page.waitForTimeout(600)
    check(r.pdfPrevented && await chips() === 1 && uploads.at(-1)?.name === 'memo.pdf', 'pdf paste attaches'); await clearChips()
    // 5) 未対応・超過は既存の理由文、チップなし
    await synth({ files: [{ name: 'tool.zip', type: 'application/zip', body: 'PK' }] }); await page.waitForTimeout(300)
    r.unsupported = await note(); check(/対応していない/.test(r.unsupported) && await chips() === 0, `unsupported ${r.unsupported}`)
    await synth({ files: [{ name: 'big.txt', type: 'text/plain', big: 5 * 1024 * 1024 + 1 }] }); await page.waitForTimeout(300)
    r.oversize = await note(); check(/大きすぎます/.test(r.oversize) && await chips() === 0, `oversize ${r.oversize}`)
    await shot('rejected')
    // 6) Excel 型（文字 + 表の画像）は文字扱い: 既定の貼り付けを止めず、添付しない
    const before = uploads.length
    r.excelPrevented = await synth({ text: 'A1\tB1', files: [{ name: 'image.png', type: 'image/png', body: 'x' }] }); await page.waitForTimeout(300)
    check(r.excelPrevented === false && uploads.length === before && await chips() === 0, 'excel-like paste stays text')
    // 7) 本体なし（Files だけ）: 案内を出し、文字を入れない
    r.unavailablePrevented = await synth({ typesOnly: ['Files'] }); await page.waitForTimeout(300)
    r.unavailable = await note(); check(r.unavailablePrevented && /📎 から選んで/.test(r.unavailable) && await chips() === 0, `unavailable ${r.unavailable}`)
    await shot('unavailable')
    // 8) 既存の 📎 選択（回帰）+ 貼り付けを混ぜ、本人の送信で attachments が載る
    await page.setInputFiles('#attachment-file', [{ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('ID-773') }]); await page.waitForTimeout(500)
    await copyScreenshot()
    await page.focus('#message'); await page.keyboard.press(key); await page.waitForTimeout(800)
    check(await chips() === 2, 'picker + paste chips'); check(posts.length === 0, 'still not sent before submit')
    await page.fill('#message', 'このスクショを見て'); await shot('before-send'); await page.click('#send'); await page.waitForTimeout(1500)
    r.posts = posts; check(posts.length === 1 && posts[0].attachments?.length === 2 && posts[0].text === 'このスクショを見て', `message payload ${JSON.stringify(posts)}`)
    check(await chips() === 0, 'chips cleared after accept')
    r.history = await page.evaluate(() => document.getElementById('history-list').textContent); check(r.history.includes('📎 memo.txt') && r.history.includes('📎 image.png'), `history ${r.history}`)
    await shot('sent')
    r.uploads = uploads
  } catch (e) { failures.push(`${device}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ failures }, null, 2)); process.exit(failures.length ? 1 : 0)
