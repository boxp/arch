import { expect, it, vi } from 'vitest'
import { createVoicePlayer, splitVoiceSentences } from './voice'
const tick = () => new Promise(r => setTimeout(r, 0))
function setup(fetcher: typeof fetch) {
  const audio = { src: '', duration: 2, onplaying: null as null | (() => void), onended: null as null | (() => void), onerror: null as null | (() => void), play: vi.fn(async () => { audio.onplaying?.() }), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(() => { audio.src = '' }) }
  const revoke = vi.fn(), player = createVoicePlayer({ fetcher, audio: audio as unknown as HTMLAudioElement, createUrl: vi.fn(() => 'blob:test'), revokeUrl: revoke })
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
