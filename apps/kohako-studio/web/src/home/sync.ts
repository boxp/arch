// BOXP-565: 端末間の会話共有。BFF の会話履歴（conversation/transcript）を検証し、この端末の履歴へ足す操作を決める（DOM 非依存）。
import { validateViews, type View } from './views'

type Item = {
  requestId: string
  at: number
  current: boolean
  /** BOXP-657: 眼鏡（Even G2）から送った発言。BFF が入口で決めた値で、端末の自己申告ではない。 */
  g2?: true
  text?: string
  attachments?: string[]
  status: 'pending' | 'done' | 'failed' | 'unknown'
  error?: string
  reply?: { text: string; at: number; views?: View[] }
}
type Active = { requestId: string; kind: 'text' | 'reply' } | null
export type Transcript =
  | { rev: string; sessionStartedAt: number; items: Item[]; active: Active }
  | { rev: string; unchanged: true }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
export function validateTranscript(data: unknown): Transcript | null {
  if (!object(data) || !str(data.rev, 100) || !data.rev) return null
  if (data.unchanged === true) return { rev: data.rev, unchanged: true }
  if (!num(data.sessionStartedAt) || !Array.isArray(data.items) || data.items.length > 50) return null
  const items: Item[] = []
  for (const v of data.items) {
    if (
      !object(v) ||
      !str(v.requestId, 64) ||
      !v.requestId ||
      !num(v.at) ||
      typeof v.current !== 'boolean' ||
      !['pending', 'done', 'failed', 'unknown'].includes(String(v.status)) ||
      (v.text !== undefined && !str(v.text, 500)) ||
      (v.error !== undefined && !str(v.error, 500)) ||
      (v.attachments !== undefined &&
        (!Array.isArray(v.attachments) ||
          v.attachments.length > 20 ||
          !v.attachments.every((a: unknown) => str(a, 255))))
    )
      return null
    let reply: Item['reply']
    if (v.reply !== undefined) {
      if (
        !object(v.reply) ||
        !str(v.reply.text, 30000) ||
        !num(v.reply.at) ||
        (v.reply.views !== undefined && (!Array.isArray(v.reply.views) || v.reply.views.length > 50))
      )
        return null
      reply = { text: v.reply.text, at: v.reply.at, views: validateViews(v.reply.views) }
    }
    items.push({
      requestId: v.requestId,
      at: v.at,
      current: v.current,
      ...(v.origin === 'g2' ? { g2: true as const } : {}),
      status: v.status as Item['status'],
      ...(v.text === undefined ? {} : { text: v.text as string }),
      ...(v.attachments === undefined ? {} : { attachments: v.attachments as string[] }),
      ...(v.error === undefined ? {} : { error: v.error as string }),
      ...(reply ? { reply } : {}),
    })
  }
  let active: Active = null
  if (data.active !== null) {
    if (
      !object(data.active) ||
      !str(data.active.requestId, 64) ||
      !data.active.requestId ||
      (data.active.kind !== 'text' && data.active.kind !== 'reply')
    )
      return null
    active = { requestId: data.active.requestId, kind: data.active.kind }
  }
  return { rev: data.rev, sessionStartedAt: data.sessionStartedAt, items, active }
}
export class Seen {
  private ids = new Set<string>()
  private mark(key: string) {
    if (this.ids.has(key)) return false
    this.ids.add(key)
    if (this.ids.size > 400) this.ids.delete(this.ids.values().next().value as string)
    return true
  }
  markUser(id: string) {
    return this.mark(`u:${id}`)
  }
  markReply(id: string) {
    return this.mark(`r:${id}`)
  }
  markEnd(id: string) {
    return this.mark(`e:${id}`)
  }
  markDivider(id: string) {
    return this.mark(`d:${id}`)
  }
}
/**
 * BFF の履歴に載っていた依頼の受付番号。次の履歴に無くなった番号（保持期限切れ・最新 50 件から外れた）を返し、
 * 開いたままの端末の画面からも消せるようにする。履歴に一度も載っていない依頼（通知返信など）は対象にしない。
 */
export class Shared {
  private ids = new Set<string>()
  update(items: { requestId: string }[]): string[] {
    const now = new Set(items.map((x) => x.requestId))
    const gone = [...this.ids].filter((id) => !now.has(id))
    this.ids = now
    return gone
  }
}
type Op =
  | { op: 'user'; id: string; text: string; at: number; g2?: true }
  | { op: 'reply'; id: string; text: string; views: View[]; at: number; latest: boolean }
  | { op: 'ended'; id: string; stopped: boolean; at: number }
  | { op: 'divider'; id: string; at: number }
  | { op: 'stale'; id: string }
  | { op: 'follow'; id: string; kind: 'text' | 'reply' }
export function planSync(
  items: Item[],
  active: Active,
  ctx: { seen: Seen; trackingId: string; canFollow: boolean },
): Op[] {
  const ops: Op[] = []
  items.forEach((item, i) => {
    const id = item.requestId
    if (i > 0 && !items[i - 1].current && item.current && ctx.seen.markDivider(id))
      ops.push({ op: 'divider', id, at: item.at })
    if (item.text !== undefined && ctx.seen.markUser(id))
      ops.push({
        op: 'user',
        id,
        text: item.text + (item.attachments ?? []).map((x) => `\n📎 ${x}`).join(''),
        at: item.at,
        ...(item.g2 ? { g2: true as const } : {}),
      })
    if (id === ctx.trackingId) return
    if (item.status === 'done' && item.reply && ctx.seen.markReply(id))
      ops.push({
        op: 'reply',
        id,
        text: item.reply.text,
        views: item.reply.views ?? [],
        at: item.reply.at,
        latest: i === items.length - 1,
      })
    if ((item.status === 'failed' || item.status === 'unknown') && ctx.seen.markEnd(id))
      ops.push({ op: 'ended', id, stopped: item.error === 'cancelled', at: item.at })
  })
  const last = items.at(-1)
  if (last && !last.current && last.status !== 'pending' && ctx.seen.markDivider(`stale:${last.requestId}`))
    ops.push({ op: 'stale', id: last.requestId })
  if (active && active.requestId !== ctx.trackingId && ctx.canFollow)
    ops.push({ op: 'follow', id: active.requestId, kind: active.kind })
  return ops
}
/**
 * 次回の照会に付ける rev。進行中の依頼をこの端末がまだ追えていない間（別の依頼を追跡中・送信中など）は rev を
 * 覚えず、次回も全文を受け取って追跡を試み直す。覚えてしまうと「変化なし」が返り続け、その依頼の進行状態・承認・
 * 停止をこの端末で扱えなくなる。
 */
export function nextRev(rev: string, active: Active, trackingId: string): string {
  return active && active.requestId !== trackingId ? '' : rev
}
