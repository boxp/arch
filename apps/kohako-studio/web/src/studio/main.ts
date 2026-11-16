import { must } from '../must'
import { makeVisemes, visemeAt, boundaryTime, spokenSeconds, type VisemeSequence } from '../live2d/viseme'
import './style.css'
import {
  interpretRequest,
  newOutgoing,
  pcm16,
  resolveUnconfirmed,
  sendOutcomeUnknown,
  type Outgoing,
  presentation,
  rigStateOf,
  silentSpeechSeconds,
  studioRigModelId,
  wantsRig,
  wantsActing,
  type State,
} from './model'
import {
  clipIdFor,
  clipName,
  lookFor,
  poseFor,
  modelFor,
  modelStatus,
  mouthLevel,
  type RigState,
} from '../live2d/model'
import { setupSelector } from '../live2d/selector'
import { applyPose, loadRig, type Player } from '../live2d/rig'
import { ActingDirector, cueForSentence, splitSentences } from '../live2d/acting'
import { createActingStage } from '../live2d/gesture'
import { createSentenceSpeaker, createSilentSentencer } from './acting-speech'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const face = el<HTMLImageElement>('face'),
  stateLabel = el('state'),
  message = el<HTMLTextAreaElement>('message'),
  send = el<HTMLButtonElement>('send'),
  record = el<HTMLButtonElement>('record'),
  stop = el<HTMLButtonElement>('stop'),
  speech = el<HTMLInputElement>('speech')
const error = el('error'),
  approvalBox = el('approval'),
  reply = el('reply')
let state: State = 'offline',
  enabled = false,
  stt = false,
  requestId = '',
  started = 0,
  approvalId = '',
  busy = false,
  accepted = false
let recording: {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  chunks: Float32Array[]
  size: number
  timer: number
} | null = null
let starting = false,
  held = false
// 送信したが受理されたか確認できなかったメッセージ。再送時は同じ requestId で送り重複実行を防ぐ。
let unconfirmed: Outgoing | null = null
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
speech.disabled = !synthesis
speech.addEventListener('change', () => {
  if (!speech.checked) {
    if (actingEnabled) interruptActing()
    else if (synthesis) window.speechSynthesis.cancel()
    if (state === 'speaking') show('done')
  }
})
el('speech-help').textContent = synthesis
  ? 'ブラウザ内蔵の音声で再生します（オフでも応答中はリグが口パクします）。'
  : 'このブラウザでは読み上げを利用できません（応答中はリグが口パクします）。'
// Web リグ（既定は最新の本人モデル。PSD2Live 独自 runtime）。読めなければ従来の静止表情に戻る。
const rigModel = modelFor(`?model=${studioRigModelId(location.search)}`),
  rigCanvas = el<HTMLCanvasElement>('rig')
const lost = setupSelector(el('prototype-selector'), false)
if (lost) {
  face.hidden = true
  el('face-mode').textContent = '消失した試作の比較画像を表示中'
}
let rig: Player | null = null,
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
let acting: ActingDirector | null = null,
  stage: ReturnType<typeof createActingStage> | null = null
const speaker =
  synthesis && actingEnabled
    ? createSentenceSpeaker({
        synth: {
          speak: (u) => window.speechSynthesis.speak(u as SpeechSynthesisUtterance),
          cancel: () => window.speechSynthesis.cancel(),
        },
        makeUtterance: (text) => {
          const u = new SpeechSynthesisUtterance(text)
          u.lang = 'ja-JP'
          return u
        },
      })
    : null
