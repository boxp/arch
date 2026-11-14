// BOXP-545: BFF をモックして読み上げ方式と停止・再開を検証する。
import { chromium, devices } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8798)
fs.mkdirSync(out, { recursive: true })
const wav = Buffer.alloc(44 + 16000 * 6 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < 16000 * 6; i++) wav.writeInt16LE(Math.round(5000 * Math.sin(2 * Math.PI * 440 * i / 16000)), 44 + i * 2)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}, failures = []
const assert = (ok, message) => { if (!ok) throw Error(message) }
for (const [device, options] of [['pc', { viewport: { width: 1280, height: 800 } }], ['pixel7', { ...devices['Pixel 7'] }]]) {
  results[device] = {}
  for (const mode of ['mix', 'off']) {
    const ctx = await browser.newContext(options), page = await ctx.newPage()
    await page.addInitScript(() => {
      window.mixCounts = { play: 0, starts: 0, decode: 0 }
      const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function (...args) { if (this.src.startsWith('blob:')) window.mixCounts.play++; return play.apply(this, args) }
      const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer && this.buffer.length > 1) window.mixCounts.starts++; return start.apply(this, args) }
      const decode = AudioContext.prototype.decodeAudioData; AudioContext.prototype.decodeAudioData = function (...args) { window.mixCounts.decode++; return decode.apply(this, args) }
    })
    await ctx.route('**/kohako/api/v1/**', async route => {
      const p = new URL(route.request().url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (p === 'tts') return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav })
      if (p === 'me') return json(200, { authenticated: true })
      if (p === 'conversation') return json(200, { enabled: true, stt: false })
      if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
      if (p === 'messages') return json(202, { status: 'accepted' })
      if (p.startsWith('requests/')) return json(200, { status: 'done', reply: { text: 'こんにちは。今日はいい天気ですね。楽しく過ごしましょう。' } })
      return json(404, {})
    })
    try {
      await page.goto(`http://localhost:${port}/kohako/home.html?acting=0&face=static`); await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
      await page.locator('#settings-open').click(); assert(await page.locator('#pref-mix').isChecked(), 'mix default')
      if (mode === 'off') await page.locator('#pref-mix').uncheck()
      await page.locator('#settings-close').click()
      await page.locator('label:has(#speech)').click(); await page.locator('#message').fill('こんにちは'); await page.locator('#send').click()
      await page.waitForFunction(() => window.__kohakoHome.state === 'speaking'); await page.waitForFunction(() => window.mixCounts.starts + window.mixCounts.play > 0, null, { timeout: 30000 })
      let counts = await page.evaluate(() => ({ ...window.mixCounts }))
      if (mode === 'mix') {
        assert(counts.starts >= 1 && counts.play === 0 && counts.decode >= 1, `mix ${JSON.stringify(counts)}`)
        await page.locator('#hush').click(); const stopped = await page.evaluate(() => window.mixCounts.starts); await page.waitForTimeout(800); assert((await page.evaluate(() => window.mixCounts.starts)) === stopped, 'started after stop')
        await page.locator('#resume-speech').click(); await page.waitForFunction(n => window.mixCounts.starts > n, stopped, { timeout: 30000 }); await page.waitForFunction(() => window.__kohakoHome.state === 'done', null, { timeout: 30000 })
        counts = await page.evaluate(() => ({ ...window.mixCounts })); results[device].mix = { pass: true, speaking: true, stopped, resumed: true, done: true, ...counts }
      } else {
        assert(counts.play >= 1 && counts.starts === 0, `off ${JSON.stringify(counts)}`); await page.waitForFunction(() => window.__kohakoHome.state === 'done', null, { timeout: 30000 }); await page.reload(); await page.waitForFunction(() => !document.querySelector('#send').disabled); await page.locator('#settings-open').click(); assert(!(await page.locator('#pref-mix').isChecked()), 'setting did not persist')
        results[device].off = { pass: true, done: true, persisted: true, ...counts }
      }
    } catch (error) { failures.push(`${device} ${mode}: ${error.message}`); results[device][mode] = { pass: false, error: error.message }; await page.screenshot({ path: `${out}/${device}-${mode}-failure.png` }).catch(() => {}) }
    finally { await ctx.close() }
  }
}
await browser.close(); server.close(); fs.writeFileSync(`${out}/result.json`, JSON.stringify({ results, failures }, null, 2)); console.log(JSON.stringify({ results, failures }, null, 2)); process.exitCode = failures.length ? 1 : 0
