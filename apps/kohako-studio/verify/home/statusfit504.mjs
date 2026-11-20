// BOXP-504 TD-02: 利用枠ウィジェットが枠の数・進行中 agent 数・文字拡大・長い吹き出しで伸びても、
// 吹き出し・入力・送信・停止・時計・カード・キャラ中央を覆わず、帯の文字が切れず、詳細が舞台内に収まることを BFF モックで確かめる（token 不要）。
// 使い方: ローカル build を $SITE/kohako/ に置き `STATUS_JSON=/work/status.json node statusfit504.mjs out/<name>`
// STATUS_JSON は BFF /kohako/api/v1/status 応答（実データの写し）。few/max の情報量はそこから作る（値の捏造は検証用の写しの中だけ）。
import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const outDir = process.argv[2] || 'out/statusfit'; fs.mkdirSync(outDir, { recursive: true })
const SITE = process.env.SITE || '/site'
const live = JSON.parse(fs.readFileSync(process.env.STATUS_JSON, 'utf8'))
const clone = o => JSON.parse(JSON.stringify(o))
// few: Antigravity 群が無い（BOXP-637 以前と同じ情報量）。max: 全帯が値を持ち、進行中 agent が多い。
const few = clone(live); few.quota.pools = few.quota.pools.filter(p => !p.id.startsWith('antigravity_'))
const max = clone(live)
for (const p of max.quota.pools) for (const w of p.windows) if (w.usedPercent !== null) w.usedPercent = 88.8
const agents = ['claude-opus', 'claude-fable', 'codex', 'codex-sol', 'antigravity']
max.tasks.inProgress.byAgent = agents.map((agent, i) => ({ agent, count: 12 - i })); max.tasks.inProgress.total = max.tasks.inProgress.byAgent.reduce((n, a) => n + a.count, 0)
const data = { live, few, max }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8769)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}, failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }
const overlap = (a, c) => a && c && a.x < c.x + c.width - .5 && c.x < a.x + a.width - .5 && a.y < c.y + c.height - .5 && c.y < a.y + a.height - .5
const LONG = 'おかえりなさい、ご主人さま。今日は利用枠に余裕があるので、続きの作業も進められそうです。気になることがあれば、なんでも話しかけてくださいね。'
async function scenario(name, viewport, set, scene, { large = false, longBubble = false } = {}) {
  const status = data[set]
  const ctx = await b.newContext({ viewport, isMobile: viewport.width < 600 || viewport.height < 600, hasTouch: viewport.width < 600 || viewport.height < 600 }), page = await ctx.newPage()
  await ctx.route('**/kohako/api/v1/**', async r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }); if (p === 'me') return j(200, { authenticated: true }); if (p === 'conversation') return j(200, { enabled: true, stt: null }); if (p === 'status') return j(200, status); return j(404, {}) })
  await page.goto('http://localhost:8769/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'))
  await page.waitForFunction(() => !document.getElementById('status-widget').textContent.includes('確認中'))
  if (large) await page.addStyleTag({ content: 'html{font-size:125%}' })
  await page.evaluate(([scene, text]) => { document.body.dataset.scene = scene; new MutationObserver(() => { if (document.body.dataset.scene !== scene) document.body.dataset.scene = scene }).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] }); if (text) document.getElementById('reply').textContent = text; if (scene === 'show') { const c = document.getElementById('cards'), l = document.getElementById('card-list'); c.hidden = false; for (let i = 0; i < 3; i++) { const d = document.createElement('div'); d.className = 'card'; d.textContent = `検証用カード ${i + 1}`; l.append(d) } } }, [scene, longBubble ? LONG.repeat(scene === 'show' ? 3 : 1) : ''])
  await page.waitForTimeout(500)
  const m = await page.evaluate(() => {
    const rect = e => { if (!e) return null; for (let o = e; o; o = o.parentElement) if (+getComputedStyle(o).opacity === 0) return null; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null }
    const ids = ['status-widget', 'form', 'message', 'send', 'stop', 'bubble', 'cards', 'trouble', 'character', 'rig', 'face', 'greeting', 'clock', 'date']
    const labels = [...document.querySelectorAll('#status-widget .mini-label, #status-widget .mini-value, #status-widget .mini-group, #status-widget .gauge-title, #status-widget .gauge-caption, #status-widget .task-chips span')].map(e => ({ text: e.textContent, cut: e.scrollWidth > e.clientWidth + 1, size: parseFloat(getComputedStyle(e).fontSize) }))
    return { boxes: Object.fromEntries(ids.map(id => [id, rect(document.getElementById(id))])), stage: rect(document.querySelector('.stage')), labels }
  })
  const w = m.boxes['status-widget']
  if (viewport.height > viewport.width) { // スマホ縦は BOXP-544 で時計とともに非表示（変更なし）。
    check(!w, `${name}: portrait widget visible`)
    await page.screenshot({ path: `${outDir}/${name}.png` }); out[name] = m; await ctx.close(); return
  }
  check(!!w, `${name}: widget not visible`)
  check(w && w.y >= m.stage.y - 1 && w.y + w.height <= m.stage.y + m.stage.height + 1 && w.x >= m.stage.x - 1 && w.x + w.width <= m.stage.x + m.stage.width + 1, `${name}: widget outside stage`)
  for (const id of ['form', 'message', 'send', 'stop', 'bubble', 'cards', 'trouble', 'greeting', 'clock', 'date']) check(!overlap(w, m.boxes[id]), `${name}: widget overlaps ${id}`)
  if (scene === 'show') { check(!!m.boxes.cards, `${name}: cards not visible`); check(!overlap(m.boxes.bubble, m.boxes.cards), `${name}: bubble overlaps cards`) }
  const avatar = m.boxes.rig || m.boxes.face; if (scene !== 'relax' && avatar && viewport.height < 600) { const c = avatar; check(!overlap(w, { x: c.x + c.width * .3, y: c.y + c.height * .15, width: c.width * .4, height: c.height * .7 }), `${name}: widget overlaps central character`) }
  for (const l of m.labels) { check(!l.cut, `${name}: label cut "${l.text}"`); check(l.size >= 9, `${name}: label too small ${l.size}px "${l.text}"`) }
  const shownPools = status.quota.pools.filter(p => !['claude_shared', 'claude_opus', 'codex_shared', 'localllm'].includes(p.id) && p.windows.some(x => x.usedPercent !== null && !['unavailable', 'unobserved', 'not_provided'].includes(x.state)))
  for (const p of shownPools) check(await page.locator(`#status-widget .status-mini[data-pool="${p.id}"] .mini-track span`).count() === 1, `${name}: mini bar missing ${p.id}`)
  const t = status.tasks.inProgress; check(await page.locator('.task-total').textContent() === String(t.total), `${name}: task total mismatch`)
  await page.screenshot({ path: `${outDir}/${name}-closed.png` })
  await page.click('#status-widget')
  const inside = await page.evaluate(() => { const p = document.getElementById('status-panel').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return p.top >= s.top - 1 && p.bottom <= s.bottom + 1 && p.left >= s.left - 1 && p.right <= s.right + 1 && p.height >= 60 })
  check(inside, `${name}: detail popover outside stage`)
  const scrolls = await page.evaluate(() => { const p = document.getElementById('status-panel'); p.scrollTop = p.scrollHeight; return p.scrollTop + p.clientHeight >= p.scrollHeight - 1 })
  check(scrolls, `${name}: detail cannot scroll to end`)
  await page.screenshot({ path: `${outDir}/${name}-open.png` }); await page.keyboard.press('Escape')
  check(await page.locator('#status-panel').isHidden(), `${name}: Escape did not close`)
  out[name] = m; await ctx.close()
}
const views = { pc: { width: 1280, height: 800 }, pcsmall: { width: 1024, height: 640 }, land: { width: 844, height: 390 }, landse: { width: 667, height: 375 }, landmax: { width: 932, height: 430 }, portrait: { width: 390, height: 844 } }
for (const set of ['few', 'live', 'max']) for (const v of ['pc', 'land', 'landse', 'portrait']) for (const scene of ['relax', 'talk', 'show']) await scenario(`${set}-${v}-${scene}`, views[v], set, scene)
for (const v of ['pc', 'pcsmall', 'land', 'landse', 'landmax']) for (const scene of ['relax', 'talk', 'show']) await scenario(`large-max-${v}-${scene}`, views[v], 'max', scene, { large: true })
for (const v of ['pc', 'land', 'landse']) await scenario(`long-live-${v}-talk`, views[v], 'live', 'talk', { longBubble: true, large: v === 'land' })
for (const v of ['pc', 'pcsmall', 'land', 'landse', 'landmax']) for (const large of [false, true]) await scenario(`long-max-${v}-show${large ? '-large' : ''}`, views[v], 'max', 'show', { longBubble: true, large })
await b.close(); srv.close(); fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ out, failures }, null, 1)); console.log(JSON.stringify({ count: Object.keys(out).length, failures }, null, 1)); process.exit(failures.length ? 1 : 0)
