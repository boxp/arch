// 再読み込み後に進行中の依頼を追い直すための控え（会話本文は保存しない）。受理未確認の送信は重複防止のため本文ごとタブ内に控える。
import type { Outgoing } from '../studio/model'
export type Inflight = { requestId: string; expiresAt: number; accepted: boolean }
const ID = /^[A-Za-z0-9-]{8,64}$/
export function parseResume(raw: string | null, now: number): Inflight | null {
  try { const v = JSON.parse(raw ?? 'null'); return v && typeof v.requestId === 'string' && ID.test(v.requestId) && typeof v.expiresAt === 'number' && v.expiresAt > now && typeof v.accepted === 'boolean' ? { requestId: v.requestId, expiresAt: v.expiresAt, accepted: v.accepted } : null } catch { return null }
}
export function parseUnconfirmed(raw: string | null): Outgoing | null {
  try { const v = JSON.parse(raw ?? 'null'); return v && v.kind === 'text' && typeof v.text === 'string' && v.text.length <= 500 && typeof v.requestId === 'string' && ID.test(v.requestId) && typeof v.expiresAt === 'number' ? { kind: 'text', text: v.text, requestId: v.requestId, expiresAt: v.expiresAt } : null } catch { return null }
}
