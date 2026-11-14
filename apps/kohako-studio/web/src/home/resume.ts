// 再読み込み後に進行中の依頼を追い直すための控え（会話本文は保存しない）。受理未確認の送信は重複防止のため本文ごとタブ内に控える。
import type { Outgoing } from '../studio/model'
export type Inflight = { requestId: string; expiresAt: number; accepted: boolean }
const ID = /^[A-Za-z0-9-]{8,64}$/
export function parseResume(raw: string | null, now: number): Inflight | null {
  try {
    const v = JSON.parse(raw ?? 'null')
    return v &&
      typeof v.requestId === 'string' &&
      ID.test(v.requestId) &&
      typeof v.expiresAt === 'number' &&
      v.expiresAt > now &&
      typeof v.accepted === 'boolean'
      ? { requestId: v.requestId, expiresAt: v.expiresAt, accepted: v.accepted }
      : null
  } catch {
    return null
  }
}
export function parseUnconfirmed(raw: string | null): Outgoing | null {
  try {
    const v = JSON.parse(raw ?? 'null')
    return v &&
      v.kind === 'text' &&
      typeof v.text === 'string' &&
      v.text.length <= 500 &&
      typeof v.requestId === 'string' &&
      ID.test(v.requestId) &&
      typeof v.expiresAt === 'number'
      ? {
          kind: 'text',
          text: v.text,
          requestId: v.requestId,
          expiresAt: v.expiresAt,
          ...(Array.isArray(v.attachments) &&
          v.attachments.length <= 3 &&
          v.attachments.every((x: unknown) => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x))
            ? {
                attachments: v.attachments,
                attachmentNames: Array.isArray(v.attachmentNames)
                  ? v.attachmentNames.filter((x: unknown) => typeof x === 'string').slice(0, 3)
                  : [],
              }
            : {}),
        }
      : null
  } catch {
    return null
  }
}
/** 進行中の依頼の照会結果をどう扱うか。認証切れ・依頼消失だけを終了とし、5xx/429/408 などの一時的な失敗は追跡を続ける（二重実行防止のため控えも消さない）。 */
export function pollVerdict(status: number, hasData: boolean): 'ok' | 'terminal' | 'retry' {
  if (status === 200) return hasData ? 'ok' : 'retry'
  if (status === 401 || status === 403 || status === 404 || status === 410) return 'terminal'
  if (status === 408 || status === 429 || status >= 500) return 'retry'
  return 'terminal'
}
