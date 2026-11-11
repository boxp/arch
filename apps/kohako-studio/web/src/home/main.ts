import { initInbox } from './inbox'
// BOXP-500: コハコの家（kohako-home）。Studio と同じ BFF・認証・Web 専用会話を使う全画面 UI。
// 会話の送信・重複防止・停止・承認・追跡は Studio（src/studio/main.ts）と同じ規則。人格・判断・記憶は Hermes だけが持つ。
import './style.css'
import { states, formatPool, formatTasks, gaugeOf, taskBadgeOf, upstreamUnavailable, type Status } from './status'
import { validateViews, mapsUrl, htmlSrcdoc, sanitizeHtml, type View } from './views'
import { clipHold, isPetting, petFollow, petShown, zeroPet } from './petfollow'
import { makeVisemes, visemeAt, boundaryTime, spokenSeconds, type VisemeSequence } from '../live2d/viseme'
import { interpretRequest, newOutgoing, pcm16, presentation, resolveUnconfirmed, rigStateOf, sendOutcomeUnknown, silentSpeechSeconds, studioRigModelId, wantsActing, wantsRig, type Outgoing, type State } from '../studio/model'
import { clipIdFor, clipName, lookFor, modelFor, mouthLevel, poseFor, type RigState } from '../live2d/model'
import { applyPose, loadRig, type Player } from '../live2d/rig'
import { ActingDirector, cueForSentence, splitSentences, type ActingStage } from '../live2d/acting'
import { createActingStage } from '../live2d/gesture'
import { createSentenceSpeaker, createSilentSentencer } from '../studio/acting-speech'
import { SceneDirector, targetScene, type Scene } from './scene'
import { cardsFromText, type Card } from './cards'
import { acts, bboxOf, classifyTouch, HAND_MESHES, HEAD_MESHES, inside, toScreenRect, TouchLimiter, TouchBatcher, type Point, type Rect, type Zone } from './touch'
import { parsePrefs, type Prefs } from './prefs'
import { parseResume, parseUnconfirmed, pollVerdict, type Inflight } from './resume'
import { addErrorText, holdLabel, MessageQueue, QUEUE_MAX_ITEMS, type HoldReason, type QueueItem } from './queue'

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
const setUnconfirmed = (o: Outgoing | null) => { unconfirmed = o; if (!o) pendingFromQueue = false; tab.set(UNCONFIRMED_KEY, o ? JSON.stringify(o) : null) }
// BOXP-508: 送信待ち（本文はメモリだけ）。pendingFromQueue は受理未確認の控えが送信待ちから送り出したものか（入力欄に戻さず送信待ち欄に出す）。
const queue = new MessageQueue()
let pendingFromQueue = false, dispatching = false, dispatchTimer = 0
const queueBox = el('queue'), queueList = el('queue-list'), queueStatus = el('queue-status'), queueNote = el('queue-note'), queueResume = el<HTMLButtonElement>('queue-resume'), queueClear = el<HTMLButtonElement>('queue-clear')
const setInflight = (x: Inflight | null) => tab.set(INFLIGHT_KEY, x ? JSON.stringify(x) : null)
let recording: { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; size: number; timer: number } | null = null
let starting = false, held = false
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
speech.disabled = !synthesis

// ---- リグと演技（476 の規則をそのまま使う） ----
const rigModel = modelFor(`?model=${studioRigModelId(location.search)}`)
let rig: Player | null = null, stage: (ActingStage & { report(): Record<string, unknown> }) | null = null, acting: ActingDirector | null = null, speakingSince = 0, mouthTimer = 0
let visemes: VisemeSequence | null = null, visemeAnchor = 0, visemeLive = false
function startViseme(text: string, duration = silentSpeechSeconds(text), live = false) { visemes = makeVisemes(text, duration); visemeLive = live; speakingSince = performance.now(); visemeAnchor = 0 }
function syncViseme(charIndex: number) { if (visemes) { visemeAnchor = boundaryTime(visemes, charIndex); speakingSince = performance.now() } }
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
function renderCards(next: Card[], views: View[] = []) {
  cards = next; cardsOpen = next.length > 0 || views.length > 0; cardList.replaceChildren()
  for (const c of next) {
    const box = document.createElement('div'); box.className = `card card-${c.kind}`
    if (c.kind === 'list') { const ul = document.createElement('ul'); for (const item of c.items) { const li = document.createElement('li'); li.textContent = item; ul.append(li) } box.append(ul) }
    else if (c.kind === 'code') { const pre = document.createElement('pre'); pre.textContent = c.text; box.append(pre) }
    else { const host = document.createElement('div'); host.className = 'host'; host.textContent = c.host; const a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = c.url; box.append(host, a) }
    cardList.append(box)
  }
  for (const view of views) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = view.kind === 'map' ? '地図を開く' : view.kind === 'usage' ? '利用枠のグラフを開く' : '図を開く'
    button.addEventListener('click', () => openViewer(view, button)); cardList.append(button)
  }
  cardsBox.hidden = !cardsOpen
}