const sentencer = createSilentSentencer({
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
})
function interruptActing() {
  speaker?.cancel()
  sentencer.cancel()
  acting?.interrupt()
  if (acting) rigReport.acting = acting.snapshot
}
function actingPose(player: Player, state: RigState) {
  const ids = player.clips,
    pose = poseFor(
      state,
      player.expressions,
      ids.map((id) => clipName(rigModel, id)),
    )
  player.play(clipIdFor(rigModel, ids, pose.clip))
  player.lookAt(...lookFor(rigModel, ...pose.look))
  return pose
}
const rigReport: Record<string, unknown> = { loaded: false, errors: [] as string[] }
function show(next: State) {
  if (actingEnabled && (next === 'failed' || next === 'stopped') && state !== next) interruptActing()
  state = next
  stateLabel.textContent = presentation[next].label
  face.src = `./kohako/studio/c48v6-${presentation[next].face}-color.png`
  if (next !== 'speaking') {
    speakingSince = 0
    visemes = null
    stage?.setViseme?.(null)
    rig?.lipSync(0)
    clearTimeout(mouthTimer)
  }
  if (rig)
    rigReport.pose = {
      state: next,
      ...(actingEnabled ? actingPose(rig, rigStateOf[next]) : applyPose(rig, rigModel, rigStateOf[next])),
    }
  if (acting) {
    acting.setOperational(rigStateOf[next])
    rigReport.acting = acting.snapshot
  }
  send.disabled = !enabled || busy || !!recording || starting
  record.disabled = !enabled || !stt || busy
  stop.hidden = !busy || !requestId || !accepted
  approvalBox.hidden = next !== 'approval'
}
function log(text: string) {
  const item = document.createElement('li')
  item.textContent = text
  el('log').prepend(item)
}
function problem(status: number, data: Record<string, unknown> | null): string {
  if (status === 401 || status === 403) return 'Cloudflare Access でログインし直してください。'
  if (status === 429) return '処理が混み合っています。しばらく待ってからお試しください。'
  if (data?.error === 'conversation_disabled' || data?.error === 'stt_disabled') return 'この機能は現在無効です。'
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
function fail(status: number, data: Record<string, unknown> | null) {
  error.textContent = problem(status, data)
  if (status === 401 || status === 403) {
    enabled = false
    el('connection').textContent = '未認証'
    show('offline')
  } else show('failed')
}
async function initialize() {
  try {
    const me = await call('me')
    if (me.status !== 200) return fail(me.status, me.data)
    const conv = await call('conversation')
    if (conv.status !== 200 || !conv.data) return fail(conv.status, conv.data)
    enabled = conv.data.enabled === true
    stt = enabled && !!conv.data.stt
    el('connection').textContent = enabled ? '接続中' : '会話は無効です'
    el('features').textContent =
      `音声認識: ${stt ? '有効' : '無効'} ／ セッション開始: ${typeof conv.data.sessionStartedAt === 'number' ? new Date(conv.data.sessionStartedAt).toLocaleString('ja-JP') : '未開始'} ／ 共有コンテキスト: ${String(conv.data.sharedContext ?? 'なし')}`
    el('record-help').textContent = stt
      ? '押している間だけ録音します（0.5〜30秒）。'
      : '音声認識が無効のため録音できません。'
    show(enabled ? 'idle' : 'offline')
  } catch {
    error.textContent = '接続できませんでした。'
    show('offline')
  }
}
async function poll(id: string) {
  const deadline = Date.now() + 11 * 60_000
  while (requestId === id && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1800))
    let result: Awaited<ReturnType<typeof call>>
    try {
      result = await call(`requests/${id}`)
    } catch {
      continue
    }
    if (result.status !== 200 || !result.data) {
      busy = false
      requestId = ''
      fail(result.status, result.data)
      return
    }
    const next = interpretRequest(result.data)
    if (next.state === 'approval' && next.approval) {
      approvalId = next.approval.approvalId
      el('approval-summary').textContent = next.approval.summary
      el('approval-expiry').textContent = `期限: ${new Date(next.approval.expiresAt).toLocaleString('ja-JP')}`
      show('approval')
    } else if (next.state === 'thinking') show('thinking')
    else {
      busy = false
      requestId = ''
      show(next.state)
      if (next.state === 'done') {
        reply.textContent = next.text ?? ''
        log(`送信から応答完了: ${Date.now() - started} ms`)
        const text = next.text
        if (actingEnabled && text) {
          const sentences = splitSentences(text)
          acting?.beginReply()
          show('speaking')
          let currentSentence = 0
          const sentenceDuration = (s: string) => {
            const total = sentences.reduce((n, v) => n + Array.from(v.replace(/\s/g, '')).length, 0)
            return speech.checked && speaker
              ? spokenSeconds(s)
              : total
                ? (silentSpeechSeconds(text) * Array.from(s.replace(/\s/g, '')).length) / total
                : 0
          }
          const events = {
            onBoundary: (_index: number, charIndex: number) => syncViseme(charIndex),
            onSentence: (index: number, sentence: string) => {
              currentSentence = index
              startViseme(sentence, sentenceDuration(sentence), !!(speech.checked && speaker))
              acting?.sentence(cueForSentence(sentence))
              if (acting) rigReport.acting = acting.snapshot
            },
            onEnd: () => {
              if (state === 'speaking') show('done')
            },
            onError: (message: string) => {
              if (state === 'speaking') {
                log(`読み上げ失敗: ${message}（口パクのみ表示）`)
                mouthOnly(sentences.slice(currentSentence).join(''))
              }
            },
          }
          if (speech.checked && speaker) speaker.speak(sentences, events)
          else {
            const total = sentences.reduce((n, s) => n + Array.from(s.replace(/\s/g, '')).length, 0)
            sentencer.run(
              sentences,
              (s) => (total ? (silentSpeechSeconds(text) * Array.from(s.replace(/\s/g, '')).length) / total : 0),
              events,
            )
          }
        } else if (!actingEnabled && speech.checked && synthesis && text) {
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = 'ja-JP'
          utterance.onstart = () => {
            startViseme(text, spokenSeconds(text), true)
          }
          utterance.onboundary = (e) => syncViseme(e.charIndex)
          utterance.onend = () => {
            if (state === 'speaking') show('done')
          }
          // 中断以外の読み上げ失敗（音声なし等）は口パクだけ続ける。
          utterance.onerror = (e) => {
            if (state !== 'speaking') return
            if (e.error === 'interrupted' || e.error === 'canceled') show('done')
            else {
              log(`読み上げ失敗: ${e.error}（口パクのみ表示）`)
              mouthOnly(text)
            }
          }
          show('speaking')
          window.speechSynthesis.speak(utterance)
        } else if (text) mouthOnly(text)
      } else if (next.state === 'failed') error.textContent = '処理の結果を確認できませんでした。'
      return
    }
  }
  if (requestId === id) {
    busy = false
    requestId = ''
    error.textContent = '応答の確認がタイムアウトしました。'
    show('failed')
  }
}
el<HTMLFormElement>('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = message.value.trim()
  if (!text || busy || !enabled || recording || starting) return
  if (actingEnabled) interruptActing()
  else if (synthesis) window.speechSynthesis.cancel()
  error.textContent = ''
  busy = true
  accepted = false
  started = Date.now()
  show('thinking')
  let payload: Outgoing
  if (unconfirmed) {
    // 受理未確認の送信がある間は新しい ID を発行せず、まず BFF に状態を照会して確定させる。
    const pending = unconfirmed
    let lookup: Awaited<ReturnType<typeof call>> | null = null
    try {
      lookup = await call(`requests/${pending.requestId}`)
    } catch {
      lookup = null
    }
    const decision = resolveUnconfirmed(pending, lookup ? lookup.status : null, Date.now())
    if (decision === 'attach') {
      unconfirmed = null
      message.value = pending.text
      requestId = pending.requestId
      accepted = true
      log('受理未確認だった前回メッセージは受理済みでした。再送せず結果を追跡します。')
      show('thinking')
      void poll(requestId)
      return
    }
    if (decision === 'wait') {
      busy = false
      message.value = pending.text
      error.textContent =
        '前回の送信が受理されたか確認できません。二重実行を避けるため、確認できるまで新しい送信は行いません。しばらくしてから再度送信してください。'
      show('failed')
      return
    }
    if (decision === 'resend') {
      payload = pending
      if (pending.text !== text) {
        message.value = pending.text
        log('受理未確認の前回メッセージを同じ ID で再送します（重複実行防止）。')
      }
    } else {
      unconfirmed = null
      payload = newOutgoing(text, Date.now(), () => crypto.randomUUID())
    }
  } else payload = newOutgoing(text, Date.now(), () => crypto.randomUUID())
  requestId = payload.requestId
  let result: Awaited<ReturnType<typeof call>> | null = null
  try {
    result = await call('messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    result = null
  }
  if (result && result.status === 202) {
    unconfirmed = null
    accepted = true
    show(state)
    void poll(requestId)
    return
  }
  busy = false
  requestId = ''
  // 再送が拒否された場合（期限切れ到着の 410 等）も、先行送信が受理済みの可能性があるので次回の照会まで保持する。
  if (sendOutcomeUnknown(result ? result.status : null) || payload === unconfirmed) {
    unconfirmed = payload
    error.textContent =
      '送信結果を確認できません。もう一度送信すると、まず前回の受理状況を確認します（二重実行はしません）。'
    show('failed')
    return
  }
  fail(must(result).status, must(result).data)
})
async function decide(choice: 'once' | 'deny') {
  if (!requestId || !approvalId) return
  el<HTMLButtonElement>('allow').disabled = true
  el<HTMLButtonElement>('deny').disabled = true
  try {
    const result = await call('approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, approvalId, choice }),
    })
    if (result.status !== 200 && result.status !== 202) error.textContent = problem(result.status, result.data)
    else {
      approvalId = ''
      show('thinking')
    }
  } catch {
    error.textContent = '承認結果を確認できません。'
  }
  el<HTMLButtonElement>('allow').disabled = false
  el<HTMLButtonElement>('deny').disabled = false
}
el('allow').addEventListener('click', () => void decide('once'))
el('deny').addEventListener('click', () => void decide('deny'))
stop.addEventListener('click', async () => {
  if (!requestId || !accepted) return
  if (actingEnabled) interruptActing()
  stop.disabled = true
  try {
    const result = await call(`requests/${requestId}/cancel`, { method: 'POST' })
    if (result.status !== 202) error.textContent = problem(result.status, result.data)
    else if (result.data?.status === 'cancel-unknown') error.textContent = '停止の結果を確認中です。'
  } catch {
    error.textContent = '停止の結果を確認できません。'
  }
  stop.disabled = false
})
async function finishRecording() {
  held = false
  const r = recording
  if (!r) return
  recording = null
  clearTimeout(r.timer)
  r.processor.disconnect()
  r.source.disconnect()
  r.stream.getTracks().forEach((track) => {
    track.stop()
  })
  await r.context.close()
  const samples = new Float32Array(r.size)
  let offset = 0
  for (const chunk of r.chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  const pcm = pcm16(samples, r.context.sampleRate).slice(0, 960000)
  if (pcm.length < 16000) {
    error.textContent = '0.5秒以上録音してください。'
    show('idle')
    return
  }
  busy = true
  show('thinking')
  const began = Date.now()
  try {
    const result = await call('transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Kohako-Transcription-Id': crypto.randomUUID() },
      body: new Blob([pcm]),
    })
    log(
      `STT 往復: ${Date.now() - began} ms / BFF: ${typeof result.data?.ms === 'number' ? `${result.data.ms} ms` : '不明'}`,
    )
    busy = false
    if (result.status !== 200 || typeof result.data?.text !== 'string') {
      fail(result.status, result.data)
      return
    }
    message.value = result.data.text
    show('idle')
  } catch {
    busy = false
    error.textContent = '音声認識に接続できませんでした。'
    show('failed')
  }
}
record.addEventListener('pointerdown', async (event) => {
  if (busy || starting || recording || !stt) return
  event.preventDefault()
  held = true
  starting = true
  error.textContent = ''
  record.setPointerCapture(event.pointerId)
  show(state)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    if (!held || busy) {
      stream.getTracks().forEach((track) => {
        track.stop()
      })
      return
    }
    const context = new AudioContext(),
      source = context.createMediaStreamSource(stream),
      processor = context.createScriptProcessor(4096, 1, 1)
    const r = { stream, context, source, processor, chunks: [] as Float32Array[], size: 0, timer: 0 }
    recording = r
    processor.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0))
      r.chunks.push(chunk)
      r.size += chunk.length
    }
    source.connect(processor)
    processor.connect(context.destination)
    r.timer = window.setTimeout(() => void finishRecording(), 30000)
    show('listening')
  } catch {
    error.textContent = 'マイクを利用できません。ブラウザの権限を確認してください。'
    show('failed')
  } finally {
    starting = false
    show(state)
  }
})
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
  record.addEventListener(event, () => void finishRecording())
