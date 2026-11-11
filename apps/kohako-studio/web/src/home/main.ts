// BOXP-500: コハコの家（kohako-home）。Studio と同じ BFF・認証・Web 専用会話を使う全画面 UI。
// 会話の送信・重複防止・停止・承認・追跡は Studio（src/studio/main.ts）と同じ規則。人格・判断・記憶は Hermes だけが持つ。
import './style.css'
import { interpretRequest, newOutgoing, pcm16, presentation, resolveUnconfirmed, rigStateOf, sendOutcomeUnknown, silentSpeechSeconds, studioRigModelId, wantsActing, wantsRig, type Outgoing, type State } from '../studio/model'
import { clipIdFor, clipName, lookFor, modelFor, mouthLevel, poseFor, speechMouth, type RigState } from '../live2d/model'
import { applyPose, loadRig, type Player } from '../live2d/rig'
import { ActingDirector, cueForSentence, splitSentences, type ActingStage } from '../live2d/acting'
import { createActingStage } from '../live2d/gesture'
import { createSentenceSpeaker, createSilentSentencer } from '../studio/acting-speech'
import { SceneDirector, targetScene, type Scene } from './scene'
import { cardsFromText, type Card } from './cards'
import { acts, bboxOf, classifyTouch, HAND_MESHES, HEAD_MESHES, inside, toScreenRect, TouchLimiter, type Point, type Rect, type Zone } from './touch'
import { parsePrefs, type Prefs } from './prefs'
import { parseResume, parseUnconfirmed, type Inflight } from './resume'

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const body = document.body, face = el<HTMLImageElement>('face'), rigCanvas = el<HTMLCanvasElement>('rig'), character = el('character')
const stateLabel = el('state'), message = el<HTMLTextAreaElement>('message'), send = el<HTMLButtonElement>('send'), stop = el<HTMLButtonElement>('stop'), record = el<HTMLButtonElement>('record'), hush = el<HTMLButtonElement>('hush')
const speech = el<HTMLInputElement>('speech'), reply = el('reply'), bubble = el('bubble'), bubbleTag = el('bubble-tag'), error = el('error'), trouble = el('trouble'), approvalBox = el('approval')
const cardsBox = el('cards'), cardList = el('card-list'), elapsedLabel = el('elapsed'), connection = el('connection')

// ---- 設定（このブラウザにだけ保存） ----
const PREFS_KEY = 'kohako-home-prefs', INFLIGHT_KEY = 'kohako-home-inflight', UNCONFIRMED_KEY = 'kohako-home-unconfirmed'
const storage = (s: () => Storage) => ({ get: (k: string) => { try { return s().getItem(k) } catch { return null } }, set: (k: string, v: string | null) => { try { if (v === null) s().removeItem(k); else s().setItem(k, v) } catch { /* 保存できない環境では保存しない */ } } })
const local = storage(() => localStorage), tab = storage(() => sessionStorage)
let prefs: Prefs = parsePrefs(local.get(PREFS_KEY))
const systemReduce = matchMedia('(prefers-reduced-motion: reduce)')
const reduced = () => prefs.reducedMotion || systemReduce.matches
const prefBoxes: [keyof Prefs, HTMLInputElement][] = [['touch', el('pref-touch')], ['lines', el('pref-lines')], ['pinned', el('pref-pinned')], ['reducedMotion', el('pref-reduce')]]
const subtleBox = el<HTMLInputElement>('pref-subtle')
function applyPrefs() {
  for (const [key, box] of prefBoxes) box.checked = prefs[key] as boolean
  subtleBox.checked = prefs.intensity === 'subtle'
  body.classList.toggle('reduce', reduced())
  el('touch-open').hidden = !prefs.touch
  local.set(PREFS_KEY, JSON.stringify(prefs))
}
for (const [key, box] of prefBoxes) box.addEventListener('change', () => { prefs = { ...prefs, [key]: box.checked }; applyPrefs(); refreshScene() })
subtleBox.addEventListener('change', () => { prefs = { ...prefs, intensity: subtleBox.checked ? 'subtle' : 'normal' }; applyPrefs() })
systemReduce.addEventListener?.('change', applyPrefs)
applyPrefs()

// ---- 会話の状態（Studio と同じ） ----
let state: State = 'offline', enabled = false, stt = false, requestId = '', started = 0, approvalId = '', approvalExpires = 0, busy = false, accepted = false, netDown = false
let unconfirmed: Outgoing | null = parseUnconfirmed(tab.get(UNCONFIRMED_KEY))
const setUnconfirmed = (o: Outgoing | null) => { unconfirmed = o; tab.set(UNCONFIRMED_KEY, o ? JSON.stringify(o) : null) }
const setInflight = (x: Inflight | null) => tab.set(INFLIGHT_KEY, x ? JSON.stringify(x) : null)
let recording: { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; size: number; timer: number } | null = null
let starting = false, held = false
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
speech.disabled = !synthesis

