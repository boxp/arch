// Run in the Playwright container with the built site at /site/kohako and playwright at /pw.
import { chromium, devices } from '/pw/playwright/index.mjs'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' }
const srv = http.createServer((q,r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join('/site',p), (e,d) => { if(e) { r.writeHead(404); return r.end() } r.writeHead(200,{'content-type':types[path.extname(p)] || 'application/octet-stream'}); r.end(d) }) }).listen(8767)
fs.mkdirSync('/out', { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), result = {}
for (const [name, config] of [['pc', { viewport: { width:1280, height:800 } }], ['pixel7', devices['Pixel 7']]]) {
 const context = await browser.newContext(config), page = await context.newPage()
 await context.route('**/kohako/api/v1/**', r => { const p = new URL(r.request().url()).pathname.replace('/kohako/api/v1/', ''); const data = p === 'me' ? { user:'verify' } : p === 'conversation' ? { enabled:true, stt:false } : p === 'messages' ? { status:'accepted' } : p.startsWith('requests/') ? { status:'done', reply:{ text:'いいよ、うん、おおきいね' } } : {}; return r.fulfill({ status: p === 'messages' ? 202 : 200, contentType:'application/json', body:JSON.stringify(data) }) })
 await page.goto('http://localhost:8767/kohako/home.html'); await page.waitForFunction(() => window.__kohakoHome?.report.loaded && window.__kohakoHome.state !== 'offline', null, {timeout:30000})
 await page.evaluate(() => { document.querySelector('#speech').checked = false }); await page.fill('#message','こんにちは'); await page.evaluate(() => document.querySelector('#form').requestSubmit())
 await page.waitForFunction(() => window.__kohakoHome.state === 'speaking', null, {timeout:15000})
 const samples = [], images = {}
 for (let i=0;i<80;i++) { const v = await page.evaluate(() => ({ viseme:window.__kohakoHome.report.viseme, mouth:window.__kohakoHome.report.mouth })); samples.push(v); if (['i','u','o'].includes(v.viseme) && !images[v.viseme]) { const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head); if(a && a.x >= 0 && a.y >= 0) { await page.screenshot({ path:`/out/${name}-${v.viseme}.png`, clip:{ x:a.x, y:a.y, width:a.w, height:a.h } }); images[v.viseme]=true } } await page.waitForTimeout(35) }
 await page.waitForTimeout(1000); const a = await page.evaluate(() => window.__kohakoHome.hitAreas().head); const x=a.x+a.w/2, y=a.y+a.h/2
 await page.mouse.move(x,y); await page.waitForTimeout(200); const hover = await page.evaluate(() => window.__kohakoHome.report.petFollow)
 const cdp = name === 'pixel7' ? await context.newCDPSession(page) : null
 if(name === 'pc') { await page.mouse.down(); await page.mouse.move(x+30,y,{steps:8}) } else { await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] }); await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:x+30,y}] }) }
 await page.waitForTimeout(400); const during = await page.evaluate(() => window.__kohakoHome.report.petFollow)
 if(name === 'pc') await page.mouse.up(); else await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] })
 await page.waitForTimeout(1800); const after = await page.evaluate(() => window.__kohakoHome.report.petFollow)
 result[name] = { samples, images, hover, during, after, head:a }; await context.close()
}
fs.writeFileSync('/out/mouthpet.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2)); await browser.close(); srv.close()
