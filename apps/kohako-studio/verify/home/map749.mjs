// BOXP-749: 会話内地図の単一ピン・複数候補の店名付きピンを、BFF モックで実ブラウザ表示する（地図タイルは実 OpenStreetMap）。
// 使い方: SITE=<kohako/ を含む dir> node map749.mjs <realpath749.mjs の出力 JSON> [out]
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const site = process.env.SITE || '/site', port = Number(process.env.PORT || 8771), real = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), out = process.argv[3] || 'out/map749'
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(site, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(port)
const area = { lat: 35.655, lon: 139.7538, bbox: [139.751, 35.653, 139.757, 35.658], precision: 'area', label: '東京都港区芝大門二丁目', source: 'openstreetmap' }
const cases = [
  { key: 'single', view: real.single.reply.views[0], pins: ['Cafe Renoir 芝大門店'], areas: 0 },
  { key: 'multi', view: real.multi.reply.views[0], pins: ['Cafe Renoir 芝大門店', 'エクセルシオール カフェ 三田店', 'ロバーツコーヒー 麻布十番店'], areas: 0 },
  { key: 'area', view: { kind: 'map', title: '付近だけ', destination: { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1' }, geo: area }, pins: [], areas: 1 },
  { key: 'mixed', view: { kind: 'map', title: '一部不明', places: [real.multi.reply.views[0].places[1], { name: '位置不明の店' }] }, pins: ['エクセルシオール カフェ 三田店'], areas: 0, unknown: true },
  { key: 'none', view: { kind: 'map', title: '不明', destination: { name: '位置不明の店' } }, pins: [], areas: 0, nomap: true },
]
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), failures = [], results = []
const check = (ok, message) => { if (!ok) failures.push(message) }
for (const [name, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['portrait', { width: 412, height: 915 }, true], ['landscape', { width: 915, height: 412 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage(); let current = 0
  const requests = []; page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname !== 'localhost') requests.push(u.href) })
  await ctx.route('**/kohako/api/v1/**', async (route) => { const p = new URL(route.request().url()).pathname.split('/v1/')[1], j = (code, data) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(503, {}); if (p === 'messages') return j(202, {}); if (p.startsWith('requests/')) return j(200, { status: 'done', reply: { text: '地図です', at: Date.now(), views: [cases[current].view] } }); return j(404, {}) })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html`); await page.waitForFunction(() => !document.querySelector('#send').disabled)
    for (current = 0; current < cases.length; current++) {
      const c = cases[current], tag = `${name} ${c.key}`
      await page.waitForTimeout(0)
      await page.locator('#message').fill(`地図 ${c.key}`); await page.locator('#form').evaluate((e) => e.requestSubmit()); await page.locator('#viewer').waitFor({ timeout: 12000 })
      await page.waitForFunction((t) => document.getElementById('viewer-title').textContent === t, c.view.title)
      if (!c.nomap) await page.waitForFunction(() => [...document.querySelectorAll('.view-map-tile')].every((i) => i.complete), null, { timeout: 20000 }).catch(() => {})
      const info = await page.evaluate(() => {
        const box = document.querySelector('.view-map'), r = box?.getBoundingClientRect(), rect = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }
        return {
          map: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          tiles: [...document.querySelectorAll('.view-map-tile')].map((i) => ({ ok: i.complete && i.naturalWidth === 256, src: i.src, ref: i.getAttribute('referrerpolicy') })),
          pins: [...document.querySelectorAll('.view-map-pin')].map((p) => ({ n: p.dataset.n, label: p.querySelector('.view-map-label').textContent, badge: p.querySelector('.view-map-n').textContent, at: rect(p), label_at: rect(p.querySelector('.view-map-label')), visible: getComputedStyle(p.querySelector('.view-map-n')).visibility })),
          areas: [...document.querySelectorAll('.view-map-area')].map((p) => ({ label: p.querySelector('.view-map-label').textContent, at: rect(p) })),
          list: [...document.querySelectorAll('.view-map-list li')].map((l) => l.textContent),
          text: document.getElementById('viewer').textContent,
          viewer: rect(document.getElementById('viewer')),
        }
      })
      check(JSON.stringify(info.pins.map((p) => p.label)) === JSON.stringify(c.pins), `${tag}: pins ${JSON.stringify(info.pins.map((p) => p.label))}`)
      check(info.pins.every((p, i) => p.badge === String(i + 1) && p.visible === 'visible'), `${tag}: pin numbers`)
      check(info.areas.length === c.areas, `${tag}: areas ${info.areas.length}`)
      if (c.nomap) check(!info.map && info.text.includes('地図上の位置を特定できませんでした'), `${tag}: no map`)
      else {
        check(!!info.map && info.tiles.length > 0 && info.tiles.every((t) => t.ok), `${tag}: tiles ${info.tiles.filter((t) => t.ok).length}/${info.tiles.length}`)
        check(info.tiles.every((t) => t.ref === 'strict-origin'), `${tag}: referrer`)
        const m = info.map
        for (const p of info.pins) check(p.at.x >= m.x && p.at.x <= m.x + m.w && p.at.y >= m.y && p.at.y <= m.y + m.h, `${tag}: pin ${p.n} outside map`)
        check(m.y >= 0 && m.y + m.h <= viewport.height, `${tag}: map not fully visible without scroll (${Math.round(m.y)}+${Math.round(m.h)})`)
        check(info.text.includes('© OpenStreetMap contributors'), `${tag}: attribution`)
        // 店名ラベルが互いに重ならず、地図枠に収まる
        const L = info.pins.map((p) => p.label_at)
        for (let i = 0; i < L.length; i++) { check(L[i].x >= m.x - 1 && L[i].x + L[i].w <= m.x + m.w + 1 && L[i].y >= m.y - 1 && L[i].y + L[i].h <= m.y + m.h + 1, `${tag}: label ${i + 1} outside map`); for (let j = 0; j < i; j++) check(L[i].x + L[i].w <= L[j].x || L[j].x + L[j].w <= L[i].x || L[i].y + L[i].h <= L[j].y || L[j].y + L[j].h <= L[i].y, `${tag}: labels ${j + 1}/${i + 1} overlap`) }
      }
      if (c.areas) check(info.areas[0].label.endsWith('（付近）') && info.text.includes('番地まで特定できず'), `${tag}: area wording`)
      if (c.unknown) check(info.list.some((l) => l.includes('位置不明の店') && l.includes('地図に印はありません')), `${tag}: unknown listed`)
      check(info.list.length === (c.view.places?.length ?? 1), `${tag}: list ${info.list.length}`)
      results.push({ tag, zoom: await page.locator('.view-map').getAttribute('data-zoom').catch(() => null), pins: info.pins.map((p) => [p.n, p.label]), areas: info.areas.map((a) => a.label), tiles: info.tiles.length })
      await page.screenshot({ path: `${out}/${name}-${c.key}.png` }); await page.keyboard.press('Escape')
    }
    // 出発地・住所を含む位置情報が地図タイル以外の外部へ送られていない
    check(requests.every((u) => u.startsWith('https://tile.openstreetmap.org/')), `${name}: external requests ${requests.filter((u) => !u.startsWith('https://tile.openstreetmap.org/')).slice(0, 3)}`)
  } catch (e) { failures.push(`${name}: ${e.message}`) } finally { await ctx.close() }
}
await browser.close(); server.close(); fs.writeFileSync(`${out}/result.json`, JSON.stringify({ failures, results }, null, 2)); console.log(JSON.stringify({ failures, results }, null, 1)); process.exitCode = failures.length ? 1 : 0
