import { QUEUE_MAX_CHARS, QUEUE_MAX_ITEMS, type NoticeReply } from './queue'

export const REAUTH_KEY = 'kohako-home-reauth'
export const REAUTH_DRAFT_MAX = 4000
const TTL = 15 * 60_000,
  RELOAD_GUARD = 2 * 60_000
/** 送信待ちの退避形式。通常の発言は本文の文字列、通知返信（BOXP-658）は返信先の文脈ごと退避する（復元後は保留）。 */
export type ReauthEntry = string | NoticeReply
export type ReauthStash = {
  v: 1
  draft: string
  queue: ReauthEntry[]
  at: number
  reloadAt: number
}
const text = (t: unknown, max: number): t is string =>
  typeof t === 'string' && t.length <= max && !!t.trim() && t === t.trim()
export function validNotice(x: unknown): x is NoticeReply {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const n = x as Record<string, unknown>
  return (
    Object.keys(n).every((k) =>
      ['eventId', 'ticketId', 'source', 'title', 'kind', 'value', 'replyId', 'attempted'].includes(k),
    ) &&
    typeof n.eventId === 'string' &&
    /^[A-Za-z0-9._:-]{8,200}$/.test(n.eventId) &&
    (n.ticketId === undefined || (typeof n.ticketId === 'string' && /^[A-Z]+-\d+$/.test(n.ticketId))) &&
    typeof n.source === 'string' &&
    /^[a-z0-9-]{1,40}$/.test(n.source) &&
    typeof n.title === 'string' &&
    n.title.length > 0 &&
    n.title.length <= 200 &&
    (n.kind === 'choice' || n.kind === 'text') &&
    text(n.value, QUEUE_MAX_CHARS) &&
    typeof n.replyId === 'string' &&
    /^[A-Za-z0-9-]{8,64}$/.test(n.replyId) &&
    (n.attempted === undefined || n.attempted === true)
  )
}
export const classifyFailure = ({ status }: { status: number }): 'auth' | 'other' =>
  status === 401 || status === 403 ? 'auth' : 'other'
export const serializeReauth = (stash: ReauthStash): string => JSON.stringify(stash)
export function parseReauth(raw: string | null, now: number): ReauthStash | null {
  try {
    const x: unknown = JSON.parse(raw ?? 'null')
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null
    const v = x as Record<string, unknown>
    if (
      Object.keys(v).sort().join(',') !== 'at,draft,queue,reloadAt,v' ||
      v.v !== 1 ||
      typeof v.draft !== 'string' ||
      v.draft.length > REAUTH_DRAFT_MAX ||
      !Array.isArray(v.queue) ||
      v.queue.length > QUEUE_MAX_ITEMS ||
      !v.queue.every((t) => text(t, QUEUE_MAX_CHARS) || validNotice(t)) ||
      typeof v.at !== 'number' ||
      !Number.isFinite(v.at) ||
      v.at > now ||
      now - v.at > TTL ||
      typeof v.reloadAt !== 'number' ||
      !Number.isFinite(v.reloadAt) ||
      v.reloadAt > now ||
      v.reloadAt < v.at
    )
      return null
    return v as ReauthStash
  } catch {
    return null
  }
}
export const recentlyReloaded = (stash: ReauthStash | null, now: number): boolean =>
  !!stash && now >= stash.reloadAt && now - stash.reloadAt <= RELOAD_GUARD

/** 実際に復元した先を使い、草稿だけ・送信待ちだけも正しく案内する。 */
export function restoredNotice(draft: boolean, merged: boolean, queued: number): string {
  if (merged)
    return `再認証前の入力を、いまの入力欄の先頭に戻しました${queued ? `。送信待ち ${queued} 件も戻しました` : ''}（まだ送信されていません）。`
  if (draft) return `再認証前の入力${queued ? `と送信待ち ${queued} 件` : ''}を戻しました（まだ送信されていません）。`
  return `再認証前の送信待ち ${queued} 件を戻しました（まだ送信されていません）。`
}
