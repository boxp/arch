import { expect, it, vi } from 'vitest'
import { createVoicePlayer, splitVoiceSentences, VOICE_CHUNK_MAX } from './voice'
import { splitSentences } from '../live2d/acting'
const tick = () => new Promise(r => setTimeout(r, 0))
function setup(fetcher: typeof fetch) {
  const audio = { src: '', duration: 2, onplaying: null as null | (() => void), onended: null as null | (() => void), onerror: null as null | (() => void), play: vi.fn(async () => { audio.onplaying?.() }), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(() => { audio.src = '' }) }
  const revoke = vi.fn(), player = createVoicePlayer({ fetcher, audio: audio as unknown as HTMLAudioElement, createUrl: vi.fn(() => 'blob:test'), revokeUrl: revoke, retryDelay: async () => {} })
  const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  return { audio, player, events, revoke }
}
it('groups contiguous units, prefetches up to two in parallel after the first, and resumes from a unit', async () => {
  const units = ['最初。', ...Array.from({ length: 8 }, (_, i) => String(i).repeat(55) + '。')]
  const calls: string[] = [], resolvers: ((r: Response) => void)[] = []
  let active = 0, maxActive = 0
  const fetcher = vi.fn((_url, init) => { calls.push(JSON.parse(String(init?.body)).text); active++; maxActive = Math.max(maxActive, active); return new Promise<Response>(resolve => resolvers.push(r => { active--; resolve(r) })) }) as unknown as typeof fetch
  const { player, audio, events } = setup(fetcher), onChunkEnd = vi.fn()
  player.speak(units, { ...events, onChunkEnd }, 1)
  expect(calls).toEqual([units[1]])
  resolvers.shift()!(new Response('wav')); await tick()
  expect(calls).toHaveLength(3)
  resolvers.shift()!(new Response('wav')); await tick()
  expect(calls).toHaveLength(4)
  resolvers.shift()!(new Response('wav')); await tick()
  expect(calls).toHaveLength(4)
  while (!events.onEnd.mock.calls.length) {
    audio.onended?.(); await tick()
    while (resolvers.length) { resolvers.shift()!(new Response('wav')); await tick() }
  }
  expect(maxActive).toBe(2)
  expect(calls.join('')).toBe(units.slice(1).join(''))
  expect(calls.every(x => x.length <= 160)).toBe(true)
  expect(onChunkEnd.mock.calls.map(x => x[0])).toEqual([1, 3, 5, 7, 8])
  expect(events.onSentence.mock.calls.map(x => x[0])).toEqual([1, 2, 4, 6, 8])
})
it('cancel prevents stale fetch and playback', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r })) as unknown as typeof fetch, { audio, player, events } = setup(fetcher)
  player.speak(['old'], events); player.cancel(); resolve(new Response('wav')); await tick(); expect(audio.play).not.toHaveBeenCalled(); expect(events.onSentence).not.toHaveBeenCalled()
  player.speak(['new'], events); resolve(new Response('wav')); await tick(); expect(audio.play).toHaveBeenCalledTimes(1); const ended = audio.onended; player.cancel(); ended?.(); await tick(); expect(events.onEnd).not.toHaveBeenCalled()
})
it('reports errors and splits long sentences', async () => {
  const { player, events } = setup((async () => new Response('', { status: 500 })) as typeof fetch)
  player.speak(['x'], events); await tick(); expect(events.onError).toHaveBeenCalledWith('fetch_failed', 0)
  const text = 'あ'.repeat(40) + '、' + 'い'.repeat(350); const chunks = splitVoiceSentences([text]); expect(chunks.join('')).toBe(text); expect(chunks.every(x => x.length <= VOICE_CHUNK_MAX)).toBe(true); expect(chunks[0].endsWith('、')).toBe(true)
})

it('preserves a long novel through both splitters', () => {
  const text = ('「第123話！」彼女は驚いた……！？\n数字42と記号＠。\n'.repeat(80) + '長'.repeat(400)).trim()
  const sentences = splitSentences(text), chunks = splitVoiceSentences(sentences)
  expect(chunks.join('')).toBe(text); expect(sentences.every(s => Array.from(s).length <= 120)).toBe(true); expect(chunks.every(s => s.length <= VOICE_CHUNK_MAX)).toBe(true)
})
it('retries once and reports the failed group index', async () => {
  const calls: string[] = []
  const fetcher = vi.fn(async (_url, init) => { const value = JSON.parse(String(init?.body)).text; calls.push(value); return new Response('wav', { status: value.startsWith('b') ? 500 : 200 }) }) as unknown as typeof fetch
  const { player, audio, events } = setup(fetcher)
  player.speak(['a', 'b'.repeat(60), 'c'.repeat(60)], events); await tick(); audio.onended?.(); await tick()
  expect(calls).toEqual(['a', 'b'.repeat(60) + 'c'.repeat(60), 'b'.repeat(60) + 'c'.repeat(60)])
  expect(events.onError).toHaveBeenCalledWith('fetch_failed', 1)
})
it('calls fetcher without a receiver so window.fetch does not throw Illegal invocation (BOXP-522)', async () => {
  // Chrome の window.fetch は this が Window/undefined 以外だと送信前に TypeError: Illegal invocation を投げる。
  const fetcher = vi.fn(function (this: unknown) { if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"); return Promise.resolve(new Response('wav')) }) as unknown as typeof fetch
  const { player, events } = setup(fetcher)
  player.speak(['one'], events); await tick(); expect(events.onError).not.toHaveBeenCalled(); expect(events.onSentence).toHaveBeenCalledWith(0, 'one', 2)
})
it('extends past 120 only to finish an unfinished sentence and stops at 160', async () => {
  const units = ['first。', 'あ'.repeat(60), 'い'.repeat(60), 'う'.repeat(39) + '。', '終わり。']
  const calls: string[] = []
  const fetcher = vi.fn(async (_url, init) => { calls.push(JSON.parse(String(init?.body)).text); return new Response('wav') }) as unknown as typeof fetch
  const { player, audio } = setup(fetcher)
  player.speak(units, { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }); await tick()
  audio.onended?.(); await tick(); audio.onended?.(); await tick(); audio.onended?.(); await tick()
  expect(calls).toEqual(['first。', units[1] + units[2] + units[3], units[4]])
  player.cancel()
})
it('cancel discards buffered audio and aborts the in-flight request', async () => {
  const pending: { resolve: (r: Response) => void; signal: AbortSignal }[] = []
  const fetcher = vi.fn((_url, init) => new Promise<Response>(resolve => pending.push({ resolve, signal: init!.signal as AbortSignal }))) as unknown as typeof fetch
  const { player, audio, events } = setup(fetcher)
  player.speak(['a', ...Array(5).fill('あ'.repeat(60) + '。')], events)
  pending[0].resolve(new Response('wav')); await tick()
  pending[1].resolve(new Response('wav')); await tick()
  expect(pending).toHaveLength(4)
  const ended = audio.onended; player.cancel(); expect(pending[2].signal.aborted && pending[3].signal.aborted).toBe(true)
  pending[2].resolve(new Response('wav')); pending[3].resolve(new Response('wav')); ended?.(); await tick()
  expect(audio.play).toHaveBeenCalledTimes(1); expect(events.onEnd).not.toHaveBeenCalled(); expect(events.onError).not.toHaveBeenCalled()
})
