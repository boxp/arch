import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createTts, KOHAKU } from './tts.js'
import { createApp } from './app.js'
const speakers = (styles = [{ name: 'ノーマル', id: 7 }], uuid = KOHAKU.speakerUuid) => [{ speaker_uuid: uuid, styles }]
const response = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } })
it('selects UUID and style and caches only success', async () => {
  let data = speakers([{ name: 'あまあま', id: 1 }]), now = 0
  const fetcher = vi.fn(async () => response(data)) as unknown as typeof fetch, t = createTts({ url: 'http://tts', fetcher, now: () => now })
  await expect(t.resolveStyle()).rejects.toMatchObject({ code: 'voice_unavailable' })
  data = speakers([{ name: 'ノーマル', id: 3 }], 'other'); await expect(t.resolveStyle()).rejects.toMatchObject({ code: 'voice_unavailable' })
  data = speakers(); expect(await t.resolveStyle()).toBe(7); expect(await t.resolveStyle()).toBe(7); expect(fetcher).toHaveBeenCalledTimes(3)
  now = 600000; expect(await t.resolveStyle()).toBe(7); expect(fetcher).toHaveBeenCalledTimes(4)
})
it('validates, synthesizes and bounds the queue', async () => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const fetcher = vi.fn(async (input: string | URL | Request) => { const url = String(input); if (url.endsWith('/speakers')) return response(speakers()); if (url.includes('audio_query')) { await gate; return response({}) }; return new Response('RIFFdata') }) as unknown as typeof fetch
  const t = createTts({ url: 'http://tts', fetcher, now: Date.now })
  for (const text of ['', ' '.repeat(2), 'a'.repeat(301), 3]) await expect(t.synthesize(text)).rejects.toMatchObject({ code: 'invalid' })
  const jobs = Array.from({ length: 5 }, () => t.synthesize('a'.repeat(300))); await expect(t.synthesize('overflow')).rejects.toMatchObject({ code: 'busy' }); release(); expect((await Promise.all(jobs)).every(x => x.subarray(0, 4).toString() === 'RIFF')).toBe(true)
})
it('enforces route auth and maps errors and conversation flag', async () => {
  let mode = 'ok'
  const fetcher = (async (input: string | URL | Request) => { const url = String(input); if (url.endsWith('/speakers')) return response(mode === 'missing' ? speakers([], 'other') : speakers()); if (mode === 'failed') return new Response('', { status: 500 }); return url.includes('audio_query') ? response({}) : new Response('RIFFdata') }) as typeof fetch
  const tts = createTts({ url: 'http://tts', fetcher, now: Date.now })
  const server = createServer(createApp({ authenticate: async h => h.authorization === 'owner' ? 'owner' : h.authorization === 'verifier' ? 'verifier' : null, tts }))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`, call = (who: string, text?: unknown) => fetch(base + 'tts', { method: text === undefined ? 'GET' : 'POST', headers: { authorization: who, 'content-type': 'application/json' }, ...(text === undefined ? {} : { body: JSON.stringify({ text }) }) })
    expect((await call('none')).status).toBe(401); expect((await call('verifier')).status).toBe(403)
    mode = 'missing'; expect((await call('owner', 'a')).status).toBe(503)
    mode = 'ok'; const ok = await call('owner', 'a'); expect(ok.status).toBe(200); expect(ok.headers.get('x-kohako-tts-style-id')).toBe('7')
    expect((await call('owner', '')).status).toBe(400); mode = 'failed'; expect((await call('owner', 'a')).status).toBe(502)
    expect(await (await fetch(base + 'conversation', { headers: { authorization: 'owner' } })).json()).toMatchObject({ tts: true })
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
