import { Seen, Shared, nextRev, planSync, validateTranscript } from './sync'
import { classifyFailure, parseReauth, recentlyReloaded, restoredNotice, REAUTH_KEY, serializeReauth } from './reauth'
import { submitAction } from './composer'
import { must } from '../must'
import './activity.css'
import { validateActivity, renderActivity, tickActivity } from './activity'
import { createDictation, supportsDictation, appendDictation } from './dictation'
import { attachmentSubmitAction, attachmentValidation } from './attachments'
import { shouldSubmit } from './keys'
import { atBottom, createFollower } from './scroll'
import {
  mapChunks,
  estimatePosition,
  createReadFollowState,
  textRange,
  highlight,
  scrollReading,
  type Span,
} from './readfollow'
import { chatEntries } from './chatlog'
import { renderMarkdown, plainText } from './markdown'
import { initInbox, noticeChoices } from './inbox'
import { type Choice, choiceButtonText, choiceMessage, extractChoices } from './choices'
// BOXP-500: コハコの家（kohako-home）。Studio と同じ BFF・認証・Web 専用会話を使う全画面 UI。
// 会話の送信・重複防止・停止・承認・追跡は Studio（src/studio/main.ts）と同じ規則。人格・判断・記憶は Hermes だけが持つ。
import './style.css'
import './room.css'
import './menus.css'
import { buildRoomV1, type Daypart, daypartOf, roomOptions } from './room'
import { IdleDirector, type IdleAct, idleActNames, settledHead } from './idle'
import {
  states,
  formatPercent,
  formatPool,
  formatTasks,
  gaugeOf,
  taskBadgeOf,
  upstreamUnavailable,
  miniLabelOf,
  type Status,
} from './status'
import { validateViews, mapsUrl, osmUrl, htmlSrcdoc, sanitizeHtml, type View } from './views'
import { clipHold, isPetting, petEyesWanted, petFollow, petShown, zeroPet } from './petfollow'
import { makeVisemes, visemeAt, boundaryTime, spokenSeconds, type VisemeSequence } from '../live2d/viseme'
import {
  interpretRequest,
  newOutgoing,
  presentation,
  resolveUnconfirmed,
  rigStateOf,
  sendOutcomeUnknown,
  silentSpeechSeconds,
  studioRigModelId,
  wantsActing,
  wantsRig,
  type Outgoing,
  type State,
} from '../studio/model'
import { clipIdFor, clipName, lookFor, modelFor, mouthLevel, poseFor, type RigState } from '../live2d/model'
import { applyPose, loadRig, type Player } from '../live2d/rig'
import { ActingDirector, cueForSentence, splitSentences, type ActingStage } from '../live2d/acting'
import { createActingStage } from '../live2d/gesture'
import { createSentenceSpeaker, createSilentSentencer } from '../studio/acting-speech'
import { SceneDirector, targetScene, messageShown, type Scene } from './scene'
import { arrivalNote, arrivalPhase, LANDING_MS, type Arrival } from './arrival'
import { cardsFromText, type Card } from './cards'
import {
  acts,
  bboxOf,
  classifyTouch,
  fingerRect,
  HAND_MESHES,
  HEAD_MESHES,
  inside,
  toScreenRect,
  TouchLimiter,
  TouchBatcher,
  type Point,
  type Rect,
  type Zone,
} from './touch'
import { createVoicePlayer, splitVoiceSentences } from './voice'
import { parsePrefs, parseVolume, type Prefs } from './prefs'
import { blendLook, followWeightFor, lookTarget, smoothLook, TouchLook, type Look } from './lookfollow'
import { parseResume, parseUnconfirmed, pollVerdict, type Inflight } from './resume'
import { addErrorText, holdLabel, MessageQueue, QUEUE_MAX_ITEMS, type HoldReason, type QueueItem } from './queue'
import { createCharacterMorph, layoutKey } from './morph'

// BOXP-510 TD-03: 家を開いた時点で SW を登録し、PWA としてインストール可能にする（Push と同じ SW・scope）。
if ('serviceWorker' in navigator)
  void navigator.serviceWorker.register('/kohako/sw.js', { scope: '/kohako/' }).catch(() => {})

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const body = document.body,
  face = el<HTMLImageElement>('face'),
  rigCanvas = el<HTMLCanvasElement>('rig'),
  character = el('character')
const stateLabel = el('state'),
  message = el<HTMLTextAreaElement>('message'),
  send = el<HTMLButtonElement>('send'),
  stop = el<HTMLButtonElement>('stop'),
  record = el<HTMLButtonElement>('record'),
  hush = el<HTMLButtonElement>('hush')
// BOXP-544: 縦スマホでは操作ヒントを省いた短い文言にして、入力欄で折り返して切れないようにする。
const fullPlaceholder = message.placeholder
const speech = el<HTMLInputElement>('speech'),
  reply = el('reply'),
  bubble = el('bubble'),
  bubbleTag = el('bubble-tag'),
  error = el('error'),
  trouble = el('trouble'),
  approvalBox = el('approval')
const cardsBox = el('cards'),
  cardList = el('card-list'),
  elapsedLabel = el('elapsed'),
  connection = el('connection')

// ---- 設定（このブラウザにだけ保存） ----
const PREFS_KEY = 'kohako-home-prefs',
  INFLIGHT_KEY = 'kohako-home-inflight',
  UNCONFIRMED_KEY = 'kohako-home-unconfirmed'
const storage = (s: () => Storage) => ({
  get: (k: string) => {
    try {
      return s().getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) s().removeItem(k)
      else s().setItem(k, v)
    } catch {
      /* 保存できない環境では保存しない */
    }
  },
})
const local = storage(() => localStorage),
  tab = storage(() => sessionStorage)
let prefs: Prefs = parsePrefs(local.get(PREFS_KEY))
const systemReduce = matchMedia('(prefers-reduced-motion: reduce)')
const reduced = () => prefs.reducedMotion || systemReduce.matches
const mixBox = el<HTMLInputElement>('pref-mix')
const prefBoxes: [keyof Prefs, HTMLInputElement][] = [
  ['mix', mixBox],
  ['touch', el('pref-touch')],
  ['follow', el('pref-follow')],
  ['lines', el('pref-lines')],
  ['pinned', el('pref-pinned')],
  ['reducedMotion', el('pref-reduce')],
  ['bgMotion', el('pref-bg')],
  ['chestSway', el('pref-chest')],
  ['idleActs', el('pref-idle')],
]
const voiceSelect = el<HTMLSelectElement>('pref-voice'),
  volumeInput = el<HTMLInputElement>('pref-volume'),
  volumeValue = el('pref-volume-value')
const subtleBox = el<HTMLInputElement>('pref-subtle')
function applyPrefs() {
  for (const [key, box] of prefBoxes) box.checked = prefs[key] as boolean
  voiceSelect.value = prefs.voice
  volumeInput.value = String(prefs.volume)
  volumeValue.textContent = `${prefs.volume}%`
  subtleBox.checked = prefs.intensity === 'subtle'
  body.classList.toggle('reduce', reduced())
  body.classList.toggle('bg-still', !prefs.bgMotion || reduced())
  el('touch-open').hidden = !prefs.touch
  local.set(PREFS_KEY, JSON.stringify(prefs))
}
for (const [key, box] of prefBoxes)
  box.addEventListener('change', () => {
    prefs = { ...prefs, [key]: box.checked }
    applyPrefs()
    refreshScene()
  })
voiceSelect.addEventListener('change', () => {
  prefs = { ...prefs, voice: voiceSelect.value === 'browser' ? 'browser' : 'kohaku' }
  applyPrefs()
})
// BOXP-534: 読み上げ音量。動かしている間も再生中のコハクの声へすぐ反映し（端末の声は次の文から）、離したときに保存する。
volumeInput.addEventListener('input', () => {
  const volume = parseVolume(volumeInput.value)
  volumeValue.textContent = `${volume}%`
  prefs = { ...prefs, volume }
  syncVolume()
})
volumeInput.addEventListener('change', () => {
  prefs = { ...prefs, volume: parseVolume(volumeInput.value) }
  applyPrefs()
  syncVolume()
})
subtleBox.addEventListener('change', () => {
  prefs = { ...prefs, intensity: subtleBox.checked ? 'subtle' : 'normal' }
  applyPrefs()
})
systemReduce.addEventListener?.('change', applyPrefs)
document.addEventListener('visibilitychange', () => body.classList.toggle('tab-hidden', document.hidden))
applyPrefs()

// ---- 会話の状態（Studio と同じ） ----
let voiceTrouble = false
/** 読み上げを本人が止めて「続きから読む」を出している（送信待ちの自動送信で再開位置を消さないため）。 */
let speechPaused = false
let state: State = 'offline',
  enabled = false,
  stt = false,
  requestId = '',
  started = 0,
  approvalId = '',
  approvalExpires = 0,
  busy = false,
  accepted = false,
  netDown = false
let authExpired = false,
  intentionalReload = false,
  typedSinceLoad = false
const reconnect = el<HTMLButtonElement>('reconnect')
const rawReauth = tab.get(REAUTH_KEY)
let reauth = parseReauth(rawReauth, Date.now())
if (rawReauth && !reauth) tab.set(REAUTH_KEY, null)
const updateReconnect = () => {
  reconnect.textContent = authExpired ? '再認証のため再読み込み' : '再接続'
}
let unconfirmed: Outgoing | null = parseUnconfirmed(tab.get(UNCONFIRMED_KEY))
const setUnconfirmed = (o: Outgoing | null) => {
  unconfirmed = o
  if (!o) pendingFromQueue = false
  tab.set(UNCONFIRMED_KEY, o ? JSON.stringify(o) : null)
}
// BOXP-508: 送信待ち（本文はメモリだけ）。pendingFromQueue は受理未確認の控えが送信待ちから送り出したものか（入力欄に戻さず送信待ち欄に出す）。
const queue = new MessageQueue()
let pendingFromQueue = false,
  dispatching = false,
  dispatchTimer = 0
const queueBox = el('queue'),
  queueList = el('queue-list'),
  queueStatus = el('queue-status'),
  queueNote = el('queue-note'),
  queueResume = el<HTMLButtonElement>('queue-resume'),
  queueClear = el<HTMLButtonElement>('queue-clear')
const setInflight = (x: Inflight | null) => tab.set(INFLIGHT_KEY, x ? JSON.stringify(x) : null)
let recording = false,
  starting = false
let cancelDictation: (() => void) | undefined, syncDictationNoteHook: (() => void) | undefined
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
const voiceAudio = new Audio()
let mixContext: AudioContext | null = null
function unlockMix() {
  if (!prefs.mix) return
  try {
    const AudioContextClass =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!mixContext && AudioContextClass) {
      mixContext = new AudioContextClass()
      const silent = mixContext.createBufferSource()
      silent.buffer = mixContext.createBuffer(1, 1, mixContext.sampleRate)
      silent.connect(mixContext.destination)
      silent.start()
      silent.onended = () => silent.disconnect()
    }
    if (mixContext && mixContext.state !== 'running') void mixContext.resume().catch(() => {})
  } catch {}
}
for (const name of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(name, unlockMix, true)
async function runningMixContext() {
  unlockMix()
  const context = mixContext
  if (!context) return null
  if (context.state !== 'running') {
    try {
      await Promise.race([context.resume(), new Promise<void>((resolve) => setTimeout(resolve, 300))])
    } catch {
      return null
    }
  }
  return context.state === 'running' ? context : null
}
const voicePlayer = createVoicePlayer({
  fetcher: (input, init) => window.fetch(input, init),
  audio: voiceAudio,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  mixer: { enabled: () => prefs.mix, context: runningMixContext, gain: () => prefs.volume / 100 },
})
const syncVolume = () => {
  voiceAudio.volume = prefs.volume / 100
  voicePlayer.setVolume(prefs.volume / 100)
}
syncVolume()

// ---- リグと演技（476 の規則をそのまま使う） ----
const rigModel = modelFor(`?model=${studioRigModelId(location.search)}`)
let rig: Player | null = null,
  stage: (ActingStage & { report(): Record<string, unknown> }) | null = null,
  acting: ActingDirector | null = null,
  speakingSince = 0,
  mouthTimer = 0
let visemes: VisemeSequence | null = null,
  visemeAnchor = 0,
  visemeLive = false
function startViseme(text: string, duration = silentSpeechSeconds(text), live = false) {
  visemes = makeVisemes(text, duration)
  visemeLive = live
  speakingSince = performance.now()
  visemeAnchor = 0
}
function syncViseme(charIndex: number) {
  if (visemes) {
    visemeAnchor = boundaryTime(visemes, charIndex)
    speakingSince = performance.now()
  }
}
const actingEnabled = wantsActing(location.search)
const speaker = synthesis
  ? createSentenceSpeaker({
      synth: {
        speak: (u) => window.speechSynthesis.speak(u as SpeechSynthesisUtterance),
        cancel: () => window.speechSynthesis.cancel(),
      },
      makeUtterance: (text) => {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ja-JP'
        u.volume = prefs.volume / 100
        return u
      },
    })
  : null
const sentencer = createSilentSentencer({
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
})
const report: Record<string, unknown> = { loaded: false, errors: [] as string[], touches: [] as unknown[] }
// 胸の揺れの状態は検査から読むときだけ求める（毎フレーム report を作らない）。
Object.defineProperty(report, 'chest', { enumerable: true, get: () => stage?.report().chest ?? null })
Object.defineProperty(report, 'hair', { enumerable: true, get: () => stage?.report().hairPatch ?? null })
Object.defineProperty(report, 'face', { enumerable: true, get: () => stage?.report().facePatch ?? null })
function interruptActing() {
  voicePlayer.cancel()
  speaker?.cancel()
  sentencer.cancel()
  acting?.interrupt()
  if (acting) report.acting = acting.snapshot
}
function actingPose(player: Player, s: RigState) {
  const ids = player.clips,
    pose = poseFor(
      s,
      player.expressions,
      ids.map((id) => clipName(rigModel, id)),
    )
  player.play(clipIdFor(rigModel, ids, pose.clip))
  player.lookAt(...lookFor(rigModel, ...pose.look))
  return pose
}
// 「動きを減らす」では体のしぐさを止め、表情だけにする。
const calmStage = (s: ActingStage): ActingStage => ({
  setEmotion: (e) => s.setEmotion(e),
  playGesture: (g) => {
    if (!reduced()) s.playGesture(g)
  },
  reset: () => s.reset(),
})

// ---- 表示 ----
let lastReply = '',
  lastActivity = Date.now(),
  thinkingSince = 0,
  cardsOpen = false
type Entry = { who: 'あなた' | 'コハコ' | 'お知らせ'; text: string; at: number; rid?: string }
const history: Entry[] = []
// BOXP-565: 端末間の会話共有。seen は履歴へ出した発言・返答の受付番号、remoteIds は他端末が送り、この端末が追っているだけの依頼。
const seen = new Seen()
const shared = new Shared()
const remoteIds = new Set<string>()
let transcriptRev = '',
  syncing = false,
  firstSync = true
const chatlog = el('chatlog'),
  chatList = el('chatlog-list')
const chatFollower = createFollower(),
  bubbleFollower = createFollower()
chatFollower.attach(chatlog)
// BOXP-646: スマホ縦で会話ログの高さが変わった（カードが出て場面が変わる等）ときも、末尾を見ていたなら末尾へ合わせ直す。
// 吹き出し末尾の選択肢ボタンが枠の外へ押し出されないようにする。利用者が遡って読んでいる間は動かさない。
let chatlogHeight = 0
new ResizeObserver(() => {
  if (chatlog.clientHeight === chatlogHeight) return
  chatlogHeight = chatlog.clientHeight
  if (chatFollower.following() && !readingFollowsChat()) chatFollower.pin(chatlog)
}).observe(chatlog)
bubbleFollower.attach(bubble)
function renderChat() {
  const bottom = chatFollower.following(),
    top = chatlog.scrollTop
  chatList.replaceChildren(
    ...chatEntries(history, bubbleText).map((entry) => {
      const li = document.createElement('li')
      li.dataset.who = entry.who
      const label = document.createElement('span')
      label.className = 'chat-who'
      label.textContent = entry.who
      const content = document.createElement('div')
      content.className = 'md'
      content.append(renderMarkdown(entry.text))
      li.append(label, content)
      return li
    }),
  )
  if (bottom && !readingFollowsChat()) chatFollower.pin(chatlog)
  else chatlog.scrollTop = top
  if (readingFollowsChat()) updateReading()
}
function addHistory(who: Entry['who'], text: string, at = Date.now(), rid = '') {
  history.push({ who, text, at, ...(rid ? { rid } : {}) })
  if (history.length > 100) history.shift()
  const li = document.createElement('li'),
    w = document.createElement('span'),
    t = document.createElement('span'),
    time = new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const list = el('history-list'),
    scroller = el('history'),
    bottom = atBottom(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight)
  if (rid) li.dataset.rid = rid
  li.dataset.who = who
  w.className = 'who'
  w.textContent = `${who}（${time}）`
  t.className = 'md'
  t.append(renderMarkdown(text))
  li.append(w, t)
  list.append(li)
  if (bottom) scroller.scrollTop = scroller.scrollHeight
  renderChat()
}
let touchLineTimer = 0,
  bubbleText = ''
function setBubble(text: string, touch = false) {
  if (reading) clearReading()
  const bottom = chatFollower.following()
  clearTimeout(touchLineTimer)
  bubbleText = text
  reply.replaceChildren(renderMarkdown(text))
  reply.classList.add('md')
  bubble.classList.toggle('touch', touch)
  bubbleTag.hidden = !touch
  bubble.scrollTop = 0
  bubbleFollower.reset()
  // 吹き出しが別の内容に変わったら、前のお知らせの操作欄は閉じる（通知は受信箱に未読で残る）。
  el('notice-actions').hidden = true
  el('notice-status').textContent = ''
  // BOXP-646: 返答の選択肢ボタンもその返答だけのもの。吹き出しが変わったら閉じ、前の返答へ誤って結び付けない。
  clearReplyChoices()
  renderChat()
  if (bottom && !readingFollowsChat()) chatFollower.pin(chatlog)
  if (readingFollowsChat()) updateReading()
  updateMessage()
}
function updateMessage() {
  body.dataset.message = messageShown({
    scene: body.dataset.scene ?? 'relax',
    touch: bubble.classList.contains('touch'),
    // 通知の操作欄・返答の選択肢ボタン（BOXP-646）が出ている間は、くつろぎ中でも吹き出しを出したままにする。
    notice: !el('notice-actions').hidden || !el('reply-choices').hidden,
  })
    ? '1'
    : '0'
}
function renderCards(next: Card[], views: View[] = []) {
  cardsOpen = next.length > 0 || views.length > 0
  cardList.replaceChildren()
  for (const c of next) {
    const box = document.createElement('div')
    box.className = `card card-${c.kind}`
    if (c.kind === 'list') {
      const ul = document.createElement('ul')
      for (const item of c.items) {
        const li = document.createElement('li')
        li.textContent = item
        ul.append(li)
      }
      box.append(ul)
    } else if (c.kind === 'code') {
      const pre = document.createElement('pre')
      pre.textContent = c.text
      box.append(pre)
    } else {
      const host = document.createElement('div')
      host.className = 'host'
      host.textContent = c.host
      const a = document.createElement('a')
      a.href = c.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = c.url
      box.append(host, a)
    }
    cardList.append(box)
  }
  for (const view of views) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.view = view.kind
    button.textContent =
      view.kind === 'map'
        ? '地図をもう一度表示'
        : view.kind === 'usage'
          ? '利用枠のグラフをもう一度表示'
          : '図をもう一度表示'
    button.addEventListener('click', () => openViewer(view, button))
    cardList.append(button)
  }
  cardsBox.hidden = !cardsOpen
}

