export const KOHAKU = {
  modelUuid: '22e8ed77-94fe-4ef2-871f-a86f94e9a579',
  speakerUuid: '5680ac39-43c9-487a-bc3e-018c0d29cc38',
  styleName: 'ノーマル',
  label: 'コハク（ノーマル）',
  credit: 'AivisSpeech: コハク',
} as const
export class TtsError extends Error {
  constructor(public code: 'invalid' | 'busy' | 'voice_unavailable' | 'tts_failed' | 'cancelled') {
    super(code)
  }
}
export function createTts({
  url,
  fetcher,
  now,
  concurrency = 1,
}: {
  url: string
  fetcher: typeof fetch
  now: () => number
  concurrency?: number
}) {
  // CPU 合成は実時間より遅いため、CPU に余裕がある配置では同時に複数の合成を進め朗読の待ちを縮める(既定は直列)。
  let cached: { id: number; until: number } | undefined,
    active = 0
  const waiting: (() => void)[] = [],
    styles = new WeakMap<Buffer, number>()
  async function resolveStyle(cancel?: AbortSignal): Promise<number> {
    if (cached && cached.until > now()) return cached.id
    try {
      const r = await fetcher(`${url}/speakers`, {
        signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        redirect: 'error',
      })
      if (!r.ok) throw Error()
      const speakers: unknown = await r.json()
      if (!Array.isArray(speakers)) throw Error()
      const speaker = speakers.find((x) => x?.speaker_uuid === KOHAKU.speakerUuid)
      const style =
        Array.isArray(speaker?.styles) &&
        speaker.styles.find(
          (x: { name?: unknown; id?: unknown }) =>
            x.name === KOHAKU.styleName && typeof x.id === 'number' && Number.isFinite(x.id),
        )
      if (!style) throw new TtsError('voice_unavailable')
      cached = { id: style.id, until: now() + 600000 }
      return style.id
    } catch (e) {
      if (e instanceof TtsError) throw e
      throw new TtsError(cancel?.aborted ? 'cancelled' : 'tts_failed')
    }
  }
  async function status() {
    const info = {
      voice: KOHAKU.label,
      credit: KOHAKU.credit,
      modelUuid: KOHAKU.modelUuid,
      speakerUuid: KOHAKU.speakerUuid,
      style: KOHAKU.styleName,
    }
    try {
      return { available: true, ...info, styleId: await resolveStyle() }
    } catch (e) {
      return { available: false, ...info, error: e instanceof TtsError ? e.code : 'tts_failed' }
    }
  }
  async function synthesize(text: unknown, cancel?: AbortSignal): Promise<Buffer> {
    if (typeof text !== 'string' || !text.trim() || text.length > 300) throw new TtsError('invalid')
    if (cancel?.aborted) throw new TtsError('cancelled')
    const queuedAt = now()
    if (active >= concurrency) {
      if (waiting.length >= 4) throw new TtsError('busy')
      // 停止/切断で待機中のまま不要になった合成はキューから外し、後続の音声を遅らせない
      await new Promise<void>((resolve, reject) => {
        const turn = () => {
          cancel?.removeEventListener('abort', drop)
          resolve()
        }
        const drop = () => {
          const i = waiting.indexOf(turn)
          if (i >= 0) waiting.splice(i, 1)
          reject(new TtsError('cancelled'))
        }
        waiting.push(turn)
        cancel?.addEventListener('abort', drop, { once: true })
      })
    } else active++
    try {
      if (cancel?.aborted) throw new TtsError('cancelled')
      const startedAt = now()
      const styleId = await resolveStyle(cancel),
        params = new URLSearchParams({ speaker: String(styleId), text: text.trim() })
      try {
        const query = await fetcher(`${url}/audio_query?${params}`, {
          method: 'POST',
          signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
          redirect: 'error',
        })
        if (!query.ok) throw Error()
        const body = await query.json()
        const response = await fetcher(`${url}/synthesis?speaker=${styleId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
          redirect: 'error',
        })
        if (!response.ok) throw Error()
        const audio = Buffer.from(await response.arrayBuffer())
        if (
          !/^audio\/wav(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') &&
          audio.subarray(0, 4).toString() !== 'RIFF'
        )
          throw Error()
        styles.set(audio, styleId)
        // 朗読の区切り待ちを本番で切り分けるため、本文を含めず文字数・待ち・合成時間・音声長だけを記録する。
        const byteRate = audio.length >= 44 && audio.subarray(0, 4).toString() === 'RIFF' ? audio.readUInt32LE(28) : 0
        console.log(
          JSON.stringify({
            event: 'tts_synthesized',
            chars: text.trim().length,
            waitMs: startedAt - queuedAt,
            synthMs: now() - startedAt,
            audioMs: byteRate ? Math.round(((audio.length - 44) / byteRate) * 1000) : null,
          }),
        )
        return audio
      } catch {
        throw new TtsError(cancel?.aborted ? 'cancelled' : 'tts_failed')
      }
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
  return { resolveStyle: () => resolveStyle(), status, synthesize, styleIdFor: (audio: Buffer) => styles.get(audio) }
}

/** BOXP-715: 本人限定の試用声。speech.cpp の OpenAI 互換 API（Drama-3-Japanese、CPU）。既定の声はコハクのまま。 */
export const DRAMA3 = {
  label: 'Drama-3-Japanese（試用）',
  credit: 'Built with Fish Audio',
  voice: 'kohako',
  seed: 715,
} as const
export function createDrama3Tts({
  url,
  fetcher,
  now,
  timeoutMs = 180000,
}: {
  url: string
  fetcher: typeof fetch
  now: () => number
  timeoutMs?: number
}) {
  let active = 0
  const waiting: (() => void)[] = []
  const signalOf = (ms: number, cancel?: AbortSignal) =>
    cancel ? AbortSignal.any([cancel, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
  async function status() {
    const info = { voice: DRAMA3.label, credit: DRAMA3.credit }
    try {
      const r = await fetcher(`${url}/health`, { signal: signalOf(10000), redirect: 'error' })
      return r.ok ? { available: true, ...info } : { available: false, ...info, error: 'voice_unavailable' }
    } catch {
      return { available: false, ...info, error: 'voice_unavailable' }
    }
  }
  async function synthesize(text: unknown, cancel?: AbortSignal): Promise<Buffer> {
    if (typeof text !== 'string' || !text.trim() || text.length > 300) throw new TtsError('invalid')
    if (cancel?.aborted) throw new TtsError('cancelled')
    const queuedAt = now()
    if (active >= 1) {
      if (waiting.length >= 4) throw new TtsError('busy')
      await new Promise<void>((resolve, reject) => {
        const turn = () => {
          cancel?.removeEventListener('abort', drop)
          resolve()
        }
        const drop = () => {
          const i = waiting.indexOf(turn)
          if (i >= 0) waiting.splice(i, 1)
          reject(new TtsError('cancelled'))
        }
        waiting.push(turn)
        cancel?.addEventListener('abort', drop, { once: true })
      })
    } else active++
    try {
      if (cancel?.aborted) throw new TtsError('cancelled')
      const startedAt = now()
      let response: Response
      try {
        response = await fetcher(`${url}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: text.trim(), voice: DRAMA3.voice, response_format: 'wav', seed: DRAMA3.seed }),
          signal: signalOf(timeoutMs, cancel),
          redirect: 'error',
        })
      } catch {
        // 接続できない(落ちている・退避された)ときは声が使えない扱いにし、端末で既定の声へ戻せるようにする。
        throw new TtsError(cancel?.aborted ? 'cancelled' : 'voice_unavailable')
      }
      if (response.status === 503) throw new TtsError('voice_unavailable')
      try {
        if (!response.ok) throw Error()
        const audio = Buffer.from(await response.arrayBuffer())
        if (audio.subarray(0, 4).toString() !== 'RIFF') throw Error()
        const byteRate = audio.length >= 44 ? audio.readUInt32LE(28) : 0
        console.log(
          JSON.stringify({
            event: 'tts_synthesized',
            voice: 'drama3',
            chars: text.trim().length,
            waitMs: startedAt - queuedAt,
            synthMs: now() - startedAt,
            audioMs: byteRate ? Math.round(((audio.length - 44) / byteRate) * 1000) : null,
          }),
        )
        return audio
      } catch {
        throw new TtsError(cancel?.aborted ? 'cancelled' : 'tts_failed')
      }
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
  return { status, synthesize }
}
