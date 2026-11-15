import { must } from './must.js'
import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createTts, KOHAKU } from './tts.js'
import { createApp } from './app.js'
const speakers = (styles = [{ name: 'ノーマル', id: 7 }], uuid = KOHAKU.speakerUuid) => [{ speaker_uuid: uuid, styles }]
const response = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } })
it('selects UUID and style and caches only success', async () => {
  let data = speakers([{ name: 'あまあま', id: 1 }]),
    now = 0
  const fetcher = vi.fn(async () => response(data)) as unknown as typeof fetch,
    t = createTts({ url: 'http://tts', fetcher, now: () => now })
  await expect(t.resolveStyle()).rejects.toMatchObject({ code: 'voice_unavailable' })
  data = speakers([{ name: 'ノーマル', id: 3 }], 'other')
  await expect(t.resolveStyle()).rejects.toMatchObject({ code: 'voice_unavailable' })
  data = speakers()
  expect(await t.resolveStyle()).toBe(7)
  expect(await t.resolveStyle()).toBe(7)
  expect(fetcher).toHaveBeenCalledTimes(3)
  now = 600000
  expect(await t.resolveStyle()).toBe(7)
  expect(fetcher).toHaveBeenCalledTimes(4)
})
it('validates, synthesizes and bounds the queue', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/speakers')) return response(speakers())
    if (url.includes('audio_query')) {
      await gate
      return response({})
    }
    return new Response('RIFFdata')
  }) as unknown as typeof fetch
  const t = createTts({ url: 'http://tts', fetcher, now: Date.now })
  for (const text of ['', ' '.repeat(2), 'a'.repeat(301), 3])
    await expect(t.synthesize(text)).rejects.toMatchObject({ code: 'invalid' })
  const jobs = Array.from({ length: 5 }, () => t.synthesize('a'.repeat(300)))
  await expect(t.synthesize('overflow')).rejects.toMatchObject({ code: 'busy' })
  release()
  expect((await Promise.all(jobs)).every((x) => x.subarray(0, 4).toString() === 'RIFF')).toBe(true)
})
it('enforces route auth and maps errors and conversation flag', async () => {
  let mode = 'ok'
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/speakers')) return response(mode === 'missing' ? speakers([], 'other') : speakers())
    if (mode === 'failed') return new Response('', { status: 500 })
    return url.includes('audio_query') ? response({}) : new Response('RIFFdata')
  }) as typeof fetch
  const tts = createTts({ url: 'http://tts', fetcher, now: Date.now })
  const server = createServer(
    createApp({
      authenticate: async (h) =>
        h.authorization === 'owner'
          ? 'owner'
          : h.authorization === 'verifier'
            ? 'verifier'
            : h.authorization === 'notifier'
              ? 'notifier'
              : null,
      tts,
    }),
  )
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`,
      call = (who: string, text?: unknown) =>
        fetch(`${base}tts`, {
          method: text === undefined ? 'GET' : 'POST',
          headers: { authorization: who, 'content-type': 'application/json' },
          ...(text === undefined ? {} : { body: JSON.stringify({ text }) }),
        })
    expect((await call('none')).status).toBe(401)
    expect((await call('notifier')).status).toBe(403)
    mode = 'missing'
    expect((await call('owner', 'a')).status).toBe(503)
    mode = 'ok'
    const ok = await call('owner', 'a')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('x-kohako-tts-style-id')).toBe('7')
    const v = await call('verifier', 'a')
    expect(v.status).toBe(200)
    expect(v.headers.get('content-type')).toBe('audio/wav')
    expect((await call('owner', '')).status).toBe(400)
    mode = 'failed'
    expect((await call('owner', 'a')).status).toBe(502)
    expect(await (await fetch(`${base}conversation`, { headers: { authorization: 'owner' } })).json()).toMatchObject({
      tts: true,
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})
it('drops cancelled waiting jobs from the queue and aborts the active fetch', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
      release = r
    }),
    texts: string[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/speakers')) return response(speakers())
    if (url.includes('audio_query')) {
      texts.push(new URL(url).searchParams.get('text') ?? '')
      if (texts.length === 1)
        await Promise.race([
          gate,
          new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Error('aborted')))),
        ])
      return response({})
    }
    return new Response('RIFFdata')
  }) as unknown as typeof fetch
  const t = createTts({ url: 'http://tts', fetcher, now: Date.now })
  const first = new AbortController(),
    waiting = new AbortController()
  const a = t.synthesize('first', first.signal),
    b = t.synthesize('stale', waiting.signal),
    c = t.synthesize('next')
  await new Promise((r) => setTimeout(r, 0))
  waiting.abort()
  await expect(b).rejects.toMatchObject({ code: 'cancelled' })
  first.abort()
  await expect(a).rejects.toMatchObject({ code: 'cancelled' })
  expect((await c).subarray(0, 4).toString()).toBe('RIFF')
  release()
  expect(texts).toEqual(['first', 'next'])
  await expect(t.synthesize('x', AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
})
it('aborts an uncached /speakers lookup when the active request is cancelled', async () => {
  let speakersCalls = 0
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/speakers')) {
      speakersCalls++
      if (speakersCalls === 1)
        return await new Promise<Response>((_, rej) =>
          init?.signal?.addEventListener('abort', () => rej(Error('aborted'))),
        )
      return response(speakers())
    }
    return url.includes('audio_query') ? response({}) : new Response('RIFFdata')
  }) as unknown as typeof fetch
  const t = createTts({ url: 'http://tts', fetcher, now: Date.now })
  const first = new AbortController(),
    a = t.synthesize('first', first.signal),
    b = t.synthesize('next')
  await new Promise((r) => setTimeout(r, 0))
  first.abort()
  await expect(a).rejects.toMatchObject({ code: 'cancelled' })
  expect((await b).subarray(0, 4).toString()).toBe('RIFF')
})
it('runs up to the configured number of syntheses at once and queues the rest (BOXP-522)', async () => {
  const releases: (() => void)[] = []
  let running = 0,
    maxRunning = 0
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/speakers')) return response(speakers())
    if (url.includes('audio_query')) {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise<void>((r) => releases.push(r))
      running--
      return response({})
    }
    return new Response('RIFFdata')
  }) as unknown as typeof fetch
  const t = createTts({ url: 'http://tts', fetcher, now: Date.now, concurrency: 2 })
  const jobs = ['a', 'b', 'c'].map((x) => t.synthesize(x))
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  expect(maxRunning).toBe(2)
  must(releases.shift())()
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  while (releases.length) must(releases.shift())()
  await vi.waitFor(() => expect(releases).toHaveLength(0))
  expect((await Promise.all(jobs)).every((x) => x.subarray(0, 4).toString() === 'RIFF')).toBe(true)
  expect(maxRunning).toBe(2)
})