const viewer = el('viewer'),
  viewerBody = el('viewer-body')
let viewerOpener: HTMLElement | null = null
function closeViewer(focus = true) {
  if (viewer.hidden) return
  viewer.hidden = true
  viewerBody.replaceChildren()
  if (focus && viewerOpener?.isConnected) viewerOpener.focus()
  refreshScene(true)
}
el('viewer-close').addEventListener('click', () => closeViewer())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !viewer.hidden) closeViewer()
})
function openViewer(view: View, opener: HTMLElement, focus = true) {
  viewerOpener = opener
  viewer.hidden = false
  viewerBody.replaceChildren()
  el('viewer-title').textContent = view.title ?? '利用枠'
  refreshScene(true)
  const line = (text: string) => {
    const p = document.createElement('p')
    p.textContent = text
    viewerBody.append(p)
    return p
  }
  if (view.kind === 'map') {
    // 地図を先頭に置き、スマホでもスクロールなしで見えるようにする。
    if (view.geo) {
      const frame = document.createElement('iframe')
      frame.src = osmUrl(view.geo)
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      frame.referrerPolicy = 'no-referrer'
      frame.setAttribute('allow', '')
      frame.loading = 'eager'
      frame.title = view.title
      viewerBody.append(frame)
      line('© OpenStreetMap contributors')
    } else line('地図上の位置を特定できませんでした。下のリンクから Google マップで開けます。')
    line([view.destination.name, view.destination.address].filter(Boolean).join(' '))
    if (view.mode)
      line(`移動手段: ${{ transit: '公共交通', walking: '徒歩', driving: '車', bicycling: '自転車' }[view.mode]}`)
    if (view.origin) line(`出発地: ${view.origin}`)
    if (view.geo) {
      line(
        view.geo.precision === 'area'
          ? `番地まで特定できなかったため、「${view.geo.label}」付近を表示しています（正確な目的地とは異なる場合があります）。`
          : `「${view.geo.label}」付近（OpenStreetMap の検索結果）`,
      )
      line(
        '地図は OpenStreetMap から読み込みます（目的地付近の位置だけが送られ、出発地は送りません）。経路はこの地図には描かれません。',
      )
    }
    const link = (text: string, origin: boolean) => {
      const a = document.createElement('a')
      a.href = mapsUrl(view, origin)
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.referrerPolicy = 'no-referrer'
      a.textContent = text
      viewerBody.append(a, document.createElement('br'))
    }
    link('Google マップで経路を開く', false)
    if (view.origin) link(`出発地「${view.origin}」からの経路を Google マップで開く`, true)
    line('Google マップを開くと、目的地（および選択した出発地）が Google に送信されます。')
  } else if (view.kind === 'html') {
    line('※コハコが作成した参考図です。数値は会話内容にもとづくもので、確認されたデータではありません。')
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', '')
    frame.referrerPolicy = 'no-referrer'
    frame.setAttribute('allow', '')
    frame.title = view.title
    frame.srcdoc = htmlSrcdoc(sanitizeHtml(view.html))
    viewerBody.append(frame)
  } else {
    const refresh = document.createElement('button')
    refresh.textContent = '最新の状態にする'
    refresh.type = 'button'
    viewerBody.append(refresh)
    const chart = document.createElement('div')
    viewerBody.append(chart)
    const draw = () => {
      chart.replaceChildren()
      if (!statusValue) {
        chart.textContent = '取得できません'
        return
      }
      const add = (text: string) => {
        const p = document.createElement('p')
        p.textContent = text
        chart.append(p)
        return p
      }
      const time = (v: string) => new Date(v).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      add(`取得 ${time(statusValue.generatedAt)}`)
      for (const pool of statusValue.quota.pools)
        for (const w of pool.windows) {
          const absent =
            w.usedPercent === null || ['not_provided', 'not_applicable', 'unavailable', 'unobserved'].includes(w.state)
          add(
            `${pool.label} ${w.label} ${absent ? (states[w.state] ?? '未提供') : formatPercent(w.usedPercent)}（${states[w.state] ?? '不明'}）${w.resetsAt ? `・リセット ${time(w.resetsAt)}` : ''}${w.observedAt ? `・観測 ${time(w.observedAt)}` : ''}`,
          )
          if (!absent) {
            const bar = document.createElement('div'),
              fill = document.createElement('div')
            bar.className = 'view-bar'
            fill.style.width = `${Math.max(0, Math.min(100, must(w.usedPercent)))}%`
            bar.append(fill)
            chart.append(bar)
          }
        }
      add(formatTasks(statusValue.tasks))
    }
    refresh.addEventListener('click', async () => {
      await refreshStatus()
      draw()
    })
    draw()
    if (!statusValue) void refreshStatus().then(draw)
  }
  if (focus) el('viewer-close').focus()
}

el('cards-close').addEventListener('click', () => {
  renderCards([])
  lastActivity = Date.now() - 60_000
  refreshScene(true)
})

function show(next: State) {
  if (actingEnabled && (next === 'failed' || next === 'stopped') && state !== next) interruptActing()
  if (next === 'thinking' && state !== 'thinking') thinkingSince = Date.now()
  state = next
  if ((!enabled || netDown) && (recording || starting)) cancelDictation?.()
  syncDictationNoteHook?.()
  stateLabel.textContent = netDown
    ? '通信断'
    : (
        {
          idle: '待機中',
          listening: '聞き取り中',
          thinking: '考えています',
          speaking: '話しています',
          done: '返答を表示中',
          approval: '確認待ち',
          failed: 'エラー',
          offline: '未接続',
          stopped: '停止済み',
        } satisfies Record<State, string>
      )[next]
  face.src = `./kohako/studio/c48v6-${presentation[next].face}-color.png`
  if (next !== 'speaking') {
    speakingSince = 0
    visemes = null
    stage?.setViseme?.(null)
    rig?.lipSync(0)
    clearTimeout(mouthTimer)
  }
  if (rig)
    report.pose = {
      state: next,
      ...(actingEnabled ? actingPose(rig, rigStateOf[next]) : applyPose(rig, rigModel, rigStateOf[next])),
    }
  if (acting) {
    acting.setOperational(rigStateOf[next])
    report.acting = acting.snapshot
  }
  // 応答待ち中も入力欄は使え、送信ボタンは「送信待ちに追加」になる（送信待ちがある間も順序を守るため積む）。
  send.disabled = !enabled || touchActive || !!recording || starting
  send.textContent = queueing() ? '送信待ちに追加' : '送信'
  stop.hidden = !busy || !requestId || !accepted
  el<HTMLButtonElement>('visit').hidden = busy
  el<HTMLButtonElement>('visit').disabled =
    !enabled || !!unconfirmed || touchActive || !!recording || starting || queueing()
  record.hidden = !stt
  record.disabled =
    !enabled ||
    !stt ||
    busy ||
    netDown ||
    starting ||
    record.dataset.transcribing === 'true' ||
    record.dataset.unsupported === 'true'
  hush.hidden = next !== 'speaking' || !speech.checked
  const showApproval = next === 'approval'
  if (showApproval && approvalBox.hidden) {
    approvalBox.hidden = false
    el<HTMLButtonElement>('deny').focus()
  } else if (!showApproval) approvalBox.hidden = true
  trouble.hidden = !(next === 'failed' || next === 'offline' || netDown || voiceTrouble) || !error.textContent
  refreshScene()
  renderQueue()
  scheduleDispatch()
}

// ---- 場面 ----
const director = new SceneDirector('offline')
let typingUntil = 0,
  scrollingUntil = 0,
  pointerDown = false
const holding = () => pointerDown || Date.now() < typingUntil || Date.now() < scrollingUntil
function shapeOf(): 'pc' | 'portrait' | 'landscape' {
  const w = window.innerWidth,
    h = window.innerHeight
  return h > w ? 'portrait' : w >= 900 && h >= 560 ? 'pc' : 'landscape'
}
let visitActive = false
let lastLayout = '',
  lastViewport = ''
const morph = createCharacterMorph({
  character,
  canvas: rigCanvas,
  draw: () => rig?.draw(),
  frameChanged: () => window.dispatchEvent(new Event('kohako-frame-change')),
  // リグを描いている間だけ。動きを減らす設定・OS の reduced-motion・転送ゲートの出入りの間は即時に切り替える。
  enabled: () =>
    !!rig && !rigCanvas.hidden && !reduced() && !document.hidden && (character.dataset.arrival ?? 'home') === 'home',
})
// BOXP-599 TD-01: 帰還の演出（転送ゲート）の状態。リグを読み込む間は「戻る途中」、現場の実行中は「出ている」、終わった直後だけ短く姿を現す。
let rigLoading = wantsRig(location.search),
  returnedAt: number | null = null
function refreshArrival() {
  const input = { rigLoading, visit: visitActive && busy, returnedAt, now: Date.now() }
  let phase: Arrival = arrivalPhase(input)
  const before = character.dataset.arrival as Arrival | undefined
  if ((before === 'arriving' || before === 'away') && phase === 'home') {
    returnedAt = input.now
    phase = arrivalPhase({ ...input, returnedAt })
    setTimeout(refreshArrival, LANDING_MS + 20)
  }
  if (before === phase) return
  character.dataset.arrival = phase
  const note = el('arrival-note')
  note.textContent = arrivalNote[phase]
  note.hidden = !arrivalNote[phase]
}
function refreshScene(force = false) {
  const vv = window.visualViewport,
    vh = vv ? vv.height : window.innerHeight
  const shape = shapeOf(),
    kbd = shape !== 'pc' && document.activeElement === message && !!vv && vv.height < window.innerHeight * 0.8
  const target = targetScene({
    state,
    thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0,
    cardsOpen: cardsOpen || !viewer.hidden,
    idleMs: Date.now() - lastActivity,
    hasReply: !!lastReply,
    netDown,
    visit: visitActive && busy,
  })
  const scene = director.decide(target, Date.now(), { holding: holding(), pinned: prefs.pinned, force })
  const upper =
    kbd || shape === 'portrait' || shape === 'landscape' || ((scene === 'show' || scene === 'work') && shape === 'pc')
  const apply = () => {
    document.documentElement.style.setProperty('--vh', `${Math.round(vh)}px`)
    body.dataset.shape = shape
    body.dataset.kbd = kbd ? '1' : '0'
    message.placeholder = shape === 'portrait' ? '話しかける' : fullPlaceholder
    if (shape === 'portrait' && bubble.parentElement !== chatlog) {
      chatlog.append(bubble)
      chatlog.scrollTop = chatlog.scrollHeight
    } else if (shape !== 'portrait' && bubble.parentElement !== character.parentElement) character.after(bubble)
    if (viewer.hidden) delete body.dataset.viewer
    else body.dataset.viewer = 'open'
    body.dataset.scene = scene
    el('visit-place').hidden = scene !== 'visit'
    refreshArrival()
    updateMessage()
    if ((character.dataset.frame === 'upper') !== upper) character.dataset.frame = upper ? 'upper' : 'full'
    character.classList.toggle('mini', kbd && shape !== 'portrait')
  }
  // BOXP-626: コハコの配置が変わる時だけ写しで移す（毎回の呼び出しで描き直さない）。
  const layout = layoutKey({
    scene,
    shape,
    kbd,
    upper,
    mini: kbd && shape !== 'portrait',
    viewer: !viewer.hidden,
    vh: Math.round(vh),
  })
  // 画面の大きさ自体が変わった時（リサイズ・回転・キーボード）は写しを使わず即時に切り替える。
  const viewport = `${window.innerWidth}x${window.innerHeight}|${Math.round(vh)}`,
    resized = !!lastViewport && viewport !== lastViewport
  lastViewport = viewport
  if (layout !== lastLayout) {
    lastLayout = layout
    morph.around(apply, { instant: resized })
  } else apply()
  if (scene === 'work' || busy) elapsedLabel.textContent = `${Math.floor((Date.now() - started) / 1000)}秒`
  elapsedLabel.hidden = !busy
  if (scene === 'work' && !reply.dataset.reply && !reply.textContent?.startsWith('少しお時間'))
    setBubble('少しお時間をいただいています。終わりしだいお伝えしますね。途中で止める場合は「停止」を押してください。')
  return scene
}

