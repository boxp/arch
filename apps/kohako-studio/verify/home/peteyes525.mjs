// BOXP-525: 実マウス・タッチの連続描画から、なで閉眼と解除、無効条件を検証する。
// Playwright コンテナで node peteyes525.mjs <dist> <出力先>。BFF は完全モック。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.argv[2], OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/kohako\//, '/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8773)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), result = {}, failures = []
const check = (ok, s) => { if (!ok) failures.push(s) }
async function open(name, config, prefs) {
  const context = await browser.newContext(config), page = await context.newPage()
  await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); const data = p === 'me' ? { user: 'verify' } : p === 'conversation' ? { enabled: true, stt: false } : p === 'messages' ? { status: 'accepted' } : p.startsWith('requests/') ? { status: 'done', reply: { text: 'いいよ、うん、おおきいね。こんにちは。' } } : {}; return r.fulfill({ status: p === 'messages' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(data) }) })
  if (prefs) await context.addInitScript(p => localStorage.setItem('kohako-home-prefs', JSON.stringify(p)), prefs)
  await page.goto('http://localhost:8773/kohako/home.html'); await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, { timeout: 60000 }); await page.waitForTimeout(2000)
  const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head)
  const clip = { x: Math.max(0, Math.round(a.x - 20)), y: Math.max(0, Math.round(a.y - 20)), width: Math.round(a.w + 40), height: Math.round(a.h + 40) }
  const measure = async label => {
    const png = await page.screenshot({ clip, scale: 'css' }); fs.writeFileSync(`${OUT}/${name}-${label}.png`, png)
    const blue = await page.evaluate(async ([b, box]) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob()), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); const d = g.getImageData(box.x, box.y, box.w, box.h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i+2] > 110 && d[i+2] > d[i]+45 && d[i+2] > d[i+1]+25) n++; return n }, [png.toString('base64'), { x: Math.round(a.x - clip.x + a.w * .2), y: Math.round(a.y - clip.y + a.h * .3), w: Math.round(a.w * .6), h: Math.round(a.h * .55) }])
    const report = await page.evaluate(() => ({ headZ: window.__kohakoHome.report.petFollow?.headZ, wanted: window.__kohakoHome.report.petEyes, mouth: window.__kohakoHome.report.mouth }))
    return { blue, ...report }
  }
  return { context, page, a, measure }
}
async function input(page, touch, a) {
  const cdp = touch ? await page.context().newCDPSession(page) : null, y = a.y + a.h * .35, from = [a.x + a.w * .45, y], to = [a.x + a.w * .65, y]
  const move = async p => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }) : page.mouse.move(...p)
  return { from, to, move, down: async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] }) : (await page.mouse.move(...from), page.mouse.down()), up: async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up(), cancel: async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }) : move([a.x + a.w + 200, y]) }
}
async function speaking(name, config, touch) {
  const { context, page, measure } = await open(name, config)
  await page.evaluate(() => { document.querySelector('#speech').checked = false }); await page.fill('#message', 'こんにちは'); await page.evaluate(() => document.querySelector('#form').requestSubmit())
  await page.waitForFunction(() => window.__kohakoHome.state === 'speaking', null, { timeout: 15000 })
  // 返答の表示で舞台の配置が変わるので、読み上げが始まってから頭の位置を取り直す。
  const io = await input(page, touch, await page.evaluate(() => window.__kohakoHome.hitAreas().head))
  await io.down(); await io.move(io.to)
  const samples = await frames(page, measure, 'speaking', 8, 80)
  await io.up(); result[name] = samples
  check(samples.filter(x => x.wanted).length >= 2 && Math.max(...samples.filter(x => x.wanted).map(x => x.mouth)) - Math.min(...samples.filter(x => x.wanted).map(x => x.mouth)) > 0.01, `${name}: なで中の口形が変化しない`)
  await context.close()
}
async function frames(page, measure, prefix, n, delay = 150) { const out = []; for (let i = 0; i < n; i++) { out.push(await measure(`${prefix}-${i}`)); if (i < n - 1) await page.waitForTimeout(delay) } return out }
async function scenario(name, config, touch, prefs, disabled = false) {
  const { context, page, a, measure } = await open(name, config, prefs), io = await input(page, touch, a), out = { head: a }
  out.idle = await frames(page, measure, 'idle', 6); const baseline = Math.max(...out.idle.map(x => x.blue)); out.baseline = baseline; check(baseline > 10, `${name}: 瞳を検出できない ${baseline}`)
  out.cycles = []
  for (let k = 0; k < (disabled ? 1 : 3); k++) {
    await io.down(); await io.move(io.to); await page.waitForTimeout(700)
    const during = []; for (let i = 0; i < 6; i++) { await io.move(i % 2 ? io.to : io.from); during.push(await measure(`cycle${k}-during-${i}`)); await page.waitForTimeout(150) }
    await io.up(); const release = []; let last = 0; for (const t of [150, 400, 1500, 2000, 2500, 3000]) { await page.waitForTimeout(t-last); release.push(await measure(`cycle${k}-release-${t}`)); last = t }
    out.cycles.push({ during, release })
    check(disabled ? Math.max(...during.map(x => x.blue)) >= baseline*.6 : during.every(x => x.blue <= baseline*.15), `${name} cycle${k}: なで中 ${during.map(x => x.blue)} baseline ${baseline}`)
    if (!disabled) { check(Math.max(...release.slice(2).map(x => x.blue)) >= baseline*.6, `${name} cycle${k}: 解除後に開かない ${release.map(x => x.blue)}`); check(during.some(x => Math.abs(x.headZ) > 3), `${name} cycle${k}: 頭追従なし`) }
  }
  if (!disabled) {
    await io.down(); await io.move(io.to); await page.waitForTimeout(900); out.cancelBefore = await frames(page, measure, 'cancel-before', 3); await io.cancel(); await page.waitForTimeout(1500); out.cancelAfter = await frames(page, measure, 'cancel-after', 4); if (!touch) await io.up()
    check(out.cancelBefore.every(x => x.blue <= baseline*.15), `${name}: 取消前に閉じない`); check(Math.max(...out.cancelAfter.map(x => x.blue)) >= baseline*.6, `${name}: 取消後に開かない`)
    await page.waitForTimeout(3000)
    if (!touch) { const hover = []; for (let i = 0; i < 6; i++) { await io.move(i % 2 ? io.to : io.from); hover.push(await measure(`hover-${i}`)); await page.waitForTimeout(150) } out.hover = hover; check(Math.max(...hover.map(x => x.blue)) >= baseline*.6, `${name}: hover で閉眼`) }
    await io.down(); await page.waitForTimeout(200); await io.up(); out.headTap = await frames(page, measure, 'head-tap', 5); check(Math.max(...out.headTap.map(x => x.blue)) >= baseline*.6, `${name}: 頭 tap で閉眼`)
    await page.waitForTimeout(3000); const hand = await page.evaluate(() => window.__kohakoHome.hitAreas().hands.find(Boolean)); if (hand) { const x = hand.x + hand.w/2, y = hand.y + hand.h/2; if (touch) { const c = await context.newCDPSession(page); await c.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] }); await c.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }) } else await page.mouse.click(x,y); out.handTap = await frames(page, measure, 'hand-tap', 5); check(Math.max(...out.handTap.map(x => x.blue)) >= baseline*.6, `${name}: 手 tap で閉眼`) } else failures.push(`${name}: 手領域なし`)
  }
  result[name] = out; await context.close(); console.log(name, 'baseline', baseline, 'during', out.cycles.map(x => x.during.map(y => y.blue)), 'release', out.cycles.map(x => x.release.map(y => y.blue)))
}
try {
  const pc = { viewport: { width: 1280, height: 800 } }
  await scenario('pc', pc, false); await scenario('pixel7', devices['Pixel 7'], true)
  await speaking('pc-speaking', pc, false); await speaking('pixel7-speaking', devices['Pixel 7'], true)
  await scenario('off', pc, false, { touch: false }, true); await scenario('reduced', { ...pc, reducedMotion: 'reduce' }, false, null, true)
} catch (e) { failures.push(String(e.stack || e)) }
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ result, failures }, null, 2)); console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS'); await browser.close(); srv.close(); process.exit(failures.length ? 1 : 0)
