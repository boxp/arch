import { expect, it, vi } from 'vitest'
import { createVoicePlayer, splitVoiceSentences } from './voice'
import { splitSentences } from '../live2d/acting'
const tick = () => new Promise(r => setTimeout(r, 0))
function setup(fetcher: typeof fetch) {
  const audio = { src: '', duration: 2, onplaying: null as null | (() => void), onended: null as null | (() => void), onerror: null as null | (() => void), play: vi.fn(async () => { audio.onplaying?.() }), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(() => { audio.src = '' }) }
  const revoke = vi.fn(), player = createVoicePlayer({ fetcher, audio: audio as unknown as HTMLAudioElement, createUrl: vi.fn(() => 'blob:test'), revokeUrl: revoke, retryDelay: async () => {} })
  const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  return { audio, player, events, revoke }
}
it('plays in order and prefetches at most one sentence', async () => {
  const fetcher = vi.fn(async () => new Response('wav')) as unknown as typeof fetch, { audio, player, events, revoke } = setup(fetcher)
  player.speak(['one', 'two', 'three'], events); await tick(); expect(fetcher).toHaveBeenCalledTimes(2); expect(events.onSentence).toHaveBeenCalledWith(0, 'one', 2)
  audio.onended?.(); await tick(); expect(fetcher).toHaveBeenCalledTimes(3); expect(events.onSentence).toHaveBeenCalledWith(1, 'two', 2)
  audio.onended?.(); await tick(); audio.onended?.(); await tick(); expect(events.onEnd).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledTimes(3)
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
  const text = 'あ'.repeat(200) + '、' + 'い'.repeat(350); const chunks = splitVoiceSentences([text]); expect(chunks.join('')).toBe(text); expect(chunks.every(x => x.length <= 300)).toBe(true); expect(chunks[0].endsWith('、')).toBe(true)
})

it('preserves a long novel through both splitters', () => {
  const text = ('「第123話！」彼女は驚いた……！？\n数字42と記号＠。\n'.repeat(80) + '長'.repeat(400)).trim()
  const sentences = splitSentences(text), chunks = splitVoiceSentences(sentences)
  expect(chunks.join('')).toBe(text); expect(sentences.every(s => Array.from(s).length <= 120)).toBe(true); expect(chunks.every(s => s.length <= 300)).toBe(true)
})
it('retries once, tracks completion and resumes without earlier fetches', async () => {
  const calls: string[] = []
  const fetcher = vi.fn(async (_url, init) => { const value = JSON.parse(String(init?.body)).text; calls.push(value); return new Response('wav', { status: value === 'b' && calls.filter(x => x === 'b').length === 1 ? 503 : 200 }) }) as unknown as typeof fetch
  const { player, audio, events } = setup(fetcher), onChunkEnd = vi.fn()
  player.speak(['a', 'b', 'c'], { ...events, onChunkEnd }); await tick(); audio.onended?.(); await tick(); audio.onended?.(); await tick(); audio.onended?.(); await tick()
  expect(calls).toEqual(['a', 'b', 'b', 'c']); expect(onChunkEnd.mock.calls.map(x => x[0])).toEqual([0, 1, 2]); expect(events.onEnd).toHaveBeenCalledOnce()
  calls.length = 0; player.speak(['a', 'b', 'c'], events, 1); await tick(); expect(calls).not.toContain('a'); const ended = audio.onended; player.cancel(); ended?.(); await tick(); expect(events.onEnd).toHaveBeenCalledOnce()
})
it('reports the index after two failed fetches', async () => {
  const fetcher = vi.fn(async (_url, init) => new Response('wav', { status: JSON.parse(String(init?.body)).text === 'b' ? 500 : 200 })) as unknown as typeof fetch
  const { player, audio, events } = setup(fetcher); player.speak(['a', 'b'], events); await tick(); audio.onended?.(); await tick()
  expect(fetcher).toHaveBeenCalledTimes(3); expect(events.onError).toHaveBeenCalledWith('fetch_failed', 1)
})
it('calls fetcher without a receiver so window.fetch does not throw Illegal invocation (BOXP-522)', async () => {
  // Chrome の window.fetch は this が Window/undefined 以外だと送信前に TypeError: Illegal invocation を投げる。
  const fetcher = vi.fn(function (this: unknown) { if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"); return Promise.resolve(new Response('wav')) }) as unknown as typeof fetch
  const { player, events } = setup(fetcher)
  player.speak(['one'], events); await tick(); expect(events.onError).not.toHaveBeenCalled(); expect(events.onSentence).toHaveBeenCalledWith(0, 'one', 2)
})