const sceneNow = () => body.dataset.scene as Scene
window.addEventListener('resize', () => {
  refreshScene()
  if (shapeOf() === 'portrait') closeStatus()
})
window.visualViewport?.addEventListener('resize', () => refreshScene())
message.addEventListener('input', () => {
  typedSinceLoad = true
  typingUntil = Date.now() + 2000
  message.style.height = 'auto'
  message.style.height = `${Math.min(message.scrollHeight, window.innerHeight * 0.3)}px`
})
message.addEventListener('focus', () => setTimeout(() => refreshScene(), 300))
message.addEventListener('blur', () => setTimeout(() => refreshScene(), 300))
message.addEventListener('keydown', (e) => {
  if (shouldSubmit(e)) {
    e.preventDefault()
    el<HTMLFormElement>('form').requestSubmit()
  }
})
for (const box of [bubble, cardsBox, chatlog])
  box.addEventListener(
    'scroll',
    () => {
      scrollingUntil = Date.now() + 1000
    },
    { passive: true },
  )
window.addEventListener(
  'pointerdown',
  () => {
    pointerDown = true
  },
  true,
)
window.addEventListener(
  'pointerup',
  () => {
    pointerDown = false
  },
  true,
)
window.addEventListener(
  'pointercancel',
  () => {
    pointerDown = false
  },
  true,
)

