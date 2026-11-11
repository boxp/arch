import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { atomic, load } from './storage.js'
export type Item = { eventId: string; source: string; eventType: string; ticketId?: string; runId?: string; title: string; body: string; choices?: string[]; createdAt: string; receivedAt: string; deliveries: number; readAt?: string; handledAt?: string; pushedAt?: string; pushSkipped?: 'quiet' | 'no-subscriptions' | 'error'; reply?: { replyId: string; kind: 'choice' | 'text'; value: string; requestId: string; claimedAt: string; status: 'claimed' | 'submitted' | 'submit_failed' } }
const string = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
export function validPayload(x: any): boolean {
  return !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => ['eventId','source','eventType','ticketId','runId','title','body','choices','createdAt'].includes(k)) && typeof x.eventId === 'string' && /^[A-Za-z0-9._:-]{8,200}$/.test(x.eventId) && typeof x.source === 'string' && /^[a-z0-9-]{1,40}$/.test(x.source) && string(x.eventType,80) && (x.ticketId === undefined || typeof x.ticketId === 'string' && /^[A-Z]+-\d+$/.test(x.ticketId)) && (x.runId === undefined || string(x.runId,120)) && string(x.title,200) && string(x.body,4000) && (x.choices === undefined || Array.isArray(x.choices) && x.choices.length <= 6 && x.choices.every((v: unknown) => string(v,40))) && typeof x.createdAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(x.createdAt) && Number.isFinite(Date.parse(x.createdAt))
}
export async function createNotifications(dir: string, push: (id: string) => Promise<{ pushedAt?: string; pushSkipped?: Item['pushSkipped'] }>, now = Date.now) {
  const path = join(dir, 'notifications.json'), items = await load<Item[]>(path, []); let queue = Promise.resolve()
  const mutate = <T>(fn: () => Promise<T> | T): Promise<T> => { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result }
  const save = () => atomic(path, items)
  return {
    list: () => ({ items: [...items].reverse(), unread: items.filter(i => !i.readAt).length }),
    ingest: (x: any) => mutate(async () => {
      if (!validPayload(x)) return 'invalid' as const
      const old = items.find(i => i.eventId === x.eventId)
      if (old) { old.deliveries++; await save(); return 'duplicate' as const }
      const item: Item = { ...x, receivedAt: new Date(now()).toISOString(), deliveries: 1 }; items.push(item)
      while (items.length > 500) { let idx = items.findIndex(i => i.handledAt); if (idx < 0) idx = items.findIndex(i => i.readAt); items.splice(idx < 0 ? 0 : idx, 1) }
      await save()
      try { Object.assign(item, await push(item.eventId)) } catch { item.pushSkipped = 'error' }
      await save(); return 'stored' as const
    }),
    mark: (id: string, field: 'readAt' | 'handledAt') => mutate(async () => { const item = items.find(i => i.eventId === id); if (!item) return false; item[field] ??= new Date(now()).toISOString(); await save(); return true }),
    reply: (id: string, x: any, submit: (item: Item, reply: NonNullable<Item['reply']>) => boolean, tracked: (requestId: string) => boolean = () => true) => mutate(async () => {
      const item = items.find(i => i.eventId === id); if (!item) return { error: 'not_found' }
      if (!x || Object.keys(x).some(k => !['replyId','kind','value'].includes(k)) || typeof x.replyId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(x.replyId) || !['text','choice'].includes(x.kind) || !string(x.value,500) || !x.value.trim() || x.kind === 'choice' && !item.choices?.includes(x.value)) return { error: 'invalid' }
      if (item.reply && item.reply.replyId !== x.replyId) return { error: 'already_replied' }
      // 'claimed' のまま残るのは claim 保存後・送信前に BFF が止まった場合だけ（mutate で直列化し submit は同期）。
      // 送れたか分からないので submit_failed と同じく同じ requestId で再送可能にし、Hermes 側は reply_id で重複を照合する。
      // submitted でも会話トラッカー（メモリ）が受付番号を知らなければ BFF 再起動で追跡が失われている。
      // 返信が実行されたか分からないので同じ requestId で再送し、Hermes 側が reply_id で重複を照合する（追跡も再開できる）。
      if (item.reply && item.reply.status === 'submitted' && tracked(item.reply.requestId)) return { requestId: item.reply.requestId, status: item.reply.status, existing: true }
      if (!item.reply) { item.reply = { replyId: x.replyId, kind: x.kind, value: x.value, requestId: randomUUID(), claimedAt: new Date(now()).toISOString(), status: 'claimed' }; await save() }
      let ok = false; try { ok = submit(item, item.reply) } catch { /* 同じ claim で再試行 */ }
      item.reply.status = ok ? 'submitted' : 'submit_failed'; await save()
      return { requestId: item.reply.requestId, status: item.reply.status }
    })
  }
}
