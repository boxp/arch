// BOXP-510 TD-04: 全身モデル v11r の表情差分（照れの赤面・にっこりの閉じ目）と通常表示への復帰を、最終描画の画素で確かめる。
// BFF は完全にモック。PC と Pixel 7 相当で、頭の周りを高解像度で撮影する。
// - 目: 各表情で 150ms おきに 6 枚撮り、青い瞳の画素数の最大値を使う（自動まばたきに当たっても開いた目のどれかが写る）。
//   にっこりは 6 枚すべてで青が少ない（＝閉じ続けている）こと。発話の口・頭をなでる動きを重ねても閉じたままであること。
// - 頬: 顔の下半分の肌色の画素について、赤みの平均 (R-G) の中央値を使う。照れは通常より増え、通常へ戻すと元へ戻ること。
// 使い方: ビルドを SITE（既定 /site）の kohako/ に置き、`node variants510.mjs /out`。失敗または外部通信があれば終了コード 1。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8797)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

async function measure(page, clip) {
  const png = await page.screenshot({ clip, scale: 'device' })
  const m = await page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data; let blue = 0, skin = 0, red = 0
    for (let y = Math.floor(img.height * .25); y < img.height * .85; y++) for (let x = Math.floor(img.width * .2); x < img.width * .8; x++) {
      const i = (y * img.width + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2]
      if (b > 110 && b > r + 45 && b > gg + 25) blue++
      // 肌（明るく赤みが勝つ）。髪（暗い）・瞳（青）・白目（灰白）は入らない。頬は顔の下半分。
      if (y > img.height * .5 && r > 200 && gg > 120 && b > 110 && r >= gg && r - b < 90) { skin++; red += r - gg }
    }
    return { blue: blue / (img.width * img.height) * 1e4, redness: skin ? red / skin : 0, skin }
  }, png.toString('base64'))
  return { ...m, png }
}
async function shots(page, clip, name, n = 6) {
  const list = []
  for (let k = 0; k < n; k++) { list.push(await measure(page, clip)); await page.waitForTimeout(150) }
  fs.writeFileSync(`${out}/${name}.png`, list.reduce((best, item) => item.blue > best.blue ? item : best).png)
  const blues = list.map(s => s.blue)
  return { blueMax: Math.max(...blues), blueMin: Math.min(...blues), redness: median(list.map(s => s.redness)), skin: median(list.map(s => s.skin)) }
}

