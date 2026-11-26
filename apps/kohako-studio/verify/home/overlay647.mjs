// BOXP-647: BFF mocked; all non-local requests blocked.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { createStaticServer } from './retention647-static.mjs'
const { chromium } = createRequire(path.join(process.env.RUN_WORKSPACE, 'package.json'))('playwright')
const out = process.argv[2], site = process.env.SITE, port = Number(process.env.PORT || 8848)
fs.mkdirSync(out, { recursive: true })
const server = createStaticServer(site).listen(port, '127.0.0.1')
const assets = process.env.PUBLIC ? createStaticServer(process.env.PUBLIC).listen(port + 1, '127.0.0.1') : null
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = [], external = []
await Promise.all([['pc', { width: 1440, height: 900 }, false], ['portrait', { width: 412, height: 915 }, true], ['landscape', { width: 915, height: 412 }, true]].map(async ([name, viewport, mobile]) => {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }), page = await ctx.newPage(), checks = results[name] = {}
  let deliveries = 0
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const check = async (key, value) => { checks[key] = !!value; if (!value) failures.push(`${name}: ${key}`) }
  page.on('request', req => { if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()) })
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort())
  if (process.env.UPSTREAM) await page.route(`http://127.0.0.1:${port}/**`, async route => {
    const url = new URL(route.request().url())
    const response = await fetch(`${process.env.UPSTREAM}${url.pathname}`)
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  // public の大きな追跡済み画像はコピーせず、同一ホストの読み取り専用サーバーから参照する。
  if (assets || process.env.ASSET_PORT) await page.route('**/kohako/kohako/**', async route => {
    const url = new URL(route.request().url())
    const response = await fetch(`http://127.0.0.1:${assets ? port + 1 : process.env.ASSET_PORT}${url.pathname.slice('/kohako'.length)}`)
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  await page.route('**/kohako/api/v1/**', route => {
    const p = new URL(route.request().url()).pathname.split('/v1/')[1]
    if (p === 'messages') deliveries++
    const data = p === 'me' ? { authenticated: true } : p === 'conversation' ? { enabled: true, stt: false } : p === 'status' ? { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } } : p === 'notifications' ? { items: [], unread: 0 } : p === 'messages' ? { status: 'accepted' } : p.startsWith('requests/') ? { status: 'done', reply: { text: `返答${deliveries}です。 https://example.com/` } } : {}
    return route.fulfill({ status: p === 'messages' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/kohako/home.html?acting=0&face=static&daypart=day`)
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
    await page.locator('#speech').uncheck({ force: true })
    async function fresh(inOverlay = false) {
      await page.waitForFunction(() => !document.querySelector('#send').disabled && document.querySelector('#state').textContent !== '話しています', null, { timeout: 20000 })
      const next = deliveries + 1
      await page.locator('#message').fill(`確認${next}`)
      if (inOverlay) await page.locator('#form').evaluate(form => form.requestSubmit())
      else await page.locator('#send').click()
      await page.waitForFunction(text => document.querySelector('#reply').textContent.startsWith(text) && document.querySelector('#bubble').dataset.retained === '1', `返答${next}です。`, { timeout: 20000 })
    }
    const shown = async () => await page.locator('body').getAttribute('data-message') === '1' && await page.locator('#bubble').isVisible()
    await fresh()
    await page.locator('#history-open').click(); await check('menu-open', await shown())
    await page.locator('#history-close').click(); await check('menu-close', await shown())
    await page.screenshot({ path: path.join(out, `${name}-menu.png`) })
    // メニューを開いてから新返答が届いた場合、閉じるボタン自体の影響を独立して確認する。
    await page.locator('#history-open').click()
    await fresh(true)
    await page.locator('#history-close').click(); await check('menu-close-with-reply', await shown())
    await fresh()
    await page.waitForSelector('#cards:not([hidden])')
    await page.locator('#cards-close').click(); await check('url-close', await shown())
    await page.screenshot({ path: path.join(out, `${name}-url.png`) })
    await fresh(); await page.locator('#reply').click(); await check('inside', await shown())
    await page.locator('#settings-open').click(); await page.keyboard.press('Escape'); await check('escape', await shown())
    await page.locator('#touch-open').click(); await page.locator('#touch-open').click(); await check('toggle', await shown())
    if (mobile) await page.touchscreen.tap(5, 200); else await page.mouse.click(5, 200)
    await check('outside', !(await shown()))
    await fresh(); await check('fresh', await shown())
    await page.screenshot({ path: path.join(out, `${name}-fresh.png`) })
    if (!process.env.SKIP_MODEL) {
      // 実画面で実行可能な4列を Lean の生成物から選ぶ（隠れた本文はクリックできない）。
      const selected = new Set(['overlay,inside,outside', 'outside,overlay,fresh', 'outside,fresh,inside', 'overlay,outside,overlay'])
      const allTraces = new Map(fs.readFileSync(process.env.MODEL_TRACES, 'utf8').trim().split('\n').map(line => line.split(' ')))
      const traces = [...allTraces].filter(([steps]) => selected.has(steps))
      if (traces.length !== selected.size) throw new Error('Lean traces missing')
      for (const [steps, expected] of traces) {
        await fresh()
        const prefix = []
        for (const step of steps.split(',')) {
          prefix.push(step)
          if (step === 'fresh') await fresh()
          else if (step === 'inside') await page.locator('#reply').click()
          else if (step === 'overlay') { await page.locator('#history-open').click(); await page.locator('#history-close').click() }
          else if (mobile) await page.touchscreen.tap(5, 200)
          else await page.mouse.click(5, 200)
          // overlay はモデル上の恒等操作なので、残りを overlay で埋めた生成列が各時点の期待値になる。
          const key = [...prefix, ...Array(3 - prefix.length).fill('overlay')].join(',')
          if (!allTraces.has(key)) throw new Error(`Lean prefix missing: ${key}`)
          await check(`model:${steps}:${prefix.length}`, (await shown()) === (allTraces.get(key) === '1'))
        }
        await check(`model:${steps}`, (await shown()) === (expected === '1'))
      }
    }
    await check('page-errors', errors.length === 0)
  } catch (e) { failures.push(`${name}: ${e.message}`); checks.exception = e.message; await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {}) }
  await ctx.close()
}))
await browser.close(); server.close(); assets?.close()
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, failures, external }, null, 2))
console.log(JSON.stringify({ results, failures, external }, null, 2))
process.exitCode = failures.length || external.length ? 1 : 0
