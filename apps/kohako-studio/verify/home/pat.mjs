import { chromium } from '/pw/playwright/index.mjs'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
http.createServer((q,r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site',p), (e,d) => { if(e) { r.writeHead(404); return r.end() } r.writeHead(200,{'content-type':types[path.extname(p)] || 'application/octet-stream'}); r.end(d) }) }).listen(8768)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width:1280, height:800 } }), page = await context.newPage()
const posts = []
await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); if (r.request().method()==='POST') posts.push(p); const data = p === 'me' ? { user:'verify' } : p === 'conversation' ? { enabled:true, stt:false } : {}; return r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(data) }) })
await page.goto('http://localhost:8768/kohako/home.html'); await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, {timeout:30000})
await page.waitForTimeout(1500)
const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head), clip = { x:a.x-40, y:a.y-20, width:a.w+80, height:a.h+80 }
const cx=a.x+a.w/2, cy=a.y+a.h/2, out = {}
await page.screenshot({ path:'/out/pat-rest.png', clip })
for (const [name, dx] of [['right', 0.35], ['left', -0.35]]) {
  await page.mouse.move(cx, cy); await page.mouse.down()
  for (let i=0;i<6;i++) { await page.mouse.move(cx + a.w*dx, cy, {steps:5}); await page.mouse.move(cx + a.w*dx*0.4, cy, {steps:5}) }
  await page.mouse.move(cx + a.w*dx, cy, {steps:3}); await page.waitForTimeout(400)
  out[name] = await page.evaluate(() => window.__kohakoHome.report.petFollow)
  await page.screenshot({ path:`/out/pat-${name}.png`, clip })
  await page.mouse.up(); await page.waitForTimeout(1200)
  out[name+'After'] = await page.evaluate(() => window.__kohakoHome.report.petFollow)
}
await page.screenshot({ path:'/out/pat-after.png', clip })
await page.waitForTimeout(2500); out.posts = posts
fs.writeFileSync('/out/pat.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); await browser.close(); process.exit(0)
