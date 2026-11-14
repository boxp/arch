// BOXP-551: 利用枠の使用率が浮動小数の長い小数（例: Fable専用 7.000000000000001%）で表示されないことを、
// BFF を完全にモックした実描画で確かめる（token 不要）。欠測・リセット後未観測の窓を 0% にしないことも確かめる。
// 使い方: ローカル build を `SITE`（既定 /site）の kohako/ に置き `node percent551.mjs <出力先>`（Playwright 1.56.1）。
// `EXPECT_FAIL=1` は修正前 build で再現（長い小数が出る）を確かめるときに使い、再現できれば終了コード 0 を返す。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const outDir = process.argv[2] || 'out/percent551', site = process.env.SITE || '/site', port = +(process.env.PORT || 8797); fs.mkdirSync(outDir, { recursive: true })
const now = Date.now(), iso = ms => new Date(ms).toISOString()
const win = (name, label, state, usedPercent) => ({ name, label, state, usedPercent, resetsAt: usedPercent === null ? null : iso(now + 3 * 86400000), observedAt: iso(now - 60000), status: usedPercent === null ? null : 'allowed' })
const statusOf = fable => ({ schema: 'kohako-home-status/v1', generatedAt: iso(now), quota: { state: 'ok', pools: [
  { id: 'claude_shared', label: 'Claude共有（Opus/Fable）', windows: [win('shared_5h', '5時間', 'ok', 0.2 * 100), win('shared_7d', '7日', 'ok', 0.43 * 100)] },
  { id: 'claude_fable', label: 'Fable専用上限', windows: [fable], note: '共有枠にも同時に掛かります' },
  { id: 'claude_opus', label: 'Opus専用', windows: [], state: 'not_provided', note: '窓ごとの利用率は提供されていません' },
  { id: 'codex_shared', label: 'Codex共有（codex/sol/astra）', windows: [win('primary', '7日', 'ok', 0.31 * 100)] },
  { id: 'localllm', label: 'ローカルLLM', windows: [], state: 'not_applicable' }] },
  tasks: { state: 'ok', inProgress: { total: 1, complete: true, byAgent: [{ agent: 'claude-opus', count: 1 }], conflicts: [] } } })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(site, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(port)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}, failures = [], check = (cond, msg) => { if (!cond) failures.push(msg) }
const longDecimal = /\d+\.\d{2,}%/
async function scenario(name, status) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage()
  await ctx.route('**/kohako/api/v1/**', async r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(200, status); return j(404, {}) })
  await page.goto(`http://localhost:${port}/kohako/home.html`)
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'))
  await page.waitForFunction(() => !document.getElementById('status-widget').textContent.includes('確認中'))
  await page.waitForTimeout(500)
  const widget = await page.textContent('#status-widget'), gauges = await page.locator('.gauge-value').allTextContents(), minis = await page.locator('.status-mini').allTextContents()
  await page.screenshot({ path: `${outDir}/${name}-closed.png` })
  await page.click('#status-widget'); const detail = await page.textContent('#status-detail')
  await page.screenshot({ path: `${outDir}/${name}-open.png` })
  out[name] = { widget, gauges, minis, detail }; await ctx.close()
  return out[name]
}
const ok = await scenario('fable-7', statusOf(win('fable_7d', '7日', 'ok', 0.07 * 100)))
const all = ok.widget + ok.detail
if (process.env.EXPECT_FAIL) check(all.includes('7.000000000000001%'), 'before-fix build did not reproduce the long decimal')
else {
  check(!longDecimal.test(all), `long decimal shown: ${all.match(longDecimal)?.[0]}`)
  check(ok.minis.some(t => t.startsWith('Fable専用 7% ')), `fable mini: ${JSON.stringify(ok.minis)}`)
  check(JSON.stringify(ok.gauges) === JSON.stringify(['43%', '31%']), `gauges: ${JSON.stringify(ok.gauges)}`)
  check(ok.detail.includes('7日 7%（正常）'), 'detail missing Fable 7日 7%')
  const expired = await scenario('fable-expired', statusOf(win('fable_7d', '7日', 'expired', null)))
  check(!expired.minis.some(t => t.startsWith('Fable専用')), `expired fable mini shown: ${JSON.stringify(expired.minis)}`)
  check(expired.detail.includes('7日 —（リセット後未観測）'), 'expired detail not shown as missing')
  check(!/Fable専用上限 7日 0%/.test(expired.widget + expired.detail), 'expired fable invented as 0%')
}
await b.close(); srv.close(); fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ out, failures }, null, 1)); console.log(JSON.stringify({ out, failures }, null, 1)); process.exit(failures.length ? 1 : 0)