// ---- 背景（BOXP-512） ----
const room = roomOptions(location.search)
if (room.version === 'v1') {
  body.dataset.bg = 'v1'
  document.querySelector('.room')?.replaceChildren(buildRoomV1(document))
}
// ---- 時計 ----
const days = ['日', '月', '火', '水', '木', '金', '土']
let lastClock = ''
function tickClock() {
  const d = new Date(),
    hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (hm !== lastClock) {
    lastClock = hm
    el('clock').textContent = hm
    el('clock-small').textContent = hm
    el('date').textContent =
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${days[d.getDay()]}曜日`
    const h = d.getHours()
    body.dataset.daypart = room.daypart ?? daypartOf(h)
    el('greeting').textContent =
      h < 5
        ? '遅くまでおつかれさまです、ご主人さま。'
        : h < 11
          ? 'おはようございます、ご主人さま。'
          : h < 18
            ? 'こんにちは、ご主人さま。'
            : 'こんばんは、ご主人さま。今日もおつかれさまでした。'
  }
}
setInterval(() => {
  tickClock()
  refreshScene()
}, 500)
tickClock()

// ---- BFF ----
function problem(status: number, data: Record<string, unknown> | null): string {
  if (status === 401 || status === 403) return 'Cloudflare Access でログインし直してください。'
  if (status === 429)
    return 'いま別の依頼を処理中です（Studio など別の画面からの依頼の可能性があります）。終わってからもう一度お試しください。'
  if (data?.error === 'conversation_disabled' || data?.error === 'stt_disabled') return 'この機能は現在無効です。'
  if (data?.error === 'unknown_attachment')
    return '添付ファイルの期限が切れたか、別の会話のファイルです。追加し直してください。'
  if (data?.error === 'pdf_no_text') return 'PDFから文字を抽出できませんでした。'
  if (data?.error === 'pdf_unreadable') return 'PDFを読み取れませんでした。'
  if (data?.error === 'attachments_too_large')
    return '画像の合計サイズが大きすぎます（1回の送信で合計 5.5 MiB まで）。添付を減らしてください。'
  if (data?.error === 'attachment_text_too_large')
    return 'PDFやテキストの本文が長すぎます（合計約 48 KB まで）。ファイルを分けて送ってください。'
  if (status === 413) return 'サイズ超過です。'
  if (status === 415) return '対応していないファイル形式か、拡張子と中身が一致しません。'
  if (status === 422 || data?.error === 'no_speech') return '音声を認識できませんでした。'
  return `処理に失敗しました（${status}）。`
}
async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const response = await fetch(new URL(`api/v1/${path}`, new URL('./', location.href)), {
    ...init,
    credentials: 'same-origin',
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'X-Kohako-Request': '1', ...init.headers },
  })
  if (response.type === 'opaqueredirect') return { status: 401, data: null }
  const data: unknown = await response.json().catch(() => null)
  return {
    status: response.status,
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null,
  }
}
void call('tts')
  .then((result) => {
    el('voice-unavailable').hidden = result.status === 200 && result.data?.available === true
  })
  .catch(() => {
    el('voice-unavailable').hidden = false
  })
// 利用枠とボードは会話の有効・無効に関係なく取得する。
let statusValue: Status | null = null,
  statusDelay = 60000,
  statusTimer = 0,
  statusLoading = false,
  statusFailed = false
function renderStatus() {
  const lines = statusValue
    ? [
        ...statusValue.quota.pools.map((p) => formatPool(p)),
        formatTasks(statusValue.tasks),
        `更新 ${new Date(statusValue.generatedAt).toLocaleString('ja-JP')}`,
      ]
    : []
  if (statusFailed)
    lines.unshift(statusValue ? '最新情報を取得できなかったため、前回の値を表示しています' : '取得できません')
  const detail = el('status-detail')
  detail.replaceChildren()
  for (const line of lines) {
    const p = document.createElement('p')
    p.textContent = line
    detail.append(p)
  }
  const host = el('status-widget')
  host.replaceChildren()
  // 取得失敗中は前回値を表示しているため、横長配置でも「古い情報」の見出しを必ず出す（BOXP-504 TD-02）。
  host.classList.toggle('is-stale', statusFailed && !!statusValue)
  if (!statusValue) {
    host.textContent = statusFailed ? '利用枠・タスクを取得できません' : '利用枠・タスクを確認中'
    return
  }
  const tag = document.createElement('span')
  tag.className = 'status-tag'
  tag.textContent = statusFailed ? '古い情報' : '利用枠とタスク'
  host.append(tag)
  const row = document.createElement('span')
  row.className = 'status-row'
  host.append(row)
  for (const [id, label] of [
    ['claude_shared', 'Claude共有'],
    ['codex_shared', 'Codex共有'],
  ]) {
    const g = gaugeOf(statusValue.quota.pools.find((p) => p.id === id)),
      box = document.createElement('span')
    box.className = `status-gauge ${g.cls}`
    box.dataset.pool = id
    const title = document.createElement('span')
    title.className = 'gauge-title'
    title.textContent = label
    const ring = document.createElement('span')
    ring.className = 'gauge-ring'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.innerHTML =
      '<circle class="ring-track" cx="50" cy="50" r="43"/><circle class="ring-value" cx="50" cy="50" r="43" pathLength="100"/>'
    const arc = svg.lastElementChild as SVGElement
    const amount = Math.max(0, Math.min(100, g.percent ?? 100))
    const dashes: number[] = []
    if (g.cls === 'stale' || g.percent === null) {
      for (let n = 0; n < amount; n += 6) dashes.push(Math.min(2, amount - n), Math.min(4, Math.max(0, amount - n - 2)))
      dashes.push(0, 100)
    }
    arc.style.strokeDasharray = dashes.length ? dashes.join(' ') : `${amount} 100`
    const value = document.createElement('span')
    value.className = 'gauge-value'
    value.textContent = formatPercent(g.percent)
    ring.append(svg, value)
    const caption = document.createElement('span')
    caption.className = 'gauge-caption'
    caption.textContent = [g.label, g.stateText].filter(Boolean).join('・')
    box.append(title, ring, caption)
    row.append(box)
  }
  const t = taskBadgeOf(statusValue.tasks),
    task = document.createElement('span')
  task.className = 'status-task'
  const total = document.createElement('strong')
  total.className = 'task-total'
  total.textContent = t.total === null ? '—' : String(t.total)
  const text = document.createElement('span')
  text.textContent = `進行中${t.suffix}${t.stateText ? `・${t.stateText}` : ''}`
  const chips = document.createElement('span')
  chips.className = 'task-chips'
  for (const a of t.agents) {
    const chip = document.createElement('span')
    chip.textContent = `${a.agent} ${a.count}`
    chips.append(chip)
  }
  task.append(total, text)
  row.append(task)
  // agent 別の内訳はゲージの列の下に横並びで置き、agent が増えても縦に伸びにくくする（BOXP-504 TD-02）。
  if (chips.childElementCount) host.append(chips)
  // 専用枠・Antigravity 群などの小さな帯は 1 本 1 行の列にまとめ、横画面では円形ゲージの横へ並べる（BOXP-504 TD-02）。
  const minis = document.createElement('span')
  minis.className = 'status-minis'
  // 1 本を「名前・値・帯」の 1 行にし、同じ提供元の群（Antigravity）は見出しを 1 つだけ付ける。正常以外の状態は値の後に添える。
  let lastGroup = ''
  for (const pool of statusValue.quota.pools.filter((p) => !['claude_shared', 'codex_shared'].includes(p.id))) {
    const g = gaugeOf(pool)
    if (g.percent === null) continue
    const { group, name } = miniLabelOf(pool)
    if (group && group !== lastGroup) {
      const head = document.createElement('span')
      head.className = 'mini-group'
      head.textContent = group
      minis.append(head)
    }
    lastGroup = group
    const mini = document.createElement('span')
    mini.className = `status-mini ${g.cls}`
    mini.dataset.pool = pool.id
    const label = document.createElement('span')
    label.className = 'mini-label'
    label.textContent = name
    const value = document.createElement('span')
    value.className = 'mini-value'
    value.textContent = `${formatPercent(g.percent)}${g.cls === 'ok' ? '' : ` ${g.stateText}`}`
    const track = document.createElement('span')
    track.className = 'mini-track'
    const fill = document.createElement('span')
    fill.style.width = `${Math.max(0, Math.min(100, g.percent))}%`
    track.append(fill)
    mini.append(label, value, track)
    minis.append(mini)
  }
  if (minis.childElementCount) host.append(minis)
}
async function refreshStatus() {
  clearTimeout(statusTimer)
  if (document.hidden || statusLoading) return
  statusLoading = true
  let backoff = false
  try {
    const r = await call('status')
    if (r.status === 401 || r.status === 403) fail(r.status, r.data)
    if (r.status !== 200 || r.data?.schema !== 'kohako-home-status/v1') throw Error('status unavailable')
    statusValue = r.data as unknown as Status
    statusFailed = false
    backoff = upstreamUnavailable(statusValue)
  } catch {
    statusFailed = true
    backoff = true
  } finally {
    statusLoading = false
    renderStatus()
    fitStatusPanel()
    if (!backoff) statusDelay = 60000
    if (!document.hidden) {
      statusTimer = window.setTimeout(() => void refreshStatus(), statusDelay)
      if (backoff) statusDelay = Math.min(600000, statusDelay * 2)
    }
  }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(statusTimer)
  if (!document.hidden) void refreshStatus()
})
const statusOpen = el<HTMLButtonElement>('status-widget'),
  statusPanel = el('status-panel')
// 詳細は舞台の中に収める。開く向きは CSS の配置に任せ、はみ出す分だけ高さを詰めて中をスクロールさせる（BOXP-504 TD-02）。
function fitStatusPanel() {
  statusPanel.style.maxHeight = ''
  if (statusPanel.hidden) return
  const stage = statusPanel.closest('.stage')
  if (!stage) return
  const p = statusPanel.getBoundingClientRect(),
    s = stage.getBoundingClientRect(),
    over = Math.max(0, s.top + 4 - p.top) + Math.max(0, p.bottom - (s.bottom - 4))
  if (over > 0) statusPanel.style.maxHeight = `${Math.max(80, p.height - over)}px`
}
function setStatusShown(shown: boolean) {
  statusPanel.hidden = !shown
  statusOpen.setAttribute('aria-expanded', String(shown))
  fitStatusPanel()
}
window.addEventListener('resize', fitStatusPanel)
// ウィジェットの実際の高さを --status-h に出し、吹き出し・カード・時計がその分だけ上に収まるよう CSS で詰める。
// 枠の数や文字の大きさで高さが変わっても重ならない（BOXP-504 TD-02）。隠れている間は 0。
new ResizeObserver(() => {
  document.body.style.setProperty('--status-h', `${Math.ceil(statusOpen.offsetHeight)}px`)
  document.body.style.setProperty('--status-w', `${Math.ceil(statusOpen.offsetWidth)}px`)
}).observe(statusOpen)
function closeStatus() {
  setStatusShown(false)
}
statusOpen.addEventListener('click', () => setStatusShown(Boolean(statusPanel.hidden)))
el('status-close').addEventListener('click', () => {
  closeStatus()
  statusOpen.focus()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeStatus()
})
void refreshStatus()
function setError(text: string) {
  error.textContent = text
  if (text) addHistory('お知らせ', text)
}
function fail(status: number, data: Record<string, unknown> | null) {
  authExpired = classifyFailure({ status }) === 'auth'
  updateReconnect()
  setError(
    authExpired
      ? recentlyReloaded(reauth, Date.now())
        ? '再読み込みしても認証できませんでした。ログイン画面が開かない場合は、ブラウザで「コハコの家」のURLを開き直してください。'
        : 'Cloudflare Access の認証が切れました。ボタンで画面を再読み込みしてログインし直してください。'
      : problem(status, data),
  )
  if (authExpired) {
    enabled = false
    connection.textContent = '認証切れ'
    show('offline')
  } else show('failed')
  if (status === 429 && data?.error === 'busy') void syncTranscript()
}
async function initialize() {
  try {
    const me = await call('me')
    if (me.status !== 200) return fail(me.status, me.data)
    const conv = await call('conversation')
    if (conv.status !== 200 || !conv.data) return fail(conv.status, conv.data)
    authExpired = false
    updateReconnect()
    reauth = parseReauth(tab.get(REAUTH_KEY), Date.now())
    if (!reauth) tab.set(REAUTH_KEY, null)
    if (reauth) {
      let restored = 0
      for (const text of reauth.queue) if (queue.add(text, Date.now()).ok) restored++
      let merged = false
      let draftRestored = false
      if (reauth.draft && !message.value) {
        message.value = reauth.draft
        draftRestored = true
      } else if (reauth.draft && (message.value !== reauth.draft || typedSinceLoad)) {
        if (queue.add(reauth.draft, Date.now()).ok) restored++
        else {
          message.value = `${reauth.draft}\n${message.value}`
          merged = true
          draftRestored = true
        }
      }
      if (restored) queue.hold('auth')
      if (restored || draftRestored) addHistory('お知らせ', restoredNotice(draftRestored, merged, restored))
      tab.set(REAUTH_KEY, null)
      reauth = null
    }
    enabled = conv.data.enabled === true
    stt = enabled && !!conv.data.stt
    netDown = false
    connection.title = 'Web専用の会話・端末間で共有中'
    connection.textContent = enabled ? '接続中' : '会話オフ'
    el('features').textContent =
      `音声入力: ${stt ? '利用可能（自宅サーバー内で認識・音声保存なし）' : 'オフ'} ／ 会話の開始: ${typeof conv.data.sessionStartedAt === 'number' ? new Date(conv.data.sessionStartedAt).toLocaleString('ja-JP') : '未開始'}`
    error.textContent = ''
    show(enabled ? 'idle' : 'offline')
    if (enabled) {
      await syncTranscript()
      await resumeInflight()
    }
  } catch {
    authExpired = false
    updateReconnect()
    setError('接続できませんでした。通信を確認して「再接続」を押してください。')
    show('offline')
  }
}
reconnect.addEventListener('click', () => {
  if (!authExpired) {
    error.textContent = ''
    connection.textContent = '接続を確認中'
    void initialize()
    return
  }
  if (
    chips.length &&
    !window.confirm('添付ファイルは再読み込みで外れます。再認証後に追加し直してください。再読み込みしますか？')
  )
    return
  const now = Date.now(),
    previous = parseReauth(tab.get(REAUTH_KEY), now)
  // 認証できないまま再度押した場合は、前回退避した分を上書きせず今回の入力と合わせて退避する。
  const texts = [...(previous?.queue ?? []), ...queue.list().map((x) => x.text)]
  const typed = message.value,
    kept = previous?.draft ?? ''
  const draft = kept && typed && (typed !== kept || typedSinceLoad) ? `${kept}\n${typed}` : typed || kept
  const saved = serializeReauth({ v: 1, draft, queue: texts, at: now, reloadAt: now })
  // 上限超過などで退避できない場合も、確認で取り消されたときに前回退避した分を消さないよう、保存済みの内容は書き換えない。
  if (parseReauth(saved, now)) tab.set(REAUTH_KEY, saved)
  if (tab.get(REAUTH_KEY) !== saved && (draft || texts.length)) {
    const fresh = queue.list().length
    const lost = previous
      ? `今回の入力中の文と送信待ち ${fresh} 件は退避できる上限を超えるため再読み込みで消えます（前回退避した分は残ります）。`
      : `入力中の文と送信待ち ${texts.length} 件は再読み込みで消えます。`
    if (!window.confirm(`${lost}再読み込みしますか？`)) return
  }
  reconnect.disabled = true
  intentionalReload = true
  location.reload()
})
window.addEventListener('online', () => {
  if (!busy) void initialize()
})
window.addEventListener('offline', () => {
  netDown = true
  show(state)
})

/** 再読み込み前に追っていた依頼があれば続きを追う（本文は保存していない）。 */
async function resumeInflight() {
  const saved = parseResume(tab.get(INFLIGHT_KEY), Date.now())
  if (!saved) {
    setInflight(null)
    if (unconfirmed && !busy) await resumeUnconfirmed(unconfirmed)
    return
  }
  if (busy) return
  // 初回照会を待つ間に送信されると requestId が上書きされて追跡が取り違えるため、照会前から送信を止めておく。
  busy = true
  accepted = false
  show(state)
  let r: Awaited<ReturnType<typeof call>> | null = null
  try {
    r = await call(`requests/${saved.requestId}`)
  } catch {
    r = null
  }
  // 200 に加え一時的な失敗（502 など）や通信例外でも追跡を再開し、poll 側で問い合わせを続ける（送信可能に戻すと再送で二重実行になり得る）。
  if (!r || pollVerdict(r.status, !!r.data) !== 'terminal') {
    bubbleFollower.reset()
    renderActivity(el('activity'), null, { live: true })
    requestId = saved.requestId
    accepted = true
    started = Date.now()
    addHistory('お知らせ', '再読み込み前の依頼の続きを追っています。')
    show('thinking')
    void poll(requestId, saved.expiresAt)
    return
  }
  busy = false
  if (r.status === 404) {
    setInflight(null)
    addHistory('お知らせ', '前回の依頼は見つかりませんでした（新しい会話になった可能性があります）。')
    show(state)
    return
  }
  // 401/403 は認証切れ。控えを残したまま未認証表示にして送信を止め、再ログイン後の再接続で続きを追う。それ以外の終端は控えを消して失敗を表示する。
  if (r.status !== 401 && r.status !== 403) setInflight(null)
  fail(r.status, r.data)
}
async function poll(id: string, deadline = Date.now() + 11 * 60_000) {
  let misses = 0
  while (requestId === id && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    let result: Awaited<ReturnType<typeof call>>
    const lost = () => {
      if (++misses >= 2 && !netDown) {
        netDown = true
        connection.textContent = '再接続中'
        show(state)
      }
    }
    try {
      result = await call(`requests/${id}`)
    } catch {
      lost()
      continue
    }
    if (requestId !== id) return
    // 一時的な失敗（502 など）では追跡と控えを残して問い合わせを続ける。消すと BFF 側で続く依頼の結果を取れず、再送で二重実行になり得る。
    const verdict = pollVerdict(result.status, !!result.data)
    if (verdict === 'retry') {
      lost()
      continue
    }
    if (netDown || misses) {
      misses = 0
      netDown = false
      connection.textContent = '接続中'
      error.textContent = ''
      show(state)
    }
    if (verdict === 'terminal' || !result.data) {
      busy = false
      requestId = ''
      if (result.status !== 401 && result.status !== 403) setInflight(null)
      fail(result.status, result.data)
      return
    }
    const next = interpretRequest(result.data)
    visitActive = !!result.data.visit && (next.state === 'thinking' || next.state === 'approval')
    if (result.data.visit) {
      const activity = el('activity')
      activity.hidden = false
      const visit = result.data.visit as { steps?: unknown }
      const steps = Array.isArray(visit.steps) ? visit.steps : []
      activity.textContent =
        steps.filter((step: unknown): step is string => typeof step === 'string').at(-1) || '現場を見ています'
      refreshScene()
    } else
      renderActivity(el('activity'), validateActivity(result.data.activity), {
        live: next.state === 'thinking' || next.state === 'approval',
        // 手順一覧を開いている間だけ、各手順の実行内容（実引数）を取り寄せて行の中に出す（BOXP-560）。
        loadDetail: async (stepId) => (await call(`requests/${id}/activity/${stepId}`)).data,
        onLayout: () => {
          if (body.dataset.shape === 'portrait') chatFollower.pin(chatlog)
          else if (el('activity').dataset.live === '1' && !el('activity-steps')?.hidden) bubbleFollower.pin(bubble)
        },
      })
    if (next.state === 'approval' && next.approval) {
      if (approvalId !== next.approval.approvalId) {
        approvalId = next.approval.approvalId
        approvalExpires = next.approval.expiresAt
        el('approval-summary').textContent = next.approval.summary
        el('approval-error').textContent = ''
        addHistory('お知らせ', `確認が必要です: ${next.approval.summary}`, Date.now(), id)
        setBubble('ご主人さま、実行する前に一度だけ確認させてください。')
      }
      show('approval')
    } else if (next.state === 'thinking') {
      if (state !== 'thinking') show('thinking')
    } else {
      busy = false
      requestId = ''
      approvalId = ''
      setInflight(null)
      if (next.state === 'done') {
        lastReply = next.text ?? ''
        lastActivity = Date.now()
      } // 返答前に一瞬くつろぎへ戻らない
      show(next.state)
      if (next.state === 'done')
        deliver(
          next.text ?? '',
          validateViews((result.data.reply as Record<string, unknown> | undefined)?.views),
          id,
          remoteIds.has(id),
        )
      else if (next.state === 'failed') {
        seen.markEnd(id)
        setError('処理の結果を確認できませんでした。')
        show('failed')
      } else if (next.state === 'stopped') {
        seen.markEnd(id)
        setBubble('処理を止めました、ご主人さま。ほかに何かお手伝いできることはありますか？')
        addHistory('お知らせ', '依頼を止めました。', Date.now(), id)
      }
      remoteIds.delete(id)
      void syncTranscript()
      return
    }
  }
  if (requestId === id) {
    busy = false
    requestId = ''
    setInflight(null)
    setError('応答の確認がタイムアウトしました。')
    show('failed')
  }
}
let speechChunks: string[] = [],
  speechNext = 0
const resumeSpeech = el<HTMLButtonElement>('resume-speech')
const readFollowButton = el<HTMLButtonElement>('read-follow'),
  readFollow = createReadFollowState()
let readSpans: Span[] = [],
  readGroup: { first: number; last: number; start: number; duration: number; boundary?: number } | null = null,
  readTimer = 0,
  reading = false
const readScroller = () => (chatlog.contains(bubble) ? chatlog : bubble)
function readingFollowsChat() {
  return reading && readFollow.following() && readScroller() === chatlog
}
function clearReading() {
  reading = false
  readGroup = null
  clearInterval(readTimer)
  highlight(null)
  readFollowButton.hidden = true
}
function updateReading(force = false) {
  if (!reading || !readGroup) return
  const group = readGroup,
    span = { start: readSpans[group.first]?.start ?? 0, end: readSpans[group.last]?.end ?? 0 }
  const position = estimatePosition(span, group.start, group.duration, performance.now(), group.boundary)
  let index = group.first
  while (index < group.last && position >= readSpans[index].end) index++
  const range = textRange(reply, readSpans[index])
  highlight(range)
  if (range && readFollow.following()) scrollReading(readScroller(), range, force)
}
for (const scroller of [bubble, chatlog]) {
  const pause = () => {
    if (!reading || readScroller() !== scroller) return
    readFollow.pause()
    readFollowButton.hidden = false
  }
  for (const type of ['wheel', 'touchmove']) scroller.addEventListener(type, pause, { passive: true })
  scroller.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pause()
  })
  scroller.addEventListener(
    'pointerdown',
    (event) => {
      const rect = scroller.getBoundingClientRect()
      if (event.pointerType === 'mouse' && event.target === scroller && event.clientX >= rect.right - 16) pause()
    },
    { passive: true },
  )
}
readFollowButton.addEventListener('click', () => {
  readFollow.resume()
  readFollowButton.hidden = true
  updateReading(true)
})
function clearSpeechResume() {
  clearReading()
  speechChunks = []
  speechNext = 0
  speechPaused = false
  resumeSpeech.hidden = true
}
function offerSpeechResume() {
  resumeSpeech.hidden = !speechChunks.length || speechNext >= speechChunks.length
}
function playReply() {
  if (!speechChunks.length) return
  const kohaku = prefs.voice === 'kohaku'
  resumeSpeech.hidden = true
  voiceTrouble = false
  speechPaused = false
  error.textContent = ''
  acting?.beginReply()
  show('speaking')
  clearReading()
  reading = true
  readFollow.reset()
  readSpans = mapChunks(speechChunks, reply.textContent ?? '')
  readTimer = window.setInterval(updateReading, 120)
  const events = {
    onSentence: (index: number, sentence: string, duration = 0) => {
      let last = index,
        joined = speechChunks[index] ?? ''
      while (last + 1 < speechChunks.length && joined.length < sentence.length) joined += speechChunks[++last]
      readGroup = { first: index, last, start: performance.now(), duration }
      updateReading()
      startViseme(sentence, duration || spokenSeconds(sentence), kohaku === false)
      acting?.sentence(cueForSentence(sentence))
      if (acting) report.acting = acting.snapshot
    },
    onBoundary: (_index: number, charIndex: number) => {
      if (readGroup) readGroup.boundary = charIndex
      updateReading()
      syncViseme(charIndex)
    },
    onChunkEnd: (index: number) => {
      speechNext = index + 1
    },
    // 読み上げ失敗で止めた送信待ちは、続きを読み終えたら元どおり自動送信へ戻す。
    onEnd: () => {
      clearSpeechResume()
      if (queue.held === 'speech') queue.resume()
      if (state === 'speaking') show('done')
    },
    onError: () => {
      clearReading()
      if (state !== 'speaking') return
      voiceTrouble = true
      error.textContent = kohaku
        ? 'コハクの声で読み上げられませんでした。「続きから読む」で再試行できるほか、設定の「読み上げの声」から端末の声へ切り替えられます。'
        : '読み上げが途中で止まりました。「続きから読む」で続きを読めます。'
      offerSpeechResume()
      show('done')
    },
  }
  if (kohaku) voicePlayer.speak(speechChunks, events, speechNext)
  else if (speaker) speaker.speak(speechChunks, events, speechNext)
  else {
    clearReading()
    show('done')
    offerSpeechResume()
  }
}
resumeSpeech.addEventListener('click', () => {
  unlockMix()
  primeVoiceAudio()
  speech.checked = true
  playReply()
})

/** 返答を吹き出し・カード・履歴へ出し、演技と読み上げを始める（Studio と同じ）。 */
function deliver(text: string, views: View[] = [], id = '', quiet = false) {
  clearSpeechResume()
  closeViewer(false)
  voiceTrouble = false
  error.textContent = ''
  trouble.hidden = true
  lastReply = text
  lastActivity = Date.now()
  reply.dataset.reply = '1'
  setBubble(text || '（返答の本文がありませんでした）')
  showReplyChoices(text, id)
  if (!id || seen.markReply(id)) addHistory('コハコ', text, Date.now(), id)
  renderCards(cardsFromText(text), views)
  const spoken = plainText(text)
  // 地図・利用枠グラフ・図はボタンを押さなくても返答と同時に開く（ボタンは閉じた後の再表示用）。
  const first = views[0],
    firstButton = first && cardList.querySelector<HTMLButtonElement>('button[data-view]')
  if (!quiet && first && firstButton) openViewer(first, firstButton, false)
  if (!quiet && speech.checked && text && (prefs.voice === 'kohaku' || speaker)) {
    speechChunks = splitVoiceSentences(splitSentences(spoken))
    speechNext = 0
    playReply()
  } else if (!quiet && actingEnabled && text) {
    const sentences = splitSentences(spoken),
      total = sentences.reduce((n, v) => n + Array.from(v.replace(/\s/g, '')).length, 0)
    acting?.beginReply()
    show('speaking')
    sentencer.run(
      sentences,
      (sentence) =>
        total ? (silentSpeechSeconds(spoken) * Array.from(sentence.replace(/\s/g, '')).length) / total : 0,
      {
        onSentence: (_index, sentence) => {
          startViseme(sentence)
          acting?.sentence(cueForSentence(sentence))
          if (acting) report.acting = acting.snapshot
        },
        onEnd: () => {
          if (state === 'speaking') show('done')
        },
        onError: () => {},
      },
    )
  } else if (text) mouthOnly(spoken)
}
function mouthOnly(text: string) {
  show('speaking')
  startViseme(text)
  mouthTimer = window.setTimeout(() => {
    if (state === 'speaking') show('done')
  }, silentSpeechSeconds(text) * 1000)
}
/** 従来方式（HTMLAudio）の再生をユーザー操作内で一度許可させる（iOS は操作外の play() を拒否するため）。読み上げ中の音声は上書きしない。 */
function primeVoiceAudio() {
  if (voiceAudio.getAttribute('src')) return
  voiceAudio.src = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA'
  void voiceAudio
    .play()
    .then(() => {
      if (voiceAudio.src.startsWith('data:audio/wav')) {
        voiceAudio.pause()
        voiceAudio.removeAttribute('src')
        voiceAudio.load()
      }
    })
    .catch(() => {})
}
// 読み上げ ON は Web Audio が使えない場合の従来方式フォールバックに備えて HTMLAudio も許可させる（1 サンプルの無音なので他アプリの音楽は止めない）。
speech.addEventListener('change', () => {
  if (!speech.checked) hushNow(true)
  else {
    unlockMix()
    primeVoiceAudio()
  }
})
// 読み上げ ON のまま「他アプリの音楽を止めない」を OFF にしたときも、その操作内で従来方式の再生を許可させる。
mixBox.addEventListener('change', () => {
  if (!mixBox.checked && speech.checked) primeVoiceAudio()
})
/** 読み上げを止める。pause は本人の「止める」/読み上げOFF で、続きが残るなら送信待ちの自動送信を止めて再開位置を守る（録音開始など新しい発言のための中断では止めない）。 */
function hushNow(pause = false) {
  clearReading()
  voicePlayer.cancel()
  speaker?.cancel()
  if (actingEnabled) interruptActing()
  if (state === 'speaking') {
    if (pause && speechChunks.length > speechNext) speechPaused = true
    show('done')
    offerSpeechResume()
  }
}
hush.addEventListener('click', () => hushNow(true))

// ---- 送信待ち（BOXP-508） ----
/** 入力欄からの送信を送信待ちへ積むか。応答待ち中・送信中・読み上げ中、または送信待ち（保留を含む）が残っている間は順序を守るため積む（読み上げを新しい発言で中断しない）。 */
function queueing(): boolean {
  return busy || state === 'speaking' || queue.size > 0 || pendingFromQueue
}
/** 自動送信を止める理由（なければ null）。正常終了（done）と待機（idle）以外では送らない。 */
function holdFor(): HoldReason | null {
  if (!enabled) return 'auth'
  if (unconfirmed) return 'unknown'
  if (netDown || state === 'offline') return 'offline'
  if (state === 'stopped') return 'stopped'
  if (state === 'failed') return 'failed'
  // 読み上げ失敗・本人の停止で「続きから読む」を出している間は、次の送信で再開位置が消えないよう自動送信を止める。
  if ((voiceTrouble || speechPaused) && speechChunks.length > 0 && speechNext < speechChunks.length) return 'speech'
  return null
}
function renderQueue() {
  const items = queue.list(),
    pending = unconfirmed
  queueBox.hidden = !items.length && !pending && !queueNote.textContent
  queueList.replaceChildren()
  if (pending) {
    const li = document.createElement('li')
    li.className = 'unconfirmed'
    const label = document.createElement('span')
    label.className = 'q-state'
    label.textContent = busy ? '送信状況を確認中' : '届いたか未確認'
    const text = document.createElement('span')
    text.className = 'q-text'
    text.textContent = pending.text
    li.append(label, text)
    queueList.append(li)
  }
  items.forEach((item, i) => {
    const li = document.createElement('li')
    const label = document.createElement('span')
    label.className = 'q-state'
    label.textContent = `${i + 1}番目・待機中`
    const text = document.createElement('span')
    text.className = 'q-text'
    text.textContent = item.text
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'ghost'
    cancel.textContent = '取消'
    cancel.setAttribute('aria-label', `送信待ち ${i + 1}番目を取り消す`)
    cancel.addEventListener('click', () => {
      if (queue.remove(item.id)) {
        queueNote.textContent = ''
        addHistory('お知らせ', '送信待ちを 1 件取り消しました（送っていません）。')
        show(state)
      }
    })
    li.append(label, text, cancel)
    queueList.append(li)
  })
  const held = queue.held ?? (pending && !busy ? 'unknown' : null)
  queueStatus.textContent = held
    ? pending
      ? `${holdLabel[held]}、送信待ちを一時停止しています。「確認して再開」で前回の送信状況を確かめてから送ります。`
      : held === 'speech'
        ? '読み上げが途中のため、送信待ちを一時停止しています。「続きから読む」で読み終えるか、「再開」で上から順に送ります。'
        : `${holdLabel[held]}、送信待ちを一時停止しています。「再開」で上から順に送ります。`
    : items.length
      ? busy || state === 'speaking'
        ? `いまの返答が終わったら、上から順に1件ずつ送ります（${items.length}/${QUEUE_MAX_ITEMS}）。`
        : 'まもなく次のメッセージを送ります。'
      : ''
  queueResume.textContent = pending ? '確認して再開' : '再開'
  queueResume.hidden = !held
  queueResume.disabled = busy
  queueClear.hidden = !items.length
}
function scheduleDispatch() {
  if (!dispatchTimer)
    dispatchTimer = window.setTimeout(() => {
      dispatchTimer = 0
      tryDispatch(false)
    }, 0)
}
/** 送信待ちの先頭を 1 件だけ送る。force は「再開」の明示操作（失敗・停止の後でも送る）。 */
function tryDispatch(force: boolean) {
  if (!queue.size) return
  // 通信切れは応答待ち中でもその場で保留にする（再接続後に明示の「再開」なしで自動送信しないため）。
  if (!force && netDown && !queue.held && queue.hold('offline')) {
    addHistory('お知らせ', `${holdLabel.offline}、送信待ち ${queue.size} 件の自動送信を止めました。`)
    renderQueue()
  }
  if (busy || dispatching) return
  if (!force) {
    if (queue.held) return
    const reason = holdFor()
    if (reason) {
      if (queue.hold(reason)) {
        addHistory('お知らせ', `${holdLabel[reason]}、送信待ち ${queue.size} 件の自動送信を止めました。`)
        renderQueue()
      }
      return
    }
    if (state !== 'done' && state !== 'idle') return
  }
  if (!enabled || unconfirmed || touchActive || recording || starting || netDown) return
  queue.resume()
  const item = queue.take()
  if (!item) return
  dispatching = true
  void sendText(item.text, item).finally(() => {
    dispatching = false
    show(state)
  })
}
function enqueue(text: string, fromComposer = true): boolean {
  const added = queue.add(text, Date.now())
  if (!added.ok) {
    queueNote.textContent = addErrorText[added.error]
    renderQueue()
    return false
  }
  queueNote.textContent = ''
  if (fromComposer) {
    message.value = ''
    message.style.height = ''
    typingUntil = 0
  }
  show(state)
  return true
}
queueResume.addEventListener('click', () => {
  if (busy) return
  if (!enabled) {
    queueNote.textContent =
      '認証が切れています。「再認証のため再読み込み」でログインし直したあと、「再開」を押してください。'
    renderQueue()
    return
  }
  // 通信が戻るまでは保留を解かない（解くと再接続時に明示の再開なしで自動送信されるため）。
  if (netDown) {
    queueNote.textContent = '通信が切れています。接続が戻ってから「再開」してください。'
    renderQueue()
    return
  }
  queueNote.textContent = ''
  queue.resume()
  if (unconfirmed) {
    const pending = unconfirmed
    void sendText(pending.text, 'pending')
    return
  }
  tryDispatch(true)
})
queueClear.addEventListener('click', () => {
  const n = queue.size
  queue.clear()
  queueNote.textContent = ''
  if (n) addHistory('お知らせ', `送信待ち ${n} 件をすべて取り消しました（送っていません）。`)
  show(state)
})
// 送信待ちはメモリだけに持つため、再読み込み・タブを閉じる前にブラウザの確認を出す（黙って再送・保存はしない）。
window.addEventListener('beforeunload', (e) => {
  if (queue.size && !intentionalReload) {
    e.preventDefault()
    e.returnValue = ''
  }
})

type Chip = { name: string; size: number; type: string; state: string; id?: string }
const chips: Chip[] = [],
  chipBox = el('attachment-chips'),
  fileInput = el<HTMLInputElement>('attachment-file'),
  form = el<HTMLFormElement>('form')
function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
function renderChips() {
  chipBox.replaceChildren()
  for (const chip of chips) {
    const span = document.createElement('span'),
      cancel = document.createElement('button')
    span.textContent = `${chip.name} (${formatFileSize(chip.size)}) ${chip.state}`
    cancel.type = 'button'
    cancel.textContent = '×'
    cancel.setAttribute('aria-label', `${chip.name}の添付を取り消す`)
    cancel.onclick = () => {
      const i = chips.indexOf(chip)
      if (i >= 0) chips.splice(i, 1)
      renderChips()
    }
    if (chip.state === '本文一部省略') span.title = '上限を超えた末尾を省略して送信します'
    span.append(cancel)
    chipBox.append(span)
  }
}
async function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const validation = attachmentValidation(file, chips)
    if (validation) {
      setError(validation)
      if (chips.length >= 3) break
      continue
    }
    const chip: Chip = { name: file.name, size: file.size, type: file.type, state: 'アップロード中' }
    chips.push(chip)
    renderChips()
    try {
      const result = await call('attachments', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Kohako-Filename': encodeURIComponent(file.name),
        },
        body: file,
      })
      if (result.status !== 201 || typeof result.data?.attachmentId !== 'string') {
        chip.state = '失敗'
        setError(problem(result.status, result.data))
      } else {
        chip.id = result.data.attachmentId
        chip.name = String(result.data.name)
        chip.state = result.data.truncated ? '本文一部省略' : ''
      }
    } catch {
      chip.state = '失敗'
      setError('アップロードに失敗しました。取り消して再度追加してください。')
    }
    renderChips()
  }
}
el<HTMLButtonElement>('attach').onclick = () => fileInput.click()
fileInput.onchange = () => {
  if (fileInput.files) void addFiles(fileInput.files)
  fileInput.value = ''
}
form.addEventListener('dragover', (e) => e.preventDefault())
form.addEventListener('drop', (e) => {
  e.preventDefault()
  if (e.dataTransfer?.files) void addFiles(e.dataTransfer.files)
})
el('visit').addEventListener('click', () => {
  if (!busy && enabled && !unconfirmed && !touchActive && !recording && !starting && !queueing())
    void sendText('見てきて', 'visit')
})
el<HTMLFormElement>('form').addEventListener('submit', (event) => {
  event.preventDefault()
  const text = message.value.trim() || (chips.length ? '添付ファイルを見てください' : '')
  if (!text || touchActive || !enabled || recording || starting) return
  if (chips.length && chips.some((x) => !x.id)) {
    setError('添付のアップロード完了を待つか、失敗した添付を取り消してください。')
    return
  }
  const attachAction = attachmentSubmitAction(chips.length > 0, queueing(), !!unconfirmed)
  if (attachAction === 'reject-queue') {
    setError('ファイル付きのメッセージは送信待ちに入れられません。いまの返答が終わってから送信してください。')
    return
  }
  if (attachAction === 'confirm-pending' && unconfirmed) {
    // 受理未確認の前回発言（添付付きの同じ依頼を含む）を同じ受付番号で先に確認・再送する。チップは残し、受理されたら外す。
    if (busy || dispatching) {
      setError('前回の送信の受理状況を確認中です。少し待ってから再度送信してください。')
      return
    }
    const pending = unconfirmed,
      same = !!pending.attachments && chips.every((x) => x.id && must(pending.attachments).includes(x.id))
    addHistory(
      'お知らせ',
      same
        ? '受理未確認の添付付き発言を同じ受付番号で確認します（重複実行防止）。'
        : '受理未確認の前回メッセージを先に同じ受付番号で確認します（重複実行防止）。添付と入力はそのまま残しています。',
    )
    void sendText(pending.text, 'pending')
    return
  }
  const action = submitAction({
    hasUnconfirmed: !!unconfirmed,
    queueing: queueing(),
    confirmingBlocked: busy || dispatching || state === 'speaking',
  })
  if (action === 'enqueue') {
    enqueue(text)
    return
  }
  if (action === 'enqueue-and-confirm' && unconfirmed) {
    // 受理未確認の前回の発言がある間は、新しい本文を送信待ちへ積んでから前回分を同じ受付番号で確認・再送する（入力を消さず、順序も守る）。
    if (!enqueue(text)) return
    addHistory(
      'お知らせ',
      '受理未確認の前回メッセージを先に同じ受付番号で確認します（重複実行防止）。新しい発言は送信待ちに積みました。',
    )
    const pending = unconfirmed
    void sendText(pending.text, 'pending')
    return
  }
  message.value = ''
  message.style.height = ''
  void sendText(text, 'composer')
})
// ---- 返答の選択肢ボタン（BOXP-646） ----
// 状態は要素の dataset に持つ（setBubble が初期化途中で呼ばれても参照できるよう、モジュール変数を使わない）。
function clearReplyChoices() {
  const box = el('reply-choices')
  delete box.dataset.owner
  box.hidden = true
  box.replaceChildren()
  updateMessage()
}
/**
 * 最新の返答に選択肢（A／B…）があれば、吹き出しの下にボタンを出す。押すと「A：説明」を通常の発言と同じ経路
 * （受理未確認の確認・送信待ちを含む）で送る。押した時点でボタンを消して二重送信を防ぎ、自動で選ぶことはしない。
 * 入力欄の下書きは消さない。返答が別のものに変わったら（setBubble）ボタンも消える。
 */
function showReplyChoices(text: string, id: string) {
  clearReplyChoices()
  const choices = extractChoices(text)
  if (!choices) return
  const owner = id || `local-${Date.now()}`,
    box = el('reply-choices'),
    bottom = chatFollower.following()
  box.dataset.owner = owner
  for (const choice of choices) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'secondary'
    b.textContent = choiceButtonText(choice)
    b.title = choiceMessage(choice)
    b.addEventListener('click', () => sendReplyChoice(choice, owner))
    box.append(b)
  }
  box.hidden = false
  updateMessage()
  // スマホ縦では吹き出しが会話ログの末尾にあるので、ボタンを足した分も末尾へ追従する（読んでいる途中なら動かさない）。
  if (bottom && !readingFollowsChat()) chatFollower.pin(chatlog)
}
function sendReplyChoice(choice: Choice, owner: string) {
  const box = el('reply-choices')
  if (box.dataset.owner !== owner || box.hidden) return
  if (touchActive || !enabled || recording || starting) {
    el('notice-status').textContent = !enabled
      ? '認証が切れているため送れません。再接続してから選んでください。'
      : '今は送れません。少し待ってから選んでください。'
    return
  }
  const text = choiceMessage(choice)
  const action = submitAction({
    hasUnconfirmed: !!unconfirmed,
    queueing: queueing(),
    confirmingBlocked: busy || dispatching || state === 'speaking',
  })
  if (action === 'send') {
    clearReplyChoices()
    // 下書きの添付は選択内容に混ぜない（'choice' は添付を付けずに送る）。
    void sendText(text, 'choice')
    return
  }
  if (!enqueue(text, false)) return
  clearReplyChoices()
  if (action === 'enqueue-and-confirm' && unconfirmed) {
    addHistory(
      'お知らせ',
      '受理未確認の前回メッセージを先に同じ受付番号で確認します（重複実行防止）。選んだ内容は送信待ちに積みました。',
    )
    const pending = unconfirmed
    void sendText(pending.text, 'pending')
  }
}
/**
 * 1 件の発言を送る。from: 'composer' は入力欄から、'pending' は受理未確認の控えの確認・再送、QueueItem は送信待ちの先頭。
 * 受理（202）されるまで履歴に「あなた」として出さない。受理されなかったと確定したら本文を元の場所（入力欄が空ならそこ、送信待ちなら先頭）へ戻す。
 */
async function sendText(text: string, from: 'composer' | 'choice' | 'pending' | 'visit' | QueueItem): Promise<void> {
  const giveBack = () => {
    if (typeof from === 'object') queue.putBack(from)
    else if (from === 'composer' || from === 'choice') {
      if (!message.value.trim()) message.value = text
      else queue.putBack({ id: -Date.now(), text, addedAt: Date.now() })
    }
  }
  bubbleFollower.reset()
  renderActivity(el('activity'), null, { live: true })
  clearSpeechResume()
  voicePlayer.cancel()
  speaker?.cancel()
  if (actingEnabled) interruptActing()
  voiceTrouble = false
  error.textContent = ''
  busy = true
  accepted = false
  started = Date.now()
  lastActivity = Date.now()
  typingUntil = 0
  delete reply.dataset.reply
  setBubble('…')
  show('thinking')
  let payload: Outgoing
  if (unconfirmed) {
    // 受理未確認の送信がある間は新しい ID を発行せず、まず BFF に状態を照会して確定させる（Studio と同じ）。
    const pending = unconfirmed
    let lookup: Awaited<ReturnType<typeof call>> | null = null
    try {
      lookup = await call(`requests/${pending.requestId}`)
    } catch {
      lookup = null
    }
    const decision = resolveUnconfirmed(pending, lookup ? lookup.status : null, Date.now())
    if (decision === 'attach') {
      setUnconfirmed(null)
      requestId = pending.requestId
      accepted = true
      setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
      if (seen.markUser(pending.requestId))
        addHistory(
          'あなた',
          pending.text + (pending.attachmentNames ?? []).map((x) => `\n📎 ${x}`).join(''),
          Date.now(),
          pending.requestId,
        )
      if (pending.attachments) {
        for (let i = chips.length - 1; i >= 0; i--)
          if (chips[i].id && pending.attachments.includes(must(chips[i].id))) chips.splice(i, 1)
        renderChips()
      }
      addHistory('お知らせ', '前回の送信は受理済みでした。再送せずに結果を追います。')
      show('thinking')
      void poll(requestId)
      return
    }
    if (decision === 'wait') {
      busy = false
      if (from === 'composer' || from === 'choice') giveBack()
      // 照会が 401/403（Access 期限切れのリダイレクトを含む）なら認証切れ。控えと送信待ちは残したまま、再認証用の再読み込みボタンへ切り替える。
      if (lookup && classifyFailure({ status: lookup.status }) === 'auth') {
        fail(lookup.status, lookup.data)
        return
      }
      setError(
        '前回の送信が受理されたか確認できません。二重実行を避けるため、確認できるまで新しい送信は行いません。しばらくしてから再度送信してください。',
      )
      show('failed')
      return
    }
    if (decision === 'resend') payload = pending
    else {
      const fromQueue = pendingFromQueue
      setUnconfirmed(null)
      pendingFromQueue = fromQueue
      payload = {
        ...newOutgoing(pending.text, Date.now(), () => crypto.randomUUID()),
        ...(pending.attachments ? { attachments: pending.attachments, attachmentNames: pending.attachmentNames } : {}),
      }
    }
  } else {
    payload = newOutgoing(text, Date.now(), () => crypto.randomUUID())
    if (from === 'composer' && chips.length) {
      payload.attachments = chips.map((x) => must(x.id))
      payload.attachmentNames = chips.map((x) => x.name)
    }
  }
  requestId = payload.requestId
  // POST 応答前に再読み込みされても BFF 受理済みの依頼を追い直せるよう、送信前に本文と受付番号を控える（再送時は同じ受付番号で BFF が冪等に扱う）。
  const resending = payload === unconfirmed
  setUnconfirmed(payload)
  if (typeof from === 'object') pendingFromQueue = true
  let result: Awaited<ReturnType<typeof call>> | null = null
  try {
    result = await call('messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, views: true }),
    })
  } catch {
    result = null
  }
  if (result && result.status === 202) {
    setUnconfirmed(null)
    accepted = true
    if (seen.markUser(payload.requestId))
      addHistory(
        'あなた',
        payload.text + (payload.attachmentNames ?? []).map((x) => `\n📎 ${x}`).join(''),
        Date.now(),
        payload.requestId,
      )
    if (payload.attachments) {
      for (let i = chips.length - 1; i >= 0; i--)
        if (chips[i].id && payload.attachments.includes(must(chips[i].id))) chips.splice(i, 1)
      renderChips()
    }
    setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
    show(state)
    void poll(requestId)
    return
  }
  busy = false
  requestId = ''
  if (sendOutcomeUnknown(result ? result.status : null) || resending) {
    // 受理されたか不明。本文は控え（同じ受付番号）に残し、送信待ちには戻さない（戻すと二重に送り得る）。
    setUnconfirmed(payload)
    setError('送信できたか確認できませんでした。送信待ちの「確認して再開」から、前回の送信状況を確認できます。')
    show('failed')
    return
  }
  const wasQueued = pendingFromQueue
  setUnconfirmed(null) // 受理されなかったことが確定したので控えを消す
  if (from !== 'pending') giveBack()
  else if (wasQueued) queue.putBack({ id: -Date.now(), text: payload.text, addedAt: Date.now() })
  else if (!message.value.trim()) message.value = payload.text
  else queue.putBack({ id: -Date.now(), text: payload.text, addedAt: Date.now() })
  fail(must(result).status, must(result).data)
}
async function decide(choice: 'once' | 'deny') {
  if (!requestId || !approvalId) return
  const allow = el<HTMLButtonElement>('allow'),
    deny = el<HTMLButtonElement>('deny')
  allow.disabled = deny.disabled = true
  try {
    const result = await call('approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, approvalId, choice }),
    })
    if (result.status !== 200 && result.status !== 202) {
      const text =
        result.data?.error === 'approval_expired'
          ? '確認の期限が切れました。'
          : result.status === 409
            ? 'この確認はすでに処理済みか、受け付けられませんでした。'
            : problem(result.status, result.data)
      el('approval-error').textContent = text
      addHistory('お知らせ', text)
    } else {
      addHistory('お知らせ', choice === 'once' ? '一度だけ許可しました。' : '拒否しました。')
      approvalId = ''
      show('thinking')
      message.focus()
    }
  } catch {
    el('approval-error').textContent =
      '許可・拒否の結果を送信できたか確認できませんでした。通信状態を確認してください。'
  }
  allow.disabled = deny.disabled = false
}
el('allow').addEventListener('click', () => void decide('once'))
el('deny').addEventListener('click', () => void decide('deny'))
// 確認カードが出ている間はフォーカスをカードの中に留める。
approvalBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return
  const items = [el<HTMLButtonElement>('allow'), el<HTMLButtonElement>('deny')].filter((b) => !b.disabled)
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLButtonElement),
    next = items[(i + (e.shiftKey ? items.length - 1 : 1) + items.length) % items.length]
  e.preventDefault()
  next.focus()
})
document.addEventListener('focusin', (e) => {
  if (!approvalBox.hidden && !approvalBox.contains(e.target as Node) && e.target !== stop)
    el<HTMLButtonElement>('deny').focus()
})
setInterval(() => {
  tickActivity()
  if (!approvalBox.hidden && approvalExpires) {
    const s = Math.max(0, Math.round((approvalExpires - Date.now()) / 1000))
    el('approval-expiry').textContent = s
      ? `あと ${s} 秒で期限切れになります（${new Date(approvalExpires).toLocaleTimeString('ja-JP')}）`
      : '期限が切れました。'
  }
}, 1000)
stop.addEventListener('click', async () => {
  if (!requestId || !accepted) return
  if (actingEnabled) interruptActing()
  stop.disabled = true
  stateLabel.textContent = '停止しています'
  try {
    const result = await call(`requests/${requestId}/cancel`, { method: 'POST' })
    if (result.status !== 202) setError(problem(result.status, result.data))
    else if (result.data?.status === 'cancel-unknown') setError('停止の結果を確認中です。')
  } catch {
    setError('停止の結果を確認できません。')
  }
  stop.disabled = false
})

// ---- 音声入力 ----
const recordCancel = el<HTMLButtonElement>('record-cancel'),
  recordStatus = el('record-status'),
  dictationNote = el('dictation-note')
const syncDictationNote = () => {
  dictationNote.hidden = !stt || (dictation.state === 'idle' && !recordStatus.textContent)
}
const supported = supportsDictation({
  secure: window.isSecureContext,
  getUserMedia: navigator.mediaDevices?.getUserMedia,
  audioContext: window.AudioContext,
})
record.dataset.unsupported = String(!supported)
if (!supported) recordStatus.textContent = 'このブラウザでは音声入力を使えません。'
const dictation = createDictation({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createContext: () => new AudioContext(),
  transcribe: (pcm) =>
    call('transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Kohako-Transcription-Id': crypto.randomUUID() },
      body: new Blob([new Uint8Array(pcm)]),
    }),
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  onState: (phase, seconds) => {
    starting = phase === 'starting'
    recording = phase === 'recording' || phase === 'transcribing'
    record.dataset.transcribing = String(phase === 'transcribing')
    record.textContent = phase === 'recording' ? '■ 録音終了' : phase === 'transcribing' ? '…' : '🎤'
    record.setAttribute(
      'aria-label',
      phase === 'recording'
        ? '録音を終えて文字にする'
        : phase === 'transcribing'
          ? '文字にしています'
          : '音声入力を始める',
    )
    el('form').classList.toggle('dictating', phase === 'recording' || phase === 'transcribing')
    record.setAttribute('aria-pressed', String(phase === 'recording'))
    recordCancel.hidden = phase === 'idle'
    if (phase === 'recording')
      recordStatus.textContent = `${recordStatus.dataset.hushed === 'true' ? '（読み上げを停止中・自動では再開しません） ' : ''}● 録音中 0:${String(seconds).padStart(2, '0')} / 0:30`
    else if (phase !== 'idle') recordStatus.textContent = '文字にしています…'
    else if (/^(● 録音中|録音のため|文字にしています)/.test(recordStatus.textContent ?? ''))
      recordStatus.textContent = '録音を中止しました（音声は破棄しました）。'
    show(
      phase === 'idle'
        ? state === 'listening'
          ? 'idle'
          : state
        : state === 'idle' || state === 'done' || state === 'stopped' || state === 'failed'
          ? 'listening'
          : state,
    )
    syncDictationNote()
  },
  onError: (text) => {
    setError(text)
    recordStatus.textContent = text
    syncDictationNote()
  },
  onAuth: (status, data) => fail(status, data),
  onText: (text) => {
    const result = appendDictation(message.value, text, message.maxLength)
    message.value = result.value
    message.focus()
    message.setSelectionRange(message.value.length, message.value.length)
    message.dispatchEvent(new Event('input', { bubbles: true }))
    const done = '文字起こしが完了しました。内容を確認してから送信してください。'
    recordStatus.textContent = done
    window.setTimeout(() => {
      if (recordStatus.textContent === done) {
        recordStatus.textContent = ''
        syncDictationNote()
      }
    }, 10000)
    if (result.truncated) setError('入力欄の上限（500文字）を超えたため、末尾を省略しました。')
    syncDictationNote()
  },
})
cancelDictation = () => {
  void dictation.cancel()
}
syncDictationNoteHook = syncDictationNote
record.addEventListener('click', () => {
  if (dictation.state === 'recording') {
    void dictation.stop()
    return
  }
  if (dictation.state !== 'idle' || !enabled || !stt || busy || netDown || !supported) return
  const wasSpeaking = state === 'speaking'
  recordStatus.dataset.hushed = String(wasSpeaking)
  hushNow()
  error.textContent = ''
  recordStatus.textContent = wasSpeaking ? '録音のため読み上げを止めました（自動では再開しません）' : ''
  void dictation.start()
})
recordCancel.addEventListener('click', () => {
  recordStatus.textContent = '録音を取り消しました（音声は破棄しました）。'
  void dictation.cancel().then(syncDictationNote)
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void dictation.cancel()
})
window.addEventListener('pagehide', () => {
  void dictation.cancel()
})

// ---- ふれあい ----
const limiter = new TouchLimiter(),
  touchBatcher = new TouchBatcher()
let touchActive = false,
  touchDebounce = 0
// 会話中（考え中・読み上げ中・聞き取り中・録音中/録音開始中）や承認待ち・失敗・未接続では接触 event を Hermes へ送らない
const CONVERSING: State[] = ['thinking', 'speaking', 'listening', 'approval', 'failed', 'offline']
function touchSendable(): boolean {
  return (
    prefs.lines &&
    enabled &&
    !busy &&
    !unconfirmed &&
    !queue.size &&
    !netDown &&
    !recording &&
    !starting &&
    !CONVERSING.includes(state)
  )
}
async function sendTouch() {
  const batch = touchBatcher.take(Date.now(), touchSendable())
  if (!batch) return
  touchActive = true
  show(state)
  const id = crypto.randomUUID(),
    expiresAt = Date.now() + 60000
  try {
    const sent = await call('messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ requestId: id, kind: 'touch', touch: batch, expiresAt }),
    })
    if (sent.status !== 202) throw new Error('send failed')
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const result = await call(`requests/${id}`, { signal: AbortSignal.timeout(10000) })
      if (result.status !== 200 || !result.data) throw new Error('poll failed')
      const next = interpretRequest(result.data)
      if (next.state === 'done' && next.text) {
        if (touchSendable()) {
          const before = bubbleText,
            wasTouch = bubble.classList.contains('touch')
          setBubble(next.text, true)
          clearTimeout(touchLineTimer)
          touchLineTimer = window.setTimeout(() => {
            if (bubble.classList.contains('touch')) setBubble(wasTouch ? '' : before)
          }, 4500)
        }
        return
      }
      if (result.data.status !== 'pending') throw new Error('request failed')
    }
    throw new Error('timeout')
  } catch {
    el('touch-live').textContent = '返事を受け取れませんでした。'
    try {
      await call(`requests/${id}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) })
    } catch {
      /* 結果不明 */
    }
  } finally {
    touchActive = false
    touchBatcher.finish()
    show(state)
  }
}
let headIdx: number[] = [],
  handIdx: number[] = [],
  areas: { head: Rect | null; hands: Rect[] } = { head: null, hands: [] },
  reactionTimer = 0
