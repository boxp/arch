export type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'approval' | 'failed' | 'offline' | 'stopped'
export const presentation: Record<State, { label: string; face: string }> = {
  idle: { label: '待機中', face: 'idle' }, listening: { label: '聞いています', face: 'listening' },
  thinking: { label: '考えています', face: 'thinking' }, speaking: { label: '話しています', face: 'guiding' },
  done: { label: '応答を表示中', face: 'happy' }, approval: { label: '承認待ち', face: 'alert' },
  failed: { label: '失敗', face: 'offline' }, offline: { label: '未接続', face: 'offline' }, stopped: { label: '停止しました', face: 'offline' },
}
type Approval = { approvalId: string; summary: string; expiresAt: number }
export type Result = { state: State; text?: string; approval?: Approval }
export function interpretRequest(data: Record<string, unknown>): Result {
  if (data.status === 'pending') return { state: 'thinking' }
  if (data.status === 'done' && data.reply && typeof data.reply === 'object' && typeof (data.reply as Record<string, unknown>).text === 'string') return { state: 'done', text: (data.reply as { text: string }).text }
  if (data.status === 'approval' && data.approval && typeof data.approval === 'object') {
    const a = data.approval as Record<string, unknown>
    if (typeof a.approvalId === 'string' && typeof a.summary === 'string' && typeof a.expiresAt === 'number') return { state: 'approval', approval: { approvalId: a.approvalId, summary: a.summary, expiresAt: a.expiresAt } }
  }
  return { state: data.status === 'failed' && data.error === 'cancelled' ? 'stopped' : 'failed' }
}
/** 入力サンプルを平均化して 16kHz、符号付き PCM16 little endian にする。 */
export function pcm16(samples: Float32Array, rate: number): Uint8Array {
  const length = Math.floor(samples.length * 16000 / rate), bytes = new Uint8Array(length * 2), view = new DataView(bytes.buffer)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * rate / 16000), end = Math.max(start + 1, Math.floor((i + 1) * rate / 16000))
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j] ?? 0
    const value = Math.max(-1, Math.min(1, sum / (end - start)))
    view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true)
  }
  return bytes
}
/** Studio の表示状態を Web リグの状態に写す（応答表示中・停止は待機、未接続は失敗の姿勢）。 */
export const rigStateOf: Record<State, 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'failed'> = {
  idle: 'idle', done: 'idle', stopped: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking',
  approval: 'approval', failed: 'failed', offline: 'failed',
}
/** `?face=static` なら Web リグを読まず従来の静止表情だけを使う。 */
export function wantsRig(search: string): boolean {
  return new URLSearchParams(search).get('face') !== 'static'
}
/** Studio で使う Web リグのモデル ID。既定はコハコ v0。`?model=kohako-v5|kohako-v6` で本人モデルの試作に切り替える（他者の sample は選ばない）。 */
export function studioRigModelId(search: string): 'kohako' | 'kohako-v5' | 'kohako-v6' {
  const id = new URLSearchParams(search).get('model')
  return id === 'kohako-v5' || id === 'kohako-v6' ? id : 'kohako'
}
/** 読み上げが無効・使えない・失敗したときに、応答文の長さから口パクだけ見せる秒数（1.5〜10 秒）。 */
export function silentSpeechSeconds(text: string): number {
  const chars = [...text.replace(/\s+/g, '')].length
  return Math.min(10, Math.max(1.5, chars / 8))
}
