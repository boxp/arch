// BOXP-779: 家の「📺 一緒に見る」（home.html?watch=1）を、偽の共有画面（canvas）・偽のマイク（発振器）と BFF の完全なモックで確かめる。
// 期待値は vault の Projects/kohako-home/watch-together-spec.md（決まり・例）から取る。実際の VRChat・実マイク・実 Whisper は使わない。
// usage: SITE=/site node watch779.mjs <outdir>（Playwright 1.56.1。外部通信はすべて遮断。失敗があれば終了コード 1）
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || '/out', site = process.env.SITE || '/site', port = Number(process.env.PORT || 8879)
fs.mkdirSync(out, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); fs.readFile(path.join(site, p), (err, data) => { if (err) { res.writeHead(404); return res.end() } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data) }) }).listen(port)
const wav = (() => { const rate = 8000, n = rate * 0.6, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b })()
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const results = {}, failures = []
const check = (scenario, name, ok, detail) => { (results[scenario].checks ||= {})[name] = ok ? 'PASS' : `FAIL: ${detail}`; if (!ok) failures.push(`${scenario}: ${name}: ${detail}`) }
/** JPEG の SOF から幅・高さを読む。 */
const jpegSize = (b) => { for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) return null; const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }; i += 2 + len } return null }

// 偽の共有画面（1920x1080 の canvas、「ワールド」の絵）と偽のマイク（__say(ms) の間だけ 440Hz を鳴らす）。
const init = (mode) => {
  const md = navigator.mediaDevices
  window.__media = { display: [], mic: [], displayAsked: 0, micAsked: 0 }
  window.__live = (k) => window.__media[k].filter((t) => t.readyState === 'live').length
  md.getDisplayMedia = async (c) => {
    window.__media.displayAsked++
    if (mode === 'slow-display') await new Promise((r) => setTimeout(r, 1500))
    window.__media.displayConstraints = JSON.stringify(c)
    if (mode === 'deny-display') throw new DOMException('denied', 'NotAllowedError')
    const canvas = document.createElement('canvas')
    canvas.width = 1920; canvas.height = 1080
    const g = canvas.getContext('2d')
    let x = 0
    setInterval(() => { g.fillStyle = '#2a4a7a'; g.fillRect(0, 0, 1920, 1080); g.fillStyle = '#ffd36b'; g.fillRect(200 + (x = (x + 40) % 800), 400, 300, 300); g.fillStyle = '#fff'; g.font = '96px sans-serif'; g.fillText('WORLD 779', 700, 200) }, 50)
    const s = canvas.captureStream(5)
    window.__media.display.push(...s.getTracks())
    return s
  }
  md.getUserMedia = async (c) => {
    window.__media.micAsked++
    if (mode === 'deny-mic') throw new DOMException('denied', 'NotAllowedError')
    if (mode === 'slow-mic') await new Promise((r) => setTimeout(r, 1500))
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination()
    osc.frequency.value = 440; gain.gain.value = 0; osc.connect(gain).connect(dest); osc.start()
    window.__say = (ms) => { gain.gain.value = 0.3; setTimeout(() => { gain.gain.value = 0 }, ms) }
    window.__media.mic.push(...dest.stream.getTracks())
    return dest.stream
  }
}

