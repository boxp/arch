import { describe, expect, it, vi } from 'vitest'
import { appendDictation, createDictation, supportsDictation } from './dictation'

function setup(
  transcribe = vi.fn(
    async (_pcm: Uint8Array): Promise<{ status: number; data: Record<string, unknown> | null }> => ({
      status: 200,
      data: { text: '認識文' },
    }),
  ),
) {
  vi.useFakeTimers()
  const track = { stop: vi.fn() },
    stream = { getTracks: () => [track] } as unknown as MediaStream
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() },
    context = {
      sampleRate: 16000,
      destination: {},
      createMediaStreamSource: () => source,
      createScriptProcessor: () => processor,
      close: vi.fn(async () => {}),
    } as unknown as AudioContext
  const errors: string[] = [],
    texts: string[] = [],
    states: string[] = [],
    auth = vi.fn()
  const getUserMedia = vi.fn(async () => stream)
  const d = createDictation({
    getUserMedia,
    createContext: () => context,
    transcribe,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
    onAuth: auth,
    onText: (t) => texts.push(t),
  })
  const audio = (length: number, value: number) =>
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(length).fill(value) } })
  return { d, audio, track, context, processor, source, errors, texts, transcribe, states, auth, getUserMedia }
}
describe('dictation', () => {
  it('checks support and appends without exceeding the draft limit', () => {
    expect(supportsDictation({ secure: false, getUserMedia: () => {}, audioContext: () => {} })).toBe(false)
    expect(supportsDictation({ secure: true, getUserMedia: () => {}, audioContext: () => {} })).toBe(true)
    expect(appendDictation('草稿', '認識文', 5)).toEqual({ value: '草稿\n認識', truncated: true })
  })
  it('releases resources before uploading and appends the result', async () => {
    const x = setup()
    await x.d.start()
    expect(x.getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    x.audio(8000, 0.1)
    await x.d.stop()
    expect(x.track.stop).toHaveBeenCalledOnce()
    expect(x.context.close).toHaveBeenCalledOnce()
    expect(x.processor.disconnect).toHaveBeenCalledOnce()
    expect(x.transcribe).toHaveBeenCalledOnce()
    expect(x.texts).toEqual(['認識文'])
    expect(x.d.state).toBe('idle')
  })
  it('rejects short and silent clips', async () => {
    const x = setup()
    await x.d.start()
    x.audio(7999, 0.1)
    await x.d.stop()
    expect(x.errors.pop()).toBe('0.5秒以上話してください。')
    await x.d.start()
    x.audio(8000, 0.001)
    await x.d.stop()
    expect(x.errors.pop()).toBe('声が聞き取れませんでした。もう一度お試しください。')
    expect(x.transcribe).not.toHaveBeenCalled()
  })
  it('discards a late transcription after cancellation', async () => {
    let resolve!: (result: { status: number; data: Record<string, unknown> | null }) => void
    const x = setup(
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r
          }),
      ),
    )
    await x.d.start()
    x.audio(8000, 0.1)
    const stopped = x.d.stop()
    while (!x.transcribe.mock.calls.length) await Promise.resolve()
    await x.d.cancel()
    resolve({ status: 200, data: { text: '古い結果' } })
    await stopped
    expect(x.texts).toEqual([])
    expect(x.d.state).toBe('idle')
  })
  it('stops automatically after 30 seconds', async () => {
    const x = setup()
    await x.d.start()
    x.audio(8000, 0.1)
    await vi.advanceTimersByTimeAsync(30000)
    expect(x.transcribe).toHaveBeenCalledOnce()
    expect(x.d.state).toBe('idle')
  })
  it('routes authorization and recognition errors', async () => {
    const x = setup(vi.fn(async () => ({ status: 401, data: null })))
    await x.d.start()
    x.audio(8000, 0.1)
    await x.d.stop()
    expect(x.auth).toHaveBeenCalledWith(401, null)
    expect(x.d.state).toBe('idle')
  })
  it('keeps a newer recording when a cancelled permission request rejects late', async () => {
    const x = setup()
    let reject!: (e: unknown) => void
    x.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r
        }),
    )
    const first = x.d.start()
    await x.d.cancel()
    await x.d.start()
    expect(x.d.state).toBe('recording')
    reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await first
    expect(x.track.stop).not.toHaveBeenCalled()
    expect(x.context.close).not.toHaveBeenCalled()
    expect(x.errors).toEqual([])
    expect(x.d.state).toBe('recording')
    x.audio(8000, 0.1)
    await x.d.stop()
    expect(x.texts).toEqual(['認識文'])
    expect(x.d.state).toBe('idle')
  })
})
