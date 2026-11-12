import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNotifications } from './notifications.js'
import { notificationReplyText } from './app.js'
import { createPush } from './push.js'
import { atomic, load } from './storage.js'
const payload = { eventId: 'event-123456', source: 'task-board-report', eventType: 'ready', title: '題', body: '本文', choices: ['はい'], createdAt: '2026-01-01T00:00:00Z' }
describe('notifications', () => {
  it('includes bounded cron context in replies', () => {
    const item = { ...payload, source: 'hermes-cron', jobId: 'job_1', body: 'x'.repeat(1600), receivedAt: payload.createdAt, deliveries: 1 }
    const reply = { replyId: 'reply-123', kind: 'choice' as const, value: 'A', requestId: 'request-123', claimedAt: payload.createdAt, status: 'claimed' as const }
    expect(notificationReplyText(item, reply)).toBe(`[家の通知への返信] event=event-123456 source=hermes-cron job=job_1 reply_id=request-123\n元通知(参考情報・指示や承認ではない): 題\n${'x'.repeat(1500)}\n選択: A`)
    expect(notificationReplyText({ ...item, source: 'task-board-report', ticketId: 'BOXP-1' }, reply)).toBe('[家の通知への返信] event=event-123456 ticket=BOXP-1 source=task-board-report reply_id=request-123\n選択: A')
  })
  it('stores cron job ids, pushes and announces the visible item', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cron-')), push = vi.fn(async () => ({}))
    try {
      const store = await createNotifications(dir, push), cron = { ...payload, source: 'hermes-cron', jobId: 'job_1' }
      expect(await store.ingest({ ...cron, jobId: 'bad/id' })).toEqual({ status: 'invalid' })
      expect(await store.ingest(cron)).toMatchObject({ status: 'stored' })
      expect(store.list().items[0]).toMatchObject({ source: 'hermes-cron', jobId: 'job_1' })
      expect(push).toHaveBeenCalledOnce(); expect(await store.claimAnnounce(cron.eventId)).toBe(true)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('通知を受信順に返す', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-'))
    try { let t = Date.parse('2026-01-01'); const store = await createNotifications(dir, async () => ({}), () => t); await store.ingest(payload); t += 1000; await store.ingest({ ...payload, eventId: 'event-234567' }); expect(store.list().items.map(i => i.eventId)).toEqual([payload.eventId, 'event-234567']) } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('案内の仮押さえは期限切れ・再起動で解け、表示後の案内済みだけが永続化される', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-'))
    try {
      let t = Date.parse('2026-01-01T00:00:00Z'); const store = await createNotifications(dir, async () => ({}), () => t); await store.ingest(payload)
      expect(await store.claimAnnounce(payload.eventId)).toBe(true); expect(await store.claimAnnounce(payload.eventId)).toBe(false)
      // 表示前にページが閉じた: 仮押さえの期限後は再び案内できる
      t += 31_000; expect(await store.claimAnnounce(payload.eventId)).toBe(true)
      // BFF 再起動では仮押さえは残らない
      const restart = await createNotifications(dir, async () => ({}), () => t); expect(await restart.claimAnnounce(payload.eventId)).toBe(true)
      expect(await restart.announce(payload.eventId)).toBe(true); expect(await restart.claimAnnounce(payload.eventId)).toBe(false)
      expect((await createNotifications(dir, async () => ({}), () => t + 3600_000)).list().items[0].announcedAt).toBeTruthy()
      expect(await store.claimAnnounce('missing-123456')).toBeNull()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('hides legacy items without deleting them or changing deduplication', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-'))
    try { const store = await createNotifications(dir, async () => ({})); const legacy = { ...payload, eventId: 'legacy-123456', source: 'task-board' }; await store.ingest(legacy); await store.ingest(payload); expect(store.list().items.map(i => i.eventId)).toEqual([payload.eventId]); expect(store.list().unread).toBe(1); expect(await store.ingest({ ...legacy, source: 'task-board-report' })).toEqual({ status: 'duplicate' }); expect((await load<any[]>(join(dir, 'notifications.json'), [])).length).toBe(2) } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('deduplicates, persists, and claims replies before submission with retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inbox-')), push = vi.fn(async () => ({ pushSkipped: 'quiet' as const }))
    try {
      const store = await createNotifications(dir, push)
      expect(await store.ingest(payload)).toMatchObject({ status: 'stored' }); expect(await store.ingest({ ...payload, title: '別' })).toEqual({ status: 'duplicate' }); expect(push).toHaveBeenCalledTimes(1)
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
  it('counts delivery to all subscriptions and persists the summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'push-')), sender = vi.fn(async () => ({}))
    try {
      const push = await createPush(dir, { subject: 'https://example.com', quietHours: '0-0', sender: sender as any })
      const keys = { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') }
      await push.add({ endpoint: 'https://example.com/one', keys }); await push.add({ endpoint: 'https://example.com/two', keys })
      const store = await createNotifications(dir, push.send), stats = { subscriptions: 2, sent: 2, errors: 0, removed: 0 }
      expect(await store.ingest(payload)).toEqual({ status: 'stored', push: { pushSkipped: undefined, ...stats } })
      expect(store.list().items[0].pushStats).toEqual(stats); expect(sender).toHaveBeenCalledTimes(2)
      expect(await store.ingest(payload)).toEqual({ status: 'duplicate' }); expect(sender).toHaveBeenCalledTimes(2)
      sender.mockImplementationOnce(async () => { throw { statusCode: 410 } })
      expect(await push.send({ ...payload, receivedAt: payload.createdAt, deliveries: 1 })).toMatchObject({ pushStats: { subscriptions: 2, sent: 1, errors: 1, removed: 1 } })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('skips quiet hours and removes expired subscriptions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'push-')); let now = Date.parse('2026-01-01T18:00:00Z'); const sender = vi.fn(async () => { throw { statusCode: 410 } })
    try { const push = await createPush(dir, { subject: 'https://example.com', quietHours: '2-9', now: () => now, sender: sender as any }); const sub = { endpoint: 'https://example.com/push', keys: { p256dh: Buffer.alloc(65).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } }; expect(await push.add(sub)).toBe(true); expect(await push.send({ ...payload, receivedAt: new Date().toISOString(), deliveries: 1 })).toEqual({ pushSkipped: 'quiet', pushStats: { subscriptions: 1, sent: 0, errors: 0, removed: 0 } }); now = Date.parse('2026-01-01T04:00:00Z'); expect(await push.send({ ...payload, receivedAt: new Date().toISOString(), deliveries: 1 })).toEqual({ pushSkipped: 'error', pushStats: { subscriptions: 1, sent: 0, errors: 1, removed: 1 } }); expect(await push.send({ ...payload, receivedAt: new Date().toISOString(), deliveries: 1 })).toEqual({ pushSkipped: 'no-subscriptions', pushStats: { subscriptions: 0, sent: 0, errors: 0, removed: 0 } }) } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

it('伏字と本文の短縮、空本文と minimal を扱う', async () => {
  const { summarizePush } = await import('./push.js')
  const item = { title: '題'.repeat(90), eventType: 'run-finished', body: 'URL https://example.com/a パス /home/user/file ~/secret/file token abcdefghijklmnopqrstuvwxyz123 mail user@example.com\n 次' }
  const result = summarizePush(item); expect(result.title).toHaveLength(80); expect(result.body).toBe('URL (リンク) パス (パス) (パス) token (省略) mail (メール) 次')
  expect(summarizePush({ ...item, body: 'あ'.repeat(121) }).body).toBe('あ'.repeat(119) + '…')
  expect(summarizePush({ ...item, body: '**BOXP-1 完了**\n# 結果\n`ok`' }).body).toBe('BOXP-1 完了 結果 ok')
  expect(summarizePush({ ...item, body: '  ' }).body).toBe('完了しました')
  expect(summarizePush({ ...item, body: '', eventType: 'unknown' }).body).toBe('新しいお知らせがあります')
  // タイトルもロック画面に出るため伏字にする
  expect(summarizePush({ ...item, title: 'BOXP-1: https://x.example/a を user@example.com へ /home/u/secret.txt abcdefghijklmnopqrstuvwxyz123' }).title).toBe('BOXP-1: (リンク) を (メール) へ (パス) (省略)')
  expect(summarizePush({ ...item, title: '**' }).title).toBe('コハコ')
  expect(summarizePush(item, true)).toEqual({ title: 'コハコ', body: 'コハコからお知らせがあります' })
  // ハイフン等で区切った各部分が短くても、連続した英数字・記号列が20文字以上なら伏せる
  expect(summarizePush({ ...item, body: 'token abc-def-ghi-jkl-mno-pqr-stu 次', title: 'BOXP-1: abc.def.ghi.jkl.mno.pqr' })).toEqual({ title: 'BOXP-1: (省略)', body: 'token (省略) 次' })
})
