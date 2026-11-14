import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { atomic, load } from './storage.js'
import { isRecord } from './untrusted.js'
export type PushStats = { subscriptions: number; sent: number; errors: number; removed: number }
export type Item = {
  eventId: string
  source: string
  eventType: string
  ticketId?: string
  jobId?: string
  runId?: string
  title: string
  body: string
  choices?: string[]
  createdAt: string
  receivedAt: string
  deliveries: number
  readAt?: string
  announcedAt?: string
  handledAt?: string
  pushedAt?: string
  pushSkipped?: 'quiet' | 'no-subscriptions' | 'error'
  pushStats?: PushStats
  reply?: {
    replyId: string
    kind: 'choice' | 'text'
    value: string
    requestId: string
    claimedAt: string
    status: 'claimed' | 'submitted' | 'submit_failed'
    sessionId?: string
    runId?: string
  }
}
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
/** ingest で受け付ける通知本体（受信側で付ける項目を除いた Item）。 */
export type Payload = Pick<
  Item,
  'eventId' | 'source' | 'eventType' | 'ticketId' | 'jobId' | 'runId' | 'title' | 'body' | 'choices' | 'createdAt'
>
export function validPayload(x: unknown): x is Payload {
  return (
    isRecord(x) &&
    Object.keys(x).every((k) =>
      [
        'eventId',
        'source',
        'eventType',
        'ticketId',
        'jobId',
        'runId',
        'title',
        'body',
        'choices',
        'createdAt',
      ].includes(k),
    ) &&
    typeof x.eventId === 'string' &&
    /^[A-Za-z0-9._:-]{8,200}$/.test(x.eventId) &&
    typeof x.source === 'string' &&
    /^[a-z0-9-]{1,40}$/.test(x.source) &&
    string(x.eventType, 80) &&
    (x.ticketId === undefined || (typeof x.ticketId === 'string' && /^[A-Z]+-\d+$/.test(x.ticketId))) &&
    (x.jobId === undefined || (typeof x.jobId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.jobId))) &&
    (x.runId === undefined || string(x.runId, 120)) &&
    string(x.title, 200) &&
    string(x.body, 4000) &&
    (x.choices === undefined ||
      (Array.isArray(x.choices) && x.choices.length <= 6 && x.choices.every((v: unknown) => string(v, 40)))) &&
    typeof x.createdAt === 'string' &&
    /^\d{4}-\d\d-\d\dT/.test(x.createdAt) &&
    Number.isFinite(Date.parse(x.createdAt))
  )
}
export async function createNotifications(
  dir: string,
  push: (item: Item) => Promise<{ pushedAt?: string; pushSkipped?: Item['pushSkipped']; pushStats?: PushStats }>,
  now = Date.now,
) {
  const path = join(dir, 'notifications.json'),
    items = await load<Item[]>(path, [])
  let queue = Promise.resolve()
  const mutate = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const result = queue.then(fn)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const save = () => atomic(path, items),
    leases = new Map<string, number>()
  return {
    flush: () => queue,
    list: () => {
      const visible = items.filter((i) => i.source !== 'task-board')
      return { items: visible, unread: visible.filter((i) => !i.readAt).length }
    },
    status: (ids: string[]) =>
      Object.fromEntries(
        ids.map((id) => {
          const item = items.find((i) => i.eventId === id)
          return [id, { exists: !!item, read: !!item?.readAt, handled: !!item?.handledAt, replied: !!item?.reply }]
        }),
      ),
    ingest: (x: unknown) =>
      mutate(async () => {
        if (!validPayload(x)) return { status: 'invalid' as const }
        const old = items.find((i) => i.eventId === x.eventId)
        if (old) {
          old.deliveries++
          await save()
          return { status: 'duplicate' as const }
        }
        const item: Item = { ...x, receivedAt: new Date(now()).toISOString(), deliveries: 1 }
        items.push(item)
        while (items.length > 500) {
          let idx = items.findIndex((i) => i.handledAt)
          if (idx < 0) idx = items.findIndex((i) => i.readAt)
          items.splice(Math.max(idx, 0), 1)
        }
        await save()
        try {
          Object.assign(item, await push(item))
        } catch {
          item.pushSkipped = 'error'
        }
        await save()
        return { status: 'stored' as const, push: { pushSkipped: item.pushSkipped, ...item.pushStats } }
      }),
    /** 吹き出し表示前の仮押さえ（30秒）。永続化しないので、表示前にページが閉じても期限後に再案内できる。複数タブの同時表示を防ぐ。 */
    claimAnnounce: (id: string) =>
      mutate(() => {
        const item = items.find((i) => i.eventId === id)
        if (!item) return null
        if (item.announcedAt || (leases.get(id) ?? 0) > now()) return false
        leases.set(id, now() + 30_000)
        return true
      }),
    /** 実際に表示した後に案内済みを永続化する。 */
    announce: (id: string) =>
      mutate(async () => {
        const item = items.find((i) => i.eventId === id)
        if (!item) return null
        if (item.announcedAt) return false
        item.announcedAt = new Date(now()).toISOString()
        await save()
        return true
      }),
    mark: (id: string, field: 'readAt' | 'handledAt') =>
      mutate(async () => {
        const item = items.find((i) => i.eventId === id)
        if (!item) return false
        item[field] ??= new Date(now()).toISOString()
        await save()
        return true
      }),
    /** Hermes が返した run id を返信に記録する（BFF 再起動後に再送せず、その run の追跡だけを再開するため）。 */
    setRun: (id: string, requestId: string, runId: string) =>
      mutate(async () => {
        const r = items.find((i) => i.eventId === id)?.reply
        if (!r || r.requestId !== requestId || r.runId === runId) return
        r.runId = runId
        await save()
      }),
    reply: (
      id: string,
      x: unknown,
      submit: (item: Item, reply: NonNullable<Item['reply']>) => boolean,
      tracked: (requestId: string) => boolean = () => true,
      sessionId?: string,
    ) =>
      mutate(async () => {
        const item = items.find((i) => i.eventId === id)
        if (!item) return { error: 'not_found' }
        if (
          !isRecord(x) ||
          Object.keys(x).some((k) => !['replyId', 'kind', 'value'].includes(k)) ||
          typeof x.replyId !== 'string' ||
          !/^[A-Za-z0-9-]{8,64}$/.test(x.replyId) ||
          (x.kind !== 'text' && x.kind !== 'choice') ||
          !string(x.value, 500) ||
          !x.value.trim() ||
          (x.kind === 'choice' && !item.choices?.includes(x.value))
        )
          return { error: 'invalid' }
        if (item.reply && item.reply.replyId !== x.replyId) return { error: 'already_replied' }
        if (item.reply && item.reply.status === 'submitted' && tracked(item.reply.requestId))
          return { requestId: item.reply.requestId, status: item.reply.status, existing: true }
        // ここに来る既存返信は、会話トラッカー（メモリ）が受付番号を知らない = BFF 再起動等で追跡が失われたもの。
        // 二重実行を防ぐため新しい run は作らない: run id が記録済みならその run の追跡だけを再開し（submit 側で watch）、
        // 未記録なら固定した session・本文・Idempotency-Key で再送して Hermes の durable idempotency（24h）に同じ run を replay させる。
        // replay 保証期間を過ぎた未確認の返信は、claimed（受理直後に状態保存前で停止した可能性あり）も含め再送しない（Hermes が受理済みなら二重実行になりうるため）。
        if (item.reply && !item.reply.runId && now() - Date.parse(item.reply.claimedAt) > 23 * 3600_000)
          return { requestId: item.reply.requestId, status: item.reply.status, existing: true, expired: true }
        if (!item.reply) {
          item.reply = {
            replyId: x.replyId,
            kind: x.kind,
            value: x.value,
            requestId: randomUUID(),
            claimedAt: new Date(now()).toISOString(),
            status: 'claimed',
            ...(sessionId ? { sessionId } : {}),
          }
          await save()
        } else if (!item.reply.sessionId && sessionId) {
          item.reply.sessionId = sessionId
          await save()
        }
        const was = item.reply.status
        let ok = false
        try {
          ok = submit(item, item.reply)
        } catch {
          /* 同じ claim で再試行 */
        }
        // 一度 Hermes へ渡した返信は、追跡の再開に失敗しても submit_failed に戻さない（受理済みの可能性があるため）。
        item.reply.status = ok || was === 'submitted' ? 'submitted' : 'submit_failed'
        await save()
        return { requestId: item.reply.requestId, status: item.reply.status, resumed: ok }
      }),
  }
}
