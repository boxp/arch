import { createHash } from 'node:crypto'
import { join } from 'node:path'
import webPush from 'web-push'
import type { Item } from './notifications.js'
import { atomic, load } from './storage.js'
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } }
export function summarizePush(item: Pick<Item, 'title' | 'body' | 'eventType'>, minimal = false) {
  if (minimal) return { title: 'コハコ', body: 'コハコからお知らせがあります' }
  const fallback: Record<string, string> = { 'run-finished': '完了しました', 'lane-changed': '確認が必要です', 'morning-digest': 'お知らせがあります', 'run-stopped': '止まっています' }
  let body = redact(item.body) || fallback[item.eventType] || '新しいお知らせがあります'
  if (body.length > 120) body = body.slice(0, 119) + '…'
  // タイトルもロック画面に出るため本文と同じ伏字処理を通す
  const title = redact(item.title).slice(0, 80) || 'コハコ'
  return { title, body }
}
/** ロック画面に出してよい形へ: URL・メール・パス・長い英数字列（トークン等）を伏せ、Markdown記号を除く */
export function redact(text: string) {
  return text.replace(/https?:\/\/[^\s]+/gi, '(リンク)').replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(メール)').replace(/(?:~\/[^\s]+|\/(?:[^\s/]+\/)+[^\s/]+)/g, '(パス)').replace(/[A-Za-z0-9_+\/=.:~-]{20,}/g, '(省略)').replace(/[*`#>|]+/g, '').replace(/\s+/g, ' ').trim()
}
export async function createPush(dir: string, opts: { subject: string; quietHours: string; minimal?: boolean; now?: () => number; sender?: typeof webPush.sendNotification }) {
  const keyPath = join(dir, 'vapid.json'), path = join(dir, 'push-subscriptions.json'), now = opts.now ?? Date.now
  let keys = await load<{ publicKey: string; privateKey: string } | null>(keyPath, null)
  if (!keys) { keys = webPush.generateVAPIDKeys(); await atomic(keyPath, keys) }
  const subscriptions = await load<Record<string, Subscription>>(path, {}); let queue = Promise.resolve()
  const mutate = <T>(fn: () => Promise<T>): Promise<T> => { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result }
  const hash = (s: string) => createHash('sha256').update(s).digest('hex')
  const valid = (x: any): x is Subscription => { try { return x && typeof x.endpoint === 'string' && x.endpoint.length <= 1000 && new URL(x.endpoint).protocol === 'https:' && typeof x.keys?.p256dh === 'string' && /^[A-Za-z0-9_-]+$/.test(x.keys.p256dh) && Buffer.from(x.keys.p256dh, 'base64url').length === 65 && typeof x.keys?.auth === 'string' && /^[A-Za-z0-9_-]+$/.test(x.keys.auth) && Buffer.from(x.keys.auth, 'base64url').length === 16 } catch { return false } }
  const [start, end] = opts.quietHours.split('-').map(Number)
  return { flush: () => queue, publicKey: keys.publicKey,
    add: (x: any) => mutate(async () => { if (!valid(x)) return false; const id = hash(x.endpoint); if (!subscriptions[id] && Object.keys(subscriptions).length >= 20) return false; subscriptions[id] = { endpoint: x.endpoint, keys: x.keys }; await atomic(path, subscriptions); return true }),
    remove: (endpoint: string) => mutate(async () => { delete subscriptions[hash(endpoint)]; await atomic(path, subscriptions) }),
    send: (item: Item) => mutate(async () => {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(now()))
      if (start < end ? hour >= start && hour < end : start > end && (hour >= start || hour < end)) return { pushSkipped: 'quiet' as const }
      const list = Object.entries(subscriptions); if (!list.length) return { pushSkipped: 'no-subscriptions' as const }
      let errors = 0, sent = 0, changed = false
      for (const [key, sub] of list) try { await (opts.sender ?? webPush.sendNotification)(sub, JSON.stringify({ ...summarizePush(item, opts.minimal), tag: item.eventId, url: `/kohako/home.html?notification=${encodeURIComponent(item.eventId)}` }), { TTL: 86400, urgency: 'normal', vapidDetails: { subject: opts.subject, ...keys! } }); sent++ } catch (e) { errors++; if ([404,410].includes((e as { statusCode?: number }).statusCode ?? 0)) { delete subscriptions[key]; changed = true } }
      if (changed) await atomic(path, subscriptions)
      return sent ? { pushedAt: new Date(now()).toISOString() } : { pushSkipped: 'error' as const }
    })
  }
}