const viewer = el('viewer'), viewerBody = el('viewer-body')
let viewerOpener: HTMLElement | null = null
function closeViewer(focus = true) {
  if (viewer.hidden) return
  viewer.hidden = true; viewerBody.replaceChildren(); delete body.dataset.viewer
  if (focus && viewerOpener?.isConnected) viewerOpener.focus()
  refreshScene(true)
}
el('viewer-close').addEventListener('click', () => closeViewer())
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.hidden) closeViewer() })
function openViewer(view: View, opener: HTMLElement) {
  viewerOpener = opener; viewer.hidden = false; body.dataset.viewer = 'open'; viewerBody.replaceChildren()
  el('viewer-title').textContent = view.title ?? '利用枠'; refreshScene(true)
  const line = (text: string) => { const p = document.createElement('p'); p.textContent = text; viewerBody.append(p); return p }
  if (view.kind === 'map') {
    line([view.destination.name, view.destination.address].filter(Boolean).join(' '))
    if (view.mode) line(`移動手段: ${{ transit: '公共交通', walking: '徒歩', driving: '車', bicycling: '自転車' }[view.mode]}`)
    if (view.origin) line(`出発地: ${view.origin}`)
    const link = (text: string, origin: boolean) => { const a = document.createElement('a'); a.href = mapsUrl(view, origin); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; a.textContent = text; viewerBody.append(a, document.createElement('br')) }
    link('Google マップで経路を開く', false); if (view.origin) link(`出発地『${view.origin}』から開く`, true)
    line('開くと目的地（出発地を選んだ場合は出発地も）が Google に送られます。家の中への地図の埋め込みは Google の API キー（新しい契約）が必要なため行っていません。')
  } else if (view.kind === 'html') {
    line('コハコが作った図です。数値は会話内容にもとづくもので、確認されたデータではありません。')
    const frame = document.createElement('iframe'); frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer'; frame.setAttribute('allow', ''); frame.title = view.title; frame.srcdoc = htmlSrcdoc(sanitizeHtml(view.html)); viewerBody.append(frame)
  } else {
    const refresh = document.createElement('button'); refresh.textContent = '最新にする'; refresh.type = 'button'; viewerBody.append(refresh)
    const chart = document.createElement('div'); viewerBody.append(chart)
    const draw = () => {
      chart.replaceChildren(); if (!statusValue) { chart.textContent = '取得できません'; return }
      const add = (text: string) => { const p = document.createElement('p'); p.textContent = text; chart.append(p); return p }
      const time = (v: string) => new Date(v).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      add(`取得 ${time(statusValue.generatedAt)}`)
      for (const pool of statusValue.quota.pools) for (const w of pool.windows) {
        const absent = w.usedPercent === null || ['not_provided', 'not_applicable', 'unavailable', 'unobserved'].includes(w.state)
        add(`${pool.label} ${w.label} ${absent ? (states[w.state] ?? '未提供') : `${w.usedPercent}%`}（${states[w.state] ?? '不明'}）${w.resetsAt ? `・リセット ${time(w.resetsAt)}` : ''}${w.observedAt ? `・観測 ${time(w.observedAt)}` : ''}`)
        if (!absent) { const bar = document.createElement('div'), fill = document.createElement('div'); bar.className = 'view-bar'; fill.style.width = `${Math.max(0, Math.min(100, w.usedPercent!))}%`; bar.append(fill); chart.append(bar) }
      }
      add(formatTasks(statusValue.tasks))
    }
    refresh.addEventListener('click', async () => { await refreshStatus(); draw() }); draw(); if (!statusValue) void refreshStatus().then(draw)
  }
  el('viewer-close').focus()
}

el('cards-close').addEventListener('click', () => { renderCards([]); lastActivity = Date.now() - 60_000; refreshScene(true) })

