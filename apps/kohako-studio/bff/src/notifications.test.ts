import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNotifications } from './notifications.js'
import { createPush } from './push.js'
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
  it('skips quiet hours and removes expired subscriptions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'push-')); let now = Date.parse('2026-01-01T18:00:00Z'); const sender = vi.fn(async () => { throw { statusCode: 410 } })
    try { const push = await createPush(dir, { subject: 'https://example.com', quietHours: '2-9', now: () => now, sender: sender as any }); const sub = { endpoint: 'https://example.com/push', keys: { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } }; expect(await push.add(sub)).toBe(true); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'quiet' }); now = Date.parse('2026-01-01T04:00:00Z'); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'error' }); expect(await push.send('event-123456')).toEqual({ pushSkipped: 'no-subscriptions' }) } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