// ---- リグと演技（476 の規則をそのまま使う） ----
const rigModel = modelFor(`?model=${studioRigModelId(location.search)}`)
let rig: Player | null = null, stage: (ActingStage & { report(): Record<string, unknown> }) | null = null, acting: ActingDirector | null = null, speakingSince = 0, mouthTimer = 0
const actingEnabled = wantsActing(location.search)
const speaker = synthesis && actingEnabled ? createSentenceSpeaker({ synth: { speak: u => window.speechSynthesis.speak(u as SpeechSynthesisUtterance), cancel: () => window.speechSynthesis.cancel() }, makeUtterance: text => { const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; return u } }) : null
const sentencer = createSilentSentencer({ setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id) })
const report: Record<string, unknown> = { loaded: false, errors: [] as string[], touches: [] as unknown[] }
function interruptActing() { speaker?.cancel(); sentencer.cancel(); acting?.interrupt(); if (acting) report.acting = acting.snapshot }
function actingPose(player: Player, s: RigState) {
  const ids = player.clips, pose = poseFor(s, player.expressions, ids.map(id => clipName(rigModel, id)))
  player.play(clipIdFor(rigModel, ids, pose.clip)); player.lookAt(...lookFor(rigModel, ...pose.look))
  return pose
}
// 「動きを減らす」では体のしぐさを止め、表情だけにする。
const calmStage = (s: ActingStage): ActingStage => ({ setEmotion: e => s.setEmotion(e), playGesture: g => { if (!reduced()) s.playGesture(g) }, reset: () => s.reset() })

// ---- 表示 ----
let lastReply = '', lastActivity = Date.now(), thinkingSince = 0, cards: Card[] = [], cardsOpen = false
type Entry = { who: 'あなた' | 'コハコ' | 'お知らせ'; text: string; at: number }
const history: Entry[] = []
function addHistory(who: Entry['who'], text: string) {
  history.push({ who, text, at: Date.now() }); if (history.length > 100) history.shift()
  const li = document.createElement('li'), w = document.createElement('span'), t = document.createElement('span'), time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  w.className = 'who'; w.textContent = `${who}（${time}）`; t.textContent = text; li.append(w, t); el('history-list').append(li)
}
let touchLineTimer = 0
function setBubble(text: string, touch = false) {
  clearTimeout(touchLineTimer)
  reply.textContent = text; bubble.classList.toggle('touch', touch); bubbleTag.hidden = !touch; bubble.scrollTop = 0
}
function renderCards(next: Card[]) {
  cards = next; cardsOpen = next.length > 0; cardList.replaceChildren()
  for (const c of next) {
    const box = document.createElement('div'); box.className = `card card-${c.kind}`
    if (c.kind === 'list') { const ul = document.createElement('ul'); for (const item of c.items) { const li = document.createElement('li'); li.textContent = item; ul.append(li) } box.append(ul) }
    else if (c.kind === 'code') { const pre = document.createElement('pre'); pre.textContent = c.text; box.append(pre) }
    else { const host = document.createElement('div'); host.className = 'host'; host.textContent = c.host; const a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = c.url; box.append(host, a) }
    cardList.append(box)
  }
  cardsBox.hidden = !cardsOpen
}
el('cards-close').addEventListener('click', () => { renderCards([]); lastActivity = Date.now() - 60_000; refreshScene(true) })

function show(next: State) {
  if (actingEnabled && (next === 'failed' || next === 'stopped') && state !== next) interruptActing()
  if (next === 'thinking' && state !== 'thinking') thinkingSince = Date.now()
  state = next
  stateLabel.textContent = netDown ? '通信が切れています' : presentation[next].label
  face.src = `./kohako/studio/c48v6-${presentation[next].face}-color.png`
  if (next !== 'speaking') { speakingSince = 0; clearTimeout(mouthTimer) }
  if (rig) report.pose = { state: next, ...(actingEnabled ? actingPose(rig, rigStateOf[next]) : applyPose(rig, rigModel, rigStateOf[next])) }
  if (acting) { acting.setOperational(rigStateOf[next]); report.acting = acting.snapshot }
  send.disabled = !enabled || busy || !!recording || starting
  send.hidden = busy && accepted
  stop.hidden = !busy || !requestId || !accepted
  record.hidden = !stt; record.disabled = !enabled || !stt || busy
  hush.hidden = next !== 'speaking' || !speech.checked
  const showApproval = next === 'approval'
  if (showApproval && approvalBox.hidden) { approvalBox.hidden = false; el<HTMLButtonElement>('deny').focus() } else if (!showApproval) approvalBox.hidden = true
  trouble.hidden = !(next === 'failed' || next === 'offline' || netDown) || !error.textContent
  refreshScene()
}