const BIG = ['joy', 'greet', 'guide', 'shyHand', 'halt']
function computeAreas() {
  if (!rig) return
  const r = rig as Player & {
    meshVertices(m: number): Float32Array
    layout(): { scale: number; left: number; top: number }
  }
  const layout = r.layout()
  const head = headIdx.length
    ? headIdx.reduce<[number, number, number, number] | undefined>((b, i) => bboxOf(r.meshVertices(i), b), undefined)
    : undefined
  areas.head = head && Number.isFinite(head[0]) ? toScreenRect(head, layout, 6) : null
  const bigNow =
    BIG.includes(String((acting?.snapshot as { gesture?: string } | undefined)?.gesture ?? 'none')) ||
    BIG.includes(touchGesture) ||
    BIG.includes(String(idleGesture))
  areas.hands = bigNow ? [] : handIdx.map((i) => toScreenRect(bboxOf(r.meshVertices(i)), layout, 10))
}
let touchGesture = 'none',
  reacting = false,
  // BOXP-605: 待機のしぐさが再生中の身振り（腕の絵を差し替えている間は、手のふれあい範囲を出さない）。
  idleGesture: string | null = null
function touchBlocked(): string | null {
  if (!prefs.touch) return 'ふれあいは設定で OFF です。'
  if (state === 'approval') return '確認待ちの間はふれあいを停止しています。'
  if (state === 'failed' || state === 'offline' || netDown) return 'いまはふれあいできません。'
  if (recording) return '録音中はふれあいを停止しています。'
  return null
}
function touchReact(zone: Zone, kind: 'tap' | 'pat', via: 'pointer' | 'menu') {
  const blocked = touchBlocked()
  if (blocked) {
    if (via === 'menu') el('touch-live').textContent = blocked
    return
  }
  const now = Date.now(),
    quietOnly = state === 'thinking' || state === 'speaking' || state === 'listening'
  const { reaction } = limiter.react(kind, zone, now, { lines: false, quietOnly })
  const act = acts[reaction],
    gesture = prefs.intensity === 'subtle' || reduced() ? act.subtleGesture : act.gesture
  ;(report.touches as unknown[]).push({ at: now, zone, kind, via, reaction, gesture, state })
  if ((report.touches as unknown[]).length > 50) (report.touches as unknown[]).shift()
  if (stage) {
    if (quietOnly) {
      if (!BIG.includes(String(acting?.snapshot.gesture))) stage.playGesture('nod')
    } else {
      clearTimeout(reactionTimer)
      reacting = true
      stage.setEmotion(act.emotion)
      if (gesture !== 'none') stage.playGesture(gesture)
      touchGesture = gesture
      reactionTimer = window.setTimeout(
        () => {
          touchGesture = 'none'
          reacting = false
          if (state !== 'speaking' && state !== 'approval' && state !== 'failed') {
            stage?.reset()
            if (rig) actingEnabled ? actingPose(rig, rigStateOf[state]) : applyPose(rig, rigModel, rigStateOf[state])
          }
        },
        gesture === 'none' || gesture === 'nod' ? 2200 : 3200,
      )
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
let track: { id: number; zone: Zone; points: Point[]; headRect: Rect | null; outside?: boolean } | null = null
let petOffset = zeroPet(),
  petTick = 0
let holdClipForPet: (on: boolean) => void = () => {}
rigCanvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || track) return
  if (character.classList.contains('mini')) return
  computeAreas()
  const rect = rigCanvas.getBoundingClientRect(),
    x = e.clientX - rect.left,
    y = e.clientY - rect.top
  // BOXP-577: 指のときは頭の判定を少し広げる（手の判定を優先し、広げた分は手に重ならない所だけ頭にする）。閉眼の判定も同じ矩形で行う。
  const finger = e.pointerType === 'touch',
    headRect = areas.head && finger ? fingerRect(areas.head) : areas.head
  const zone: Zone | null =
    areas.head && inside(areas.head, x, y)
      ? 'head'
      : areas.hands.some((h) => inside(h, x, y))
        ? 'hand'
        : headRect && inside(headRect, x, y)
          ? 'head'
          : null
  if (!zone) return
  track = { id: e.pointerId, zone, headRect, points: [{ x, y, time: performance.now() }] }
})
rigCanvas.addEventListener('pointermove', (e) => {
  if (!track || e.pointerId !== track.id) return
  const rect = rigCanvas.getBoundingClientRect()
  track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() })
  if (track.zone === 'head' && track.points.length > 3) e.preventDefault()
})
rigCanvas.addEventListener('pointerup', (e) => {
  if (!track || e.pointerId !== track.id) return
  const rect = rigCanvas.getBoundingClientRect()
  track.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() })
  const kind = classifyTouch(track.points, track.zone),
    zone = track.zone
  track = null
  if (kind) touchReact(zone, kind, 'pointer')
})
rigCanvas.addEventListener('pointercancel', () => {
  track = null
})
// BOXP-525: 押したままキャンバスの外へ出た（PC マウスは外の move が届かない）間は、なでの閉眼を解く。戻れば再開する。
rigCanvas.addEventListener('pointerleave', (e) => {
  if (track && e.pointerId === track.id) track.outside = true
})
rigCanvas.addEventListener('pointerenter', (e) => {
  if (track && e.pointerId === track.id) track.outside = false
})
rigCanvas.addEventListener('lostpointercapture', () => {
  track = null
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) track = null
})
// キャンバスの外で離したときも追跡を解放する（以後のふれあいが止まらないように）。
for (const ev of ['pointerup', 'pointercancel'] as const)
  window.addEventListener(ev, (e) => {
    if (track && e.pointerId === track.id && e.target !== rigCanvas) track = null
  })
