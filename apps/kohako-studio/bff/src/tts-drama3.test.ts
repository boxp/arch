// BOXP-715: 期待値は vault の Projects/kohako-home/tts-trial-voice-spec.md の例から取る。
import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createDrama3Tts, DRAMA3, createTts, KOHAKU } from './tts.js'
import { createApp } from './app.js'

const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } })
const wav = () => new Response('RIFFdata', { headers: { 'content-type': 'audio/wav' } })

it('sends the text to speech.cpp with the fixed voice and seed', async () => {
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => wav())
  const t = createDrama3Tts({ url: 'http://drama3:8080', fetcher: fetcher as unknown as typeof fetch, now: Date.now })
  const audio = await t.synthesize(' おはよう ')
  expect(audio.subarray(0, 4).toString()).toBe('RIFF')
  const [url, init] = fetcher.mock.calls[0]
  expect(String(url)).toBe('http://drama3:8080/v1/audio/speech')
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toEqual({
    input: 'おはよう',
    voice: 'kohako',
    response_format: 'wav',
    seed: 715,
  })
})

it('validates text, bounds the queue and maps engine errors', async () => {
  let mode = 'ok'
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const fetcher = (async () => {
    if (mode === 'gate') await gate
    if (mode === 'loading') return new Response('', { status: 503 })
    if (mode === 'down') throw TypeError('fetch failed')
    if (mode === 'failed') return new Response('', { status: 500 })
    if (mode === 'notwav') return new Response('hello', { headers: { 'content-type': 'text/plain' } })
    return wav()
  }) as unknown as typeof fetch
  const t = createDrama3Tts({ url: 'http://drama3:8080', fetcher, now: Date.now })
  for (const text of ['', '  ', 'a'.repeat(301), 3])
    await expect(t.synthesize(text)).rejects.toMatchObject({ code: 'invalid' })
  mode = 'loading'
  await expect(t.synthesize('a')).rejects.toMatchObject({ code: 'voice_unavailable' })
  mode = 'down'
  await expect(t.synthesize('a')).rejects.toMatchObject({ code: 'voice_unavailable' })
  mode = 'failed'
  await expect(t.synthesize('a')).rejects.toMatchObject({ code: 'tts_failed' })
  mode = 'notwav'
  await expect(t.synthesize('a')).rejects.toMatchObject({ code: 'tts_failed' })
  mode = 'gate'
  const jobs = Array.from({ length: 5 }, () => t.synthesize('a'))
  await expect(t.synthesize('overflow')).rejects.toMatchObject({ code: 'busy' })
  release()
  expect((await Promise.all(jobs)).length).toBe(5)
  await expect(t.synthesize('x', AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
})

it('reports its status from /health with the Fish Audio credit', async () => {
  let up = true
  const fetcher = (async (input: string | URL | Request) => {
    expect(String(input)).toBe('http://drama3:8080/health')
    return up ? json({ status: 'ok' }) : new Response('', { status: 503 })
  }) as unknown as typeof fetch
  const t = createDrama3Tts({ url: 'http://drama3:8080', fetcher, now: Date.now })
  expect(await t.status()).toMatchObject({ available: true, voice: DRAMA3.label, credit: 'Built with Fish Audio' })
  up = false
  expect(await t.status()).toMatchObject({ available: false, error: 'voice_unavailable' })
})

it('routes the voice field of /tts and keeps コハク as the default', async () => {
  const kohakuCalls: string[] = [],
    drama3Calls: string[] = []
  const tts = createTts({
    url: 'http://tts',
    now: Date.now,
    fetcher: (async (input: string | URL | Request) => {
      const url = String(input)
      kohakuCalls.push(url)
      if (url.endsWith('/speakers'))
        return json([{ speaker_uuid: KOHAKU.speakerUuid, styles: [{ name: 'ノーマル', id: 7 }] }])
      return url.includes('audio_query') ? json({}) : new Response('RIFFdata')
    }) as typeof fetch,
  })
  const drama3 = createDrama3Tts({
    url: 'http://drama3:8080',
    now: Date.now,
    fetcher: (async (input: string | URL | Request) => {
      drama3Calls.push(String(input))
      return String(input).endsWith('/health') ? json({ status: 'ok' }) : wav()
    }) as typeof fetch,
  })
  const auth = async (h: Record<string, unknown>) =>
    h.authorization === 'owner'
      ? 'owner'
      : h.authorization === 'verifier'
        ? 'verifier'
        : h.authorization === 'g2'
          ? 'g2'
          : null
  const start = async (withTrial: boolean) => {
    const server = createServer(
      createApp({
        authenticate: auth as Parameters<typeof createApp>[0]['authenticate'],
        tts,
        ...(withTrial ? { ttsTrial: drama3 } : {}),
      }),
    )
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/tts`
    const post = (who: string, body: unknown) =>
      fetch(base, {
        method: 'POST',
        headers: { authorization: who, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const stop = async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
    return { base, post, stop }
  }
  const a = await start(true)
  try {
    const def = await a.post('owner', { text: 'おはよう' })
    expect(def.status).toBe(200)
    expect(def.headers.get('x-kohako-tts-voice')).toBe('kohaku')
    expect(drama3Calls).toEqual([])
    const k = await a.post('owner', { text: 'おはよう', voice: 'kohaku' })
    expect(k.status).toBe(200)
    expect(k.headers.get('x-kohako-tts-voice')).toBe('kohaku')
    const d = await a.post('owner', { text: 'おはよう', voice: 'drama3' })
    expect(d.status).toBe(200)
    expect(d.headers.get('content-type')).toBe('audio/wav')
    expect(d.headers.get('x-kohako-tts-voice')).toBe('drama3')
    expect(drama3Calls).toEqual(['http://drama3:8080/v1/audio/speech'])
    expect((await a.post('verifier', { text: 'おはよう', voice: 'drama3' })).status).toBe(200)
    expect((await a.post('owner', { text: 'おはよう', voice: 'other' })).status).toBe(400)
    expect((await a.post('owner', { text: 'おはよう', voice: 3 })).status).toBe(400)
    expect((await a.post('g2', { text: 'おはよう', voice: 'drama3' })).status).toBe(403)
    const s = await fetch(`${a.base}?voice=drama3`, { headers: { authorization: 'owner' } })
    expect(await s.json()).toMatchObject({ available: true, credit: 'Built with Fish Audio' })
    const sk = await fetch(a.base, { headers: { authorization: 'owner' } })
    expect(await sk.json()).toMatchObject({ voice: KOHAKU.label })
  } finally {
    await a.stop()
  }
  const b = await start(false)
  try {
    const r = await b.post('owner', { text: 'おはよう', voice: 'drama3' })
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'tts_voice_unavailable' })
    expect((await b.post('owner', { text: 'おはよう' })).status).toBe(200)
  } finally {
    await b.stop()
  }
  expect(kohakuCalls.length).toBeGreaterThan(0)
})
