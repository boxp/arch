import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversation } from './conversation.js'
import type { createHermes } from './hermes.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function setup(entry: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-conv-')); dirs.push(dir)
  await writeFile(join(dir, 'conversations-test.json'), JSON.stringify({ sessionStartedAt: 100, lastUse: 100, lastExchange: null, entries: [{ requestId: 'request', payloadHash: 'hash', createdAt: 100, kind: 'text', ...entry }] }))
  let resolve!: (value: { status: 'done'; text: string }) => void
  const watch = vi.fn(() => new Promise<{ status: 'done'; text: string }>(r => { resolve = r }))
  const run = vi.fn(), stop = vi.fn()
  const conv = createConversation({ now: () => 200, prefix: 'test', store: dir, hermes: { run, watch, stop } as unknown as ReturnType<typeof createHermes> })
  await conv.restore(); await conv.flush()
  return { conv, watch, run, resolve: () => resolve({ status: 'done', text: 'hello' }), dir }
}
it('restores a completed reply', async () => {
  const { conv } = await setup({ status: 'done', reply: { text: 'hello', at: 100 } })
  expect(conv.get('request')?.reply?.text).toBe('hello')
})
it('watches a pending run without resending and keeps busy', async () => {
  const { conv, watch, run, resolve } = await setup({ status: 'pending', runId: 'run' })
  await vi.waitFor(() => expect(watch).toHaveBeenCalledOnce())
  expect(run).not.toHaveBeenCalled()
  expect(conv.submit({ requestId: 'other', kind: 'text', text: 'x', expiresAt: 500 }, '')).toEqual({ error: 'busy' })
  resolve(); await vi.waitFor(() => expect(conv.get('request')?.status).toBe('done'))
  expect(conv.get('request')?.reply?.text).toBe('hello')
})
it('marks a pending run without id unknown and rotates session', async () => {
  const { conv, watch } = await setup({ status: 'pending' })
  expect(conv.get('request')).toMatchObject({ status: 'unknown', error: 'bff_restarted' })
  expect(conv.sessionStartedAt).toBe(200); expect(watch).not.toHaveBeenCalled()
})
it('marks a pending attachment run without id unknown so it is not resent blindly', async () => {
  const { conv, watch, run } = await setup({ status: 'pending', attachments: [{ id: 'a', kind: 'text', displayName: 'a.txt' }] })
  expect(conv.get('request')).toMatchObject({ status: 'unknown', error: 'bff_restarted' })
  expect(watch).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled()
})
it('flush waits for the queued snapshot', async () => {
  const { conv, dir } = await setup({ status: 'pending' })
  await conv.flush()
  const state = JSON.parse(await readFile(join(dir, 'conversations-test.json'), 'utf8'))
  expect(state.entries[0]).toMatchObject({ status: 'unknown', error: 'bff_restarted' })
})
it('does not persist notification reply exchanges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-conv-')); dirs.push(dir)
  const run = vi.fn(async () => ({ status: 'done' as const, text: 'notify reply' }))
  const conv = createConversation({ now: () => 200, prefix: 'test', store: dir, hermes: { run, watch: vi.fn(), stop: vi.fn() } as unknown as ReturnType<typeof createHermes> })
  conv.submit({ requestId: 'notify', kind: 'text', text: 'secret notify body', expiresAt: 500 }, '', undefined, { sessionId: 's', idempotencyKey: 'k' })
  await vi.waitFor(() => expect(conv.get('notify')?.status).toBe('done'))
  await conv.flush()
  const raw = await readFile(join(dir, 'conversations-test.json'), 'utf8')
  expect(raw).not.toContain('secret notify body'); expect(raw).not.toContain('notify reply')
  expect(JSON.parse(raw).lastExchange).toBeNull()
})
it('persists cancelRequested and denies approvals after restart instead of showing them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-conv-')); dirs.push(dir)
  const stop1 = vi.fn(async () => 'ok' as const)
  const conv1 = createConversation({ now: () => 200, prefix: 'test', store: dir, cancelSettleMs: 1, hermes: { run: vi.fn((_id, _t, _s, _i, _a, _r, onRun: (id: string) => void) => { onRun('run'); return new Promise(() => {}) }), watch: vi.fn(), stop: stop1, approve: vi.fn(async () => 'ok' as const) } as unknown as ReturnType<typeof createHermes> })
  conv1.submit({ requestId: 'request', kind: 'text', text: 'x', expiresAt: 500 }, '')
  await vi.waitFor(() => expect(conv1.get('request')?.runId).toBe('run'))
  await conv1.cancel('request'); await conv1.flush()
  expect(JSON.parse(await readFile(join(dir, 'conversations-test.json'), 'utf8')).entries[0]).toMatchObject({ status: 'pending', runId: 'run', cancelRequested: true })
  const approve = vi.fn(async () => 'ok' as const), stop = vi.fn(async () => 'ok' as const)
  const watch = vi.fn((_runId: string, onApproval: (runId: string, approval: unknown) => void) => { onApproval('run', { requestId: 'p1', generation: 1, description: 'rm', command: 'rm -rf /tmp/x', choices: ['once', 'deny'] }); return new Promise(() => {}) })
  const conv2 = createConversation({ now: () => 300, prefix: 'test', store: dir, hermes: { run: vi.fn(), watch, stop, approve } as unknown as ReturnType<typeof createHermes> })
  await conv2.restore()
  await vi.waitFor(() => expect(watch).toHaveBeenCalledOnce())
  expect(stop).toHaveBeenCalledWith('run')
  expect(approve).toHaveBeenCalledWith('run', 'deny', 'p1', 1)
  const approval = conv2.get('request')?.approval
  expect(approval).toMatchObject({ consumed: true, choice: 'deny', active: false })
  expect(await conv2.approve('request', approval!.approvalId, 'once')).toBe('approval_conflict')
  await conv2.flush()
})

it('keeps long replies and bounds the context, marking truncation on a code point boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-conv-')); dirs.push(dir)
  const novel = ('「第123話！」記号＠、彼女は言った。'.repeat(150)).slice(0, 2600)
  const long = 'あ'.repeat(23999) + '😀' + 'い'.repeat(6000)
  const run = vi.fn().mockResolvedValueOnce({ status: 'done', text: novel }).mockResolvedValueOnce({ status: 'done', text: long })
  const conv = createConversation({ now: () => 200, prefix: 'test', store: dir, hermes: { run, watch: vi.fn(), stop: vi.fn() } as unknown as ReturnType<typeof createHermes> })
  conv.submit({ requestId: 'one', kind: 'text', text: 'x', expiresAt: 500 }, '')
  await vi.waitFor(() => expect(conv.get('one')?.status).toBe('done'))
  expect(conv.get('one')?.reply?.text).toBe(novel); expect(conv.lastExchange!.reply.length).toBeLessThanOrEqual(1000)
  conv.submit({ requestId: 'two', kind: 'text', text: 'x', expiresAt: 500 }, '')
  await vi.waitFor(() => expect(conv.get('two')?.status).toBe('done'))
  expect(conv.get('two')?.reply?.text).toBe('あ'.repeat(23999) + '\n（返答が長すぎるため、ここから先は省略されました）')
  await conv.flush(); expect(JSON.parse(await readFile(join(dir, 'conversations-test.json'), 'utf8')).lastExchange.reply.length).toBeLessThanOrEqual(1000)
})