// 二本指・ピンチはふれあいにしない。
rigCanvas.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) track = null
  },
  { passive: true },
)
// BOXP-525: 頭は前後（画面の縦）になでることが多いが、キャンバスは縦スクロール（pan-y）を許すため、縦になでると約 0.3 秒でブラウザが
// スクロールに切り替えて pointercancel になり、なでが途中で切れて頭が跳ね戻っていた（Pixel 7 で実測）。頭の上で始めた 1 本指の操作だけスクロールさせない。
rigCanvas.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 1 && track?.zone === 'head' && e.cancelable && !touchBlocked()) e.preventDefault()
  },
  { passive: false },
)
character.addEventListener('click', () => {
  if (character.classList.contains('mini')) {
    message.blur()
    renderCards([])
    refreshScene(true)
  }
})
const touchOpen = el<HTMLButtonElement>('touch-open'),
  touchMenu = el('touch-menu')
touchOpen.addEventListener('click', () => {
  touchMenu.hidden = !touchMenu.hidden
  touchOpen.setAttribute('aria-expanded', String(!touchMenu.hidden))
  if (!touchMenu.hidden) el<HTMLButtonElement>('touch-pat').focus()
})
el('touch-pat').addEventListener('click', () => touchReact('head', 'pat', 'menu'))
el('touch-hand').addEventListener('click', () => touchReact('hand', 'tap', 'menu'))

