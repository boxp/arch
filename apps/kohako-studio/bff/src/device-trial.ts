import { randomUUID } from 'node:crypto'
import { isRecord } from './untrusted.js'

/**
 * BOXP-752: 家から本人の端末へ Web Push を送り、通知のタップで決まった公開施設の地図を 1 回だけ開く試験（段0）。
 * 仕様: Obsidian Projects/kohako-device-delegation/trial-spec.md（spec_feature: kohako-device-trial）。
 * 起点は本人の操作だけ。行き先は下の固定の一覧から選ぶだけで、URL・文字列・コマンドは受け付けない。
 */
export const PLACES: Readonly<Record<string, string>> = Object.freeze({
  tocho: '東京都庁',
  'tokyo-station': '東京駅',
  kahaku: '国立科学博物館',
  ndl: '国立国会図書館',
})
export const DEFAULT_PLACE = 'tocho'
export const TTL_MS = 120_000
export const HOURLY_LIMIT = 10
export const HISTORY = 50
export const SEND_TIMEOUT_MS = 15_000
export const mapUrl = (name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`

export type DeviceState = 'pending' | 'opened' | 'expired' | 'cancelled'
export type Via = 'notification' | 'page'
export type PushOutcome = { sent: number; errors: number; skipped?: 'no-subscriptions' | 'error' }
export type DevicePush = {
  title: string
  body: string
  tag: string
  url: string
  kind: 'device-request'
  requestId: string
}
type Req = {
  id: string
  place: string
  createdAt: number
  expiresAt: number
  state: DeviceState
  endedAt?: number
  via?: Via
  push?: PushOutcome
}
type Saved = { stopped: boolean; requests: Req[]; created: number[] }
type Result = { status: number; error?: string }

const ERROR: Record<Exclude<DeviceState, 'pending'>, { status: number; error: string }> = {
  opened: { status: 409, error: 'already_opened' },
  expired: { status: 410, error: 'expired' },
  cancelled: { status: 409, error: 'cancelled' },
}
const validPlace = (p: unknown): p is string => typeof p === 'string' && Object.hasOwn(PLACES, p)

function parse(x: unknown): Saved {
  const empty: Saved = { stopped: false, requests: [], created: [] }
  if (!isRecord(x)) return empty
  const requests = Array.isArray(x.requests)
    ? x.requests.filter(
        (r): r is Req =>
          isRecord(r) &&
          typeof r.id === 'string' &&
          validPlace(r.place) &&
          typeof r.createdAt === 'number' &&
          typeof r.expiresAt === 'number' &&
          ['pending', 'opened', 'expired', 'cancelled'].includes(r.state as string),
      )
    : []
  const created = Array.isArray(x.created) ? x.created.filter((n): n is number => typeof n === 'number') : []
  // 停止が読めない時は止めた側に倒す（決まり 6 の「再起動をまたいで残る」を壊さない）。
  return { stopped: x.stopped !== false, requests, created }
}

export async function createDeviceTrial(opts: {
  store: { load: () => Promise<unknown>; save: (v: Saved) => Promise<void> }
  now: () => number
  send: (msg: DevicePush, ttlSeconds: number) => Promise<PushOutcome>
  id?: () => string
  /** 送信を待つ上限。過ぎたら送信失敗として記録する。 */
  sendTimeoutMs?: number
}) {
  const raw = await opts.store.load()
  const data = raw === undefined || raw === null ? parse({ stopped: false }) : parse(raw)
  const newId = opts.id ?? randomUUID
  const sendTimeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS
  let queue = Promise.resolve()
  const mutate = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  /** 決まり 5: 期限を過ぎた待ちは、見た時に期限切れにする。変えたら true。 */
  const expireNow = () => {
    const t = opts.now()
    let changed = false
    for (const r of data.requests)
      if (r.state === 'pending' && t >= r.expiresAt) {
        r.state = 'expired'
        r.endedAt = r.expiresAt
        changed = true
      }
    return changed
  }
  const save = () => opts.store.save(data)
  const view = (r: Req) => ({
    id: r.id,
    place: r.place,
    name: PLACES[r.place],
    state: r.state,
    createdAt: new Date(r.createdAt).toISOString(),
    expiresAt: new Date(r.expiresAt).toISOString(),
    ...(r.endedAt !== undefined ? { endedAt: new Date(r.endedAt).toISOString() } : {}),
    ...(r.via ? { via: r.via } : {}),
    ...(r.state === 'opened' && r.endedAt !== undefined
      ? { seconds: Math.round((r.endedAt - r.createdAt) / 1000) }
      : {}),
    ...(r.push ? { push: r.push } : {}),
  })
  const settle = (id: string, to: 'opened' | 'cancelled', via?: Via) =>
    mutate(async (): Promise<Result & { url?: string }> => {
      const changed = expireNow()
      const r = data.requests.find((q) => q.id === id)
      if (r?.state !== 'pending' || data.stopped) {
        if (changed) await save()
        if (!r) return { status: 404, error: 'not_found' }
        return r.state === 'pending' ? ERROR.cancelled : ERROR[r.state]
      }
      r.state = to
      r.endedAt = opts.now()
      if (via) r.via = via
      await save()
      return to === 'opened' ? { status: 200, url: mapUrl(PLACES[r.place]) } : { status: 200 }
    })
  return {
    flush: () => queue,
    view: () =>
      mutate(async () => {
        if (expireNow()) await save()
        return {
          stopped: data.stopped,
          ttlSeconds: TTL_MS / 1000,
          places: Object.entries(PLACES).map(([key, name]) => ({ key, name })),
          defaultPlace: DEFAULT_PLACE,
          requests: data.requests.map(view),
        }
      }),
    create: (x: unknown) =>
      mutate(async (): Promise<{ status: 201; request: Req } | { status: 400 | 409 | 429; error: string }> => {
        if (!isRecord(x) || Object.keys(x).some((k) => k !== 'place') || !validPlace(x.place))
          return { status: 400, error: 'invalid' }
        const changed = expireNow(),
          t = opts.now()
        const refuse = data.stopped
          ? ({ status: 409, error: 'stopped' } as const)
          : data.requests.some((r) => r.state === 'pending')
            ? ({ status: 409, error: 'pending_exists' } as const)
            : data.created.filter((c) => t - c < 3600_000).length >= HOURLY_LIMIT
              ? ({ status: 429, error: 'too_many' } as const)
              : undefined
        if (refuse) {
          if (changed) await save()
          return refuse
        }
        const r: Req = { id: newId(), place: x.place, createdAt: t, expiresAt: t + TTL_MS, state: 'pending' }
        data.requests.push(r)
        data.created = [...data.created.filter((c) => t - c < 3600_000), t]
        while (data.requests.length > HISTORY) data.requests.shift()
        await save()
        return { status: 201 as const, request: r }
      }).then(async (made) => {
        if (made.status !== 201) return made
        const r = made.request
        // 送信は操作の順番の外で待つ。応答しない送信が停止・取消・表示を待たせないように（期限つき）。
        let push: PushOutcome
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          push = await Promise.race([
            opts.send(
              {
                title: 'コハコの家（試験）',
                body: `地図で「${PLACES[r.place]}」を開きます。タップで開きます（${TTL_MS / 60_000}分以内）`,
                tag: `device-${r.id}`,
                url: `/kohako/device-trial.html?request=${encodeURIComponent(r.id)}`,
                kind: 'device-request',
                requestId: r.id,
              },
              Math.ceil(TTL_MS / 1000),
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Error('send timeout')), sendTimeoutMs)
            }),
          ])
        } catch {
          push = { sent: 0, errors: 1, skipped: 'error' }
        } finally {
          clearTimeout(timer)
        }
        return mutate(async () => {
          r.push = push
          await save()
          return { status: 201 as const, request: view(r) }
        })
      }),
    open: (id: string, via: Via) => settle(id, 'opened', via),
    cancel: (id: string) => settle(id, 'cancelled'),
    setStopped: (stopped: boolean) =>
      mutate(async (): Promise<Result> => {
        expireNow()
        data.stopped = stopped
        // 決まり 6: 停止で待ちはすべて取消。解除しても戻さない。
        if (stopped)
          for (const r of data.requests)
            if (r.state === 'pending') {
              r.state = 'cancelled'
              r.endedAt = opts.now()
            }
        await save()
        return { status: 200 }
      }),
  }
}