// ---- 場面 ----
const director = new SceneDirector('offline')
let typingUntil = 0, scrollingUntil = 0, pointerDown = false
const holding = () => pointerDown || Date.now() < typingUntil || Date.now() < scrollingUntil
function shapeOf(): 'pc' | 'portrait' | 'landscape' {
  const w = window.innerWidth, h = window.innerHeight
  return h > w ? 'portrait' : w >= 900 && h >= 560 ? 'pc' : 'landscape'
}
function refreshScene(force = false) {
  const vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight
  document.documentElement.style.setProperty('--vh', `${Math.round(vh)}px`)
  const shape = shapeOf(), kbd = shape !== 'pc' && document.activeElement === message && !!vv && vv.height < window.innerHeight * 0.8
  body.dataset.shape = shape; body.dataset.kbd = kbd ? '1' : '0'
  const target = targetScene({ state, thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0, cardsOpen, idleMs: Date.now() - lastActivity, hasReply: !!lastReply, netDown })
  const scene = director.decide(target, Date.now(), { holding: holding(), pinned: prefs.pinned, force })
  body.dataset.scene = scene
  const upper = kbd || shape === 'landscape' || ((scene === 'show' || scene === 'work') && shape === 'pc')
  if ((character.dataset.frame === 'upper') !== upper) character.dataset.frame = upper ? 'upper' : 'full'
  character.classList.toggle('mini', kbd || (shape === 'portrait' && (scene === 'show' || scene === 'work')))
  if (scene === 'work' || busy) elapsedLabel.textContent = `${Math.floor((Date.now() - started) / 1000)}秒`
  elapsedLabel.hidden = !busy
  if (scene === 'work' && !reply.dataset.reply && !reply.textContent?.startsWith('少し時間')) setBubble('少し時間がかかっています。終わったらお知らせしますね。止めたいときは「停止」を押してください。')
  return scene
}
const sceneNow = () => body.dataset.scene as Scene
window.addEventListener('resize', () => refreshScene())
window.visualViewport?.addEventListener('resize', () => refreshScene())
message.addEventListener('input', () => { typingUntil = Date.now() + 2000; message.style.height = 'auto'; message.style.height = `${Math.min(message.scrollHeight, window.innerHeight * 0.3)}px` })
message.addEventListener('focus', () => setTimeout(() => refreshScene(), 300)); message.addEventListener('blur', () => setTimeout(() => refreshScene(), 300))
message.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el<HTMLFormElement>('form').requestSubmit() } })
for (const box of [bubble, cardsBox]) box.addEventListener('scroll', () => { scrollingUntil = Date.now() + 1000 }, { passive: true })
window.addEventListener('pointerdown', () => { pointerDown = true }, true); window.addEventListener('pointerup', () => { pointerDown = false }, true); window.addEventListener('pointercancel', () => { pointerDown = false }, true)