// ---- 引き出し・Esc ----
const drawers: [string, string][] = [
  ['history', 'history-open'],
  ['settings', 'settings-open'],
]
for (const [id, opener] of drawers) {
  el(opener).addEventListener('click', () => {
    for (const [other] of drawers) if (other !== id) el(other).hidden = true
    el(id).hidden = !el(id).hidden
    if (!el(id).hidden) {
      if (id === 'history') {
        const list = el('history')
        list.scrollTop = list.scrollHeight
      }
      el<HTMLButtonElement>(`${id}-close`).focus()
    }
  })
  el(`${id}-close`).addEventListener('click', () => {
    el(id).hidden = true
    el(opener).focus()
  })
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const [id] of drawers) el(id).hidden = true
    touchMenu.hidden = true
    touchOpen.setAttribute('aria-expanded', 'false')
  }
})

// BOXP-516: Studio と同じくカーソルの方向へ視線（目と頭の向き）を向ける。マウス／ペンは hover を追う。
// BOXP-577: スマホ・タブレットでは触れた位置へ向ける（触れている間は指を追い、離すと少し残して中立へ、スクロール等で取り消されたら即中立）。
// 受け身（passive）で座標を控えるだけで、スクロール・UI 操作は止めない。描画への反映は既存の描画ループで行う（通信はしない）。
let lookPointer: Look | null = null,
  lookCurrent: Look = { x: 0, y: 0 },
  lookWeight = 0,
  lookApplied = false,
  lookFace: Look | null = null,
  lookFaceAt = 0
const touchLook = new TouchLook(),
  listen = { passive: true, capture: true } as const
// ペンは画面に触れていない hover（buttons === 0）のときだけ追う。接触中（描く・スクロール・操作）は追従を止めて中立へ戻す。
window.addEventListener(
  'pointermove',
  (e) => {
    pointerMovedAt = performance.now()
    if (e.pointerType === 'mouse' || (e.pointerType === 'pen' && e.buttons === 0)) {
      lookPointer = { x: e.clientX, y: e.clientY }
      touchLook.clear()
    } else if (e.pointerType === 'pen') lookPointer = null
    else if (e.pointerType === 'touch') touchLook.move(e.pointerId, { x: e.clientX, y: e.clientY })
  },
  listen,
)
window.addEventListener(
  'pointerdown',
  (e) => {
    pointerMovedAt = performance.now()
    if (e.pointerType === 'pen') lookPointer = null
    else if (e.pointerType === 'touch') {
      // マウス併用端末では以前のマウス位置が残っていると、取り消し・離した後の待機終了時に中立でなくそこへ戻ってしまうため捨てる。
      lookPointer = null
      if (e.isPrimary) touchLook.down(e.pointerId, { x: e.clientX, y: e.clientY })
    }
  },
  listen,
)
window.addEventListener(
  'pointerup',
  (e) => {
    if (e.pointerType === 'touch') touchLook.up(e.pointerId, { x: e.clientX, y: e.clientY }, performance.now())
  },
  listen,
)
window.addEventListener(
  'pointercancel',
  (e) => {
    if (e.pointerType === 'touch') touchLook.cancel(e.pointerId)
  },
  listen,
)
// 窓の外へ出た（relatedTarget なし）・窓が非アクティブ・非表示になったら中立へ戻す。
document.addEventListener(
  'mouseout',
  (e) => {
    if (!e.relatedTarget) lookPointer = null
  },
  { passive: true },
)
window.addEventListener('blur', () => {
  lookPointer = null
  touchLook.clear()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lookPointer = null
    touchLook.clear()
    // BOXP-605: 非表示の間は描画が止まる。戻った時に途中のしぐさや過ぎた予定を出さず、間を数え直す。
    idleDirector.reset()
  }
})
window.addEventListener('resize', () => {
  lookFaceAt = 0
})

// ---- リグの読込と描画ループ ----
let petEyesLatched = false
// BOXP-605: 待機中のしぐさ。待機が続き、会話・ふれあい・演出・操作が無い間だけ、不規則な間をあけて小さなしぐさを挟む（決め方は idle.ts）。
const idleDirector = new IdleDirector()
let pointerMovedAt = -Infinity,
  idleEmotion = false