async function scenario(name, opts, run) {
  results[name] = {}
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const log = { transcriptions: [], attachments: [], messages: [], tts: [], external: [], errors: [] }
  const replies = {}, texts = [...(opts.texts || [])]
  page.on('pageerror', (e) => log.errors.push(String(e)))
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => { log.external.push(route.request().url()); return route.abort() })
  await ctx.route('**/kohako/api/v1/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname.split('/v1/')[1], json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (p === 'me') return json(200, { authenticated: true })
    if (p === 'conversation') return json(200, { enabled: true, stt: 'whisper' })
    if (p === 'status') return json(200, { schema: 'kohako-home-status/v1', quota: { state: 'ok', pools: [] }, tasks: { state: 'ok', inProgress: { total: 0, complete: true, byAgent: [], conflicts: [] } } })
    if (p === 'notifications') return json(200, { items: [], unread: 0 })
    if (p === 'tts' && req.method() === 'GET') return json(200, { available: true })
    if (p === 'tts') { log.tts.push({ at: Date.now(), text: req.postDataJSON().text }); await new Promise((r) => setTimeout(r, 150)); return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }) }
    if (p === 'transcriptions') {
      const text = texts.length ? texts.shift() : 'ねえ、今日はいい天気だね'
      log.transcriptions.push({ at: Date.now(), size: req.postDataBuffer()?.length ?? 0, text })
      if (opts.sttDelay) await new Promise((r) => setTimeout(r, opts.sttDelay))
      return json(200, { text })
    }
    if (p === 'attachments' && req.method() === 'POST') {
      const body = req.postDataBuffer() ?? Buffer.alloc(0)
      log.attachments.push({ type: req.headers()['content-type'], name: decodeURIComponent(req.headers()['x-kohako-filename'] || ''), size: body.length, jpeg: body[0] === 0xff && body[1] === 0xd8, dims: jpegSize(body) })
      if (opts.uploadDelay) await new Promise((r) => setTimeout(r, opts.uploadDelay))
      return json(201, { attachmentId: `${log.attachments.length}`.padStart(32, 'a'), name: decodeURIComponent(req.headers()['x-kohako-filename'] || ''), kind: 'image', size: body.length })
    }
    if (p === 'messages' && req.method() === 'POST') {
      const body = req.postDataJSON()
      log.messages.push({ at: Date.now(), ...body })
      replies[body.requestId] = { at: Date.now() + (opts.replyDelay ?? 300), text: body.watch ? 'わあ、黄色い四角が動いていますね。きれいな青い空です。' : 'はい、ご主人さま。普通の会話の返事です。' }
      return json(202, { requestId: body.requestId, status: 'accepted' })
    }
    const r = /^requests\/([^/]+)$/.exec(p)
    if (r && replies[r[1]]) return Date.now() < replies[r[1]].at ? json(200, { requestId: r[1], status: 'pending' }) : json(200, { requestId: r[1], status: 'done', reply: { text: replies[r[1]].text } })
    return json(404, { error: 'not_found' })
  })
  await page.addInitScript(init, opts.mode || 'ok')
  await page.goto(`http://localhost:${port}/kohako/home.html?${opts.query ?? 'watch=1'}&acting=0&face=static&daypart=day`)
  await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 30000 })
  // 読み上げ設定は OFF（共有中の呼びかけの返事だけは読むことを確かめる）。
  await page.evaluate(() => { const s = document.getElementById('speech'); if (s.checked) s.click() })
  const ui = () => page.evaluate(() => ({
    watch: window.__kohakoHome.watch, state: window.__kohakoHome.state,
    buttonHidden: document.getElementById('watch').hidden, buttonDisabled: document.getElementById('watch').disabled,
    panelHidden: document.getElementById('watch-panel').hidden, status: document.getElementById('watch-status').textContent,
    note: document.getElementById('watch-note').textContent, stopHidden: document.getElementById('watch-stop').hidden,
    display: window.__live('display'), mic: window.__live('mic'), displayAsked: window.__media.displayAsked, micAsked: window.__media.micAsked,
    displayConstraints: window.__media.displayConstraints,
    history: document.getElementById('history')?.textContent ?? document.body.textContent,
  }))
  const H = { page, ui, log,
    start: async () => { await page.click('#watch'); await page.waitForFunction(() => window.__kohakoHome.watch === 'watching', null, { timeout: 10000 }) },
    say: async (ms = 1200) => { await page.evaluate((ms) => window.__say(ms), ms) },
    waitWatch: (w, timeout = 15000) => page.waitForFunction((w) => window.__kohakoHome.watch === w, w, { timeout }),
  }
  try { results[name].data = await run(H) } catch (e) { check(name, 'exception', false, String(e)) }
  results[name].log = { ...log, transcriptions: log.transcriptions.map((t) => t.text) }
  check(name, '外部への通信なし', log.external.length === 0, JSON.stringify(log.external))
  check(name, 'ページの例外なし', log.errors.length === 0, JSON.stringify(log.errors))
  await page.screenshot({ path: path.join(out, `watch779-${name}.png`) })
  await ctx.close()
}

