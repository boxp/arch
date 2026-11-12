import { pcm16 } from '../studio/model'

export type DictationState = 'idle' | 'starting' | 'recording' | 'transcribing'
type Result = { status: number; data: Record<string, unknown> | null }
type Resources = { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; size: number; timer: number; tick: number; started: number }
export function supportsDictation(env: { secure: boolean; getUserMedia: unknown; audioContext: unknown }): boolean {
  return env.secure && typeof env.getUserMedia === 'function' && typeof env.audioContext === 'function'
}
export function appendDictation(draft: string, text: string, max: number): { value: string; truncated: boolean } {
  const addition = (draft ? '\n' : '') + text.trim(), room = Math.max(0, max - draft.length)
  return { value: draft + addition.slice(0, room), truncated: addition.length > room }
}
export function createDictation(deps: {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>; createContext: () => AudioContext
  transcribe: (pcm: Uint8Array) => Promise<Result>; now: () => number
  setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void
  onState: (state: DictationState, seconds: number) => void; onError: (text: string) => void
  onAuth: (status: number, data: Result['data']) => void; onText: (text: string) => void
}) {
  let state: DictationState = 'idle', generation = 0, resources: Resources | null = null
  const update = (next: DictationState, seconds = 0) => { state = next; deps.onState(next, seconds) }
  async function release(r: Resources) {
    deps.clearTimeout(r.timer); deps.clearTimeout(r.tick); r.processor.onaudioprocess = null
    r.processor.disconnect(); r.source.disconnect(); r.stream.getTracks().forEach(t => t.stop())
    await r.context.close().catch(() => {})
  }
  async function cancel() {
    ++generation; const r = resources; resources = null; update('idle')
    if (r) await release(r)
  }
  async function start() {
    if (state !== 'idle') return
    const id = ++generation; update('starting')
    let stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined
    try {
      stream = await deps.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (id !== generation) { stream.getTracks().forEach(t => t.stop()); return }
      context = deps.createContext(); source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(4096, 1, 1)
      const r: Resources = { stream, context, source, processor, chunks: [], size: 0, timer: 0, tick: 0, started: deps.now() }; resources = r
      processor.onaudioprocess = e => { const chunk = new Float32Array(e.inputBuffer.getChannelData(0)); r.chunks.push(chunk); r.size += chunk.length }
      source.connect(processor); processor.connect(context.destination)
      const tick = () => { if (resources !== r) return; update('recording', Math.min(30, Math.floor((deps.now() - r.started) / 1000))); r.tick = deps.setTimeout(tick, 1000) }
      r.timer = deps.setTimeout(() => void stop(), 30000); tick()
    } catch (e) {
      if (resources) { const r = resources; resources = null; await release(r) }
      else { processor?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(t => t.stop()); if (context) await context.close().catch(() => {}) }
      if (id !== generation) return
      const name = e instanceof Error || (typeof e === 'object' && e !== null && 'name' in e) ? String((e as { name: unknown }).name) : ''
      deps.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'マイクの使用が許可されていません。ブラウザのサイト設定でマイクを許可してください。' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'マイクが見つかりません。' : name === 'NotReadableError' ? 'マイクを他のアプリが使用中です。' : 'マイクを利用できません。')
      update('idle')
    }
  }
  async function stop() {
    const r = resources; if (!r || state !== 'recording') return
    const id = generation; resources = null; update('transcribing'); await release(r)
    if (id !== generation) return
    const samples = new Float32Array(r.size); let offset = 0, sum = 0
    for (const chunk of r.chunks) { samples.set(chunk, offset); offset += chunk.length; for (const sample of chunk) sum += sample * sample }
    if (samples.length < r.context.sampleRate * 0.5) { deps.onError('0.5秒以上話してください。'); update('idle'); return }
    if (Math.sqrt(sum / samples.length) < 0.004) { deps.onError('声が聞き取れませんでした。もう一度お試しください。'); update('idle'); return }
    try {
      const result = await deps.transcribe(pcm16(samples, r.context.sampleRate).slice(0, 960000))
      if (id !== generation) return
      if (result.status === 401 || result.status === 403) deps.onAuth(result.status, result.data)
      else if (result.status === 422 || result.data?.error === 'no_speech' || (result.status === 200 && (typeof result.data?.text !== 'string' || !result.data.text.trim()))) deps.onError('音声を認識できませんでした。')
      else if (result.status === 413) deps.onError('録音が長すぎます。')
      else if (result.status !== 200) deps.onError('音声認識に接続できませんでした。もう一度お試しください。')
      else deps.onText((result.data!.text as string).trim())
    } catch { if (id === generation) deps.onError('音声認識に接続できませんでした。もう一度お試しください。') }
    finally { if (id === generation) update('idle') }
  }
  return { start, stop, cancel, get state() { return state } }
}
