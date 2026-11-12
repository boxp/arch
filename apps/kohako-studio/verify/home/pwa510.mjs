// BOXP-510: SITE/kohako にビルドを置き node pwa510.mjs /out で実行。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8773)
fs.mkdirSync(out, { recursive: true })
let posts = 0, networkDown = false
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  if (networkDown) { req.socket.destroy(); return }
  const p = new URL(req.url, 'http://localhost').pathname
  if (p.startsWith('/kohako/api/')) {
    if (req.method === 'POST') posts++
    const endpoint = p.split('/').pop()
    const data = endpoint === 'me' ? { authenticated: true } : endpoint === 'conversation' ? { enabled: true, stt: false } : endpoint === 'notifications' ? { items: [], unread: 0 } : {}
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return
  }
  const filePath = ['/kohako/sw.js', '/kohako/manifest.webmanifest'].includes(p) ? p.replace('/kohako/', '/kohako/kohako/') : p
  fs.readFile(path.join(site, filePath), (err, data) => { if (err) { res.writeHead(404); res.end(); return }; res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data) })
}).listen(port)
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
const assert = (v, m) => { if (!v) throw Error(m) }
for (const [device, viewport, mobile] of [['pc', { width: 1280, height: 800 }, false], ['pixel7', { width: 412, height: 915 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'allow' }), page = await ctx.newPage()
  page.on('request', req => { if (new URL(req.url()).hostname !== 'localhost') external.push(req.url()) })
  await ctx.route(/^https?:\/\/(?!localhost)/, route => route.abort())
  try {
    const base = `http://localhost:${port}`
    await page.goto(`${base}/kohako/home.html?acting=0&face=static`)
    const manifest = await page.evaluate(async () => (await fetch('/kohako/manifest.webmanifest')).json())
    for (const [key, value] of Object.entries({ id: '/kohako/home.html', start_url: '/kohako/home.html', scope: '/kohako/', display: 'standalone', name: 'コハコの家', short_name: 'コハコ', theme_color: '#f3eef9', background_color: '#f3eef9' })) assert(manifest[key] === value, `${key}: ${manifest[key]}`)
    for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const icon = manifest.icons.find(i => i.sizes === size && i.purpose === purpose && i.type === 'image/png')
      assert(icon, `missing icon ${size} ${purpose}`)
      const dimensions = await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return `${img.naturalWidth}x${img.naturalHeight}` }, icon.src)
      assert(dimensions === size, `icon ${icon.src}: ${dimensions}`)
    }
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
    const cdp = await ctx.newCDPSession(page), installability = await cdp.send('Page.getInstallabilityErrors')
    assert(installability.installabilityErrors.length === 0, `installability: ${JSON.stringify(installability)}`)
    await page.evaluate(() => fetch('/kohako/api/v1/me'))
    const keys = await page.evaluate(async () => { const result = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(request.url); return result })
    assert(keys.length > 0 && keys.every(k => new URL(k).pathname === '/kohako/kohako/offline-v1.html'), `cache: ${keys}`)
    const source = fs.readFileSync(path.join(site, 'kohako/kohako/sw.js'), 'utf8')
    assert(source.includes("addEventListener('push'") && source.includes("addEventListener('notificationclick'"), 'push handlers missing')
    const before = posts
    // Chromium の SW からの通信も遮断する（context の offline 設定は SW に伝播しない）。
    networkDown = true
    await ctx.setOffline(true)
    await page.goto(`${base}/kohako/home.html`)
    assert((await page.locator('body').innerText()).includes('未送信のメッセージは送られていません'), 'offline message missing')
    assert(await page.locator('form').count() === 0 && posts === before, 'offline page sent a POST')
    networkDown = false
    await ctx.setOffline(false)
    await page.reload()
    assert(await page.locator('#message').count() === 1, 'home did not recover')
    results[device] = { manifest, cache: keys, installability: installability.installabilityErrors, offline: true, recovered: true }
  } catch (e) { failures.push(`${device}: ${e.message}`); await page.screenshot({ path: `${out}/${device}-failure.png` }).catch(() => {}) }
  networkDown = false
  await ctx.close()
}
if (external.length) failures.push(`external requests: ${external.join(', ')}`)
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ failures, external: external.length }))
await browser.close(); server.close(); process.exit(failures.length ? 1 : 0)