// 1. 呼びかけ以外は捨て、呼びかけには画面 1 枚と認識文を送り、読み上げ OFF でも返事を読み上げ、待機へ戻る。
await scenario('call', { texts: ['今日のワールドきれいだね', 'ヘイ、コハコ。この景色どう？'], replyDelay: 2500 }, async (H) => {
  const before = await H.ui()
  check('call', '入口が出る・未共有ではパネルなし', !before.buttonHidden && !before.buttonDisabled && before.panelHidden && before.watch === 'off', JSON.stringify(before))
  await H.start()
  const watching = await H.ui()
  check('call', '共有中の表示と停止ボタン', /共有中/.test(watching.status) && !watching.stopHidden && !watching.panelHidden && watching.display === 1 && watching.mic === 1, JSON.stringify(watching))
  check('call', '画面の音は求めない', JSON.parse(watching.displayConstraints).audio === false, watching.displayConstraints)
  await H.page.waitForTimeout(1500)
  check('call', '黙っている間は何も送らない', H.log.transcriptions.length === 0 && H.log.messages.length === 0, JSON.stringify(H.log.transcriptions))
  await H.say(1200)
  // 発話（1.2 秒）＋無音 0.8 秒で区切れて認識へ送られるのを待ってから、待機へ戻るのを待つ。
  for (let i = 0; i < 100 && H.log.transcriptions.length === 0; i++) await H.page.waitForTimeout(100)
  await H.page.waitForFunction(() => window.__kohakoHome.watch === 'watching', null, { timeout: 10000 })
  await H.page.waitForTimeout(800)
  const afterNoCall = await H.ui()
  check('call', '呼びかけの無い認識文は送らず・表示しない', H.log.transcriptions.length === 1 && H.log.attachments.length === 0 && H.log.messages.length === 0 && !afterNoCall.history.includes('今日のワールドきれいだね'), JSON.stringify({ t: H.log.transcriptions.length, a: H.log.attachments.length, m: H.log.messages.length }))
  await H.say(1200)
  await H.waitWatch('asking')
  const asking = await H.ui()
  // 考え中に話しても聞き流す
  await H.say(1200)
  await H.page.waitForTimeout(1600)
  const tDuring = H.log.transcriptions.length
  await H.waitWatch('replying', 15000)
  await H.waitWatch('watching', 20000)
  const after = await H.ui()
  const m = H.log.messages[0] || {}, a = H.log.attachments[0] || {}
  check('call', '呼びかけで画面 1 枚（JPEG・長辺 1280 以下）を上げる', H.log.attachments.length === 1 && a.type === 'image/jpeg' && a.jpeg && a.dims && Math.max(a.dims.width, a.dims.height) <= 1280 && a.dims.width === 1280, JSON.stringify(a))
  check('call', '認識文を本文に watch 付きで送る（位置は添えない）', H.log.messages.length === 1 && m.text === 'ヘイ、コハコ。この景色どう？' && m.watch === true && m.views === true && JSON.stringify(m.attachments) === JSON.stringify(['a'.repeat(31) + '1']) && m.location === undefined, JSON.stringify(m))
  check('call', '考え中は聞き流す（2 通目を送らない）', tDuring === 2 && H.log.messages.length === 1, `transcriptions=${tDuring}`)
  check('call', '読み上げ OFF でも返事を読み上げる', H.log.tts.some((t) => t.text.includes('黄色い四角')), JSON.stringify(H.log.tts))
  check('call', '返事の後は待機へ戻る（共有は続く）', after.watch === 'watching' && after.display === 1 && after.mic === 1 && /共有中/.test(after.status), JSON.stringify(after))
  check('call', '返事は会話履歴に残る', after.history.includes('黄色い四角'), '')
  return { before: { ...before, history: undefined }, asking: { ...asking, history: undefined }, after: { ...after, history: undefined }, attachment: a }
})

