// BOXP-715 TD-02: 家の実画面で、読み上げ声 Drama-3/コハク のとき「本文(吹き出し・履歴)」と「音声」のどちらが止まるかを切り分ける。
// 画面は配備版(クラスタ内 Service)または SITE のローカル build、TTS は配備中 BFF へ検証用 token で中継(実合成)。
// 返答本文は会話 API をモックして固定（Hermes の待ちを切り離す）。token は出力しない。
// usage: VOICE=drama3|kohaku [SITE=/path/to/site] TOKEN_FILE=... node voice715.mjs <outdir>
import { chromium } from 'playwright'
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true })
const VOICE = process.env.VOICE || 'drama3', SITE = process.env.SITE, LIMIT = +(process.env.LIMIT_S || 300)
const H = 'http://kohako-studio.kohako-studio.svc.cluster.local'
const token = fs.readFileSync(process.env.TOKEN_FILE || '/var/run/secrets/kohako-bff-verifier/token', 'utf8').trim()
const REPLY = process.env.REPLY || '今日の作業をまとめるね。午前中は家の声の候補を増やして、新しい声をCPUだけで動かせるようにしたよ。お昼すぎにモデルの取得が終わって、声の設計もできたから、いまは本人だけが設定から選べる状態になってる。ただ、メモリをたくさん使うので、ほかの重い処理と重なったときは、試用の声のほうが先に止まるようにしてあるよ。'
const LOCAL = 'http://localhost:8771'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const t0 = Date.now(), T = () => +((Date.now() - t0) / 1000).toFixed(1)
const log = { voice: VOICE, mode: SITE ? 'local-build' : 'deployed', tts: [], events: [], errors: [] }
let rid = 'r715' + Math.random().toString(36).slice(2, 12), replied = false
await ctx.route(u => u.origin === LOCAL, async r => {
  const q = r.request(), u = new URL(q.url()), p = u.pathname
  if (p.startsWith('/kohako/api/')) (log.api ??= []).push([T(), q.method(), p])
  const j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) })
  if (p === '/kohako/api/v1/messages' && q.method() === 'POST') { log.events.push([T(), 'message-posted']); return j(202, { requestId: JSON.parse(q.postData() || '{}').requestId || rid, status: 'accepted' }) }
  if (p.startsWith('/kohako/api/v1/requests/') && q.method() === 'GET') { if (!replied) log.events.push([T(), 'reply-delivered-by-api']); replied = true; return j(200, { requestId: p.split('/').pop(), status: 'done', reply: { text: REPLY } }) }
  if (p.startsWith('/kohako/api/')) {
    const isTts = p === '/kohako/api/v1/tts' && q.method() === 'POST', s = T(), body = isTts ? JSON.parse(q.postData() || '{}') : null
    try {
      const resp = await r.fetch({ url: H + p + u.search, headers: { ...q.headers(), authorization: 'Bearer ' + token }, timeout: 0 })
      if (isTts) log.tts.push({ sent: s, done: T(), status: resp.status(), chars: body.text?.length, voice: body.voice ?? 'kohaku' })
      return r.fulfill({ response: resp })
    } catch (e) { if (isTts) log.tts.push({ sent: s, done: T(), status: 'aborted', chars: body.text?.length, voice: body.voice ?? 'kohaku' }); return r.abort() }
  }
  // ローカル build にあるファイルはそれを、無いもの（Live2D モデルなど大きな資産）は配備版から取る。
  if (SITE) { const fp = path.join(SITE, p); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, contentType: types[path.extname(fp)] || "application/octet-stream", body: fs.readFileSync(fp) }) }
  return r.fulfill({ response: await r.fetch({ url: H + p + u.search }) })
})
const page = await ctx.newPage()
page.on('pageerror', e => log.errors.push(String(e)))
await page.addInitScript(v => { localStorage.setItem('kohako-home-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('kohako-home-prefs') || '{}'), voice: v })) }, VOICE)
await page.goto(LOCAL + '/kohako/home.html', { waitUntil: 'load' })
await page.waitForFunction(() => window.__kohakoHome?.report.loaded, null, { timeout: 60000 })
await page.waitForFunction(() => document.getElementById('connection').textContent.startsWith('接続中'), null, { timeout: 30000 })
await page.evaluate(() => { const s = document.getElementById('speech'); if (!s.checked) s.click() })
log.prefsVoice = await page.evaluate(() => window.__kohakoHome.prefs.voice)
const snap = () => page.evaluate(r => ({ state: window.__kohakoHome.state, scene: window.__kohakoHome.scene, shown: document.body.dataset.message === '1', bubble: (document.getElementById('reply').textContent || '').includes(r.slice(0, 10)), history: window.__kohakoHome.history.some(h => h.text === r), error: document.getElementById('error').textContent, resume: !document.getElementById('resume-speech')?.hidden, reading: !!document.querySelector('#reply .reading, #reply [data-reading]') }), REPLY)
await page.fill('#message', '今日の作業をまとめて'); await page.click('#send')
let prev = '', first = {}
while (T() < LIMIT) {
  const s = await snap(), k = JSON.stringify(s)
  if (k !== prev) { log.events.push([T(), s]); prev = k }
  if (s.shown && s.bubble && first.textVisible === undefined) first.textVisible = T()
  if (s.history && first.history === undefined) first.history = T()
  if (log.tts.some(x => x.status === 200) && first.firstAudio === undefined) first.firstAudio = log.tts.find(x => x.status === 200).done
  if (replied && s.state !== 'speaking' && s.state !== 'thinking') { first.speakingEnded = T(); break }
  await page.waitForTimeout(250)
}
log.first = first; log.final = await snap(); log.endedAt = T()
await page.screenshot({ path: OUT + `/voice715-${VOICE}-${log.mode}.png` })
fs.writeFileSync(OUT + `/voice715-${VOICE}-${log.mode}.json`, JSON.stringify(log, null, 1))
console.log(JSON.stringify({ first, final: log.final, tts: log.tts, errors: log.errors, api: (log.api || []).slice(-15) }))
await b.close()
