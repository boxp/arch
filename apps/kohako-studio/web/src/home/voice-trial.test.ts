// BOXP-715: 期待値は vault の Projects/kohako-home/tts-trial-voice-spec.md（家の画面）から取る。
import { expect, it, vi } from 'vitest'
import { createVoicePlayer, replyTextWaitMs, speechHoldsQueue, VOICE_REQUEST_TIMEOUT_MS } from './voice'
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

// BOXP-715 TD-02: 遅い声でも返答を止めない（spec「遅い声でも返答を止めない」の表から）。
it('shows reply text without waiting for drama3 audio, and after 8s for コハク', () => {
  expect(replyTextWaitMs('drama3')).toBe(0)
  expect(replyTextWaitMs('kohaku')).toBe(8000)
  expect(replyTextWaitMs('browser')).toBeNull()
})

function slowPlayer(voice: 'kohaku' | 'drama3', respond: (init?: RequestInit) => Promise<Response>) {
  const bodies: { text: string }[] = []
  let inFlight = 0,
    maxInFlight = 0
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      return await respond(init)
    } finally {
      inFlight--
    }
  }) as unknown as typeof fetch
  const audio = {
    src: '',
    duration: 1,
    onplaying: null as null | (() => void),
    onended: null as null | (() => void),
    play: vi.fn(async function (this: { onplaying: () => void; onended: () => void }) {
      queueMicrotask(() => {
        audio.onplaying?.()
        audio.onended?.()
      })
    }),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  }
  const p = createVoicePlayer({
    fetcher,
    audio: audio as unknown as HTMLAudioElement,
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
    retryDelay: async () => {},
    voice: () => voice,
  })
  return { p, bodies, fetcher, max: () => maxInFlight }
}
const LONG = ['今日の作業をまとめるね。', 'あ'.repeat(37) + '。', 'い'.repeat(50) + '。', 'う'.repeat(53) + '。']

it('sends drama3 one chunk at a time without merging, while コハク keeps merging', async () => {
  const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  const d = slowPlayer('drama3', async () => new Response('wav'))
  d.p.speak(LONG, events, 0)
  await vi.waitFor(() => expect(events.onEnd).toHaveBeenCalled())
  expect(d.bodies.map((b) => b.text)).toEqual(LONG)
  expect(d.max()).toBe(1)
  const k = slowPlayer('kohaku', async () => new Response('wav'))
  const e2 = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  const SHORT = ['あ。', 'い'.repeat(10) + '。', 'う'.repeat(10) + '。', 'え'.repeat(10) + '。']
  k.p.speak(SHORT, e2, 0)
  await vi.waitFor(() => expect(e2.onEnd).toHaveBeenCalled())
  expect(k.bodies.map((x) => x.text)).toEqual([SHORT[0], SHORT.slice(1).join('')])
  const d2 = slowPlayer('drama3', async () => new Response('wav'))
  const e3 = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  d2.p.speak(SHORT, e3, 0)
  await vi.waitFor(() => expect(e3.onEnd).toHaveBeenCalled())
  expect(d2.bodies.map((x) => x.text)).toEqual(SHORT)
})

it('gives up a synthesis request after 90s without retrying and reports the error', async () => {
  vi.useFakeTimers()
  try {
    expect(VOICE_REQUEST_TIMEOUT_MS).toBe(90000)
    const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    const d = slowPlayer(
      'drama3',
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))
        }),
    )
    d.p.speak(['おはよう。'], events, 0)
    await vi.advanceTimersByTimeAsync(89000)
    expect(events.onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.onError).toHaveBeenCalledWith('timeout', 0)
    expect(d.fetcher).toHaveBeenCalledTimes(1)
    expect(events.onEnd).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('still retries once when a request fails quickly (503)', async () => {
  const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
  const d = slowPlayer('drama3', async () => new Response('{}', { status: 503 }))
  d.p.speak(['おはよう。'], events, 0)
  await vi.waitFor(() => expect(events.onError).toHaveBeenCalled())
  expect(d.fetcher).toHaveBeenCalledTimes(2)
})

it('does not hold the next message after a drama3 failure, but keeps holding for コハク and for a pause', () => {
  const r = { remaining: true }
  expect(speechHoldsQueue({ ...r, voice: 'drama3', trouble: true, paused: false })).toBe(false)
  expect(speechHoldsQueue({ ...r, voice: 'kohaku', trouble: true, paused: false })).toBe(true)
  expect(speechHoldsQueue({ ...r, voice: 'drama3', trouble: false, paused: true })).toBe(true)
  expect(speechHoldsQueue({ ...r, voice: 'kohaku', trouble: false, paused: false })).toBe(false)
  expect(speechHoldsQueue({ remaining: false, voice: 'kohaku', trouble: true, paused: true })).toBe(false)
})
