import '../studio/style.css'
import './style.css'
import { FrameMeter, clipName, lookFor, micMouth, modelFor, modelStatus, mouthLevel, rigStates, speechMouth, stateLabels, type RigState } from './model'
import { setupSelector } from './selector'
import { applyPose, loadRig, type Player } from './rig'
import { emotions, gestures, type ActingStage, type Emotion, type Gesture } from './acting'
import { createActingStage } from './gesture'

// runtime（p2l.js / p2l_runtime.wasm）は sample 配下を共用し、モデルの .p2lrt だけを切り替える。
const runtimeDir = './kohako/live2d/sample/'
const model = modelFor(location.search)

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = el<HTMLCanvasElement>('stage'), error = el('error'), metrics = el('metrics')
el('model-name').textContent = `${model.name}・${modelStatus(model)}`
el('model-notice').textContent = model.notice
el('model-credits').textContent = model.credits
const lost = setupSelector(el('prototype-selector'), true)
if (lost) { canvas.hidden = true; el('status').textContent = '比較画像を表示中'; el('model-name').textContent = '消失した試作'; el('model-notice').textContent = '下記の比較画像と理由をご覧ください。' }
const report: Record<string, unknown> = { errors: [] as string[] }
function fail(text: string) { (report.errors as string[]).push(text); error.textContent = text }
window.addEventListener('error', e => fail(`エラー: ${e.message}`))
window.addEventListener('unhandledrejection', e => fail(`エラー: ${String(e.reason)}`))
function metric(key: string, text: string) {
  let item = metrics.querySelector<HTMLLIElement>(`[data-key="${key}"]`)
  if (!item) { item = document.createElement('li'); item.dataset.key = key; metrics.append(item) }
  item.textContent = text
}

let player: Player | null = null, state: RigState = 'idle', mouth = 0, manual = 0, speakingSince = 0
let mic: { stream: MediaStream; context: AudioContext; analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer> } | null = null
const meter = new FrameMeter()
let drawTotal = 0, drawCount = 0

function apply(next: RigState) {
  state = next
  el('state').textContent = stateLabels[next]
  for (const button of el('states').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.state === next))
  if (!player) return
  report.pose = { state: next, ...applyPose(player, model, next) }
}
for (const s of rigStates) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.dataset.state = s
  button.textContent = stateLabels[s]; button.addEventListener('click', () => apply(s)); el('states').append(button)
}

function tick(now: number) {
  if (player) {
    // 手動スライダーは値をそのまま渡し、マイク・発話の自動口パクだけモデル別の写像を通す。
    if (mic) { mic.analyser.getFloatTimeDomainData(mic.buffer); mouth = micMouth(mic.buffer, mouth); player.lipSync(mouthLevel(model, mouth)) }
    else if (state === 'speaking' && speakingSince) { mouth = speechMouth((now - speakingSince) / 1000); player.lipSync(mouthLevel(model, mouth)) }
    else { mouth = manual; player.lipSync(Math.min(1, Math.max(0, manual))) }
    if (drawCount && drawCount % 30 === 0) {
      metric('fps', `描画: ${meter.fps().toFixed(1)} fps ／ 1 フレームの描画 ${(drawTotal / drawCount).toFixed(2)} ms（平均）`)
      report.fps = meter.fps(); report.drawMs = drawTotal / drawCount
    }
  }
  requestAnimationFrame(tick)
}

async function load() {
  const { player: p, fetchMs, instantiateMs, modelMs, totalMs, wasmBytes, rigBytes } = await loadRig(canvas, model, runtimeDir)
  const draw = p.draw.bind(p)
  p.draw = () => { const s = performance.now(); draw(); const e = performance.now(); drawTotal += e - s; drawCount++; meter.tick(e) }
  p.start(); player = p
  const debug = p.gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debug ? String(p.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(p.gl.getParameter(p.gl.RENDERER))
  Object.assign(report, { loaded: true, model: model.id, fetchMs, instantiateMs, modelMs, totalMs, wasmBytes, rigBytes, renderer, clips: p.clips.map(id => clipName(model, id)), expressions: p.expressions, parameters: p.parameters.length, meshes: p.meshes.length })
  metric('load', `読込: 取得 ${fetchMs.toFixed(0)} ms ／ WASM 初期化 ${instantiateMs.toFixed(0)} ms ／ モデル・テクスチャ ${modelMs.toFixed(0)} ms ／ 合計 ${totalMs.toFixed(0)} ms`)
  metric('size', `サイズ: runtime ${(wasmBytes / 1024).toFixed(0)} KiB ／ モデル ${(rigBytes / 1024).toFixed(0)} KiB ／ メッシュ ${p.meshes.length} ／ パラメータ ${p.parameters.length}`)
  metric('gpu', `WebGL: ${renderer} ／ 画面倍率 ${window.devicePixelRatio}`)
  el('status').textContent = '描画中'
  el('param-count').textContent = String(p.parameters.length)
  const values = el('params')
  for (const range of p.parameterRanges()) {
    const label = document.createElement('label'); label.className = 'slider'; label.textContent = range.id
    const input = document.createElement('input'); input.type = 'range'; input.min = String(range.min); input.max = String(range.max); input.step = String((range.max - range.min) / 100 || 0.01); input.value = String(range.default)
    input.addEventListener('input', () => p.setParameter(range.id, Number(input.value)))
    label.append(input); values.append(label)
  }
  canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); p.lookAt(...lookFor(model, ((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2)) })
  canvas.addEventListener('pointerleave', () => apply(state))
  apply('idle')
  if (new URLSearchParams(location.search).get('acting') === '1') setupActing(p)
  requestAnimationFrame(tick)
}