const CASES = [
  { name: 'pc', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' },
  { name: 'pixel7', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, reducedMotion: 'reduce' },
]
for (const c of CASES) {
  const { name, ...config } = c, ctx = await browser.newContext(config), page = await ctx.newPage()
  page.on('request', q => { if (new URL(q.url()).hostname !== 'localhost') external.push(q.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort())
  await ctx.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.split('/v1/')[1]; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === 'me' ? { authenticated: true } : p === 'conversation' ? { enabled: true, stt: false } : p === 'notifications' ? { items: [], unread: 0 } : {}) }) })
  const s = results[name] = {}
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0`)
    await page.waitForFunction(() => window.__kohakoHome?.report?.loaded && window.__kohakoHome.stage, null, { timeout: 60000 })
    await page.waitForTimeout(1800)
    const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head)
    const clip = { x: Math.max(0, Math.floor(a.x)), y: Math.max(0, Math.floor(a.y)), width: Math.ceil(a.w), height: Math.ceil(a.h) }
    const set = e => page.evaluate(e => window.__kohakoHome.stage.setEmotion(e), e)
    for (const e of ['neutral', 'smile', 'smileClosed', 'shy', 'troubled', 'surprised', 'serious']) { await set(e); await page.waitForTimeout(1500); s[e] = await shots(page, clip, `${name}-${e}`) }
    for (const e of ['troubled', 'surprised']) { await set(e); await page.waitForTimeout(1200); await set('neutral'); await page.waitForTimeout(1800); s[`${e}After`] = await shots(page, clip, `${name}-${e}-after`) }
    // にっこりのまま発話の口と頭なでを重ねる
    await set('smileClosed'); await page.waitForTimeout(1200)
    await page.evaluate(() => { const st = window.__kohakoHome.stage; st.setViseme?.({ open: 0.7, width: 1 }); st.setPetOffset?.({ headX: 8, headY: 0, headZ: 5 }) })
    await page.waitForTimeout(600)
    s.smileClosedTalkPet = await shots(page, clip, `${name}-smileClosed-talk-pet`)
    await page.evaluate(() => { const st = window.__kohakoHome.stage; st.setViseme?.(null); st.setPetOffset?.({ headX: 0, headY: 0, headZ: 0 }) })
    // 照れ → 通常へ戻す
    await set('shy'); await page.waitForTimeout(1500)
    await set('neutral'); await page.waitForTimeout(2000)
    s.neutralAfter = await shots(page, clip, `${name}-neutral-after`)
    s.facePatch = await page.evaluate(() => { const f = window.__kohakoHome.stage.report?.().facePatch; return f && { patched: f.patched, blush: typeof f.setBlush } })
    const diff = async (a, b) => page.evaluate(async ([a, b]) => {
      const read = async s => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data }
      const x = await read(a), y = await read(b); let sum = 0; for (let i = 0; i < x.length; i += 4) sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]); return sum / (x.length / 4 * 3)
    }, [fs.readFileSync(`${out}/${name}-${a}.png`).toString('base64'), fs.readFileSync(`${out}/${name}-${b}.png`).toString('base64')])
    s.differences = { troubled: await diff('neutral', 'troubled'), surprised: await diff('neutral', 'surprised'), troubledAfter: await diff('neutral', 'troubled-after'), surprisedAfter: await diff('neutral', 'surprised-after') }
    const n = s.neutral
    if (!(s.surprised.blueMax < n.blueMax * .9)) failures.push(`${name}: 驚きの虹彩が小さく見えない (${n.blueMax} → ${s.surprised.blueMax})`)
    if (!(s.differences.troubled > 5 && s.troubled.blueMax < n.blueMax * .95 && Math.abs(s.troubledAfter.blueMax - n.blueMax) < n.blueMax * .15)) failures.push(`${name}: 困りの差分または復帰が不十分 (${JSON.stringify(s.differences)})`)
    if (!(s.differences.surprised > 5 && Math.abs(s.surprisedAfter.blueMax - n.blueMax) < n.blueMax * .15)) failures.push(`${name}: 驚きからの復帰が不十分 (${JSON.stringify(s.differences)})`)
    if (s.facePatch?.blush !== 'function') failures.push(`${name}: 頬の赤みを付ける処理が使えない (${JSON.stringify(s.facePatch)})`)
    if (!(s.shy.redness > n.redness + 2)) failures.push(`${name}: 照れの頬の赤みが足りない (通常 ${n.redness.toFixed(1)} 照れ ${s.shy.redness.toFixed(1)})`)
    if (!(Math.abs(s.neutralAfter.redness - n.redness) < 2)) failures.push(`${name}: 通常へ戻しても赤みが残る (通常 ${n.redness.toFixed(1)} 戻した後 ${s.neutralAfter.redness.toFixed(1)})`)
    if (!(s.smileClosed.blueMax < n.blueMax * .2 && s.smileClosed.blueMax < s.smile.blueMax * .2)) failures.push(`${name}: にっこりで目が閉じていない (青 通常 ${n.blueMax.toFixed(1)} 笑顔 ${s.smile.blueMax.toFixed(1)} にっこり ${s.smileClosed.blueMax.toFixed(1)})`)
    if (!(s.smileClosedTalkPet.blueMax < n.blueMax * .2)) failures.push(`${name}: 発話・なでを重ねると目が開く (${s.smileClosedTalkPet.blueMax.toFixed(1)})`)
    if (!(s.smile.blueMax > n.blueMax * .6)) failures.push(`${name}: 通常の笑顔まで目が閉じた (${s.smile.blueMax.toFixed(1)})`)
    if (!(s.neutralAfter.blueMax > n.blueMax * .6)) failures.push(`${name}: 通常へ戻しても目が開かない (${s.neutralAfter.blueMax.toFixed(1)})`)
  } catch (e) { failures.push(`${name}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
if (external.length) failures.push(`外部通信 ${external.length} 件`)
fs.writeFileSync(`${out}/variants510.json`, JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ failures, external: external.length, summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x && 'blueMax' in x).map(([e, x]) => [e, `blue ${x.blueMax.toFixed(1)}/${x.blueMin.toFixed(1)} red ${x.redness.toFixed(1)}`]))])) }, null, 1))
process.exit(failures.length ? 1 : 0)
