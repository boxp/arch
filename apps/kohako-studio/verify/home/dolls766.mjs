// BOXP-766: 家の人形（作業中の AI モデル）を PC とスマホ縦で開き、並び・重なり・押した後のカード・通信を確かめる。
// 実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node dolls766.mjs <出力dir> [build の dist]`
//   dist を渡すと MODE=local: 手元の build を 127.0.0.1 で配り、API は見本の値で返す（BFF に触らない）。
//   dist を省くと MODE=deployed: BASE（クラスタ内 Service の /kohako/）から画面も API も取り、TOKEN_FILE の検証用 token を API にだけ付ける。
//   token は出力しない。票の中身は結果ファイルに番号と文字数だけ残す（Notes の本文は書き出さない）。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const OUT = process.argv[2], SITE = process.argv[3]
fs.mkdirSync(OUT, { recursive: true })
let BASE = process.env.BASE
const local = !!SITE
if (local) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
  const ROOT = fs.realpathSync(SITE)
  const inside = (url) => { try { const p = decodeURIComponent(new URL(url, 'http://x').pathname).replace(/^\/kohako\//, '/'); if (p.includes('\0')) return null; const f = path.resolve(ROOT, '.' + path.posix.normalize('/' + p)); const real = fs.realpathSync(f); return real === ROOT || real.startsWith(ROOT + path.sep) ? real : null } catch { return null } }
  const srv = http.createServer((q, r) => { const f = inside(q.url); if (!f) { r.writeHead(404); return r.end() } fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d) }) }).listen(0, '127.0.0.1')
  await new Promise(r => srv.on('listening', r))
  BASE = `http://127.0.0.1:${srv.address().port}/kohako/home.html`
}
const token = local ? '' : fs.readFileSync(process.env.TOKEN_FILE, 'utf8').trim()
// 見本（MODE=local）: 仕様 5 章の例に近い 6 種の人形。
const sample = [
  ['opus', '楽長の人形', 'claude-opus-5-5', null, ['BOXP-1', 'BOXP-2']], ['fable', '語り部の人形', 'claude-fable-5-2', null, ['BOXP-3']],
  ['sol', '灯守りの人形', 'gpt-6.1-sol', null, ['BOXP-4']], ['neon', '灯り細工の人形', null, null, ['BOXP-5']],
  ['plain', '無地の人形', null, 'モデル未確認', ['BOXP-6']], ['luna', '月見の人形', 'gpt-5.6-luna', null, ['BOXP-7']],
].map(([key, name, model, plainLabel, ids]) => ({ key, name, version: 2, model, plainLabel, tickets: ids.map((id) => ({ id, assignee: key === 'sol' ? 'codex-sol-xhigh' : `claude-${key}`, model })) }))
const statusBody = () => ({ schema: 'kohako-home-status/v1', generatedAt: new Date().toISOString(), quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', fetchedAt: new Date().toISOString(), boardUpdatedAt: null, inProgress: { total: 7, complete: true, byAgent: [{ agent: 'claude-opus', count: 2 }], conflicts: [], laneStatusMismatch: 0 }, ids: [], dolls: sample } })
const detailBody = (id) => ({ state: 'ok', fetchedAt: new Date(Date.now() - 60000).toISOString(), item: { id, title: `見本の票 ${id}`, assignee: 'claude-opus', status: 'in-progress', ticketUpdatedAt: null, latestNoteAt: new Date(Date.now() - 600000).toISOString(), latestNoteSource: 'claude-opus', progress: '<b>見本</b> の最新の記録（HTML として解釈しないこと）', blocker: null, decision: '本人の判断待ち', readError: null } })
const browser = await chromium.connect(process.env.PW_WS ?? 'ws://127.0.0.1:39766/')
const origin = new URL(BASE).origin, results = []
for (const [name, viewport, mobile] of [['pc', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile }), page = await context.newPage()
  const errors = [], outside = [], bad = [], api = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (q) => { if (!q.url().startsWith(origin) && !q.url().startsWith('data:') && !q.url().startsWith('blob:')) outside.push(new URL(q.url()).host) })
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) bad.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  await context.route('**/kohako/api/v1/**', async (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^.*\/kohako\/api\/v1\//, '')
    api.push(p.replace(/BOXP-\d+/, 'BOXP-N'))
    if (!local) return r.continue({ headers: { ...r.request().headers(), authorization: `Bearer ${token}` } })
    if (p === 'status') return r.fulfill({ json: statusBody() })
    const m = /^status\/tickets\/(BOXP-\d+)$/.exec(p)
    if (m) return r.fulfill({ json: detailBody(m[1]) })
    if (p === 'me') return r.fulfill({ json: { authenticated: true } })
    if (p === 'conversation') return r.fulfill({ json: { enabled: true, stt: null } })
    return r.fulfill({ status: 404, json: {} })
  })
  await page.goto(BASE)
  await page.waitForFunction(() => document.getElementById('connection')?.textContent.startsWith('接続中'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('#dolls .doll, #dolls .doll-tag', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  // スマホ縦は、吹き出しを閉じて入力していない時だけ札（と人形）が出る（D6）。閉じた状態を作って見る。
  if (mobile) await page.evaluate(() => { document.querySelector('#bubble')?.setAttribute('data-dismissed', '1'); document.body.dataset.message = '0' })
  await page.waitForTimeout(500)
  const info = await page.evaluate(() => {
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null }
    const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const dolls = [...document.querySelectorAll('#dolls .doll')].map((d) => ({ key: d.dataset.doll ?? 'more', box: box(d), img: d.querySelector('img')?.naturalWidth ?? -1, src: (d.querySelector('img')?.getAttribute('src') ?? '').replace(/^.*\//, '') }))
    const others = Object.fromEntries(['#bubble', '#message', '#send', '#stop', '#approval', '#status-widget', '#face', 'canvas#rig'].map((s) => [s, box(document.querySelector(s))]))
    const overlaps = []
    for (const d of dolls) for (const [s, b] of Object.entries(others)) if (s !== '#face' && s !== 'canvas#rig' && hit(d.box, b)) overlaps.push(`${d.key}x${s}`)
    return { state: document.querySelector('#dolls')?.dataset.state, dolls, overlaps, tag: document.querySelector('#dolls .doll-tag')?.textContent ?? null, small: dolls.filter((d) => d.box && (d.box.w < 44 || d.box.h < 44)).map((d) => d.key), outOfView: dolls.filter((d) => d.box && (d.box.x < 0 || d.box.x + d.box.w > innerWidth || d.box.y < 0 || d.box.y + d.box.h > innerHeight)).map((d) => d.key), scrollX: document.documentElement.scrollWidth > innerWidth }
  })
  await page.screenshot({ path: `${OUT}/${name}-room.png` })
  if (await page.locator('#dolls .doll').count()) await page.locator('#dolls').screenshot({ path: `${OUT}/${name}-dolls.png` }).catch(() => {})
  let card = null
  const first = page.locator('#dolls .doll[data-doll]').first()
  if (await first.count()) {
    await first.click()
    await page.waitForSelector('#doll-card .doll-fresh, #doll-card .doll-note-head', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(800)
    card = await page.evaluate(() => {
      const c = document.querySelector('#doll-card'), r = c.getBoundingClientRect()
      return { hidden: c.hidden, lines: [...c.querySelectorAll('p,strong,small')].map((e) => e.className.split(' ')[0] + ':' + (e.className.includes('doll-note') && !e.className.includes('head') ? `(${e.textContent.length}字)` : e.textContent)), htmlInjected: !!c.querySelector('.doll-note b'), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, tabs: c.querySelectorAll('.doll-tab').length }
    })
    await page.screenshot({ path: `${OUT}/${name}-card.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    card.closedByEsc = await page.evaluate(() => document.querySelector('#doll-card').hidden)
  }
  results.push({ name, mode: local ? 'local' : 'deployed', info, card, api, errors, outside: [...new Set(outside)], bad })
  await context.close()
}
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 1))
console.log(JSON.stringify(results, null, 1))
await browser.close()
process.exit(0)