/** 読み上げなしでも応答文の長さだけ「話しています」にして口パクする（音は出さない）。 */
function mouthOnly(text: string) {
  show('speaking')
  startViseme(text)
  mouthTimer = window.setTimeout(() => {
    if (state === 'speaking') show('done')
  }, silentSpeechSeconds(text) * 1000)
}
function rigTick(now: number) {
  if (!rig) return
  const v =
    visemes && state === 'speaking' && speakingSince
      ? visemeAt(visemes, visemeAnchor + (now - speakingSince) / 1000, visemeLive)
      : { vowel: 'closed', open: 0, width: 1 }
  const mouth = mouthLevel(rigModel, v.open)
  stage?.setViseme?.(state !== 'speaking' ? null : { open: v.open, width: v.width })
  rig.lipSync(mouth)
  rigReport.mouth = mouth
  rigReport.viseme = v.vowel
  requestAnimationFrame(rigTick)
}
async function startRig() {
  if (!wantsRig(location.search)) {
    el('face-mode').textContent = '静止表情（?face=static）'
    return
  }
  try {
    const loaded = await loadRig(rigCanvas, rigModel, './kohako/live2d/sample/')
    rig = loaded.player
    rig.start()
    if (actingEnabled) {
      stage = createActingStage(rig, rigModel)
      acting = new ActingDirector(stage)
    }
    face.hidden = true
    rigCanvas.hidden = false
    rigCanvas.parentElement?.classList.add('rig')
    el('face-mode').textContent =
      `${rigModel.name}・${modelStatus(rigModel)}（独自 runtime・公式 Live2D ではありません）`
    Object.assign(rigReport, {
      loaded: true,
      model: rigModel.id,
      rig: rigModel.rig,
      totalMs: loaded.totalMs,
      rigBytes: loaded.rigBytes,
    })
    log(`リグ読込: ${loaded.totalMs.toFixed(0)} ms`)
    show(state)
    requestAnimationFrame(rigTick)
  } catch (e) {
    ;(rigReport.errors as string[]).push(e instanceof Error ? e.message : String(e))
    el('face-mode').textContent = 'リグを読み込めなかったため静止表情で表示しています'
  }
}
// 自動計測用（同一ページの状態を読むだけ）。
Object.assign(window, {
  __studioRig: {
    report: rigReport,
    get player() {
      return rig
    },
    get state() {
      return state
    },
    show,
  },
})
void initialize()
if (!lost) void startRig()
