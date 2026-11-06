import './style.css'
import { interpretRequest, pcm16, presentation, rigStateOf, silentSpeechSeconds, studioRigModelId, wantsRig, type State } from './model'
import { modelFor, mouthLevel, speechMouth } from '../live2d/model'
import { applyPose, loadRig, type Player } from '../live2d/rig'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const face = el<HTMLImageElement>('face'), stateLabel = el('state'), message = el<HTMLTextAreaElement>('message'), send = el<HTMLButtonElement>('send'), record = el<HTMLButtonElement>('record'), stop = el<HTMLButtonElement>('stop'), speech = el<HTMLInputElement>('speech')
const error = el('error'), approvalBox = el('approval'), reply = el('reply')
let state: State = 'offline', enabled = false, stt = false, requestId = '', started = 0, approvalId = '', busy = false, accepted = false
let recording: { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; size: number; timer: number } | null = null
let starting = false, held = false
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
speech.disabled = !synthesis
speech.addEventListener('change', () => { if (!speech.checked && synthesis) { window.speechSynthesis.cancel(); if (state === 'speaking') show('done') } })
el('speech-help').textContent = synthesis ? 'ブラウザ内蔵の音声で再生します（オフでも応答中はリグが口パクします）。' : 'このブラウザでは読み上げを利用できません（応答中はリグが口パクします）。'
// Web リグ（既定はコハコ最小本人モデル v0。PSD2Live 独自 runtime）。読めなければ従来の静止表情に戻る。
const rigModel = modelFor(`?model=${studioRigModelId(location.search)}`), rigCanvas = el<HTMLCanvasElement>('rig')
let rig: Player | null = null, speakingSince = 0, mouthTimer = 0
const rigReport: Record<string, unknown> = { loaded: false, errors: [] as string[] }
function show(next: State) {
  state = next
  stateLabel.textContent = presentation[next].label
  face.src = `./kohako/studio/c48v6-${presentation[next].face}-color.png`
  if (next !== 'speaking') { speakingSince = 0; clearTimeout(mouthTimer) }
  if (rig) rigReport.pose = { state: next, ...applyPose(rig, rigModel, rigStateOf[next]) }
  send.disabled = !enabled || busy || !!recording || starting
  record.disabled = !enabled || !stt || busy
  stop.hidden = !busy || !requestId || !accepted
  approvalBox.hidden = next !== 'approval'
}
function log(text: string) { const item = document.createElement('li'); item.textContent = text; el('log').prepend(item) }
function problem(status: number, data: Record<string, unknown> | null): string {
  if (status === 401 || status === 403) return 'Cloudflare Access でログインし直してください。'
  if (status === 429) return '処理が混み合っています。しばらく待ってからお試しください。'
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
function fail(status: number, data: Record<string, unknown> | null) {
  error.textContent = problem(status, data)
  if (status === 401 || status === 403) { enabled = false; el('connection').textContent = '未認証'; show('offline') } else show('failed')
}
async function initialize() {
  try {
    const me = await call('me'); if (me.status !== 200) return fail(me.status, me.data)
    const conv = await call('conversation'); if (conv.status !== 200 || !conv.data) return fail(conv.status, conv.data)
    enabled = conv.data.enabled === true; stt = enabled && !!conv.data.stt
    el('connection').textContent = enabled ? '接続中' : '会話は無効です'
    el('features').textContent = `音声認識: ${stt ? '有効' : '無効'} ／ セッション開始: ${typeof conv.data.sessionStartedAt === 'number' ? new Date(conv.data.sessionStartedAt).toLocaleString('ja-JP') : '未開始'} ／ 共有コンテキスト: ${String(conv.data.sharedContext ?? 'なし')}`
    el('record-help').textContent = stt ? '押している間だけ録音します（0.5〜30秒）。' : '音声認識が無効のため録音できません。'
    show(enabled ? 'idle' : 'offline')
  } catch { error.textContent = '接続できませんでした。'; show('offline') }
}
async function poll(id: string) {
  const deadline = Date.now() + 11 * 60_000
  while (requestId === id && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1800))
    let result
    try { result = await call(`requests/${id}`) } catch { continue }
    if (result.status !== 200 || !result.data) { busy = false; requestId = ''; fail(result.status, result.data); return }
    const next = interpretRequest(result.data)
    if (next.state === 'approval' && next.approval) {
      approvalId = next.approval.approvalId; el('approval-summary').textContent = next.approval.summary
      el('approval-expiry').textContent = `期限: ${new Date(next.approval.expiresAt).toLocaleString('ja-JP')}`; show('approval')
    } else if (next.state === 'thinking') show('thinking')
    else {
      busy = false; requestId = ''; show(next.state)
      if (next.state === 'done') {
        reply.textContent = next.text ?? ''; log(`送信から応答完了: ${Date.now() - started} ms`)
        const text = next.text
        if (speech.checked && synthesis && text) {
          const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ja-JP'
          utterance.onstart = () => { speakingSince = performance.now() }
          utterance.onend = () => { if (state === 'speaking') show('done') }
          // 中断以外の読み上げ失敗（音声なし等）は口パクだけ続ける。
          utterance.onerror = e => { if (state !== 'speaking') return; if (e.error === 'interrupted' || e.error === 'canceled') show('done'); else { log(`読み上げ失敗: ${e.error}（口パクのみ表示）`); mouthOnly(text) } }
          show('speaking'); speakingSince = performance.now(); window.speechSynthesis.speak(utterance)
        } else if (text) mouthOnly(text)
      } else if (next.state === 'failed') error.textContent = '処理の結果を確認できませんでした。'
      return
    }
  }
  if (requestId === id) { busy = false; requestId = ''; error.textContent = '応答の確認がタイムアウトしました。'; show('failed') }
}
el<HTMLFormElement>('form').addEventListener('submit', async event => {
  event.preventDefault(); const text = message.value.trim(); if (!text || busy || !enabled || recording || starting) return
  if (synthesis) window.speechSynthesis.cancel()
  error.textContent = ''; busy = true; accepted = false; requestId = crypto.randomUUID(); started = Date.now(); show('thinking')
  try {
    const result = await call('messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', text, requestId, expiresAt: Date.now() + 300_000 }) })
    if (result.status !== 202) { busy = false; requestId = ''; fail(result.status, result.data); return }
    accepted = true; show(state); void poll(requestId)
  } catch { busy = false; requestId = ''; error.textContent = '送信結果を確認できません。再送する前に接続を確認してください。'; show('failed') }
})
async function decide(choice: 'once' | 'deny') {
  if (!requestId || !approvalId) return
  el<HTMLButtonElement>('allow').disabled = true; el<HTMLButtonElement>('deny').disabled = true
  try {
    const result = await call('approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, approvalId, choice }) })
    if (result.status !== 200 && result.status !== 202) error.textContent = problem(result.status, result.data)
    else { approvalId = ''; show('thinking') }
  } catch { error.textContent = '承認結果を確認できません。' }
  el<HTMLButtonElement>('allow').disabled = false; el<HTMLButtonElement>('deny').disabled = false
}
el('allow').addEventListener('click', () => void decide('once'))
el('deny').addEventListener('click', () => void decide('deny'))
stop.addEventListener('click', async () => {
  if (!requestId || !accepted) return
  stop.disabled = true
  try { const result = await call(`requests/${requestId}/cancel`, { method: 'POST' }); if (result.status !== 202) error.textContent = problem(result.status, result.data); else if (result.data?.status === 'cancel-unknown') error.textContent = '停止の結果を確認中です。' }
  catch { error.textContent = '停止の結果を確認できません。' }
  stop.disabled = false
})
async function finishRecording() {
  held = false
  const r = recording; if (!r) return
  recording = null; clearTimeout(r.timer); r.processor.disconnect(); r.source.disconnect(); r.stream.getTracks().forEach(track => track.stop()); await r.context.close()
  const samples = new Float32Array(r.size); let offset = 0; for (const chunk of r.chunks) { samples.set(chunk, offset); offset += chunk.length }
  const pcm = pcm16(samples, r.context.sampleRate).slice(0, 960000)
  if (pcm.length < 16000) { error.textContent = '0.5秒以上録音してください。'; show('idle'); return }
  busy = true; show('thinking'); const began = Date.now()
  try {
    const result = await call('transcriptions', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Kohako-Transcription-Id': crypto.randomUUID() }, body: new Blob([pcm]) })
    log(`STT 往復: ${Date.now() - began} ms / BFF: ${typeof result.data?.ms === 'number' ? result.data.ms + ' ms' : '不明'}`)
    busy = false
    if (result.status !== 200 || typeof result.data?.text !== 'string') { fail(result.status, result.data); return }
    message.value = result.data.text; show('idle')
  } catch { busy = false; error.textContent = '音声認識に接続できませんでした。'; show('failed') }
}
record.addEventListener('pointerdown', async event => {
  if (busy || starting || recording || !stt) return
  event.preventDefault(); held = true; starting = true; error.textContent = ''; record.setPointerCapture(event.pointerId); show(state)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    if (!held || busy) { stream.getTracks().forEach(track => track.stop()); return }
    const context = new AudioContext(), source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1)
    const r = { stream, context, source, processor, chunks: [] as Float32Array[], size: 0, timer: 0 }; recording = r
    processor.onaudioprocess = e => { const chunk = new Float32Array(e.inputBuffer.getChannelData(0)); r.chunks.push(chunk); r.size += chunk.length }
    source.connect(processor); processor.connect(context.destination); r.timer = window.setTimeout(() => void finishRecording(), 30000); show('listening')
  } catch { error.textContent = 'マイクを利用できません。ブラウザの権限を確認してください。'; show('failed') }
  finally { starting = false; show(state) }
})
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) record.addEventListener(event, () => void finishRecording())
/** 読み上げなしでも応答文の長さだけ「話しています」にして口パクする（音は出さない）。 */
function mouthOnly(text: string) {
  show('speaking'); speakingSince = performance.now()
  mouthTimer = window.setTimeout(() => { if (state === 'speaking') show('done') }, silentSpeechSeconds(text) * 1000)
}
function rigTick(now: number) {
  if (!rig) return
  const mouth = mouthLevel(rigModel, state === 'speaking' && speakingSince ? speechMouth((now - speakingSince) / 1000) : 0)
  rig.lipSync(mouth); rigReport.mouth = mouth
  requestAnimationFrame(rigTick)
}
async function startRig() {
  if (!wantsRig(location.search)) { el('face-mode').textContent = '静止表情（?face=static）'; return }
  try {
    const loaded = await loadRig(rigCanvas, rigModel, './kohako/live2d/sample/')
    rig = loaded.player; rig.start()
    face.hidden = true; rigCanvas.hidden = false; rigCanvas.parentElement?.classList.add('rig')
    el('face-mode').textContent = `${rigModel.name}（独自 runtime・公式 Live2D ではありません）`
    Object.assign(rigReport, { loaded: true, totalMs: loaded.totalMs, rigBytes: loaded.rigBytes })
    log(`リグ読込: ${loaded.totalMs.toFixed(0)} ms`)
    show(state); requestAnimationFrame(rigTick)
  } catch (e) {
    (rigReport.errors as string[]).push(e instanceof Error ? e.message : String(e))
    el('face-mode').textContent = 'リグを読み込めなかったため静止表情で表示しています'
  }
}
// 自動計測用（同一ページの状態を読むだけ）。
Object.assign(window, { __studioRig: { report: rigReport, get player() { return rig }, get state() { return state }, show } })
void initialize()
void startRig()
