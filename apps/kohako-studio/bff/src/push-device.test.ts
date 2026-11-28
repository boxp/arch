// BOXP-752: 試験の Push 送信の決まり（trial-spec.md 決まり 11・12）。期待値は仕様から取る。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createPush } from './push.js'

type Sender = NonNullable<Parameters<typeof createPush>[1]['sender']>
const keys = { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') }
const msg = {
  title: 't',
  body: 'b',
  tag: 'device-x',
  url: '/kohako/device-trial.html?request=x',
  kind: 'device-request' as const,
  requestId: 'x',
}
const item = { eventId: 'e1', title: 'お知らせ', body: '本文', eventType: 'run-finished' } as never
const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
const within = <T>(p: Promise<T>, ms = 300) =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

async function setup(sender: Sender, now: () => number, sendTimeoutMs?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'push-device-'))
  dirs.push(dir)
  const push = await createPush(dir, { subject: 'https://example.com', quietHours: '0-0', now, sender, sendTimeoutMs })
  return push
}

it('試験の送信が応答しなくても、家の通知と購読の登録は待たされない', async () => {
  const calls: string[] = []
  const push = await setup(
    (async (_s: { endpoint: string }, payload: string) => {
      calls.push(payload)
      if (payload.includes('device-request')) return new Promise(() => {})
      return {}
    }) as unknown as Sender,
    Date.now,
  )
  expect(await push.add({ endpoint: 'https://example.com/fold', keys })).toBe(true)
  void push.sendDevice(msg, Date.now() + 120_000)
  const sent = await within(push.send(item))
  expect(sent).not.toBe('timeout')
  expect(await within(push.add({ endpoint: 'https://example.com/pc', keys }))).toBe(true)
})

it('応答しない購読先は上限で失敗に数え、ほかの購読先には送る', async () => {
  const push = await setup(
    (async (s: { endpoint: string }) =>
      s.endpoint.endsWith('/stuck') ? new Promise(() => {}) : {}) as unknown as Sender,
    Date.now,
    50,
  )
  await push.add({ endpoint: 'https://example.com/stuck', keys })
  await push.add({ endpoint: 'https://example.com/pc', keys })
  expect(await within(push.sendDevice(msg, Date.now() + 120_000), 1000)).toEqual({ sent: 1, errors: 1 })
})

it('TTL は送る時点での依頼の期限までの残り秒。先の送信が遅くても期限後まで残る TTL を付けない', async () => {
  let t = 1_000_000
  const seen: { at: number; ttl: number }[] = []
  const push = await setup(
    (async (s: { endpoint: string }, _p: string, o: { TTL: number }) => {
      seen.push({ at: t, ttl: o.TTL })
      if (s.endpoint.endsWith('/slow')) {
        await new Promise((r) => setTimeout(r, 20))
        t += 90_000
      }
      return {}
    }) as unknown as Sender,
    () => t,
  )
  await push.add({ endpoint: 'https://example.com/slow', keys })
  await push.add({ endpoint: 'https://example.com/pc', keys })
  const expiresAt = t + 120_000
  t += 10_000
  expect(await push.sendDevice(msg, expiresAt)).toEqual({ sent: 2, errors: 0 })
  expect(seen).toHaveLength(2)
  for (const s of seen) {
    expect(s.ttl).toBeGreaterThan(0)
    expect(s.at + s.ttl * 1000).toBeLessThanOrEqual(expiresAt)
  }
  expect(seen[0].ttl).toBe(110)
})

it('期限を過ぎた依頼の通知は送らない', async () => {
  let n = 0
  const push = await setup(
    (async () => {
      n++
      return {}
    }) as unknown as Sender,
    () => 5_000,
  )
  await push.add({ endpoint: 'https://example.com/pc', keys })
  expect(await push.sendDevice(msg, 5_000)).toEqual({ sent: 0, errors: 0, skipped: 'error' })
  expect(n).toBe(0)
})