// BOXP-476: `?acting=1` のときだけ、表情と動作を手動で比較するボタンを出す。通常表示は変えない。
const emotionLabels: Record<Emotion, string> = { neutral: '通常', smile: '笑顔', shy: '照れ', troubled: '困り', surprised: '驚き', serious: '真剣' }
const gestureLabels: Record<Gesture, string> = { none: '動作なし', nod: '頷き', tilt: '首かしげ', joy: '喜び', greet: '挨拶（手を振る）', guide: '案内（UI を示す）', shyHand: '照れ（口元を隠す）', halt: '制止' }
function setupActing(p: Player) {
  const stage: ActingStage & { report(): Record<string, unknown> } = createActingStage(p, model)
  const panel = document.createElement('section'); panel.id = 'acting'
  const heading = document.createElement('h2'); heading.textContent = '表情・動作の比較（試作）'
  const row = (label: string) => { const r = document.createElement('div'); r.className = 'actions'; r.setAttribute('aria-label', label); panel.append(r); return r }
  panel.append(heading)
  const face = row('表情'), gesture = row('動作')
  for (const e of emotions) { const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary'; b.dataset.emotion = e; b.textContent = emotionLabels[e]; b.addEventListener('click', () => { stage.setEmotion(e); report.acting = stage.report() }); face.append(b) }
  for (const g of gestures) { if (g === 'none') continue; const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary'; b.dataset.gesture = g; b.textContent = gestureLabels[g]; b.addEventListener('click', () => { stage.playGesture(g); report.acting = stage.report() }); gesture.append(b) }
  const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.dataset.reset = '1'; clear.textContent = '解除'; clear.addEventListener('click', () => { stage.reset(); report.acting = stage.report() }); gesture.append(clear)
  el('states').after(panel)
  report.actingStage = stage
}

el<HTMLInputElement>('mouth').addEventListener('input', e => { manual = Number((e.target as HTMLInputElement).value) })
const synthesis = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
el<HTMLButtonElement>('speak-button').disabled = !synthesis
el<HTMLFormElement>('speak').addEventListener('submit', e => {
  e.preventDefault(); if (!synthesis) return
  const text = el<HTMLInputElement>('speak-text').value.trim(); if (!text) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ja-JP'
  utterance.onstart = () => { speakingSince = performance.now() }
  utterance.onend = utterance.onerror = () => { speakingSince = 0; if (state === 'speaking') apply('idle') }
  apply('speaking'); speakingSince = performance.now(); window.speechSynthesis.speak(utterance)
})
el('mic').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('mic')
  if (mic) { mic.stream.getTracks().forEach(t => t.stop()); await mic.context.close(); mic = null; button.textContent = 'マイク音量で口パク'; apply('idle'); return }
  if (button.disabled) return
  button.disabled = true // 許可待ち中の多重取得でストリームを取り残さない
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    const context = new AudioContext(), analyser = context.createAnalyser(); analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    mic = { stream, context, analyser, buffer: new Float32Array(analyser.fftSize) }
    button.textContent = 'マイクを止める'; apply('listening')
  } catch { fail('マイクを利用できません。ブラウザの権限を確認してください。') } finally { button.disabled = false }
})

// 自動計測用（同一ページの状態を読むだけ）。
Object.assign(window, { __rigPreview: { report, apply, setMouth: (v: number) => { manual = v }, get player() { return player } } })
if (!lost) load().catch(e => { el('status').textContent = '失敗'; fail(`読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`) })
