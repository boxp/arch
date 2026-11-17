// BOXP-581: 家の会話の「Obsidianで開く」リンク。ローカル BFF + 認証済み Hermes のモックで、PC と Pixel 7 相当(タッチ)を確認する。
// npm run build in bff/web first. Run with Playwright 1.56.1 and OUT set outside vault.
// 確認できるのは「ページが obsidian:// の起動要求を出し、ページ自体は遷移・新規タブを作らない」までで、実際にアプリでノートが開くかは実機で確認する。
import { chromium, devices } from 'playwright'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../bff/dist/app.js'
import { createHermes } from '../../bff/dist/hermes.js'
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const enc = p => encodeURIComponent(p).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const notePath = 'Projects/kohako-home/調査 (案) メモ&1+2.md', ticket = 'Tickets/BOXP-581.md'
const noteUrl = `obsidian://open?vault=BOXP&file=${enc(notePath)}`, ticketUrl = `obsidian://open?vault=BOXP&file=${enc(ticket)}`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const text = [
  `調べたノートはこちらです: [調査メモ](${noteUrl})`,
  `票: ${ticketUrl}`,
  '開けない例: [新規作成](obsidian://new?vault=BOXP&file=x.md&content=y) / [別vault](obsidian://open?vault=Other&file=a.md) / [js](javascript:alert(1))',
  '既存リンク: [Web](https://example.com/)',
  `![画像](kohako-vault:${enc('attachments/BOXP-581/dot.png')})`,
].join('\n\n')
let runInstructions = []
const hermes = createHermes({ url: 'http://fixture-hermes', key: 'fixture-only-key', fetch: async (url, options) => {
  if (options.headers.Authorization !== 'Bearer fixture-only-key') throw Error('missing server auth')
  const u = new URL(url)
  if (u.pathname === '/v1/toolsets') return Response.json({ data: [] })
  if (u.pathname === '/v1/runs') { runInstructions.push(JSON.parse(options.body).instructions ?? ''); return Response.json({ run_id: 'fixture-run-581' }) }
  if (u.pathname === '/v1/runs/fixture-run-581') return Response.json({ status: 'completed', output: text })
  if (u.pathname === '/v1/kohako/vault-image') {
    if (u.searchParams.get('path') !== 'attachments/BOXP-581/dot.png') return Response.json({}, { status: 404 })
    return Response.json({ mime: 'image/png', data: png.toString('base64') })
  }
  throw Error('unexpected upstream ' + url)
} })
const app = createApp({ authenticate: async h => h.cookie === 'fixture=owner' ? 'owner' : null, hermes })
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/kohako/api/')) return app(req, res)
  try { const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/kohako\//, ''); const data = await readFile(join(root, 'web/dist', path)); res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' }); res.end(data) } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(8799, '0.0.0.0', r))
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS) : await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
const results = {}, fail = []
const check = (label, name, ok, detail) => { results[label][name] = ok ? 'PASS' : `FAIL ${JSON.stringify(detail ?? '')}`; if (!ok) fail.push(`${label}:${name}`) }
try {
  for (const [label, options] of [['pc', { viewport: { width: 1280, height: 900 } }], ['pixel7', { ...devices['Pixel 7'] }]]) {
    results[label] = {}
    const ctx = await browser.newContext(options)
    await ctx.addCookies([{ name: 'fixture', value: 'owner', url: 'http://localhost:8799' }])
    const page = await ctx.newPage(), popups = [], navigations = []
    page.on('popup', p => popups.push(p.url()))
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations.push(f.url()) })
    await page.goto('http://localhost:8799/kohako/home.html?acting=0&face=static')
    await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await page.fill('#message', 'ノートを教えて'); await page.click('#send')
    await page.waitForFunction(() => document.querySelectorAll('#reply a.obsidian-note').length === 2)
    const links = await page.locator('#reply a').evaluateAll(as => as.map(a => ({ cls: a.className, href: a.getAttribute('href'), target: a.target, text: a.textContent, title: a.title })))
    const notes = links.filter(l => l.cls === 'obsidian-note')
    check(label, 'note-href-encoded', notes[0]?.href === noteUrl && notes[1]?.href === ticketUrl, notes)
    check(label, 'note-label', notes[0]?.text === '調査メモObsidianで開く' && notes[1]?.text === 'BOXP-581Obsidianで開く', notes)
    check(label, 'same-tab', notes.every(n => n.target === ''), notes)
    check(label, 'other-schemes-not-links', !links.some(l => /^(obsidian:\/\/(new|open\?vault=Other)|javascript:)/.test(l.href ?? '')), links)
    check(label, 'existing-https-link', links.some(l => l.href === 'https://example.com/' && l.target === '_blank'), links)
    await page.waitForFunction(() => document.querySelector('#reply .vault-image img')?.complete)
    check(label, 'vault-image', await page.locator('#reply .vault-image img').evaluate(i => i.naturalWidth === 1 && !i.hidden))
    check(label, 'history-has-note', (await page.locator('#history-list a.obsidian-note').count()) >= 2)
    const box = await page.locator('#reply a.obsidian-note').first().boundingBox(), vw = page.viewportSize().width
    check(label, 'fits-viewport', box && box.x >= 0 && box.x + box.width <= vw && box.height >= 18, { box, vw })
    await page.locator('#reply a.obsidian-note').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(process.env.OUT, `${label}.png`) })
    // 起動要求の記録: 既定動作を妨げず、クリック後の遷移先を記録する
    await page.evaluate(() => { window.__clicks = []; addEventListener('click', e => { const a = e.target.closest('a'); if (a) window.__clicks.push({ href: a.href, prevented: e.defaultPrevented }) }) })
    const before = page.url(), navCount = navigations.length
    const first = page.locator('#reply a.obsidian-note').first()
    if (label === 'pixel7') await first.tap(); else await first.click()
    await page.waitForTimeout(1000)
    const clicks = await page.evaluate(() => window.__clicks)
    check(label, 'launch-request', clicks.length === 1 && clicks[0].href === noteUrl && !clicks[0].prevented, clicks)
    check(label, 'page-stays', page.url() === before && navigations.length === navCount && popups.length === 0 && (await page.locator('#reply a.obsidian-note').count()) === 2, { url: page.url(), navigations, popups })
    check(label, 'composer-still-usable', !(await page.locator('#send').isDisabled()) || (await page.locator('#message').isEditable()))
    await ctx.close()
  }
  results.instructions = runInstructions.length && runInstructions.every(i => i.includes('obsidian://open?vault=BOXP&file=')) ? 'PASS' : 'FAIL'
  if (results.instructions !== 'PASS') fail.push('instructions')
  results.fail = fail
  await writeFile(join(process.env.OUT, 'result.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  if (fail.length) process.exitCode = 1
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)) }
