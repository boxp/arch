import { describe, expect, it, vi } from 'vitest'
import { createSentenceSpeaker, createSilentSentencer } from './acting-speech'

describe('文単位の発話', () => {
  it('再生開始に同期し、キャンセル後の通知を無視する', () => {
    const utterances: { onstart: unknown; onend: unknown; onerror: unknown }[] = []
    const synth = { speak: vi.fn(), cancel: vi.fn() }
    const speaker = createSentenceSpeaker({
      synth,
      makeUtterance: () => {
        const u = { onstart: null, onend: null, onerror: null }
        utterances.push(u)
        return u
      },
    })
    const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak(['一', '二'], events)
    expect(events.onSentence).not.toHaveBeenCalled()
    ;(utterances[0].onstart as () => void)()
    expect(events.onSentence).toHaveBeenCalledWith(0, '一')
    ;(utterances[0].onend as () => void)()
    speaker.cancel()
    ;(utterances[1].onstart as () => void)()
    ;(utterances[1].onend as () => void)()
    expect(events.onSentence).toHaveBeenCalledTimes(1)
    expect(events.onEnd).not.toHaveBeenCalled()
  })
  it('外部の中断とその他のエラーを通知する', () => {
    let u = { onstart: null as unknown, onend: null as unknown, onerror: null as unknown }
    const speaker = createSentenceSpeaker({
      synth: { speak() {}, cancel() {} },
      makeUtterance: () => (u = { onstart: null, onend: null, onerror: null }),
    })
    const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    speaker.speak(['一'], events)
    ;(u.onerror as (e: object) => void)({ error: 'interrupted' })
    expect(events.onError).toHaveBeenCalledWith('interrupted')
    speaker.speak(['二'], events)
    const canceled = u
    speaker.cancel()
    ;(canceled.onerror as (e: object) => void)({ error: 'canceled' })
    expect(events.onError).toHaveBeenCalledTimes(1)
    speaker.speak(['二'], events)
    ;(u.onerror as (e: object) => void)({ error: 'network' })
    expect(events.onError).toHaveBeenCalledWith('network')
  })
  it('無音の文を順に進め、キャンセルで止める', () => {
    vi.useFakeTimers()
    try {
      const sentencer = createSilentSentencer({
        setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeout: (id) => clearTimeout(id),
      })
      const events = { onSentence: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
      sentencer.run(['一', '二'], () => 1, events)
      expect(events.onSentence).toHaveBeenCalledWith(0, '一')
      vi.advanceTimersByTime(1000)
      expect(events.onSentence).toHaveBeenCalledWith(1, '二')
      sentencer.cancel()
      vi.runAllTimers()
      expect(events.onEnd).not.toHaveBeenCalled()
      sentencer.run(['一'], () => 1, events)
      vi.runAllTimers()
      expect(events.onEnd).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

it('forwards boundary positions for the active utterance only', () => {
  const utterances: { onstart: unknown; onend: unknown; onerror: unknown; onboundary?: unknown }[] = []
  const speaker = createSentenceSpeaker({
    synth: { speak() {}, cancel() {} },
    makeUtterance: () => {
      const u = { onstart: null, onend: null, onerror: null, onboundary: null }
      utterances.push(u)
      return u
    },
  })
  const onBoundary = vi.fn()
  speaker.speak(['あいう'], { onSentence() {}, onEnd() {}, onError() {}, onBoundary })
  ;(utterances[0].onboundary as (event: { charIndex: number }) => void)({ charIndex: 2 })
  expect(onBoundary).toHaveBeenCalledWith(0, 2)
  speaker.cancel()
  ;(utterances[0].onboundary as (event: { charIndex: number }) => void)({ charIndex: 1 })
  expect(onBoundary).toHaveBeenCalledTimes(1)
})
