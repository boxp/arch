// BOXP-510: 顔の差分と通常表示への復帰を最終描画の画素で確認する。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = 8797
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
for (const c of [{ name: 'pc', viewport: { width: 1280, height: 800 } }, { name: 'pixel7', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 }]) {
  const { name, ...config } = c, ctx = await browser.newContext({ ...config, reducedMotion: 'reduce' }), page = await ctx.newPage()
  page.on('request', q => { if (new URL(q.url()).hostname !== 'localhost') external.push(q.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort())
  await ctx.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.split('/v1/')[1]; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === 'me' ? { authenticated: true } : p === 'conversation' ? { enabled: true, stt: false } : p === 'notifications' ? { items: [], unread: 0 } : {}) }) })
  try {
    await page.goto(`http://localhost:${port}/kohako/home.html?acting=0`)
    await page.waitForFunction(() => window.__kohakoHome?.report?.loaded && window.__kohakoHome.stage, null, { timeout: 60000 })
    await page.waitForTimeout(1800)
    const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head)
    const clip = { x: Math.max(0, Math.floor(a.x)), y: Math.max(0, Math.floor(a.y)), width: Math.ceil(a.w), height: Math.ceil(a.h) }
    const stats = results[name] = {}
    for (const emotion of ['neutral', 'smile', 'smileClosed', 'shy', 'troubled', 'surprised', 'neutralAfter']) {
      await page.evaluate(e => window.__kohakoHome.stage.setEmotion(e === 'neutralAfter' ? 'neutral' : e), emotion)
      await page.waitForTimeout(1500)
      const png = await page.screenshot({ clip, scale: 'css' }); fs.writeFileSync(`${out}/${name}-${emotion}.png`, png)
      stats[emotion] = await page.evaluate(async b64 => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, img.width, img.height).data; let blue = 0, red = 0
        for (let y = Math.floor(img.height * .25); y < img.height * .85; y++) for (let x = Math.floor(img.width * .2); x < img.width * .8; x++) {
          const i = (y * img.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2]
          if (b > 110 && b > r + 45 && b > g + 25) blue++
          if (r > 150 && r > g + 18 && r > b + 10) red += r - g
        }
        return { blue, red }
      }, png.toString('base64'))
    }
    const s = stats
    if (!(s.shy.red > s.neutral.red * 1.05)) failures.push(`${name}: 赤みの増加不足`)
    if (!(s.smileClosed.blue < s.neutral.blue * .65 && s.smileClosed.blue < s.smile.blue * .65)) failures.push(`${name}: 閉眼の青画素の減少不足`)
    if (!(Math.abs(s.neutralAfter.red - s.neutral.red) < Math.max(100, s.neutral.red * .2) && s.neutralAfter.blue > s.smileClosed.blue * 1.5)) failures.push(`${name}: 通常表示への復帰不足`)
  } catch (e) { failures.push(`${name}: ${e.message}`) }
  await ctx.close()
}
await browser.close(); server.close()
if (external.length) failures.push(`外部通信 ${external.length} 件`)
fs.writeFileSync(`${out}/variants510.json`, JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external: external.length }, null, 2))
process.exit(failures.length ? 1 : 0)