// ---- 時計 ----
const days = ['日', '月', '火', '水', '木', '金', '土']
let lastClock = ''
function tickClock() {
  const d = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (hm !== lastClock) {
    lastClock = hm; el('clock').textContent = hm; el('clock-small').textContent = hm
    el('date').textContent = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${days[d.getDay()]}曜日`
    const h = d.getHours()
    el('greeting').textContent = h < 5 ? 'こんな時間まで、おつかれさまです、ご主人さま。' : h < 11 ? 'おはようございます、ご主人さま。' : h < 18 ? 'こんにちは、ご主人さま。' : 'こんばんは、ご主人さま。今日もおつかれさまでした。'
  }
}
setInterval(() => { tickClock(); refreshScene() }, 500); tickClock()

// ---- BFF ----
function problem(status: number, data: Record<string, unknown> | null): string {
  if (status === 401 || status === 403) return 'Cloudflare Access でログインし直してください。'
  if (status === 429) return 'いま別の依頼を処理中です（Studio など別の画面からの依頼の可能性があります）。終わってからもう一度お試しください。'
  if (data?.error === 'conversation_disabled' || data?.error === 'stt_disabled') return 'この機能は現在無効です。'
  if (status === 422 || data?.error === 'no_speech') return '音声を認識できませんでした。'
  return `処理に失敗しました（${status}）。`
}
async function call(path: string, init: RequestInit = {}): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const response = await fetch(new URL(`api/v1/${path}`, new URL('./', location.href)), { ...init, credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { 'X-Kohako-Request': '1', ...init.headers } })
  if (response.type === 'opaqueredirect') return { status: 401, data: null }
  const data: unknown = await response.json().catch(() => null)
  return { status: response.status, data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null }
}
function setError(text: string) { error.textContent = text; if (text) addHistory('お知らせ', text) }
function fail(status: number, data: Record<string, unknown> | null) {
  setError(problem(status, data))
  if (status === 401 || status === 403) { enabled = false; connection.textContent = '未認証'; show('offline') } else show('failed')
}
async function initialize() {
  try {
    const me = await call('me'); if (me.status !== 200) return fail(me.status, me.data)
    const conv = await call('conversation'); if (conv.status !== 200 || !conv.data) return fail(conv.status, conv.data)
    enabled = conv.data.enabled === true; stt = enabled && !!conv.data.stt; netDown = false
    connection.textContent = enabled ? '接続中・Web 専用の会話' : '会話は無効です'
    el('features').textContent = `音声認識: ${stt ? '有効' : '無効'} ／ セッション開始: ${typeof conv.data.sessionStartedAt === 'number' ? new Date(conv.data.sessionStartedAt).toLocaleString('ja-JP') : '未開始'}`
    error.textContent = ''
    show(enabled ? 'idle' : 'offline')
    if (enabled) await resumeInflight()
  } catch { setError('接続できませんでした。通信を確認して「再接続」を押してください。'); show('offline') }
}
el('reconnect').addEventListener('click', () => { error.textContent = ''; connection.textContent = '接続を確認中'; void initialize() })
window.addEventListener('online', () => { if (!busy) void initialize() })
window.addEventListener('offline', () => { netDown = true; show(state) })

/** 再読み込み前に追っていた依頼があれば続きを追う（本文は保存していない）。 */
async function resumeInflight() {
  const saved = parseResume(tab.get(INFLIGHT_KEY), Date.now()); if (!saved || busy) { if (!saved) setInflight(null); return }
  let r: Awaited<ReturnType<typeof call>> | null = null
  try { r = await call(`requests/${saved.requestId}`) } catch { r = null }
  if (r && r.status === 200) { requestId = saved.requestId; accepted = true; busy = true; started = Date.now(); addHistory('お知らせ', '再読み込み前の依頼の続きを追っています。'); show('thinking'); void poll(requestId, saved.expiresAt); return }
  if (r && r.status === 404) { setInflight(null); addHistory('お知らせ', '前回の依頼は見つかりませんでした（新しい会話になった可能性があります）。') }
}
async function poll(id: string, deadline = Date.now() + 11 * 60_000) {
  let misses = 0
  while (requestId === id && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1800))
    let result
    try { result = await call(`requests/${id}`) } catch { if (++misses >= 2 && !netDown) { netDown = true; connection.textContent = '通信が切れています（自動で問い合わせ中）'; show(state) } continue }
    if (netDown || misses) { misses = 0; netDown = false; connection.textContent = '接続中・Web 専用の会話'; error.textContent = ''; show(state) }
    if (requestId !== id) return
    if (result.status !== 200 || !result.data) { busy = false; requestId = ''; setInflight(null); fail(result.status, result.data); return }
    const next = interpretRequest(result.data)
    if (next.state === 'approval' && next.approval) {
      if (approvalId !== next.approval.approvalId) { approvalId = next.approval.approvalId; approvalExpires = next.approval.expiresAt; el('approval-summary').textContent = next.approval.summary; el('approval-error').textContent = ''; addHistory('お知らせ', `確認が必要です: ${next.approval.summary}`); setBubble('実行する前に確認させてください、ご主人さま。') }
      show('approval')
    } else if (next.state === 'thinking') { if (state !== 'thinking') show('thinking') }
    else {
      busy = false; requestId = ''; approvalId = ''; setInflight(null)
      if (next.state === 'done') { lastReply = next.text ?? ''; lastActivity = Date.now() } // 返答前に一瞬くつろぎへ戻らない
      show(next.state)
      if (next.state === 'done') deliver(next.text ?? '')
      else if (next.state === 'failed') { setError('処理の結果を確認できませんでした。'); show('failed') }
      else if (next.state === 'stopped') { setBubble('止めました。ほかにご用はありますか、ご主人さま。'); addHistory('お知らせ', '依頼を止めました。') }
      return
    }
  }
  if (requestId === id) { busy = false; requestId = ''; setInflight(null); setError('応答の確認がタイムアウトしました。'); show('failed') }
}
/** 返答を吹き出し・カード・履歴へ出し、演技と読み上げを始める（Studio と同じ）。 */
function deliver(text: string) {
  error.textContent = ''; trouble.hidden = true
  lastReply = text; lastActivity = Date.now(); reply.dataset.reply = '1'
  setBubble(text || '（空の返答でした）'); addHistory('コハコ', text); renderCards(cardsFromText(text))
  if (actingEnabled && text) {
    const sentences = splitSentences(text)
    acting?.beginReply(); show('speaking')
    let current = 0
    const events = {
      onSentence: (index: number, sentence: string) => { current = index; speakingSince = performance.now(); acting?.sentence(cueForSentence(sentence)); if (acting) report.acting = acting.snapshot },
      onEnd: () => { if (state === 'speaking') show('done') },
      onError: () => { if (state === 'speaking') mouthOnly(sentences.slice(current).join('')) },
    }
    if (speech.checked && speaker) speaker.speak(sentences, events)
    else {
      const total = sentences.reduce((n, s) => n + Array.from(s.replace(/\s/g, '')).length, 0)
      sentencer.run(sentences, s => total ? silentSpeechSeconds(text) * Array.from(s.replace(/\s/g, '')).length / total : 0, events)
    }
  } else if (!actingEnabled && speech.checked && synthesis && text) {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'
    u.onstart = () => { speakingSince = performance.now() }; u.onend = () => { if (state === 'speaking') show('done') }
    u.onerror = e => { if (state !== 'speaking') return; if (e.error === 'interrupted' || e.error === 'canceled') show('done'); else mouthOnly(text) }
    show('speaking'); speakingSince = performance.now(); window.speechSynthesis.speak(u)
  } else if (text) mouthOnly(text)
}
function mouthOnly(text: string) {
  show('speaking'); speakingSince = performance.now()
  mouthTimer = window.setTimeout(() => { if (state === 'speaking') show('done') }, silentSpeechSeconds(text) * 1000)
}
speech.addEventListener('change', () => { if (!speech.checked) hushNow() })
function hushNow() { if (actingEnabled) interruptActing(); else if (synthesis) window.speechSynthesis.cancel(); if (state === 'speaking') show('done') }
hush.addEventListener('click', hushNow)

el<HTMLFormElement>('form').addEventListener('submit', async event => {
  event.preventDefault(); const text = message.value.trim(); if (!text || busy || !enabled || recording || starting) return
  if (actingEnabled) interruptActing(); else if (synthesis) window.speechSynthesis.cancel()
  error.textContent = ''; busy = true; accepted = false; started = Date.now(); lastActivity = Date.now(); typingUntil = 0; delete reply.dataset.reply
  renderCards([]); setBubble('…'); show('thinking')
  let payload: Outgoing
  if (unconfirmed) {
    // 受理未確認の送信がある間は新しい ID を発行せず、まず BFF に状態を照会して確定させる（Studio と同じ）。
    const pending = unconfirmed
    let lookup: Awaited<ReturnType<typeof call>> | null = null
    try { lookup = await call(`requests/${pending.requestId}`) } catch { lookup = null }
    const decision = resolveUnconfirmed(pending, lookup ? lookup.status : null, Date.now())
    if (decision === 'attach') {
      setUnconfirmed(null); message.value = pending.text; requestId = pending.requestId; accepted = true
      setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
      addHistory('お知らせ', '前回の送信は受理済みでした。再送せずに結果を追います。'); show('thinking'); void poll(requestId); return
    }
    if (decision === 'wait') {
      busy = false; message.value = pending.text
      setError('前回の送信が受理されたか確認できません。二重実行を避けるため、確認できるまで新しい送信は行いません。しばらくしてから再度送信してください。'); show('failed'); return
    }
    if (decision === 'resend') { payload = pending; if (pending.text !== text) { message.value = pending.text; addHistory('お知らせ', '受理未確認の前回メッセージを同じ受付番号で再送します（重複実行防止）。') } }
    else { setUnconfirmed(null); payload = newOutgoing(text, Date.now(), () => crypto.randomUUID()) }
  } else payload = newOutgoing(text, Date.now(), () => crypto.randomUUID())
  requestId = payload.requestId
  let result: Awaited<ReturnType<typeof call>> | null = null
  try { result = await call('messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) } catch { result = null }
  if (result && result.status === 202) {
    setUnconfirmed(null); accepted = true; addHistory('あなた', payload.text); message.value = ''; message.style.height = ''
    setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true }); show(state); void poll(requestId); return
  }
  busy = false; requestId = ''
  if (sendOutcomeUnknown(result ? result.status : null) || payload === unconfirmed) {
    setUnconfirmed(payload)
    setError('送信結果を確認できません。もう一度送信すると、まず前回の受理状況を確認します（二重実行はしません）。'); show('failed'); return
  }
  fail(result!.status, result!.data)
})
async function decide(choice: 'once' | 'deny') {
  if (!requestId || !approvalId) return
  const allow = el<HTMLButtonElement>('allow'), deny = el<HTMLButtonElement>('deny'); allow.disabled = deny.disabled = true
  try {
    const result = await call('approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, approvalId, choice }) })
    if (result.status !== 200 && result.status !== 202) { const text = result.data?.error === 'approval_expired' ? '確認の期限が切れました。' : result.status === 409 ? 'この確認はすでに処理済みか、受け付けられませんでした。' : problem(result.status, result.data); el('approval-error').textContent = text; addHistory('お知らせ', text) }
    else { addHistory('お知らせ', choice === 'once' ? '一度だけ許可しました。' : '拒否しました。'); approvalId = ''; show('thinking'); message.focus() }
  } catch { el('approval-error').textContent = '承認結果を確認できません。通信を確認してください。' }
  allow.disabled = deny.disabled = false
}
el('allow').addEventListener('click', () => void decide('once'))
el('deny').addEventListener('click', () => void decide('deny'))
// 確認カードが出ている間はフォーカスをカードの中に留める。
approvalBox.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return
  const items = [el<HTMLButtonElement>('allow'), el<HTMLButtonElement>('deny')].filter(b => !b.disabled)
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLButtonElement), next = items[(i + (e.shiftKey ? items.length - 1 : 1) + items.length) % items.length]
  e.preventDefault(); next.focus()
})
document.addEventListener('focusin', e => { if (!approvalBox.hidden && !approvalBox.contains(e.target as Node) && e.target !== stop) el<HTMLButtonElement>('deny').focus() })
setInterval(() => { if (!approvalBox.hidden && approvalExpires) { const s = Math.max(0, Math.round((approvalExpires - Date.now()) / 1000)); el('approval-expiry').textContent = s ? `あと ${s} 秒で期限切れになります（${new Date(approvalExpires).toLocaleTimeString('ja-JP')}）` : '期限が切れました。' } }, 1000)
stop.addEventListener('click', async () => {
  if (!requestId || !accepted) return
  if (actingEnabled) interruptActing()
  stop.disabled = true; stateLabel.textContent = '止めています'
  try { const result = await call(`requests/${requestId}/cancel`, { method: 'POST' }); if (result.status !== 202) setError(problem(result.status, result.data)); else if (result.data?.status === 'cancel-unknown') setError('停止の結果を確認中です。') }
  catch { setError('停止の結果を確認できません。') }
  stop.disabled = false
})

// ---- 録音（Studio と同じ: 押している間だけ、0.5〜30 秒、文字にして入力欄へ入れるだけ） ----
async function finishRecording() {
  held = false
  const r = recording; if (!r) return
  recording = null; clearTimeout(r.timer); r.processor.disconnect(); r.source.disconnect(); r.stream.getTracks().forEach(t => t.stop()); await r.context.close()
  record.textContent = '押して録音'
  const samples = new Float32Array(r.size); let offset = 0; for (const c of r.chunks) { samples.set(c, offset); offset += c.length }
  const pcm = pcm16(samples, r.context.sampleRate).slice(0, 960000)
  if (pcm.length < 16000) { setError('0.5秒以上録音してください。'); show('idle'); return }
  busy = true; show('thinking')
  try {
    const result = await call('transcriptions', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Kohako-Transcription-Id': crypto.randomUUID() }, body: new Blob([pcm]) })
    busy = false
    if (result.status !== 200 || typeof result.data?.text !== 'string') { fail(result.status, result.data); return }
    message.value = result.data.text; show('idle'); message.focus()
  } catch { busy = false; setError('音声認識に接続できませんでした。'); show('failed') }
}
record.addEventListener('pointerdown', async event => {
  if (busy || starting || recording || !stt) return
  event.preventDefault(); held = true; starting = true; error.textContent = ''; record.setPointerCapture(event.pointerId); hushNow()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    if (!held || busy) { stream.getTracks().forEach(t => t.stop()); return }
    const context = new AudioContext(), source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1)
    const r = { stream, context, source, processor, chunks: [] as Float32Array[], size: 0, timer: 0 }; recording = r
    processor.onaudioprocess = e => { const c = new Float32Array(e.inputBuffer.getChannelData(0)); r.chunks.push(c); r.size += c.length }
    source.connect(processor); processor.connect(context.destination); r.timer = window.setTimeout(() => void finishRecording(), 30000); record.textContent = '● 録音中（離すと止まります）'; show('listening')
  } catch { setError('マイクを利用できません。ブラウザの権限を確認してください。'); show('failed') }
  finally { starting = false; show(state) }
})
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) record.addEventListener(ev, () => void finishRecording())

// ---- ふれあい（端末内だけ。通信・AI 呼び出し・記憶・数値の保存をしない） ----
const limiter = new TouchLimiter()
let headIdx: number[] = [], handIdx: number[] = [], areas: { head: Rect | null; hands: Rect[] } = { head: null, hands: [] }, reactionTimer = 0
const BIG = ['joy', 'greet', 'guide', 'shyHand', 'halt']
function computeAreas() {
  if (!rig) return
  const r = rig as Player & { meshVertices(m: number): Float32Array; layout(): { scale: number; left: number; top: number } }
  const layout = r.layout()
  const head = headIdx.length ? headIdx.reduce<[number, number, number, number] | undefined>((b, i) => bboxOf(r.meshVertices(i), b), undefined) : undefined
  areas.head = head && Number.isFinite(head[0]) ? toScreenRect(head, layout, 6) : null
  const bigNow = BIG.includes(String((acting?.snapshot as { gesture?: string } | undefined)?.gesture ?? 'none')) || BIG.includes(touchGesture)
  areas.hands = bigNow ? [] : handIdx.map(i => toScreenRect(bboxOf(r.meshVertices(i)), layout, 10))
}
let touchGesture = 'none'
function touchBlocked(): string | null {
  if (!prefs.touch) return 'ふれあいは設定で OFF です。'
  if (state === 'approval') return '確認待ちの間はふれあいを止めています。'
  if (state === 'failed' || state === 'offline' || netDown) return 'いまはふれあいできません。'
  if (recording) return '録音中はふれあいを止めています。'
  return null
}
function touchReact(zone: Zone, kind: 'tap' | 'pat', via: 'pointer' | 'menu') {
  const blocked = touchBlocked(); if (blocked) { if (via === 'menu') el('touch-live').textContent = blocked; return }
  const now = Date.now(), quietOnly = state === 'thinking' || state === 'speaking' || state === 'listening'
  const { reaction, line } = limiter.react(kind, zone, now, { lines: prefs.lines, quietOnly })
  const act = acts[reaction], gesture = prefs.intensity === 'subtle' || reduced() ? act.subtleGesture : act.gesture
  ;(report.touches as unknown[]).push({ at: now, zone, kind, via, reaction, line, gesture, state }); if ((report.touches as unknown[]).length > 50) (report.touches as unknown[]).shift()
  if (stage) {
    if (quietOnly) { if (!BIG.includes(String(acting?.snapshot.gesture))) stage.playGesture('nod') }
    else {
      clearTimeout(reactionTimer)
      stage.setEmotion(act.emotion); if (gesture !== 'none') stage.playGesture(gesture); touchGesture = gesture
      reactionTimer = window.setTimeout(() => { touchGesture = 'none'; if (state !== 'speaking' && state !== 'approval' && state !== 'failed') { stage?.reset(); if (rig) actingEnabled ? actingPose(rig, rigStateOf[state]) : applyPose(rig, rigModel, rigStateOf[state]) } }, gesture === 'none' || gesture === 'nod' ? 2200 : 3200)
    }
  }
  const words = zone === 'hand' ? 'ハイタッチしました' : kind === 'pat' ? '頭をなでました' : '頭にタッチしました'
  el('touch-live').textContent = `${words}。${line ?? 'コハコが反応しました。'}`
  if (line && !quietOnly) {
    const before = reply.textContent ?? '', wasTouch = bubble.classList.contains('touch')
    setBubble(line, true); lastActivity = Date.now(); if (sceneNow() === 'relax') refreshScene()
    touchLineTimer = window.setTimeout(() => { if (bubble.classList.contains('touch')) setBubble(wasTouch ? '' : before) }, 4500)
  }
}
let track: { id: number; zone: Zone; points: Point[] } | null = null
rigCanvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary || track) return
  if (character.classList.contains('mini')) return
  computeAreas()
  const rect = rigCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top
  const zone: Zone | null = areas.head && inside(areas.head, x, y) ? 'head' : areas.hands.some(h => inside(h, x, y)) ? 'hand' : null
  if (!zone) return
  track = { id: e.pointerId, zone, points: [{ x, y, time: performance.now() }] }
})
rigCanvas.addEventListener('pointermove', e => { if (!track || e.pointerId !== track.id) return; const rect = rigCanvas.getBoundingClientRect(); track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() }); if (track.zone === 'head' && track.points.length > 3) e.preventDefault() })
rigCanvas.addEventListener('pointerup', e => {
  if (!track || e.pointerId !== track.id) return
  const rect = rigCanvas.getBoundingClientRect(); track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() })
  const kind = classifyTouch(track.points, track.zone), zone = track.zone; track = null
  if (kind) touchReact(zone, kind, 'pointer')
})
rigCanvas.addEventListener('pointercancel', () => { track = null })
// 二本指・ピンチはふれあいにしない。
rigCanvas.addEventListener('touchstart', e => { if (e.touches.length > 1) track = null }, { passive: true })
character.addEventListener('click', () => { if (character.classList.contains('mini')) { message.blur(); renderCards([]); refreshScene(true) } })
const touchOpen = el<HTMLButtonElement>('touch-open'), touchMenu = el('touch-menu')
touchOpen.addEventListener('click', () => { touchMenu.hidden = !touchMenu.hidden; touchOpen.setAttribute('aria-expanded', String(!touchMenu.hidden)); if (!touchMenu.hidden) el<HTMLButtonElement>('touch-pat').focus() })
el('touch-pat').addEventListener('click', () => touchReact('head', 'pat', 'menu'))
el('touch-hand').addEventListener('click', () => touchReact('hand', 'tap', 'menu'))

// ---- 引き出し・Esc ----
const drawers: [string, string][] = [['history', 'history-open'], ['settings', 'settings-open']]
for (const [id, opener] of drawers) {
  el(opener).addEventListener('click', () => { for (const [other] of drawers) if (other !== id) el(other).hidden = true; el(id).hidden = !el(id).hidden; if (!el(id).hidden) el<HTMLButtonElement>(`${id}-close`).focus() })
  el(`${id}-close`).addEventListener('click', () => { el(id).hidden = true; el(opener).focus() })
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { for (const [id] of drawers) el(id).hidden = true; touchMenu.hidden = true; touchOpen.setAttribute('aria-expanded', 'false') } })

// ---- リグの読込と描画ループ ----
function rigTick(now: number) {
  if (!rig) return
  const mouth = mouthLevel(rigModel, state === 'speaking' && speakingSince ? speechMouth((now - speakingSince) / 1000) : 0)
  rig.lipSync(mouth); report.mouth = mouth
  requestAnimationFrame(rigTick)
}
async function startRig() {
  if (!wantsRig(location.search)) { el('face-mode').textContent = '静止表情（?face=static）'; return }
  try {
    const loaded = await loadRig(rigCanvas, rigModel, './kohako/live2d/sample/')
    rig = loaded.player; rig.start()
    const ids = (rig as Player & { meshIds?: string[] }).meshIds ?? []
    headIdx = HEAD_MESHES.map(n => ids.indexOf(n)).filter(i => i >= 0); handIdx = HAND_MESHES.map(n => ids.indexOf(n)).filter(i => i >= 0)
    stage = createActingStage(rig, rigModel)
    if (actingEnabled) acting = new ActingDirector(calmStage(stage))
    face.hidden = true; rigCanvas.hidden = false
    el('face-mode').textContent = `${rigModel.name}（独自 runtime・公式 Live2D ではありません）`
    Object.assign(report, { loaded: true, model: rigModel.id, totalMs: loaded.totalMs, headMeshes: headIdx.length, handMeshes: handIdx.length })
    show(state); requestAnimationFrame(rigTick)
  } catch (e) {
    (report.errors as string[]).push(e instanceof Error ? e.message : String(e))
    el('face-mode').textContent = 'リグを読み込めなかったため静止表情で表示しています（ふれあいは「ふれあい」ボタンから）'
  }
}
// 自動計測用（同一ページの状態を読むだけ）。
Object.assign(window, { __kohakoHome: { report, get player() { return rig }, get state() { return state }, get scene() { return sceneNow() }, hitAreas: () => { computeAreas(); const r = rigCanvas.getBoundingClientRect(), abs = (a: Rect | null) => a && { x: a.x + r.left, y: a.y + r.top, w: a.w, h: a.h }; return { head: abs(areas.head), hands: areas.hands.map(abs) } }, get prefs() { return prefs }, history, debug: () => ({ pointerDown, typingIn: typingUntil - Date.now(), scrollingIn: scrollingUntil - Date.now(), director: { ...director }, target: targetScene({ state, thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0, cardsOpen, idleMs: Date.now() - lastActivity, hasReply: !!lastReply, netDown }) }) } })
setBubble('おかえりなさい、ご主人さま。'); show('offline')
void initialize()
void startRig()
