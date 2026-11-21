// BOXP-647: 音声失敗後の本文保持を実時間で検証する。
import { chromium } from 'playwright'
import { createStaticServer } from './retention647-static.mjs'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2], site = process.env.SITE, port = Number(process.env.PORT || 8848)
if (!out || !site) throw Error('保存先と SITE が必要です')
fs.mkdirSync(out, { recursive: true })
const server = createStaticServer(site).listen(port, '127.0.0.1')
const browser = process.env.CDP ? await chromium.connectOverCDP(process.env.CDP) : await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
await Promise.all(['pc', 'mobile'].flatMap(device => ['kohaku', 'browser'].map(async voice => {
  const label = `${device}-${voice}`, checks = results[label] = {}, mobile = device === 'mobile', errors = []
  const ctx = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage()
  let count = 0, tts = 0
  const check = (name, ok) => { checks[name] = !!ok; if (!ok) failures.push(`${label}: ${name}`) }
  await page.addInitScript(() => {
    window.__utterances = []
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    Object.defineProperty(window, 'speechSynthesis', { value: { speak(u) { window.__utterances.push(u); setTimeout(() => u.onerror?.({ error: 'mock' }), 30) }, cancel() {}, getVoices() { return [] } } })
  })
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', req => { if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort())
  await page.route('**/kohako/api/v1/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: false })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'tts' && req.method() === 'GET') return json(200, { available: true })
    if (p === 'tts') { tts++; return json(503, {}) }
    if (p === 'messages') { count++; return json(202, { status: 'accepted' }) }
    if (p.startsWith('requests/')) return json(200, { status: 'done', reply: { text: count === 1 ? '音声失敗後も読める返答です。' : '次の返答です。' } })
    return json(200, {})
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#pref-voice').selectOption(voice, { force: true })
    await page.locator('#speech').check({ force: true })
    await page.locator('#message').fill('確認'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('音声失敗後も読める返答です。'), null, { timeout: 20000 })
    const delivered = Date.now()
    await page.waitForFunction(() => document.querySelector('#bubble').dataset.retained === '1', null, { timeout: 20000 })
    check('失敗を表示', await page.locator('#resume-speech').isVisible())
    await page.waitForTimeout(Math.max(0, 67000 - (Date.now() - delivered)))
    check('実時間67秒後に本文を表示', Date.now() - delivered >= 67000 && await page.locator('#reply').isVisible() && await page.evaluate(() => document.body.dataset.scene === 'relax' && document.body.dataset.message === '1'))
    check('本文がエラーパネルに覆われない', await page.evaluate(() => {
      const reply = document.querySelector('#reply'), rect = reply.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + Math.min(20, rect.width / 2), rect.y + Math.min(10, rect.height / 2))
      return !document.querySelector('#voice-error').hidden && document.querySelector('#trouble').hidden && (hit === reply || reply.contains(hit))
    }))
    await page.screenshot({ path: path.join(out, `${label}.png`) })
    const previous = voice === 'kohaku' ? tts : await page.evaluate(() => window.__utterances.length)
    await page.locator('#resume-speech').click()
    await page.waitForFunction(() => !document.querySelector('#resume-speech').hidden, null, { timeout: 20000 })
    check('続きから再試行', (voice === 'kohaku' ? tts : await page.evaluate(() => window.__utterances.length)) > previous)
    await page.locator('#speech').uncheck({ force: true })
    await page.locator('#message').fill('次へ'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#reply').textContent.includes('次の返答です。'), null, { timeout: 20000 })
    if (voice === 'browser') await page.evaluate(() => window.__utterances[0]?.onerror?.({ error: 'late' }))
    check('次の返答に切替', await page.locator('#reply').textContent() === '次の返答です。')
    if (voice === 'browser') check('遅延エラーで次の返答を変更しない', await page.locator('#bubble').getAttribute('data-retained') === '1' && !(await page.locator('#resume-speech').isVisible()))
    check('ページエラーなし', errors.length === 0)
  } catch (e) { failures.push(`${label}: ${e.message}`); checks.exception = e.message; await page.screenshot({ path: path.join(out, `${label}-failure.png`) }).catch(() => {}) }
  await ctx.close()
})))
await browser.close(); server.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