/** 待機のしぐさが始めた身振りの印。会話・ふれあいの身振りはこの印を持たないので、止める時に巻き込まない。 */
const IDLE_GESTURE_TAG = 'idle'
/** Owner が手を動かした直後は、しぐさを始めずカーソルや操作へ注意を向けたままにする（ms）。 */
const IDLE_POINTER_QUIET_MS = 4000
function idleCalm(now: number, petBusy: boolean): boolean {
  return (
    prefs.idleActs &&
    !reduced() &&
    !document.hidden &&
    enabled &&
    !busy &&
    !netDown &&
    rigStateOf[state] === 'idle' &&
    character.dataset.arrival === 'home' &&
    !character.classList.contains('mini') &&
    !track &&
    !petBusy &&
    !reacting &&
    !touchActive &&
    touchGesture === 'none' &&
    (!acting?.snapshot.gesture || acting.snapshot.gesture === 'none') &&
    !recording &&
    !holding() &&
    !touchLook.at(now) &&
    now - pointerMovedAt > IDLE_POINTER_QUIET_MS
  )
}
function rigTick(now: number) {
  if (!rig) return
  const dt = petTick ? Math.min(0.1, (now - petTick) / 1000) : 0
  petTick = now
  const petTrack =
      track?.zone === 'head' && track.headRect ? { points: track.points, rect: track.headRect, now } : null,
    petOptions = { enabled: !touchBlocked(), reduced: reduced(), subtle: prefs.intensity === 'subtle' }
  const petEyes = !track?.outside && petEyesWanted(petTrack, petOptions, petEyesLatched)
  petEyesLatched = petEyes
  report.petEyes = petEyes
  petOffset = petFollow(petOffset, petTrack, dt, petOptions)
  const petHold = isPetting(petTrack, petOptions) || petShown(petOffset)
  // BOXP-605: 待機中のしぐさ。stage が無い（リグ非対応）・出せない状況では何もせず、出ている途中なら短く戻す。
  const player = rig,
    idle = idleDirector.step(now / 1000, {
      calm: !!stage?.setIdlePose && idleCalm(now, petHold),
      settled: () => {
        const head = player.parameterValues()
        return settledHead(
          head[player.parameters.indexOf('ParamAngleX')] ?? 0,
          head[player.parameters.indexOf('ParamAngleZ')] ?? 0,
        )
      },
      daypart: (body.dataset.daypart as Daypart | undefined) ?? 'day',
      subtle: prefs.intensity === 'subtle',
    })
  stage?.setIdlePose?.(idle.pose)
  stage?.setIdleArms?.(idle.arms)
  // 身振りを借りるしぐさ: 始まりに 1 回だけ再生し、中断されたら（まだ続いていれば）腕を待機へ戻す。
  if (idle.gesture !== idleGesture) {
    if (idle.gesture) stage?.playGesture(idle.gesture, IDLE_GESTURE_TAG)
    else stage?.cancelGesture?.(IDLE_GESTURE_TAG)
    idleGesture = idle.gesture
  }
  if (idle.emotion && !idleEmotion) {
    stage?.setEmotion(idle.emotion)
    idleEmotion = true
  } else if (!idle.emotion && idleEmotion) {
    idleEmotion = false
    // 会話やふれあいが表情を決めた後なら触らない（待機のまま終わった時だけ元の表情へ戻す）。
    if (rigStateOf[state] === 'idle' && !reacting && touchGesture === 'none') stage?.setEmotion('neutral')
  }
  stage?.setPetEyes?.(petEyes || idle.eyes)
  report.idle = {
    act: idle.act,
    hold: idle.hold,
    eyes: idle.eyes,
    emotion: idle.emotion,
    gesture: idle.gesture,
    arms: idle.arms,
  }
  if (stage?.setPetOffset) {
    const hold = petHold || idle.hold
    stage.setPetOffset(petOffset)
    stage.setPetHold?.(hold, !petHold)
    holdClipForPet(hold)
  }
  report.petFollow = { ...petOffset }
  // BOXP-521: 胸の揺れは設定 OFF と「動きを減らす」（アプリ設定・OS）で止める。
  stage?.setChestMotion?.(prefs.chestSway && !reduced())
  if (!document.hidden) {
    // なで中・離して戻る途中・ふれあいや演技の身振り中は、505 のなで追従や身振りの頭の角度と二重にならないよう追従を退かせる。
    const blocked =
      !!track ||
      isPetting(petTrack, petOptions) ||
      petShown(petOffset) ||
      touchGesture !== 'none' ||
      (!!acting?.snapshot.gesture && acting.snapshot.gesture !== 'none') ||
      idle.gaze
    const pointer = touchLook.at(performance.now()) ?? lookPointer,
      enabled = prefs.follow && !reduced(),
      active = !!pointer && enabled && !blocked
    // 顔の中心は頭のメッシュから求める。視線で頭が動くと中心も動いて揺れ返すので、毎フレームではなく 0.5 秒ごと（リサイズ時は即時）に取り直す。
    if (active && (!lookFace || now - lookFaceAt > 500)) {
      computeAreas()
      const rect = rigCanvas.getBoundingClientRect(),
        head = areas.head
      lookFace = head
        ? { x: rect.left + head.x + head.w / 2, y: rect.top + head.y + head.h * 0.45 }
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.2 }
      lookFaceAt = now
    }
    const target = lookTarget(
      pointer,
      lookFace ?? { x: innerWidth / 2, y: innerHeight / 3 },
      { left: 0, top: 0, width: innerWidth, height: innerHeight },
      enabled,
      blocked,
      prefs.intensity === 'subtle',
    )
    const poseLook = poseFor(
      rigStateOf[state],
      rig.expressions,
      rig.clips.map((id) => clipName(rigModel, id)),
    ).look
    lookCurrent = smoothLook(lookCurrent, target, dt)
    lookWeight += ((active ? followWeightFor(poseLook) : 0) - lookWeight) * (1 - Math.exp(-dt / 0.3))
    // 効いている間だけ毎フレーム lookAt する。戻り切ったら一度だけ状態の視線を置き直し、以後は既存の演技（actingPose / applyPose）に任せる。
    if (active || lookWeight > 0.002) {
      rig.lookAt(...blendLook(lookFor(rigModel, ...poseLook), lookCurrent, lookWeight))
      lookApplied = true
    } else if (lookApplied) {
      lookWeight = 0
      lookCurrent = { x: 0, y: 0 }
      rig.lookAt(...lookFor(rigModel, ...poseLook))
      lookApplied = false
    }
    report.lookFollow = { target, current: { ...lookCurrent }, weight: lookWeight, active }
  }
  const v =
    visemes && state === 'speaking' && speakingSince
      ? visemeAt(visemes, visemeAnchor + (now - speakingSince) / 1000, visemeLive)
      : { vowel: 'closed', open: 0, width: 1 }
  const mouth = mouthLevel(rigModel, v.open)
  stage?.setViseme?.(state !== 'speaking' ? null : { open: v.open, width: reduced() ? 1 : v.width })
  rig.lipSync(mouth)
  report.mouth = mouth
  report.viseme = v.vowel
  requestAnimationFrame(rigTick)
}
async function startRig() {
  if (!wantsRig(location.search)) {
    el('face-mode').textContent = '静止表情（?face=static）'
    return
  }
  refreshArrival()
  try {
    const loaded = await loadRig(rigCanvas, rigModel, './kohako/live2d/sample/')
    rig = loaded.player
    rig.start()
    // 待機クリップは頭の角度（ParamAngleX/Y/Z）を毎フレーム上書きし、setParameter で足した追従は描画に出ない（BOXP-505 TD-01 で実測）。
    // なでている間（と離して戻り切るまで）だけクリップを止め、戻ったら最後に指定されたクリップを再開する。
    const clips = clipHold(rig.play.bind(rig))
    rig.play = (id) => clips.play(id)
    holdClipForPet = (on) => {
      clips.hold(on)
      report.petHeld = clips.held
    }
    const ids = (rig as Player & { meshIds?: string[] }).meshIds ?? []
    headIdx = HEAD_MESHES.map((n) => ids.indexOf(n)).filter((i) => i >= 0)
    handIdx = HAND_MESHES.map((n) => ids.indexOf(n)).filter((i) => i >= 0)
    // stage は ?acting=0 でも作る（なで追従の ParamAngle と母音口形は stage の update フックで毎フレーム反映される）。
    stage = createActingStage(rig, rigModel)
    if (actingEnabled) acting = new ActingDirector(calmStage(stage))
    face.hidden = true
    rigCanvas.hidden = false
    rigLoading = false
    refreshArrival()
    el('face-mode').textContent = `表示モデル: ${rigModel.name}（独自描画・公式 Live2D ではありません）`
    Object.assign(report, {
      loaded: true,
      model: rigModel.id,
      totalMs: loaded.totalMs,
      headMeshes: headIdx.length,
      handMeshes: handIdx.length,
    })
    show(state)
    requestAnimationFrame(rigTick)
  } catch (e) {
    ;(report.errors as string[]).push(e instanceof Error ? e.message : String(e))
    el('face-mode').textContent =
      '動く姿を読み込めなかったため、静止画で表示しています（ふれあいは上部の「ふれあい」から行えます）。'
    rigLoading = false
    refreshArrival()
  }
}
// 自動計測用（同一ページの状態を読むだけ）。
Object.assign(window, {
  __kohakoHome: {
    report,
    get player() {
      return rig
    },
    get stage() {
      return stage
    },
    get state() {
      return state
    },
    get scene() {
      return sceneNow()
    },
    // BOXP-626: 配置替えを写しで移した回数・進行中の写し。
    get morph() {
      return { count: morph.count, active: morph.active }
    },
    hitAreas: () => {
      computeAreas()
      const r = rigCanvas.getBoundingClientRect(),
        abs = (a: Rect | null) => a && { x: a.x + r.left, y: a.y + r.top, w: a.w, h: a.h }
      return { head: abs(areas.head), hands: areas.hands.map(abs) }
    },
    get prefs() {
      return prefs
    },
    history,
    addHistory,
    setBubble,
    // 検証用: 次の機会に指定のしぐさを出す（出してよい条件は通常どおり判定する）。
    idleActs: idleActNames,
    playIdle: (act: IdleAct) => idleDirector.force(act),
    syncNow: () => syncTranscript(),
    debug: () => ({
      pointerDown,
      typingIn: typingUntil - Date.now(),
      scrollingIn: scrollingUntil - Date.now(),
      director: { ...director },
      target: targetScene({
        state,
        thinkingMs: state === 'thinking' ? Date.now() - thinkingSince : 0,
        cardsOpen: cardsOpen || !viewer.hidden,
        idleMs: Date.now() - lastActivity,
        hasReply: !!lastReply,
        netDown,
      }),
    }),
  },
})
setBubble('おかえりなさい、ご主人さま。')
show('offline')
void initialize()
void startRig()

/** POST 応答前に再読み込みされた送信を照会し、BFF が受理済みなら再送せずに追跡する。未受理・不明なら控えを残し、次の送信で同じ受付番号を使う。 */
async function resumeUnconfirmed(pending: Outgoing) {
  busy = true
  accepted = false
  show(state)
  let lookup: Awaited<ReturnType<typeof call>> | null = null
  try {
    lookup = await call(`requests/${pending.requestId}`)
  } catch {
    lookup = null
  }
  if (lookup && lookup.status === 200 && unconfirmed === pending) {
    setUnconfirmed(null)
    requestId = pending.requestId
    accepted = true
    started = Date.now()
    setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
    if (seen.markUser(pending.requestId))
      addHistory(
        'あなた',
        pending.text + (pending.attachmentNames ?? []).map((x) => `\n📎 ${x}`).join(''),
        Date.now(),
        pending.requestId,
      )
    if (pending.attachments) {
      for (let i = chips.length - 1; i >= 0; i--)
        if (chips[i].id && pending.attachments.includes(must(chips[i].id))) chips.splice(i, 1)
      renderChips()
    }
    addHistory('お知らせ', '再読み込み前の送信は受理済みでした。再送せずに結果を追います。')
    show('thinking')
    void poll(requestId)
    return
  }
  busy = false
  // 401/403 は認証切れ。控えを残したまま未認証表示にして送信を止め、再ログイン後の再接続で受理状況を確認し直す。
  if (lookup && (lookup.status === 401 || lookup.status === 403) && unconfirmed === pending) {
    fail(lookup.status, lookup.data)
    return
  }
  if (unconfirmed === pending) {
    addHistory(
      'お知らせ',
      '再読み込み前に送信できたか確認できませんでした。送信待ちの「確認して再開」から、同じ受付番号で前回の送信状況を確認できます。',
    )
  }
  show(state)
}

/** 通知への返信（BFF が同じ Web 会話へ受付番号付きで送ったもの）を通常の依頼と同じく追い、応答・承認・停止を家の会話画面に出す。 */
function followRequest(id: string, text: string): boolean {
  if (requestId === id) return true
  if (busy || unconfirmed || !enabled) return false
  clearSpeechResume()
  voicePlayer.cancel()
  speaker?.cancel()
  if (actingEnabled) interruptActing()
  voiceTrouble = false
  error.textContent = ''
  busy = true
  accepted = true
  started = Date.now()
  lastActivity = Date.now()
  delete reply.dataset.reply
  requestId = id
  if (text && seen.markUser(id)) addHistory('あなた', text, Date.now(), id)
  setBubble('…')
  setInflight({ requestId, expiresAt: Date.now() + 11 * 60_000, accepted: true })
  show('thinking')
  void poll(requestId)
  return true
}
const inbox = initInbox(followRequest, {
  canAnnounce: () =>
    enabled &&
    !busy &&
    !unconfirmed &&
    !queue.size &&
    !netDown &&
    !recording &&
    !starting &&
    !touchActive &&
    !CONVERSING.includes(state),
  announce: (item, actions, more) => {
    const body = item.body.length > 300 ? `${item.body.slice(0, 300)}…（続きは受信箱でご覧いただけます）` : item.body
    const text = `ご主人さま、お知らせが届いています。\n${item.title}\n${body}${more ? `\nほかにも ${more} 件、受信箱に届いています。` : ''}`
    setBubble(text)
    addHistory('お知らせ', text)
    const box = el('notice-actions'),
      status = el('notice-status')
    box.replaceChildren()
    status.textContent = ''
    box.hidden = false
    updateMessage()
    const button = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', fn)
      box.append(b)
    }
    const sendNotice = async (kind: 'choice' | 'text', value: string) => {
      if (await actions.send(kind, value)) {
        box.hidden = true
        status.textContent = ''
        updateMessage()
      }
    }
    // BOXP-646: 受信箱（BOXP-568）と同じく、選択肢ボタンと自由文の返信を並べて出す。
    for (const choice of noticeChoices(item)) button(choice.text, () => void sendNotice('choice', choice.value))
    const input = document.createElement('textarea')
    input.maxLength = 500
    input.placeholder = '返信を入力'
    box.append(input)
    button('返信する', () => {
      if (input.value.trim()) void sendNotice('text', input.value)
    })
    button('受信箱で開く', () => {
      box.hidden = true
      updateMessage()
      actions.open()
    })
    button('あとで見る', () => {
      box.hidden = true
      updateMessage()
      actions.later()
    })
  },
})
window.setInterval(() => inbox.retry(), 2000)

/**
 * BFF が持つ会話履歴（直近 24 時間）と進行中の依頼を取り込み、他の端末で送った発言・返答をこの端末の履歴へ足す。
 * 進行中の依頼が他端末のものなら受付番号で追い、実行状態・承認・停止を既存の照会で扱う。この端末からは何も送信しない
 * （草稿・送信待ち・承認の選択は端末ごとのまま）。古い BFF（404）や一時的な失敗では何もしない。
 */
async function syncTranscript() {
  if (!enabled || syncing || document.visibilityState !== 'visible') return
  syncing = true
  try {
    const result = await call(
      `conversation/transcript${transcriptRev ? `?rev=${encodeURIComponent(transcriptRev)}` : ''}`,
    )
    if (result.status !== 200) return
    const data = validateTranscript(result.data)
    if (!data) return
    if ('unchanged' in data) return
    const initial = firstSync
    firstSync = false
    pruneHistory(shared.update(data.items))
    const ops = planSync(data.items, data.active, {
      seen,
      trackingId: requestId,
      canFollow: !busy && !unconfirmed && !touchActive && enabled && !parseResume(tab.get(INFLIGHT_KEY), Date.now()),
    })
    for (const op of ops) {
      if (op.op === 'user') addHistory('あなた', op.text, op.at, op.id)
      else if (op.op === 'reply') {
        addHistory('コハコ', op.text, op.at, op.id)
        if (op.latest && !initial && !busy && state !== 'speaking' && state !== 'approval') {
          setBubble(op.text)
          showReplyChoices(op.text, op.id)
          reply.dataset.reply = '1'
          lastReply = op.text
          renderCards(cardsFromText(op.text), op.views)
        }
      } else if (op.op === 'ended')
        addHistory(
          'お知らせ',
          op.stopped ? 'この依頼は停止されました。' : 'この依頼の結果を確認できませんでした。',
          op.at,
          op.id,
        )
      else if (op.op === 'divider')
        addHistory(
          'お知らせ',
          'ここから新しい会話です（これより前は以前の履歴で、文脈には引き継がれません）。',
          op.at,
          op.id,
        )
      else if (op.op === 'stale')
        addHistory(
          'お知らせ',
          'ここまでは以前の会話です（時間が空いたため、次のメッセージから新しい会話になります）。',
          Date.now(),
          op.id,
        )
      else if (op.op === 'follow') {
        if (followRemote(op.id)) {
          if (op.kind === 'reply') addHistory('お知らせ', '別の端末から通知への返信が送られました。')
          addHistory('お知らせ', '別の端末から送られたやり取りの続きを表示しています。')
        }
      }
    }
    transcriptRev = nextRev(data.rev, data.active, requestId)
  } catch {
    /* 古い BFF や一時的な通信失敗では何もしない */
  } finally {
    syncing = false
  }
}
function followRemote(id: string) {
  remoteIds.add(id)
  const followed = followRequest(id, '')
  if (!followed) remoteIds.delete(id)
  return followed
}
window.setInterval(() => void syncTranscript(), 5000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void syncTranscript()
})
window.addEventListener('online', () => void syncTranscript())
/**
 * 共有履歴の保持期限（24 時間）や件数（最新 50 件）から外れた依頼を、開いたままのこの端末の画面からも消す。
 * 対象は BFF の履歴に載っていた依頼の発言・返答・お知らせだけ（この端末だけのお知らせは対象外）。
 */
function pruneHistory(gone: string[]) {
  if (!gone.length) return
  const ids = new Set(gone)
  const removed = history.filter((e) => e.rid && ids.has(e.rid))
  if (!removed.length) return
  for (let i = history.length - 1; i >= 0; i--) if (removed.includes(history[i])) history.splice(i, 1)
  for (const li of el('history-list').querySelectorAll<HTMLElement>('li[data-rid]'))
    if (ids.has(li.dataset.rid ?? '')) li.remove()
  // 吹き出しに残っている返答も、履歴から消えたものなら表示を終える。
  if (!busy && reply.dataset.reply === '1' && removed.some((e) => e.who === 'コハコ' && e.text === lastReply)) {
    delete reply.dataset.reply
    lastReply = ''
    renderCards([], [])
    setBubble('（前の返答は保存期間を過ぎたため、表示を終了しました）')
  } else renderChat()
}
