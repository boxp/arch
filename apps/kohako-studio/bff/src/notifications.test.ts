import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNotifications } from './notifications.js'
import { createPush } from './push.js'
import { atomic, load } from './storage.js'
const payload = { eventId: 'event-123456', source: 'task-board', eventType: 'ready', title: '題', body: '本文', choices: ['はい'], createdAt: '2026-01-01T00:00:00Z' }
describe('notifications', () => {
  it('deduplicates, persists, and claims replies before submission with retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-')), push = vi.fn(async () => ({ pushSkipped: 'quiet' as const }))
    try {
      const store = await createNotifications(dir, push)
      expect(await store.ingest(payload)).toBe('stored'); expect(await store.ingest({ ...payload, title: '別' })).toBe('duplicate'); expect(push).toHaveBeenCalledTimes(1)
      const restart = await createNotifications(dir, push); expect(restart.list().items[0]).toMatchObject({ title: '題', deliveries: 2 })
      const reply = { replyId: 'reply-123456', kind: 'choice', value: 'はい' }, submit = vi.fn(() => false)
      const first = await restart.reply(payload.eventId, reply, submit); expect(first.status).toBe('submit_failed')
      expect((await restart.reply(payload.eventId, { ...reply, replyId: 'other-123456' }, submit)).error).toBe('already_replied')
      const retry = await restart.reply(payload.eventId, reply, () => true); expect(retry.requestId).toBe(first.requestId); expect(retry.status).toBe('submitted')
      expect((await restart.reply(payload.eventId, reply, submit)).requestId).toBe(first.requestId); expect(submit).toHaveBeenCalledTimes(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('re-submits a reply whose claim was saved but not sent before a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-')), push = vi.fn(async () => ({}))
    try {
      const store = await createNotifications(dir, push); await store.ingest(payload)
      const reply = { replyId: 'reply-123456', kind: 'choice', value: 'はい' }
      // claim 保存直後に BFF が止まった状態を再現する（submit が戻らないまま保存だけ残る）。
      const items = await load<any[]>(join(dir, 'notifications.json'), [])
      items[0].reply = { ...reply, requestId: 'req-claimed', claimedAt: new Date().toISOString(), status: 'claimed' }; await atomic(join(dir, 'notifications.json'), items)
      const restart = await createNotifications(dir, push), submit = vi.fn(() => true)
      const result = await restart.reply(payload.eventId, reply, submit)
      expect(submit).toHaveBeenCalledTimes(1); expect(submit.mock.calls[0][1]).toMatchObject({ requestId: 'req-claimed', value: 'はい' }); expect(result).toMatchObject({ requestId: 'req-claimed', status: 'submitted' })
      expect((await restart.reply(payload.eventId, reply, submit)).existing).toBe(true); expect(submit).toHaveBeenCalledTimes(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('does not re-submit a claimed reply older than the Hermes idempotency window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-')), push = vi.fn(async () => ({}))
    try {
      const store = await createNotifications(dir, push); await store.ingest(payload)
      const reply = { replyId: 'reply-123456', kind: 'choice', value: 'はい' }
      // Hermes 受理直後・submitted 保存前に BFF が停止し、24h 以上経ってから再送要求が来た状態を再現する。
      const items = await load<any[]>(join(dir, 'notifications.json'), [])
      items[0].reply = { ...reply, requestId: 'req-old', claimedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), status: 'claimed' }; await atomic(join(dir, 'notifications.json'), items)
      const restart = await createNotifications(dir, push), submit = vi.fn(() => true)
      const result = await restart.reply(payload.eventId, reply, submit)
      expect(submit).not.toHaveBeenCalled(); expect(result).toMatchObject({ requestId: 'req-old', status: 'claimed', existing: true, expired: true })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('resumes a submitted reply with the same requestId when the conversation tracker lost it after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-')), push = vi.fn(async () => ({}))
    try {
      const store = await createNotifications(dir, push); await store.ingest(payload)
      const reply = { replyId: 'reply-123456', kind: 'choice', value: 'はい' }, tracked = new Set<string>()
      const first = await store.reply(payload.eventId, reply, (_i, r) => { tracked.add(r.requestId); return true }, id => tracked.has(id))
      expect(first.status).toBe('submitted')
      const again = vi.fn(() => true)
      expect((await store.reply(payload.eventId, reply, again, id => tracked.has(id))).existing).toBe(true); expect(again).not.toHaveBeenCalled()
      // BFF 再起動: 永続 inbox は submitted のまま、会話トラッカー（メモリ）は空になる。
      const restart = await createNotifications(dir, push), after = new Set<string>(), submit = vi.fn((_i: any, r: any) => { after.add(r.requestId); return true })
      const resumed = await restart.reply(payload.eventId, reply, submit, id => after.has(id))
      expect(submit).toHaveBeenCalledTimes(1); expect(resumed).toMatchObject({ requestId: first.requestId, status: 'submitted' }); expect(resumed.existing).toBeUndefined()
      expect((await restart.reply(payload.eventId, reply, submit, id => after.has(id))).existing).toBe(true); expect(submit).toHaveBeenCalledTimes(1)
      expect((await restart.reply(payload.eventId, { ...reply, replyId: 'other-123456' }, submit, () => false)).error).toBe('already_replied')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('skips quiet hours and removes expired subscriptions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'push-')); let now = Date.parse('2026-01-01T18:00:00Z'); const sender = vi.fn(async () => { throw { statusCode: 410 } })
    try { const push = await createPush(dir, { subject: 'https://example.com', quietHours: '2-9', now: () => now, sender: sender as any }); const sub = { endpoint: 'https://example.com/push', keys: { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } }; expect(await push.add(sub)).toBe(true); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'quiet' }); now = Date.parse('2026-01-01T04:00:00Z'); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'error' }); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'no-subscriptions' }) } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
