import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { atomic, load } from './storage.js'
export type Item = { eventId: string; source: string; eventType: string; ticketId?: string; runId?: string; title: string; body: string; choices?: string[]; createdAt: string; receivedAt: string; deliveries: number; readAt?: string; announcedAt?: string; handledAt?: string; pushedAt?: string; pushSkipped?: 'quiet' | 'no-subscriptions' | 'error'; reply?: { replyId: string; kind: 'choice' | 'text'; value: string; requestId: string; claimedAt: string; status: 'claimed' | 'submitted' | 'submit_failed'; sessionId?: string; runId?: string } }
const string = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
export function validPayload(x: any): boolean {
  return !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => ['eventId','source','eventType','ticketId','runId','title','body','choices','createdAt'].includes(k)) && typeof x.eventId === 'string' && /^[A-Za-z0-9._:-]{8,200}$/.test(x.eventId) && typeof x.source === 'string' && /^[a-z0-9-]{1,40}$/.test(x.source) && string(x.eventType,80) && (x.ticketId === undefined || typeof x.ticketId === 'string' && /^[A-Z]+-\d+$/.test(x.ticketId)) && (x.runId === undefined || string(x.runId,120)) && string(x.title,200) && string(x.body,4000) && (x.choices === undefined || Array.isArray(x.choices) && x.choices.length <= 6 && x.choices.every((v: unknown) => string(v,40))) && typeof x.createdAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(x.createdAt) && Number.isFinite(Date.parse(x.createdAt))
}
export async function createNotifications(dir: string, push: (item: Item) => Promise<{ pushedAt?: string; pushSkipped?: Item['pushSkipped'] }>, now = Date.now) {
  const path = join(dir, 'notifications.json'), items = await load<Item[]>(path, []); let queue = Promise.resolve()
  const mutate = <T>(fn: () => Promise<T> | T): Promise<T> => { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result }
  const save = () => atomic(path, items)
  return {
    list: () => { const visible = items.filter(i => i.source !== 'task-board'); return { items: [...visible].reverse(), unread: visible.filter(i => !i.readAt).length } },
    ingest: (x: any) => mutate(async () => {
      if (!validPayload(x)) return 'invalid' as const
      const old = items.find(i => i.eventId === x.eventId)
      if (old) { old.deliveries++; await save(); return 'duplicate' as const }
      const item: Item = { ...x, receivedAt: new Date(now()).toISOString(), deliveries: 1 }; items.push(item)
      while (items.length > 500) { let idx = items.findIndex(i => i.handledAt); if (idx < 0) idx = items.findIndex(i => i.readAt); items.splice(idx < 0 ? 0 : idx, 1) }
      await save()
      try { Object.assign(item, await push(item)) } catch { item.pushSkipped = 'error' }
      await save(); return 'stored' as const
    }),
    announce: (id: string) => mutate(async () => { const item = items.find(i => i.eventId === id); if (!item) return null; if (item.announcedAt) return false; item.announcedAt = new Date(now()).toISOString(); await save(); return true }),
    mark: (id: string, field: 'readAt' | 'handledAt') => mutate(async () => { const item = items.find(i => i.eventId === id); if (!item) return false; item[field] ??= new Date(now()).toISOString(); await save(); return true }),
    /** Hermes が返した run id を返信に記録する（BFF 再起動後に再送せず、その run の追跡だけを再開するため）。 */
    setRun: (id: string, requestId: string, runId: string) => mutate(async () => { const r = items.find(i => i.eventId === id)?.reply; if (!r || r.requestId !== requestId || r.runId === runId) return; r.runId = runId; await save() }),
    reply: (id: string, x: any, submit: (item: Item, reply: NonNullable<Item['reply']>) => boolean, tracked: (requestId: string) => boolean = () => true, sessionId?: string) => mutate(async () => {
      const item = items.find(i => i.eventId === id); if (!item) return { error: 'not_found' }
      if (!x || Object.keys(x).some(k => !['replyId','kind','value'].includes(k)) || typeof x.replyId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(x.replyId) || !['text','choice'].includes(x.kind) || !string(x.value,500) || !x.value.trim() || x.kind === 'choice' && !item.choices?.includes(x.value)) return { error: 'invalid' }
      if (item.reply && item.reply.replyId !== x.replyId) return { error: 'already_replied' }
      if (item.reply && item.reply.status === 'submitted' && tracked(item.reply.requestId)) return { requestId: item.reply.requestId, status: item.reply.status, existing: true }
      // ここに来る既存返信は、会話トラッカー（メモリ）が受付番号を知らない = BFF 再起動等で追跡が失われたもの。
      // 二重実行を防ぐため新しい run は作らない: run id が記録済みならその run の追跡だけを再開し（submit 側で watch）、
      // 未記録なら固定した session・本文・Idempotency-Key で再送して Hermes の durable idempotency（24h）に同じ run を replay させる。
      // replay 保証期間を過ぎた未確認の返信は、claimed（受理直後に状態保存前で停止した可能性あり）も含め再送しない（Hermes が受理済みなら二重実行になりうるため）。
      if (item.reply && !item.reply.runId && now() - Date.parse(item.reply.claimedAt) > 23 * 3600_000) return { requestId: item.reply.requestId, status: item.reply.status, existing: true, expired: true }
      if (!item.reply) { item.reply = { replyId: x.replyId, kind: x.kind, value: x.value, requestId: randomUUID(), claimedAt: new Date(now()).toISOString(), status: 'claimed', ...(sessionId ? { sessionId } : {}) }; await save() }
      else if (!item.reply.sessionId && sessionId) { item.reply.sessionId = sessionId; await save() }
      const was = item.reply.status
      let ok = false; try { ok = submit(item, item.reply) } catch { /* 同じ claim で再試行 */ }
      // 一度 Hermes へ渡した返信は、追跡の再開に失敗しても submit_failed に戻さない（受理済みの可能性があるため）。
      item.reply.status = ok || was === 'submitted' ? 'submitted' : 'submit_failed'; await save()
      return { requestId: item.reply.requestId, status: item.reply.status, resumed: ok }
    })
  }
}