function show(next: State) {
  if (actingEnabled && (next === 'failed' || next === 'stopped') && state !== next) interruptActing()
  if (next === 'thinking' && state !== 'thinking') thinkingSince = Date.now()
  state = next
  stateLabel.textContent = netDown ? '通信が切れています' : presentation[next].label
  face.src = `./kohako/studio/c48v6-${presentation[next].face}-color.png`
  if (next !== 'speaking') { speakingSince = 0; visemes = null; stage?.setViseme?.(null); rig?.lipSync(0); clearTimeout(mouthTimer) }
  if (rig) report.pose = { state: next, ...(actingEnabled ? actingPose(rig, rigStateOf[next]) : applyPose(rig, rigModel, rigStateOf[next])) }
  if (acting) { acting.setOperational(rigStateOf[next]); report.acting = acting.snapshot }
  // 応答待ち中も入力欄は使え、送信ボタンは「キューに追加」になる（送信待ちがある間も順序を守るため積む）。
  send.disabled = !enabled || touchActive || !!recording || starting
  send.textContent = queueing() ? 'キューに追加' : '送信'
  stop.hidden = !busy || !requestId || !accepted
  record.hidden = !stt; record.disabled = !enabled || !stt || busy
  hush.hidden = next !== 'speaking' || !speech.checked
  const showApproval = next === 'approval'
  if (showApproval && approvalBox.hidden) { approvalBox.hidden = false; el<HTMLButtonElement>('deny').focus() } else if (!showApproval) approvalBox.hidden = true
  trouble.hidden = !(next === 'failed' || next === 'offline' || netDown) || !error.textContent
  refreshScene()
  renderQueue(); scheduleDispatch()
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
  const target = targetScene({ state, thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0, cardsOpen: cardsOpen || !viewer.hidden, idleMs: Date.now() - lastActivity, hasReply: !!lastReply, netDown })
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
message.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); el<HTMLFormElement>('form').requestSubmit() } })
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
// 利用枠とボードは会話の有効・無効に関係なく取得する。
let statusValue: Status | null = null, statusDelay = 60000, statusTimer = 0, statusLoading = false, statusFailed = false
function renderStatus() {
  const lines = statusValue ? [...statusValue.quota.pools.map(p => formatPool(p)), formatTasks(statusValue.tasks), `更新 ${new Date(statusValue.generatedAt).toLocaleString('ja-JP')}`] : []
  if (statusFailed) lines.unshift(statusValue ? '取得できません（前回の古い情報）' : '取得できません')
  const detail = el('status-detail'); detail.replaceChildren(); for (const line of lines) { const p = document.createElement('p'); p.textContent = line; detail.append(p) }
  const host = el('status-widget'); host.replaceChildren()
  if (!statusValue) { host.textContent = statusFailed ? '利用枠・進行中 取得できません' : '利用枠・進行中を確認中'; return }
  const tag = document.createElement('span'); tag.className = 'status-tag'; tag.textContent = statusFailed ? '古い情報' : '利用枠と進行中'; host.append(tag)
  const row = document.createElement('span'); row.className = 'status-row'; host.append(row)
  for (const [id, label] of [['claude_shared', 'Claude共有'], ['codex_shared', 'Codex共有']]) {
    const g = gaugeOf(statusValue.quota.pools.find(p => p.id === id)), box = document.createElement('span'); box.className = `status-gauge ${g.cls}`; box.dataset.pool = id
    const title = document.createElement('span'); title.className = 'gauge-title'; title.textContent = label
    const ring = document.createElement('span'); ring.className = 'gauge-ring'; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.innerHTML = '<circle class="ring-track" cx="50" cy="50" r="43"/><circle class="ring-value" cx="50" cy="50" r="43" pathLength="100"/>'; const arc = svg.lastElementChild as SVGElement; const amount = Math.max(0, Math.min(100, g.percent ?? 100)); const dashes: number[] = []; if (g.cls === 'stale' || g.percent === null) { for (let n = 0; n < amount; n += 6) dashes.push(Math.min(2, amount - n), Math.min(4, Math.max(0, amount - n - 2))); dashes.push(0, 100) } arc.style.strokeDasharray = dashes.length ? dashes.join(' ') : `${amount} 100`; const value = document.createElement('span'); value.className = 'gauge-value'; value.textContent = g.percent === null ? '—' : `${g.percent}%`; ring.append(svg, value)
    const caption = document.createElement('span'); caption.className = 'gauge-caption'; caption.textContent = [g.label, g.stateText].filter(Boolean).join('・'); box.append(title, ring, caption); row.append(box)
  }
  const t = taskBadgeOf(statusValue.tasks), task = document.createElement('span'); task.className = 'status-task'; const total = document.createElement('strong'); total.className = 'task-total'; total.textContent = t.total === null ? '—' : String(t.total); const text = document.createElement('span'); text.textContent = `進行中${t.suffix}${t.stateText ? `・${t.stateText}` : ''}`; const chips = document.createElement('span'); chips.className = 'task-chips'; for (const a of t.agents) { const chip = document.createElement('span'); chip.textContent = `${a.agent} ${a.count}`; chips.append(chip) } task.append(total, text, chips); row.append(task)
  for (const pool of statusValue.quota.pools.filter(p => !['claude_shared', 'codex_shared'].includes(p.id))) { const g = gaugeOf(pool); if (g.percent === null) continue; const mini = document.createElement('span'); mini.className = `status-mini ${g.cls}`; const text = document.createElement('span'); text.textContent = `${pool.id === 'claude_fable' ? 'Fable専用' : pool.label} ${g.percent}% ${g.stateText}`; const track = document.createElement('span'); track.className = 'mini-track'; const fill = document.createElement('span'); fill.style.width = `${Math.max(0, Math.min(100, g.percent))}%`; track.append(fill); mini.append(text, track); host.append(mini) }
}
async function refreshStatus() {
  clearTimeout(statusTimer); if (document.hidden || statusLoading) return
  statusLoading = true
  let backoff = false
  try {
    const r = await call('status'); if (r.status === 401 || r.status === 403) fail(r.status, r.data)
    if (r.status !== 200 || r.data?.schema !== 'kohako-home-status/v1') throw Error('status unavailable')
    statusValue = r.data as unknown as Status; statusFailed = false; backoff = upstreamUnavailable(statusValue)
  } catch { statusFailed = true; backoff = true }
  finally { statusLoading = false; renderStatus(); if (!backoff) statusDelay = 60000; if (!document.hidden) { statusTimer = window.setTimeout(() => void refreshStatus(), statusDelay); if (backoff) statusDelay = Math.min(600000, statusDelay * 2) } }
}
document.addEventListener('visibilitychange', () => { clearTimeout(statusTimer); if (!document.hidden) void refreshStatus() })
const statusOpen = el<HTMLButtonElement>('status-widget'), statusPanel = el('status-panel')
function setStatusShown(shown: boolean) { statusPanel.hidden = !shown; statusOpen.setAttribute('aria-expanded', String(shown)) }
function closeStatus() { setStatusShown(false) }
statusOpen.addEventListener('click', () => setStatusShown(statusPanel.hidden))
el('status-close').addEventListener('click', () => { closeStatus(); statusOpen.focus() })
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStatus() })
void refreshStatus()
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
  const saved = parseResume(tab.get(INFLIGHT_KEY), Date.now())
  if (!saved) { setInflight(null); if (unconfirmed && !busy) await resumeUnconfirmed(unconfirmed); return }
  if (busy) return
  // 初回照会を待つ間に送信されると requestId が上書きされて追跡が取り違えるため、照会前から送信を止めておく。
  busy = true; accepted = false; show(state)
  let r: Awaited<ReturnType<typeof call>> | null = null
  try { r = await call(`requests/${saved.requestId}`) } catch { r = null }
  // 200 に加え一時的な失敗（502 など）や通信例外でも追跡を再開し、poll 側で問い合わせを続ける（送信可能に戻すと再送で二重実行になり得る）。
  if (!r || pollVerdict(r.status, !!r.data) !== 'terminal') { requestId = saved.requestId; accepted = true; started = Date.now(); addHistory('お知らせ', '再読み込み前の依頼の続きを追っています。'); show('thinking'); void poll(requestId, saved.expiresAt); return }
  busy = false
  if (r.status === 404) { setInflight(null); addHistory('お知らせ', '前回の依頼は見つかりませんでした（新しい会話になった可能性があります）。'); show(state); return }
  // 401/403 は認証切れ。控えを残したまま未認証表示にして送信を止め、再ログイン後の再接続で続きを追う。それ以外の終端は控えを消して失敗を表示する。
  if (r.status !== 401 && r.status !== 403) setInflight(null)
  fail(r.status, r.data)
}
async function poll(id: string, deadline = Date.now() + 11 * 60_000) {
  let misses = 0
  while (requestId === id && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1800))
    let result
    const lost = () => { if (++misses >= 2 && !netDown) { netDown = true; connection.textContent = '通信が切れています（自動で問い合わせ中）'; show(state) } }
    try { result = await call(`requests/${id}`) } catch { lost(); continue }
    if (requestId !== id) return
    // 一時的な失敗（502 など）では追跡と控えを残して問い合わせを続ける。消すと BFF 側で続く依頼の結果を取れず、再送で二重実行になり得る。
    const verdict = pollVerdict(result.status, !!result.data)
    if (verdict === 'retry') { lost(); continue }
    if (netDown || misses) { misses = 0; netDown = false; connection.textContent = '接続中・Web 専用の会話'; error.textContent = ''; show(state) }
    if (verdict === 'terminal' || !result.data) { busy = false; requestId = ''; if (result.status !== 401 && result.status !== 403) setInflight(null); fail(result.status, result.data); return }
    const next = interpretRequest(result.data)
    if (next.state === 'approval' && next.approval) {
      if (approvalId !== next.approval.approvalId) { approvalId = next.approval.approvalId; approvalExpires = next.approval.expiresAt; el('approval-summary').textContent = next.approval.summary; el('approval-error').textContent = ''; addHistory('お知らせ', `確認が必要です: ${next.approval.summary}`); setBubble('実行する前に確認させてください、ご主人さま。') }
      show('approval')
    } else if (next.state === 'thinking') { if (state !== 'thinking') show('thinking') }
    else {
      busy = false; requestId = ''; approvalId = ''; setInflight(null)
      if (next.state === 'done') { lastReply = next.text ?? ''; lastActivity = Date.now() } // 返答前に一瞬くつろぎへ戻らない
      show(next.state)
      if (next.state === 'done') deliver(next.text ?? '', validateViews((result.data.reply as Record<string, unknown> | undefined)?.views))
      else if (next.state === 'failed') { setError('処理の結果を確認できませんでした。'); show('failed') }
      else if (next.state === 'stopped') { setBubble('止めました。ほかにご用はありますか、ご主人さま。'); addHistory('お知らせ', '依頼を止めました。') }
      return
    }
  }
  if (requestId === id) { busy = false; requestId = ''; setInflight(null); setError('応答の確認がタイムアウトしました。'); show('failed') }
}
/** 返答を吹き出し・カード・履歴へ出し、演技と読み上げを始める（Studio と同じ）。 */
function deliver(text: string, views: View[] = []) {
  closeViewer(false)
  error.textContent = ''; trouble.hidden = true
  lastReply = text; lastActivity = Date.now(); reply.dataset.reply = '1'
  setBubble(text || '（空の返答でした）'); addHistory('コハコ', text); renderCards(cardsFromText(text), views)
  if (actingEnabled && text) {
    const sentences = splitSentences(text)
    acting?.beginReply(); show('speaking')
    let current = 0
    const sentenceDuration = (s: string) => { const total = sentences.reduce((n, v) => n + Array.from(v.replace(/\s/g, '')).length, 0); return speech.checked && speaker ? spokenSeconds(s) : total ? silentSpeechSeconds(text) * Array.from(s.replace(/\s/g, '')).length / total : 0 }
    const events = {
      onBoundary: (_index: number, charIndex: number) => syncViseme(charIndex),
      onSentence: (index: number, sentence: string) => { current = index; startViseme(sentence, sentenceDuration(sentence), !!(speech.checked && speaker)); acting?.sentence(cueForSentence(sentence)); if (acting) report.acting = acting.snapshot },
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
    u.onstart = () => { startViseme(text, spokenSeconds(text), true) }; u.onboundary = e => syncViseme(e.charIndex); u.onend = () => { if (state === 'speaking') show('done') }
    u.onerror = e => { if (state !== 'speaking') return; if (e.error === 'interrupted' || e.error === 'canceled') show('done'); else mouthOnly(text) }
    show('speaking'); window.speechSynthesis.speak(u)
  } else if (text) mouthOnly(text)
}
function mouthOnly(text: string) {
  show('speaking'); startViseme(text)
  mouthTimer = window.setTimeout(() => { if (state === 'speaking') show('done') }, silentSpeechSeconds(text) * 1000)
}
speech.addEventListener('change', () => { if (!speech.checked) hushNow() })
function hushNow() { if (actingEnabled) interruptActing(); else if (synthesis) window.speechSynthesis.cancel(); if (state === 'speaking') show('done') }
hush.addEventListener('click', hushNow)

// ---- 送信待ち（BOXP-508） ----
/** 入力欄からの送信を送信待ちへ積むか。応答待ち中・送信中、または送信待ち（保留を含む）が残っている間は順序を守るため積む。 */
function queueing(): boolean { return busy || queue.size > 0 || pendingFromQueue }
/** 自動送信を止める理由（なければ null）。正常終了（done）と待機（idle）以外では送らない。 */
function holdFor(): HoldReason | null {
  if (!enabled) return 'auth'
  if (unconfirmed) return 'unknown'
  if (state === 'stopped') return 'stopped'
  if (state === 'failed') return 'failed'
  if (state === 'offline') return 'offline'
  return null
}
function renderQueue() {
  const items = queue.list(), pending = pendingFromQueue && unconfirmed ? unconfirmed : null
  queueBox.hidden = !items.length && !pending && !queueNote.textContent
  queueList.replaceChildren()
  if (pending) {
    const li = document.createElement('li'); li.className = 'unconfirmed'
    const label = document.createElement('span'); label.className = 'q-state'; label.textContent = busy ? '受理を確認中' : '受理未確認'
    const text = document.createElement('span'); text.className = 'q-text'; text.textContent = pending.text
    li.append(label, text); queueList.append(li)
  }
  items.forEach((item, i) => {
    const li = document.createElement('li')
    const label = document.createElement('span'); label.className = 'q-state'; label.textContent = `${i + 1}番目・未送信`
    const text = document.createElement('span'); text.className = 'q-text'; text.textContent = item.text
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost'; cancel.textContent = '取消'; cancel.setAttribute('aria-label', `送信待ち ${i + 1}番目を取り消す`)
    cancel.addEventListener('click', () => { if (queue.remove(item.id)) { queueNote.textContent = ''; addHistory('お知らせ', '送信待ちを 1 件取り消しました（送っていません）。'); show(state) } })
    li.append(label, text, cancel); queueList.append(li)
  })
  const held = queue.held ?? (pending && !busy ? 'unknown' : null)
  queueStatus.textContent = held
    ? `${holdLabel[held]}、送信待ちの自動送信を止めています。「再開」で${pending ? '受理状況を確認してから' : '先頭から順に'}送ります。`
    : items.length ? (busy || state === 'speaking' ? `いまの応答が終わったら、上から順に 1 件ずつ送ります（${items.length}/${QUEUE_MAX_ITEMS}）。` : 'まもなく先頭を送ります。') : ''
  queueResume.hidden = !held; queueResume.disabled = busy
  queueClear.hidden = !items.length
}
function scheduleDispatch() { if (!dispatchTimer) dispatchTimer = window.setTimeout(() => { dispatchTimer = 0; tryDispatch(false) }, 0) }
/** 送信待ちの先頭を 1 件だけ送る。force は「再開」の明示操作（失敗・停止の後でも送る）。 */
function tryDispatch(force: boolean) {
  if (!queue.size || busy || dispatching) return
  if (!force) {
    if (queue.held) return
    const reason = holdFor()
    if (reason) { if (queue.hold(reason)) { addHistory('お知らせ', `${holdLabel[reason]}、送信待ち ${queue.size} 件の自動送信を止めました。`); renderQueue() } return }
    if (state !== 'done' && state !== 'idle') return
  }
  if (!enabled || unconfirmed || touchActive || recording || starting || netDown) return
  queue.resume()
  const item = queue.take(); if (!item) return
  dispatching = true
  void sendText(item.text, item).finally(() => { dispatching = false; show(state) })
}
function enqueue(text: string): boolean {
  const added = queue.add(text, Date.now())
  if (!added.ok) { queueNote.textContent = addErrorText[added.error]; renderQueue(); return false }
  queueNote.textContent = ''; message.value = ''; message.style.height = ''; typingUntil = 0
  show(state)
  return true
}
queueResume.addEventListener('click', () => {
  if (busy) return
  if (!enabled) { queueNote.textContent = '認証が切れています。再ログイン後に「再接続」してから再開してください。'; renderQueue(); return }
  queueNote.textContent = ''; queue.resume()
  if (unconfirmed) { const pending = unconfirmed; void sendText(pending.text, 'pending'); return }
  tryDispatch(true)
})
queueClear.addEventListener('click', () => { const n = queue.size; queue.clear(); queueNote.textContent = ''; if (n) addHistory('お知らせ', `送信待ち ${n} 件をすべて取り消しました（送っていません）。`); show(state) })
// 送信待ちはメモリだけに持つため、再読み込み・タブを閉じる前にブラウザの確認を出す（黙って再送・保存はしない）。
window.addEventListener('beforeunload', e => { if (queue.size) { e.preventDefault(); e.returnValue = '' } })

el<HTMLFormElement>('form').addEventListener('submit', event => {
  event.preventDefault(); const text = message.value.trim(); if (!text || touchActive || !enabled || recording || starting) return
  if (queueing()) { enqueue(text); return }
  if (unconfirmed && unconfirmed.text !== text) {
    // 受理未確認の前回の発言がある間は、新しい本文を送信待ちへ積んでから前回分を同じ受付番号で確認・再送する（入力を消さず、順序も守る）。
    if (!enqueue(text)) return
    addHistory('お知らせ', '受理未確認の前回メッセージを先に同じ受付番号で確認します（重複実行防止）。新しい発言は送信待ちに積みました。')
    const pending = unconfirmed; void sendText(pending.text, 'pending'); return
  }
  message.value = ''; message.style.height = ''
  void sendText(text, 'composer')
})
/**
 * 1 件の発言を送る。from: 'composer' は入力欄から、'pending' は受理未確認の控えの確認・再送、QueueItem は送信待ちの先頭。
 * 受理（202）されるまで履歴に「あなた」として出さない。受理されなかったと確定したら本文を元の場所（入力欄が空ならそこ、送信待ちなら先頭）へ戻す。
 */
async function sendText(text: string, from: 'composer' | 'pending' | QueueItem): Promise<void> {
  const giveBack = () => {
    if (typeof from === 'object') queue.putBack(from)
    else if (from === 'composer') { if (!message.value.trim()) message.value = text; else queue.putBack({ id: -Date.now(), text, addedAt: Date.now() }) }
  }
  if (actingEnabled) interruptActing(); else if (synthesis) window.speechSynthesis.cancel()
  error.textContent = ''; busy = true; accepted = false; started = Date.now(); lastActivity = Date.now(); typingUntil = 0; delete reply.dataset.reply
  setBubble('…'); show('thinking')
  let payload: Outgoing
  if (unconfirmed) {
    // 受理未確認の送信がある間は新しい ID を発行せず、まず BFF に状態を照会して確定させる（Studio と同じ）。
    const pending = unconfirmed
    let lookup: Awaited<ReturnType<typeof call>> | null = null
    try { lookup = await call(`requests/${pending.requestId}`) } catch { lookup = null }
    const decision = resolveUnconfirmed(pending, lookup ? lookup.status : null, Date.now())
    if (decision === 'attach') {
      setUnconfirmed(null); requestId = pending.requestId; accepted = true
      setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
      addHistory('あなた', pending.text); addHistory('お知らせ', '前回の送信は受理済みでした。再送せずに結果を追います。'); show('thinking'); void poll(requestId); return
    }
    if (decision === 'wait') {
      busy = false; if (from === 'composer') giveBack()
      setError('前回の送信が受理されたか確認できません。二重実行を避けるため、確認できるまで新しい送信は行いません。しばらくしてから再度送信してください。'); show('failed'); return
    }
    if (decision === 'resend') payload = pending
    else { const fromQueue = pendingFromQueue; setUnconfirmed(null); pendingFromQueue = fromQueue; payload = newOutgoing(pending.text, Date.now(), () => crypto.randomUUID()) }
  } else payload = newOutgoing(text, Date.now(), () => crypto.randomUUID())
  requestId = payload.requestId
  // POST 応答前に再読み込みされても BFF 受理済みの依頼を追い直せるよう、送信前に本文と受付番号を控える（再送時は同じ受付番号で BFF が冪等に扱う）。
  const resending = payload === unconfirmed
  setUnconfirmed(payload); if (typeof from === 'object') pendingFromQueue = true
  let result: Awaited<ReturnType<typeof call>> | null = null
  try { result = await call('messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, views: true }) }) } catch { result = null }
  if (result && result.status === 202) {
    setUnconfirmed(null); accepted = true; addHistory('あなた', payload.text)
    setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true }); show(state); void poll(requestId); return
  }
  busy = false; requestId = ''
  if (sendOutcomeUnknown(result ? result.status : null) || resending) {
    // 受理されたか不明。本文は控え（同じ受付番号）に残し、送信待ちには戻さない（戻すと二重に送り得る）。
    setUnconfirmed(payload); if (from === 'composer' && !message.value.trim()) message.value = text
    setError('送信結果を確認できません。もう一度送信すると、まず前回の受理状況を確認します（二重実行はしません）。'); show('failed'); return
  }
  const wasQueued = pendingFromQueue
  setUnconfirmed(null) // 受理されなかったことが確定したので控えを消す
  if (from !== 'pending') giveBack(); else if (wasQueued) queue.putBack({ id: -Date.now(), text: payload.text, addedAt: Date.now() }); else if (!message.value.trim()) message.value = payload.text; else queue.putBack({ id: -Date.now(), text: payload.text, addedAt: Date.now() })
  fail(result!.status, result!.data)
}
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

// ---- ふれあい ----
const limiter = new TouchLimiter(), touchBatcher = new TouchBatcher()
let touchActive = false, touchDebounce = 0
// 会話中（考え中・読み上げ中・聞き取り中・録音中/録音開始中）や承認待ち・失敗・未接続では接触 event を Hermes へ送らない
const CONVERSING: State[] = ['thinking', 'speaking', 'listening', 'approval', 'failed', 'offline']
function touchSendable(): boolean { return prefs.lines && enabled && !busy && !unconfirmed && !queue.size && !netDown && !recording && !starting && !CONVERSING.includes(state) }
async function sendTouch() {
  const batch = touchBatcher.take(Date.now(), touchSendable())
  if (!batch) return
  touchActive = true; show(state)
  const id = crypto.randomUUID(), expiresAt = Date.now() + 60000
  try {
    const sent = await call('messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ requestId: id, kind: 'touch', touch: batch, expiresAt }) })
    if (sent.status !== 202) throw new Error('send failed')
    while (Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      const result = await call(`requests/${id}`, { signal: AbortSignal.timeout(10000) })
      if (result.status !== 200 || !result.data) throw new Error('poll failed')
      const next = interpretRequest(result.data)
      if (next.state === 'done' && next.text) {
        if (touchSendable()) {
          const before = reply.textContent ?? '', wasTouch = bubble.classList.contains('touch')
          setBubble(next.text, true)
          clearTimeout(touchLineTimer)
          touchLineTimer = window.setTimeout(() => { if (bubble.classList.contains('touch')) setBubble(wasTouch ? '' : before) }, 4500)
        }
        return
      }
      if (result.data.status !== 'pending') throw new Error('request failed')
    }
    throw new Error('timeout')
  } catch {
    el('touch-live').textContent = '返事を受け取れませんでした。'
    try { await call(`requests/${id}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) }) } catch { /* 結果不明 */ }
  } finally { touchActive = false; touchBatcher.finish(); show(state) }
}
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
  const { reaction } = limiter.react(kind, zone, now, { lines: false, quietOnly })
  const act = acts[reaction], gesture = prefs.intensity === 'subtle' || reduced() ? act.subtleGesture : act.gesture
  ;(report.touches as unknown[]).push({ at: now, zone, kind, via, reaction, gesture, state }); if ((report.touches as unknown[]).length > 50) (report.touches as unknown[]).shift()
  if (stage) {
    if (quietOnly) { if (!BIG.includes(String(acting?.snapshot.gesture))) stage.playGesture('nod') }
    else {
      clearTimeout(reactionTimer)
      stage.setEmotion(act.emotion); if (gesture !== 'none') stage.playGesture(gesture); touchGesture = gesture
      reactionTimer = window.setTimeout(() => { touchGesture = 'none'; if (state !== 'speaking' && state !== 'approval' && state !== 'failed') { stage?.reset(); if (rig) actingEnabled ? actingPose(rig, rigStateOf[state]) : applyPose(rig, rigModel, rigStateOf[state]) } }, gesture === 'none' || gesture === 'nod' ? 2200 : 3200)
    }
  }
  const words = zone === 'hand' ? 'ハイタッチしました' : kind === 'pat' ? '頭をなでました' : '頭にタッチしました'
  el('touch-live').textContent = `${words}。`
  if (!touchActive && touchSendable()) {
    touchBatcher.add(zone, kind, now)
    clearTimeout(touchDebounce)
    touchDebounce = window.setTimeout(() => void sendTouch(), 1200)
  }
}
let track: { id: number; zone: Zone; points: Point[]; headRect: Rect | null } | null = null
let petOffset = zeroPet(), petTick = 0
let holdClipForPet: (on: boolean) => void = () => {}
rigCanvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary || track) return
  if (character.classList.contains('mini')) return
  computeAreas()
  const rect = rigCanvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top
  const zone: Zone | null = areas.head && inside(areas.head, x, y) ? 'head' : areas.hands.some(h => inside(h, x, y)) ? 'hand' : null
  if (!zone) return
  track = { id: e.pointerId, zone, headRect: areas.head, points: [{ x, y, time: performance.now() }] }
})
rigCanvas.addEventListener('pointermove', e => { if (!track || e.pointerId !== track.id) return; const rect = rigCanvas.getBoundingClientRect(); track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() }); if (track.zone === 'head' && track.points.length > 3) e.preventDefault() })
rigCanvas.addEventListener('pointerup', e => {
  if (!track || e.pointerId !== track.id) return
  const rect = rigCanvas.getBoundingClientRect(); track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() })
  const kind = classifyTouch(track.points, track.zone), zone = track.zone; track = null
  if (kind) touchReact(zone, kind, 'pointer')
})
rigCanvas.addEventListener('pointercancel', () => { track = null })
rigCanvas.addEventListener('lostpointercapture', () => { track = null })
document.addEventListener('visibilitychange', () => { if (document.hidden) track = null })
// キャンバスの外で離したときも追跡を解放する（以後のふれあいが止まらないように）。
for (const ev of ['pointerup', 'pointercancel'] as const) window.addEventListener(ev, e => { if (track && e.pointerId === track.id && e.target !== rigCanvas) track = null })
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
  const dt = petTick ? Math.min(0.1, (now - petTick) / 1000) : 0; petTick = now
  const petTrack = track?.zone === 'head' && track.headRect ? { points: track.points, rect: track.headRect, now } : null, petOptions = { enabled: !touchBlocked(), reduced: reduced(), subtle: prefs.intensity === 'subtle' }
  petOffset = petFollow(petOffset, petTrack, dt, petOptions)
  if (stage?.setPetOffset) { stage.setPetOffset(petOffset); holdClipForPet(isPetting(petTrack, petOptions) || petShown(petOffset)) }
  report.petFollow = { ...petOffset }
  const v = visemes && state === 'speaking' && speakingSince ? visemeAt(visemes, visemeAnchor + (now - speakingSince) / 1000, visemeLive) : { vowel: 'closed', open: 0, width: 1 }
  const mouth = mouthLevel(rigModel, v.open)
  stage?.setViseme?.(v.vowel === 'closed' ? null : { open: v.open, width: reduced() ? 1 : v.width })
  rig.lipSync(mouth); report.mouth = mouth; report.viseme = v.vowel
  requestAnimationFrame(rigTick)
}
async function startRig() {
  if (!wantsRig(location.search)) { el('face-mode').textContent = '静止表情（?face=static）'; return }
  try {
    const loaded = await loadRig(rigCanvas, rigModel, './kohako/live2d/sample/')
    rig = loaded.player; rig.start()
    // 待機クリップは頭の角度（ParamAngleX/Y/Z）を毎フレーム上書きし、setParameter で足した追従は描画に出ない（BOXP-505 TD-01 で実測）。
    // なでている間（と離して戻り切るまで）だけクリップを止め、戻ったら最後に指定されたクリップを再開する。
    const clips = clipHold(rig.play.bind(rig))
    rig.play = id => clips.play(id)
    holdClipForPet = on => { clips.hold(on); report.petHeld = clips.held }
    const ids = (rig as Player & { meshIds?: string[] }).meshIds ?? []
    headIdx = HEAD_MESHES.map(n => ids.indexOf(n)).filter(i => i >= 0); handIdx = HAND_MESHES.map(n => ids.indexOf(n)).filter(i => i >= 0)
    // stage は ?acting=0 でも作る（なで追従の ParamAngle と母音口形は stage の update フックで毎フレーム反映される）。
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
Object.assign(window, { __kohakoHome: { report, get player() { return rig }, get state() { return state }, get scene() { return sceneNow() }, hitAreas: () => { computeAreas(); const r = rigCanvas.getBoundingClientRect(), abs = (a: Rect | null) => a && { x: a.x + r.left, y: a.y + r.top, w: a.w, h: a.h }; return { head: abs(areas.head), hands: areas.hands.map(abs) } }, get prefs() { return prefs }, history, debug: () => ({ pointerDown, typingIn: typingUntil - Date.now(), scrollingIn: scrollingUntil - Date.now(), director: { ...director }, target: targetScene({ state, thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0, cardsOpen: cardsOpen || !viewer.hidden, idleMs: Date.now() - lastActivity, hasReply: !!lastReply, netDown }) }) } })
setBubble('おかえりなさい、ご主人さま。'); show('offline')
void initialize()
void startRig()

/** POST 応答前に再読み込みされた送信を照会し、BFF が受理済みなら再送せずに追跡する。未受理・不明なら控えを残し、次の送信で同じ受付番号を使う。 */
async function resumeUnconfirmed(pending: Outgoing) {
  busy = true; accepted = false; show(state)
  let lookup: Awaited<ReturnType<typeof call>> | null = null
  try { lookup = await call(`requests/${pending.requestId}`) } catch { lookup = null }
  if (lookup && lookup.status === 200 && unconfirmed === pending) {
    setUnconfirmed(null); requestId = pending.requestId; accepted = true; started = Date.now()
    setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
    addHistory('あなた', pending.text); addHistory('お知らせ', '再読み込み前の送信は受理済みでした。再送せずに結果を追います。'); show('thinking'); void poll(requestId); return
  }
  busy = false
  // 401/403 は認証切れ。控えを残したまま未認証表示にして送信を止め、再ログイン後の再接続で受理状況を確認し直す。
  if (lookup && (lookup.status === 401 || lookup.status === 403) && unconfirmed === pending) { message.value = pending.text; fail(lookup.status, lookup.data); return }
  if (unconfirmed === pending) { message.value = pending.text; addHistory('お知らせ', '再読み込み前の送信の受理を確認できませんでした。もう一度送信すると、同じ受付番号で確認してから送ります（二重実行はしません）。') }
  show(state)
}

/** 通知への返信（BFF が同じ Web 会話へ受付番号付きで送ったもの）を通常の依頼と同じく追い、応答・承認・停止を家の会話画面に出す。 */
function followRequest(id: string, text: string): boolean {
  if (requestId === id) return true
  if (busy || unconfirmed || !enabled) return false
  if (actingEnabled) interruptActing(); else if (synthesis) window.speechSynthesis.cancel()
  error.textContent = ''; busy = true; accepted = true; started = Date.now(); lastActivity = Date.now(); delete reply.dataset.reply
  requestId = id; addHistory('あなた', text); setBubble('…')
  setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true }); show('thinking'); void poll(requestId)
  return true
}
initInbox(followRequest)
