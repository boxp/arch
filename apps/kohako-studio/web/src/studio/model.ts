import { LATEST_MODEL_ID, normalizeModelId, rigModels, type RigModelId } from '../live2d/model'
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
/** 本人モデルを選択し、未指定・不明値・サンプル指定は最新にする。 */
export function studioRigModelId(search: string): RigModelId {
  const id = normalizeModelId(new URLSearchParams(search).get('model'))
  return rigModels.find(m => m.id === id && m.id !== 'sample')?.id ?? LATEST_MODEL_ID
}
/** 読み上げが無効・使えない・失敗したときに、応答文の長さから口パクだけ見せる秒数（1.5〜10 秒）。 */
export function silentSpeechSeconds(text: string): number {
  const chars = [...text.replace(/\s+/g, '')].length
  return Math.min(10, Math.max(1.5, chars / 8))
}
export type Outgoing = { kind: 'text'; text: string; requestId: string; expiresAt: number }
/** 期限切れと判断する前に置く猶予（端末と BFF の時計ずれ・遅延到着に備える）。 */
export const EXPIRY_GRACE_MS = 60_000
export function newOutgoing(text: string, now: number, newId: () => string): Outgoing {
  return { kind: 'text', text, requestId: newId(), expiresAt: now + 300_000 }
}
/**
 * 受理未確認の送信をどう扱うかを、BFF への照会結果 (GET requests/:id の HTTP status、通信失敗は null) から決める。
 * 規則: 受理が確定しない限り新しい requestId は発行しない。
 * - 200: 既に受理済み → 再送せずその要求を追跡する。
 * - 404 かつ期限内: 未受理 → 同じ requestId・本文・期限で再送する（BFF が冪等に扱う）。
 * - 404 かつ期限+猶予を過ぎた: BFF は期限切れの到着を 410 で拒否するので以後受理されない → 新しい ID で送れる。
 * - それ以外（通信失敗・5xx・404 だが猶予内で期限切れ）: 状態不明のまま保持し、送らない。
 */
export function resolveUnconfirmed(unconfirmed: Outgoing, lookupStatus: number | null, now: number): 'attach' | 'resend' | 'new' | 'wait' {
  if (lookupStatus === 200) return 'attach'
  if (lookupStatus === 404) {
    if (unconfirmed.expiresAt > now) return 'resend'
    if (unconfirmed.expiresAt + EXPIRY_GRACE_MS <= now) return 'new'
  }
  return 'wait'
}
/** POST messages の結果が「受理されたか不明」か（通信失敗または 5xx はプロキシ越しに処理済みの可能性がある）。 */
export function sendOutcomeUnknown(status: number | null): boolean {
  return status === null || status >= 500
}

/** 表情・動作の演技（BOXP-476 表現セット）。2026-11-11 Owner 承認で既定を有効にした。?acting=0 は演技なしの旧通常版 v11r（復旧用）。 */
export function wantsActing(search: string): boolean {
  return new URLSearchParams(search).get('acting') !== '0'
}
