// Local BFF + mocked authenticated Hermes transport; existing delivered images, no generation.
// npm run build in bff/web first. Run with Playwright 1.56.1 and CONCEPTS/OUT set outside vault.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../bff/dist/app.js'
import { createHermes } from '../../bff/dist/hermes.js'
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = ['01-wafu.jpg', '02-navi.jpg', '03-barrier.jpg']
const text = paths.map((name, i) => `案${i + 1}\n![案${i + 1}](kohako-vault:${encodeURIComponent('attachments/BOXP-542/' + name)})`).join('\n\n') + '\n\n![欠落](kohako-vault:attachments%2FBOXP-542%2Fmissing.jpg)\n![外部](https://leak.test/x.png)'
let transportCalls = 0
const hermes = createHermes({ url: 'http://fixture-hermes', key: 'fixture-only-key', fetch: async (url, options) => {
  if (options.headers.Authorization !== 'Bearer fixture-only-key') throw Error('missing server auth')
  const u = new URL(url)
  if (u.pathname === '/v1/toolsets') return Response.json({ data: [] })
  if (u.pathname === '/v1/runs') return Response.json({ run_id: 'fixture-run-542' })
  if (u.pathname === '/v1/runs/fixture-run-542') return Response.json({ status: 'completed', output: text })
  if (u.pathname === '/v1/kohako/vault-image') {
    const path = u.searchParams.get('path'), name = path?.slice('attachments/BOXP-542/'.length)
    if (!paths.includes(name) || path !== 'attachments/BOXP-542/' + name) return Response.json({}, { status: 404 })
    transportCalls++
    const data = await readFile(join(process.env.CONCEPTS, name))
    return Response.json({ mime: 'image/jpeg', data: data.toString('base64') })
  }
  throw Error('unexpected upstream ' + url)
} })
const app = createApp({ authenticate: async h => h.cookie === 'fixture=owner' ? 'owner' : h.authorization === 'fixture-verifier' ? 'verifier' : null, hermes })
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/kohako/api/')) return app(req, res)
  try { const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/kohako\//, ''); const data = await readFile(join(root, 'web/dist', path)); res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' }); res.end(data) } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(8798, '0.0.0.0', r))
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
const results = {}
try {
  for (const [label, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 412, height: 915 }]]) {
    const ctx = await browser.newContext({ viewport })
    await ctx.addCookies([{ name: 'fixture', value: 'owner', url: 'http://localhost:8798' }])
    const page = await ctx.newPage(), external = []
    await page.route('**/*', route => { if (route.request().url().includes('leak.test')) { external.push(route.request().url()); return route.abort() } return route.continue() })
    await page.goto('http://localhost:8798/kohako/home.html?acting=0&face=static')
    await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await page.fill('#message', '既存の3案を表示'); await page.click('#send')
    await page.waitForFunction(() => document.querySelectorAll('#reply .vault-image').length === 4)
    for (const image of await page.locator('#reply .vault-image img').all()) await image.evaluate(img => { img.loading = 'eager' })
    await page.waitForFunction(() => [...document.querySelectorAll('#reply .vault-image img')].every(i => i.complete))
    const dimensions = await page.locator('#reply .vault-image img').evaluateAll(items => items.map(i => ({ width: i.naturalWidth, height: i.naturalHeight, hidden: i.hidden })))
    if (dimensions.slice(0, 3).some(i => i.width !== 896 || i.height !== 1200) || !dimensions[3].hidden) throw Error('decode/error-display failure ' + JSON.stringify(dimensions))
    if (external.length) throw Error('external image request leaked')
    const historyImages = await page.locator('#history-list .vault-image').count()
    if (historyImages !== 4) throw Error('history omitted images')
    await page.screenshot({ path: join(process.env.OUT, `${label}.png`) })
    for (let i = 0; i < 3; i++) {
      const image = page.locator('#reply .vault-image img').nth(i)
      await image.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(process.env.OUT, `${label}-concept-${i + 1}.png`) })
      const popupPromise = page.waitForEvent('popup'); await image.click(); const popup = await popupPromise
      await popup.waitForLoadState('load')
      await popup.waitForFunction(() => document.querySelector('img')?.naturalWidth === 896)
      await popup.close()
    }
    results[label] = { dimensions, historyImages, externalRequests: external.length }
    await ctx.close()
  }
  const address = 'http://localhost:8798/kohako/api/v1/vault-image?path=attachments%2FBOXP-542%2F01-wafu.jpg'
  const denied = [await fetch(address), await fetch(address, { headers: { authorization: 'fixture-verifier' } })]
  if (denied[0].status !== 401 || denied[1].status !== 403) throw Error('auth boundary failed')
  console.log(JSON.stringify({ results, denied: denied.map(r => r.status), transportCalls }, null, 2))
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)) }
