// BOXP-581 (再報告): 実際の家の会話・Task Board 通知の文面のように票 ID やパスを文字で書いただけでも
// 「Obsidianで開く」リンクになることを、ローカル BFF + 認証済み Hermes のモックで PC と Pixel 7 相当(タッチ)について確認する。
// npm run build in bff/web first. Run with Playwright 1.56.1 and OUT set outside vault.
// 確認できるのは「ページが obsidian:// の起動要求を出し、ページ自体は遷移・新規タブを作らない」までで、実際にアプリでノートが開くかは実機で確認する。
import { chromium, devices } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../bff/dist/app.js'
import { createHermes } from '../../bff/dist/hermes.js'
import { createNotifications } from '../../bff/dist/notifications.js'
const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const enc = p => encodeURIComponent(p).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const url = p => `obsidian://open?vault=BOXP&file=${enc(p)}`
// 2026-11-17 の実応答(Langfuse)を元にした文面。票 ID・絶対パス・コード表記のパスを文字で書いている。
const text = [
  'ご主人さま、BOXP-592（コハコの家の将来構想の件）を、その原点に立ち返る内容へ更新し、Fableさんへ再依頼しました。',
  '調べたノートは /home/boxp/Documents/obsidian-headless/BOXP/Projects/コハコの家/将来構想.md です。票は `Tickets/BOXP-581.md` にあります。',
  '作業ブランチ codex-task-board/BOXP-581-20261117T011635Z と BOXP-581-links はリンクにしません。PR: [arch#15213](https://github.com/boxp/arch/pull/15213)',
].join('\n\n')
const replyNotes = [url('Tickets/BOXP-592.md'), url('Projects/コハコの家/将来構想.md'), url('Tickets/BOXP-581.md')]
const notice = {
  eventId: 'BOXP-590-20261117T094636Z-fixture-done',
  source: 'task-board-route',
  eventType: 'done',
  ticketId: 'BOXP-590',
  title: '【Task Board 通知】BOXP-590：archのRenovate滞留整理',
  body: '【Task Board 通知】BOXP-590：archのRenovate滞留整理\n\nご主人さま、claude-opusさんの報告では、**残るRenovate PRは1件**になりました。\n\n残る **[PR #13440](https://github.com/boxp/arch/pull/13440)** は、今回の承認範囲外として停止しています。関連: BOXP-569、BOXP-459。',
  createdAt: new Date().toISOString(),
}
const noticeNotes = [url('Tickets/BOXP-590.md'), url('Tickets/BOXP-569.md'), url('Tickets/BOXP-459.md')]
const hermes = createHermes({ url: 'http://fixture-hermes', key: 'fixture-only-key', fetch: async (u, options) => {
  if (options.headers.Authorization !== 'Bearer fixture-only-key') throw Error('missing server auth')
  const p = new URL(u).pathname
  if (p === '/v1/toolsets') return Response.json({ data: [] })
  if (p === '/v1/runs') return Response.json({ run_id: 'fixture-run-581' })
  if (p === '/v1/runs/fixture-run-581') return Response.json({ status: 'completed', output: text })
  throw Error('unexpected upstream ' + u)
} })
const notifications = await createNotifications(await mkdtemp(join(tmpdir(), 'n581-')), async () => ({ pushSkipped: 'no-subscriptions' }))
await notifications.ingest(notice)
const push = { publicKey: () => undefined, list: () => [], status: () => ({ subscriptions: 0 }) }
const app = createApp({ authenticate: async h => h.cookie === 'fixture=owner' ? 'owner' : null, hermes, notifications, push })
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/kohako/api/')) return app(req, res)
  try { const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/kohako\//, ''); const data = await readFile(join(root, 'web/dist', path)); res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' }); res.end(data) } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(8799, '0.0.0.0', r))
const browser = process.env.PW_WS ? await chromium.connect(process.env.PW_WS) : await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] })
const results = {}, fail = []
const check = (label, name, ok, detail) => { results[label][name] = ok ? 'PASS' : `FAIL ${JSON.stringify(detail ?? '')}`; if (!ok) fail.push(`${label}:${name}`) }
const anchors = loc => loc.evaluateAll(as => as.map(a => ({ cls: a.className, href: a.getAttribute('href'), target: a.target, text: a.textContent })))
async function launch(page, label, link, expected) {
  await page.evaluate(() => { window.__clicks = []; if (!window.__listening) window.__listening = addEventListener('click', e => { const a = e.target.closest('a'); if (a) window.__clicks.push({ href: a.getAttribute('href'), prevented: e.defaultPrevented }) }) || true })
  const before = page.url()
  await link.scrollIntoViewIfNeeded()
  if (label === 'pixel7') await link.tap(); else await link.click()
  await page.waitForTimeout(800)
  const clicks = await page.evaluate(() => window.__clicks)
  return clicks.length === 1 && clicks[0].href === expected && !clicks[0].prevented && page.url() === before
}
try {
  for (const [label, options] of [['pc', { viewport: { width: 1280, height: 900 } }], ['pixel7', { ...devices['Pixel 7'] }]]) {
    results[label] = {}
    const ctx = await browser.newContext(options)
    await ctx.addCookies([{ name: 'fixture', value: 'owner', url: 'http://localhost:8799' }])
    const page = await ctx.newPage(), popups = []
    page.on('popup', p => popups.push(p.url()))
    await page.goto('http://localhost:8799/kohako/home.html?acting=0&face=static')
    await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await page.fill('#message', '票の状況は？'); await page.click('#send')
    await page.waitForFunction(() => document.querySelectorAll('#reply a.obsidian-note').length >= 3)
    const links = await anchors(page.locator('#reply a')), notes = links.filter(l => l.cls === 'obsidian-note')
    check(label, 'reply-plain-refs-linked', JSON.stringify(notes.map(n => n.href)) === JSON.stringify(replyNotes), notes)
    check(label, 'reply-labels', notes.map(n => n.text).join('|') === 'BOXP-592Obsidianで開く|将来構想Obsidianで開く|BOXP-581Obsidianで開く', notes)
    check(label, 'reply-same-tab', notes.every(n => n.target === ''), notes)
    check(label, 'branch-names-not-linked', (await page.locator('#reply').textContent()).includes('codex-task-board/BOXP-581-20261117T011635Z と BOXP-581-links'), null)
    check(label, 'https-link-kept', links.some(l => l.href === 'https://github.com/boxp/arch/pull/15213' && l.target === '_blank'), links)
    check(label, 'history-has-notes', (await page.locator('#history-list a.obsidian-note').count()) >= 3)
    await page.screenshot({ path: join(process.env.OUT, `${label}-reply.png`) })
    check(label, 'reply-launch-request', await launch(page, label, page.locator('#reply a.obsidian-note').nth(1), replyNotes[1]))
    // 受信箱の通知(実際の Task Board 通知と同じ文面)
    await page.click('#inbox-open')
    await page.locator('#inbox-list .inbox-row').first().click()
    await page.waitForFunction(() => document.querySelectorAll('#inbox-detail a.obsidian-note').length >= 3)
    const inbox = await anchors(page.locator('#inbox-detail a')), inboxNotes = inbox.filter(l => l.cls === 'obsidian-note')
    check(label, 'notice-plain-refs-linked', JSON.stringify(inboxNotes.map(n => n.href)) === JSON.stringify(noticeNotes), inboxNotes)
    check(label, 'notice-https-link-kept', inbox.some(l => l.href === 'https://github.com/boxp/arch/pull/13440'), inbox)
    const box = await page.locator('#inbox-detail a.obsidian-note').first().boundingBox(), vw = page.viewportSize().width
    check(label, 'notice-fits-viewport', box && box.x >= 0 && box.x + box.width <= vw, { box, vw })
    await page.screenshot({ path: join(process.env.OUT, `${label}-inbox.png`) })
    check(label, 'notice-launch-request', await launch(page, label, page.locator('#inbox-detail a.obsidian-note').first(), noticeNotes[0]))
    check(label, 'no-popups', popups.length === 0, popups)
    await ctx.close()
  }
  results.fail = fail
  await writeFile(join(process.env.OUT, 'result.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  if (fail.length) process.exitCode = 1
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)) }
