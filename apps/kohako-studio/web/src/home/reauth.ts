import { QUEUE_MAX_CHARS, QUEUE_MAX_ITEMS } from './queue'

export const REAUTH_KEY = 'kohako-home-reauth'
export const REAUTH_DRAFT_MAX = 4000
const TTL = 15 * 60_000,
  RELOAD_GUARD = 2 * 60_000
export type ReauthStash = { v: 1; draft: string; queue: string[]; at: number; reloadAt: number }
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
      !v.queue.every((t) => typeof t === 'string' && t.length <= QUEUE_MAX_CHARS && !!t.trim() && t === t.trim()) ||
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
