// BOXP-715: 期待値は vault の Projects/kohako-home/tts-trial-voice-spec.md（家の画面）から取る。
import { expect, it, vi } from 'vitest'
import { createVoicePlayer } from './voice'
import { defaults, parsePrefs } from './prefs'

it('keeps コハク as the default and accepts the trial voice drama3', () => {
  expect(defaults.voice).toBe('kohaku')
  expect(parsePrefs(null).voice).toBe('kohaku')
  expect(parsePrefs('{"voice":"drama3"}').voice).toBe('drama3')
  expect(parsePrefs('{"voice":"browser"}').voice).toBe('browser')
  expect(parsePrefs('{"voice":"other"}').voice).toBe('kohaku')
})

function player(voice?: () => 'kohaku' | 'drama3') {
  const bodies: unknown[] = []
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response('wav')
  }) as unknown as typeof fetch
  const audio = {
    src: '',
    duration: 1,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  }
  const p = createVoicePlayer({
    fetcher,
    audio: audio as unknown as HTMLAudioElement,
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
    ...(voice ? { voice } : {}),
  })
  return { p, bodies }
}

it('sends voice drama3 only when the trial voice is chosen', async () => {
  const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  const a = player(() => 'drama3')
  a.p.speak(['おはよう。'], events, 0)
  await vi.waitFor(() => expect(a.bodies).toHaveLength(1))
  expect(a.bodies[0]).toEqual({ text: 'おはよう。', voice: 'drama3' })
  a.p.cancel()
  const b = player(() => 'kohaku')
  b.p.speak(['おはよう。'], events, 0)
  await vi.waitFor(() => expect(b.bodies).toHaveLength(1))
  expect(b.bodies[0]).toEqual({ text: 'おはよう。' })
  b.p.cancel()
  const c = player()
  c.p.speak(['おはよう。'], events, 0)
  await vi.waitFor(() => expect(c.bodies).toHaveLength(1))
  expect(c.bodies[0]).toEqual({ text: 'おはよう。' })
  c.p.cancel()
})
