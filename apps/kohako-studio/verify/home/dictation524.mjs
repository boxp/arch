// BOXP-524: 家の音声入力（明示クリック開始/停止/取消 → 認識文を草稿へ追記 → 本人が送信）を BFF モック・擬似マイクで確認する。
// token 不要。ビルドを SITE（既定 /site）の kohako/ に置き、Playwright 1.56.1 で `node dictation524.mjs /out` を実行する。
// 失敗があれば終了コード 1。各ケースの結果を /out/dictation524.json、画面を /out/dictation524-<case>.png に保存する。
import { chromium, devices } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const SITE = process.env.SITE || '/site', OUT = process.argv[2] || '/out'
fs.mkdirSync(OUT, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.startsWith('/kohako/live2d/')) p = p.replace('/kohako/live2d/', '/kohako/kohako/live2d/'); fs.readFile(path.join(SITE, p), (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d) }) }).listen(8768)
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const results = {}, failures = []
const check = (name, cond, detail) => { if (!cond) failures.push(`${name}: ${detail}`) }
// getUserMedia を包み、取得した track の終了を数える。mode=deny は拒否、silent は無音、unsupported は API なし。
const init = mode => {
  window.__mic = { opened: 0, live: () => window.__mic.tracks.filter(t => t.readyState === 'live').length, tracks: [] }
  if (mode === 'unsupported') { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); return }
  const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md)
  md.getUserMedia = async c => {
    if (mode === 'deny') throw new DOMException('denied', 'NotAllowedError')
    let s
    if (mode === 'silent') { const ctx = new AudioContext(); s = ctx.createMediaStreamDestination().stream } else s = await orig(c)
    window.__mic.opened++; window.__mic.tracks.push(...s.getTracks()); return s
  }
}
async function scenario(name, device, opts, run) {
  const ctx = await b.newContext({ ...device, permissions: ['microphone'] }), page = await ctx.newPage(), log = { transcriptions: 0, messages: [], external: 0 }
  await page.addInitScript(init, opts.mode || 'fake')
  page.on('request', q => { const u = new URL(q.url()); if (u.hostname !== 'localhost') log.external++ })
  await ctx.route('**/kohako/api/v1/**', async r => {
    const q = r.request(), p = new URL(q.url()).pathname.replace('/kohako/api/v1/', ''), j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
    if (p === 'me') return j(200, { user: 'verify' })
    if (p === 'conversation') return j(200, { enabled: true, stt: 'whisper' })
    if (p === 'transcriptions') {
      log.transcriptions++; const size = q.postDataBuffer()?.length ?? 0; log.lastSize = size; log.lastType = q.headers()['content-type']
      const reply = opts.transcribe ? opts.transcribe(log.transcriptions) : { status: 200, body: { text: '明日の朝七時に起こしてください' } }
      if (reply.delay) await new Promise(res => setTimeout(res, reply.delay))
      return j(reply.status, reply.body)
    }
    if (p === 'messages') { log.messages.push(JSON.parse(q.postData() || '{}')); return j(202, { requestId: 'r1', status: 'accepted' }) }
    if (p.startsWith('requests/')) return j(200, { requestId: 'r1', status: 'done', reply: { text: 'はい、ご主人さま。七時ですね。' } })
    return j(404, {})
  })
  await page.goto('http://localhost:8768/kohako/home.html')
  await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
  await page.evaluate(() => { const s = document.getElementById('speech'); if (s) s.checked = false })
  const ui = () => page.evaluate(() => ({ record: document.getElementById('record').textContent, recordDisabled: document.getElementById('record').disabled, recordHidden: document.getElementById('record').hidden, pressed: document.getElementById('record').getAttribute('aria-pressed'), cancelHidden: document.getElementById('record-cancel').hidden, status: document.getElementById('record-status').textContent, noteHidden: document.getElementById('dictation-note').hidden, draft: document.getElementById('message').value, sendDisabled: document.getElementById('send').disabled, error: document.getElementById('error').textContent, connection: document.getElementById('connection').textContent, state: window.__kohakoHome?.state, live: window.__mic?.live?.() ?? null, opened: window.__mic?.opened ?? null }))
  let r
  try { r = await run(page, ui, log) } catch (e) { r = { exception: String(e) }; failures.push(`${name}: exception ${e}`) }
  r.log = log; results[name] = r
  check(name, log.external === 0, `external requests ${log.external}`)
  await page.screenshot({ path: path.join(OUT, `dictation524-${name}.png`) })
  await ctx.close()
}
const recordFor = async (page, ms) => { await page.click('#record'); await page.waitForFunction(() => document.getElementById('record').getAttribute('aria-pressed') === 'true', null, { timeout: 10000 }); await page.waitForTimeout(ms) }
const waitIdle = page => page.waitForFunction(() => document.getElementById('record').textContent === '🎤', null, { timeout: 15000 })