// 2. 送信後・返事前に ■ やめる: 取得を止め、届いた返事は文字だけで読み上げない。
await scenario('stop-asking', { texts: ['コハコ、これ何？'], replyDelay: 3000 }, async (H) => {
  await H.start()
  await H.say(1200)
  await H.waitWatch('asking')
  // 送り終えてから止める（送る前に止めたら送らないのは stop-upload で確かめる）。
  for (let i = 0; i < 100 && H.log.messages.length === 0; i++) await H.page.waitForTimeout(100)
  await H.page.click('#watch-stop')
  const stopped = await H.ui()
  await H.page.waitForFunction(() => document.body.textContent.includes('黄色い四角'), null, { timeout: 15000 })
  await H.page.waitForTimeout(1500)
  const after = await H.ui()
  check('stop-asking', '止めると画面とマイクを手放す', stopped.watch === 'off' && stopped.display === 0 && stopped.mic === 0 && stopped.stopHidden, JSON.stringify({ ...stopped, history: undefined }))
  check('stop-asking', '止めた後に届いた返事は読み上げない', !H.log.tts.some((t) => t.text.includes('黄色い四角')), JSON.stringify(H.log.tts))
  check('stop-asking', '止めた後は聞かない・送らない', H.log.transcriptions.length === 1 && H.log.messages.length === 1, '')
  return { stopped: { ...stopped, history: undefined }, after: { ...after, history: undefined } }
})

// 3. 返事の読み上げ中に ■ やめる: 読み上げを止める。
await scenario('stop-speaking', { texts: ['コハコ、見て'], replyDelay: 300 }, async (H) => {
  await H.start()
  await H.say(1200)
  await H.waitWatch('replying', 15000)
  await H.page.click('#watch-stop')
  await H.page.waitForTimeout(500)
  const after = await H.ui()
  check('stop-speaking', '読み上げを止めて off', after.watch === 'off' && after.state !== 'speaking' && after.display === 0 && after.mic === 0, JSON.stringify({ ...after, history: undefined }))
  return { after: { ...after, history: undefined } }
})

// 4. ブラウザ側で共有が終わった（トラック終了）: 止まる。
await scenario('ended', {}, async (H) => {
  await H.start()
  await H.page.evaluate(() => { for (const t of window.__media.display) { t.stop(); t.dispatchEvent(new Event('ended')) } })
  await H.page.waitForTimeout(300)
  const after = await H.ui()
  check('ended', '共有終了で off・マイクも手放す', after.watch === 'off' && after.mic === 0 && /止めました/.test(after.note), JSON.stringify({ ...after, history: undefined }))
  await H.say(1200)
  await H.page.waitForTimeout(1500)
  check('ended', '終了後は聞かない', H.log.transcriptions.length === 0, '')
})

// 5. 共有の選択を取り消した: 何も始めず、マイクは求めない。
await scenario('deny-display', { mode: 'deny-display' }, async (H) => {
  await H.page.click('#watch')
  await H.page.waitForTimeout(500)
  const after = await H.ui()
  check('deny-display', '始めず・マイクを求めない・理由を出す', after.watch === 'off' && after.micAsked === 0 && /許可されなかった/.test(after.note) && !after.panelHidden, JSON.stringify({ ...after, history: undefined }))
})

// 6. マイクを断った: 取れた画面も止める。
await scenario('deny-mic', { mode: 'deny-mic' }, async (H) => {
  await H.page.click('#watch')
  await H.page.waitForTimeout(500)
  const after = await H.ui()
  check('deny-mic', '始めず・取れた画面を止める', after.watch === 'off' && after.displayAsked === 1 && after.display === 0, JSON.stringify({ ...after, history: undefined }))
})

// 10. 画面共有の選択中に止めると、選び終わってもマイクを求めず、取れた画面も止める（codex review P1）。
await scenario('stop-starting', { mode: 'slow-display' }, async (H) => {
  await H.page.click('#watch')
  await H.page.waitForFunction(() => window.__media.displayAsked === 1, null, { timeout: 10000 })
  await H.page.click('#watch-stop')
  await H.page.waitForTimeout(2500)
  const after = await H.ui()
  check('stop-starting', '止めた後はマイクを求めず画面も手放す', after.watch === 'off' && after.displayAsked === 1 && after.micAsked === 0 && after.display === 0 && after.mic === 0, JSON.stringify({ ...after, history: undefined }))
})

// 12. マイクの許可待ちの間に画面共有が終わると、許可されても始めず、マイクも画面も手放す（codex review P1）。
await scenario('ended-asking-mic', { mode: 'slow-mic' }, async (H) => {
  await H.page.click('#watch')
  await H.page.waitForFunction(() => window.__media.micAsked === 1, null, { timeout: 5000 })
  await H.page.evaluate(() => { for (const t of window.__media.display) { t.stop(); t.dispatchEvent(new Event('ended')) } })
  await H.page.waitForTimeout(2500)
  const after = await H.ui()
  check('ended-asking-mic', '許可待ち中の共有終了で off・マイクも画面も手放す', after.watch === 'off' && after.micAsked === 1 && after.mic === 0 && after.display === 0 && /止めました/.test(after.note), JSON.stringify({ ...after, history: undefined }))
  check('ended-asking-mic', '終了後は聞かない', H.log.transcriptions.length === 0, '')
})

