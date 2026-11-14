import { describe, expect, it } from 'vitest'
import { createHermes } from './hermes.js'
const stream = (...chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close() } }))
describe('Hermes events', () => {
  it('分割されたフレーム、コメント、stream closed を処理する', async () => {
    const events: unknown[] = []; let calls = 0
    const fetcher = (async () => { calls++; return stream(': open\n\nid: 3\nda', 'ta: {"event":"tool.started"}\n\n: keepalive\n\n: stream closed\n\n') }) as typeof fetch
    await createHermes({ url: 'http://h', key: 'k', fetch: fetcher }).events('run1', e => events.push(e), new AbortController().signal)
    expect(events).toEqual([{ event: 'tool.started' }]); expect(calls).toBe(1)
  })
  it('切断後に Last-Event-ID で再開し終端で停止する', async () => {
    const headers: Record<string,string>[] = []; let calls = 0
    const fetcher = (async (_url: unknown, init?: RequestInit) => { headers.push(init!.headers as Record<string,string>); return ++calls === 1 ? stream('id: 7\ndata: {"event":"tool.started"}\n\n') : stream('data: {"event":"run.completed"}\n\n') }) as typeof fetch
    await createHermes({ url: 'http://h', key: 'k', fetch: fetcher, sleep: async () => {} }).events('run1', () => {}, new AbortController().signal)
    expect(headers[1]['Last-Event-ID']).toBe('7'); expect(calls).toBe(2)
  })
  it('404 と abort で再試行しない', async () => { let calls = 0; const fetcher = (async () => { calls++; return new Response(null, { status: 404 }) }) as typeof fetch; const h = createHermes({ url: 'http://h', key: 'k', fetch: fetcher }); await h.events('run1', () => {}, new AbortController().signal); const c = new AbortController(); c.abort(); await h.events('run1', () => {}, c.signal); expect(calls).toBe(1) })
})