for (const [dev, device] of [['pc', { viewport: { width: 1280, height: 800 } }], ['pixel7', devices['Pixel 7']]]) {
  // 基本: 開始 → 停止 → 認識文が既存草稿へ追記 → 自動送信なし → 本人が修正して送信 → 1 回だけ送られる
  await scenario(`${dev}-basic`, device, {}, async (page, ui, log) => {
    await page.fill('#message', '確認です')
    const before = await ui(); await recordFor(page, 2200); const during = await ui()
    await page.click('#record'); await waitIdle(page); const after = await ui()
    await page.waitForTimeout(1500); const sentBeforeUser = log.messages.length
    await page.fill('#message', after.draft.replace('七時', '七時半')); await page.click('#send')
    await page.waitForTimeout(2500)
    check(`${dev}-basic`, !before.recordHidden && !before.recordDisabled, 'record button not usable')
    check(`${dev}-basic`, during.pressed === 'true' && !during.cancelHidden && /録音中/.test(during.status) && during.sendDisabled && during.live === 1, `during ${JSON.stringify(during)}`)
    check(`${dev}-basic`, after.draft === '確認です\n明日の朝七時に起こしてください', `draft ${JSON.stringify(after.draft)}`)
    check(`${dev}-basic`, after.live === 0, 'mic not released')
    check(`${dev}-basic`, log.transcriptions === 1 && log.lastSize >= 16000 && log.lastType === 'application/octet-stream', `transcription ${log.transcriptions} ${log.lastSize}`)
    check(`${dev}-basic`, sentBeforeUser === 0, 'auto-sent without user action')
    check(`${dev}-basic`, log.messages.length === 1 && log.messages[0].text === '確認です\n明日の朝七時半に起こしてください', `messages ${JSON.stringify(log.messages)}`)
    return { before, during, after, sentBeforeUser }
  })
  // 取消: 録音を取り消すと送信されず、マイクが解放される
  await scenario(`${dev}-cancel`, device, {}, async (page, ui, log) => {
    await recordFor(page, 1200); await page.click('#record-cancel'); await waitIdle(page); await page.waitForTimeout(800); const after = await ui()
    check(`${dev}-cancel`, log.transcriptions === 0 && after.live === 0 && after.draft === '' && after.cancelHidden, `after ${JSON.stringify(after)} t=${log.transcriptions}`)
    return { after }
  })
}
// 認識中に取消: 遅れて返った旧結果は入力欄へ入らない。停止の連打でも 1 回だけ認識する
await scenario('stale', {}, { transcribe: () => ({ status: 200, body: { text: '古い結果' }, delay: 2500 }) }, async (page, ui, log) => {
  await recordFor(page, 1200); await page.click('#record'); await page.click('#record', { force: true }).catch(() => {})
  await page.waitForFunction(() => document.getElementById('record').getAttribute('aria-label') === '文字にしています', null, { timeout: 5000 })
  const transcribing = await ui(); await page.click('#record-cancel'); await page.waitForTimeout(3500); const after = await ui()
  check('stale', log.transcriptions === 1, `transcriptions ${log.transcriptions}`)
  check('stale', transcribing.recordDisabled && transcribing.sendDisabled, `transcribing ${JSON.stringify(transcribing)}`)
  check('stale', after.draft === '' && after.record === '🎤', `after ${JSON.stringify(after)}`)
  return { transcribing, after }
})
// 無音: 送らずに案内
await scenario('silent', {}, { mode: 'silent' }, async (page, ui, log) => {
  await recordFor(page, 1500); await page.click('#record'); await waitIdle(page); const after = await ui()
  check('silent', log.transcriptions === 0 && /聞き取れません/.test(after.status) && after.live === 0, `after ${JSON.stringify(after)}`)
  return { after }
})
// 0.5 秒未満: 送らずに案内
await scenario('short', {}, {}, async (page, ui, log) => {
  await recordFor(page, 50); await page.click('#record'); await waitIdle(page); const after = await ui()
  check('short', log.transcriptions === 0 && /0\.5秒以上/.test(after.status), `after ${JSON.stringify(after)}`)
  return { after }
})
// 権限拒否
await scenario('deny', {}, { mode: 'deny' }, async (page, ui) => {
  await page.click('#record'); await waitIdle(page); const after = await ui()
  check('deny', /許可されていません/.test(after.status) && after.pressed === 'false', `after ${JSON.stringify(after)}`)
  return { after }
})
// 非対応ブラウザ
await scenario('unsupported', {}, { mode: 'unsupported' }, async (page, ui) => {
  const after = await ui()
  check('unsupported', after.recordDisabled && /使えません/.test(after.status) && !after.noteHidden, `after ${JSON.stringify(after)}`)
  return { after }
})
// 認識できない（空認識 422）・接続失敗（502）→ 再試行で成功
await scenario('retry', {}, { transcribe: n => n === 1 ? { status: 422, body: { error: 'no_speech' } } : n === 2 ? { status: 502, body: { error: 'stt_failed' } } : { status: 200, body: { text: '三回目' } } }, async (page, ui, log) => {
  const steps = []
  for (let i = 0; i < 3; i++) { await recordFor(page, 1200); await page.click('#record'); await waitIdle(page); steps.push(await ui()) }
  check('retry', /認識できません/.test(steps[0].status) && /接続できません/.test(steps[1].status) && steps[2].draft === '三回目' && log.transcriptions === 3 && log.messages.length === 0, `steps ${JSON.stringify(steps)}`)
  return { steps }
})
// Access 認証切れ（401）: 未認証表示になり、入力中の草稿は残る
await scenario('auth', {}, { transcribe: () => ({ status: 401, body: { error: 'unauthorized' } }) }, async (page, ui, log) => {
  await page.fill('#message', '書きかけ'); await recordFor(page, 1200); await page.click('#record'); await page.waitForTimeout(1500); const after = await ui()
  check('auth', after.draft === '書きかけ' && /未認証/.test(after.connection) && after.live === 0 && log.messages.length === 0, `after ${JSON.stringify(after)}`)
  return { after }
})
// タブ非表示で録音を破棄
await scenario('hidden', {}, {}, async (page, ui, log) => {
  await recordFor(page, 1200)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(800); const after = await ui()
  check('hidden', log.transcriptions === 0 && after.live === 0 && after.record === '🎤', `after ${JSON.stringify(after)}`)
  return { after }
})
fs.writeFileSync(path.join(OUT, 'dictation524.json'), JSON.stringify({ results, failures }, null, 1))
console.log(JSON.stringify({ cases: Object.keys(results), failures }, null, 1))
await b.close(); srv.close()
process.exit(failures.length ? 1 : 0)