// 11. 画面のアップロード中に止めると、上げ終わっても認識文を送らず読み上げない（codex review P1）。
await scenario('stop-upload', { texts: ['コハコ、これ見て'], uploadDelay: 2000, replyDelay: 300 }, async (H) => {
  await H.start()
  await H.say(1200)
  await H.page.waitForFunction(() => window.__kohakoHome.watch === 'asking', null, { timeout: 15000 })
  for (let i = 0; i < 100 && H.log.attachments.length === 0; i++) await H.page.waitForTimeout(50)
  const uploading = H.log.attachments.length
  await H.page.click('#watch-stop')
  await H.page.waitForTimeout(4000)
  const after = await H.ui()
  check('stop-upload', '上げている間に止めたら送らない・読まない', uploading === 1 && after.watch === 'off' && H.log.messages.length === 0 && H.log.tts.length === 0 && after.display === 0 && after.mic === 0, JSON.stringify({ uploading, m: H.log.messages.length, tts: H.log.tts.length, ...after, history: undefined }))
})

// 7. 聞き取り中に止めると、遅れて届いた「コハコ」の認識結果では送らない。
await scenario('stale', { texts: ['コハコ、これ見て'], sttDelay: 2500 }, async (H) => {
  await H.start()
  await H.say(1200)
  await H.waitWatch('transcribing')
  await H.page.click('#watch-stop')
  await H.page.waitForTimeout(3500)
  const after = await H.ui()
  check('stale', '遅れた認識結果では何もしない', after.watch === 'off' && H.log.attachments.length === 0 && H.log.messages.length === 0, JSON.stringify({ a: H.log.attachments.length, m: H.log.messages.length }))
})

// 8. 通常会話はそのまま: 共有中も入力欄から送れ（watch なし・画面なし）、通常の応答待ち中の呼びかけは送らない。
await scenario('normal', { texts: ['コハコ、これどう？'], replyDelay: 4000 }, async (H) => {
  await H.start()
  await H.page.fill('#message', '明日の天気を教えて')
  await H.page.click('#send')
  await H.page.waitForFunction(() => window.__kohakoHome.state === 'thinking', null, { timeout: 5000 })
  await H.say(1200)
  await H.page.waitForFunction(() => /返事を待っています/.test(document.getElementById('watch-note')?.textContent ?? '') && window.__kohakoHome.watch === 'watching', null, { timeout: 15000 }).catch(() => {})
  const busy = await H.ui()
  await H.page.waitForFunction(() => document.body.textContent.includes('普通の会話の返事'), null, { timeout: 15000 })
  await H.page.waitForTimeout(800)
  const m = H.log.messages
  check('normal', '入力欄の発言は watch なし・画面なしで送られる', m.length === 1 && m[0].text === '明日の天気を教えて' && m[0].watch === undefined && m[0].attachments === undefined, JSON.stringify(m))
  check('normal', '通常の応答待ち中の呼びかけは送らず理由を出す', H.log.attachments.length === 0 && /返事を待っています/.test(busy.note) && busy.watch === 'watching', JSON.stringify({ ...busy, history: undefined }))
  check('normal', '通常会話の返事は読み上げ OFF のまま読まない', H.log.tts.length === 0, JSON.stringify(H.log.tts))
})

// 9. ?watch=1 が無い家には入口が無い。
await scenario('no-query', { query: 'x=1' }, async (H) => {
  const ui = await H.ui()
  check('no-query', '入口もパネルも出ない', ui.buttonHidden && ui.panelHidden, JSON.stringify({ ...ui, history: undefined }))
})

fs.writeFileSync(path.join(out, 'watch779.json'), JSON.stringify({ failures, results }, null, 2))
console.log(JSON.stringify({ failures, summary: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.checks])) }, null, 2))
await browser.close()
server.close()
process.exit(failures.length ? 1 : 0)
