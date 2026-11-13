// BOXP-544: portrait layout regression with a fully mocked BFF.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const site = process.env.SITE || '/site', outDir = process.argv[2] || '/out', port = Number(process.env.PORT || 8804)
const baseline = process.env.BASELINE === '1'
fs.mkdirSync(outDir, { recursive: true })
const status = { schema: 'kohako-home-status/v1', generatedAt: '2026-01-01T12:00:00Z', quota: { state: 'ok', pools: ['claude_shared', 'codex_shared'].map((id, i) => ({ id, label: id, windows: [{ name: 'daily', label: '日次', state: 'ok', usedPercent: 20 + i * 10, resetsAt: null, observedAt: null, status: null }] })) }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); const f = path.resolve(site, '.' + p); if (!f.startsWith(path.resolve(site) + path.sep)) { res.writeHead(403).end(); return } fs.readFile(f, (err, data) => { if (err) { res.writeHead(404).end(); return } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const failures = [], cases = {}, external = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const overlaps = (a, b) => a && b && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
async function run(name, viewport, scene, variant = '') {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return
  const portrait = viewport.height > viewport.width
  const ctx = await browser.newContext({ viewport, isMobile: portrait, hasTouch: portrait, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await ctx.route('**/*', async route => { const u = new URL(route.request().url()); if (u.hostname !== 'localhost') { external.push(u.href); return route.abort() } if (u.pathname.startsWith('/kohako/api/v1/')) { const p = u.pathname.split('/v1/')[1]; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === 'me' ? { authenticated: true } : p === 'conversation' ? { enabled: true, stt: true } : p === 'status' ? status : {}) }) } return route.continue() })
  const page = await ctx.newPage(); await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') })
  await page.goto(`http://localhost:${port}/kohako/home.html`); await page.waitForFunction(() => document.querySelector('#connection').textContent.startsWith('接続中')); await page.waitForFunction(() => !document.querySelector('#status-widget').textContent.includes('確認中')); await page.waitForTimeout(300)
  await page.evaluate(({scene, variant}) => { const body = document.body; const apply = () => { if (body.dataset.scene !== scene) body.dataset.scene = scene; if (variant === 'kbd' && body.dataset.kbd !== '1') body.dataset.kbd = '1' }; apply(); new MutationObserver(apply).observe(body, { attributes: true, attributeFilter: ['data-scene', 'data-kbd'] }); if (scene === 'show') { document.querySelector('#cards').hidden = false; document.querySelector('#card-list').textContent = '結果カードの内容' } if (scene === 'work') { document.querySelector('#stop').hidden = false; document.querySelector('#send').textContent = 'キューに追加' } if (scene === 'offline') { document.querySelector('#trouble').hidden = false; document.querySelector('#error').textContent = '接続できませんでした。' } if (scene === 'confirm') { document.querySelector('#approval').hidden = false; document.querySelector('#approval-summary').textContent = '操作を実行しますか？' } if (variant === 'viewer') { body.dataset.viewer = 'open'; document.querySelector('#viewer').hidden = false; document.querySelector('#viewer-title').textContent = '表示'; document.querySelector('#viewer-body').textContent = '表示内容' } }, { scene, variant })
  if (variant === 'kbd') await page.locator('#message').focus()
  await page.waitForTimeout(150)
  const data = await page.evaluate(() => { const selectors = ['.clock-face', '.status-anchor', '#status-widget', '.top', '.nav', '#form', '#message', '#send', '#stop', '#record', '#attach', '#bubble', '#cards', '#trouble', '#character', '#viewer', '#approval', '#allow', '#deny']; const rect = el => { if (!el || el.getClientRects().length === 0) return null; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return null } const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height } }; return Object.fromEntries(selectors.map(s => [s, rect(document.querySelector(s))])) })
  if (scene === 'offline') check(!!data['#trouble'], `${name}: trouble missing`); if (scene === 'confirm') check(!!data['#approval'], `${name}: approval missing`); if (scene === 'show') check(!!data['#cards'], `${name}: cards missing`); if (variant === 'viewer') check(!!data['#viewer'], `${name}: viewer missing`)
  for (const id of ['.top', '.nav', '#form', '#message', '#send', '#character']) check(!!data[id], `${name}: ${id} missing`)
  if (scene === 'work') check(!!data['#stop'], `${name}: stop missing`)
  if (portrait && !baseline) { check(await page.locator('#message').getAttribute('placeholder') === '話しかける', `${name}: placeholder not short`); check(!data['.clock-face'], `${name}: clock visible`); check(!data['.status-anchor'], `${name}: status visible`) }
  if (!portrait) { if (scene === 'relax') check(!!data['.clock-face'], `${name}: clock hidden`); check(!!data['#status-widget'], `${name}: status hidden`) }
  for (const [id, r] of Object.entries(data)) if (r && portrait && !['.clock-face', '.status-anchor', '#status-widget'].includes(id)) check(r.x >= -1 && r.y >= -1 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1, `${name}: ${id} outside viewport ${JSON.stringify(r)}`)
  const controls = ['#attach', '#message', '#record', '#send', '#stop']; for (let i = 0; i < controls.length; i++) for (const b of controls.slice(i + 1)) check(!overlaps(data[controls[i]], data[b]), `${name}: ${controls[i]} overlaps ${b}`)
  if (portrait && scene === 'show') check(!overlaps(data['#bubble'], data['#cards']), `${name}: bubble overlaps cards`)
  if (variant === 'viewer') check(!overlaps(data['#bubble'], data['#viewer']), `${name}: bubble overlaps viewer`)
  if (scene === 'offline') check(!overlaps(data['#bubble'], data['#trouble']), `${name}: bubble overlaps trouble`)
  await page.screenshot({ path: path.join(outDir, `${name}.png`), animations: 'disabled' }); cases[name] = data; await ctx.close()
}
try {
  for (const [label, viewport] of [['p360',{width:360,height:780}],['p390',{width:390,height:844}],['p412',{width:412,height:915}]]) for (const scene of ['relax','talk','show','work','offline','confirm']) await run(`${label}-${scene}`, viewport, scene)
  for (const [label, viewport] of [['p360',{width:360,height:780}],['p390',{width:390,height:844}],['p412',{width:412,height:915}]]) for (const variant of ['viewer','kbd']) await run(`${label}-${variant}`, viewport, 'talk', variant)
  for (const [label, viewport] of [['pc',{width:1280,height:800}],['landscape',{width:844,height:390}]]) for (const scene of ['relax','talk','show']) await run(`${label}-${scene}`, viewport, scene)
  if (!baseline && !process.env.ONLY) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }); const page = await ctx.newPage()
    await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'localhost') { external.push(u.href); return r.abort() } if (!u.pathname.startsWith('/kohako/api/v1/')) return r.continue(); const p = u.pathname.split('/v1/')[1]; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(p === 'me' ? { authenticated:true } : p === 'conversation' ? { enabled:true } : p === 'status' ? status : {}) }) })
    await page.goto(`http://localhost:${port}/kohako/home.html`); await page.locator('#status-widget').click(); await page.setViewportSize({width:390,height:844}); await page.waitForFunction(() => document.body.dataset.shape === 'portrait'); check(await page.locator('#status-panel').isHidden(), 'resize: panel remains open'); check(await page.locator('#status-widget').getAttribute('aria-expanded') === 'false', 'resize: aria-expanded remains true'); await ctx.close()
  }
} finally { await browser.close(); server.close() }
check(external.length === 0, `external requests: ${external.join(', ')}`)
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ cases, external, failures }, null, 2)); console.log(JSON.stringify({ failures, external }, null, 2)); process.exit(failures.length ? 1 : 0)
