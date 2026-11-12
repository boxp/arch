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
  await conv.restore()
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
it('flush waits for the queued snapshot', async () => {
  const { conv, dir } = await setup({ status: 'pending' })
  await conv.flush()
  const state = JSON.parse(await readFile(join(dir, 'conversations-test.json'), 'utf8'))
  expect(state.entries[0]).toMatchObject({ status: 'unknown', error: 'bff_restarted' })
})
