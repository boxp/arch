export const KOHAKU = { modelUuid: '22e8ed77-94fe-4ef2-871f-a86f94e9a579', speakerUuid: '5680ac39-43c9-487a-bc3e-018c0d29cc38', styleName: 'ノーマル', label: 'コハク（ノーマル）', credit: 'AivisSpeech: コハク' } as const
export class TtsError extends Error { constructor(public code: 'invalid' | 'busy' | 'voice_unavailable' | 'tts_failed' | 'cancelled') { super(code) } }
export function createTts({ url, fetcher, now, concurrency = 1 }: { url: string; fetcher: typeof fetch; now: () => number; concurrency?: number }) {
  // CPU 合成は実時間より遅いため、CPU に余裕がある配置では同時に複数の合成を進め朗読の待ちを縮める(既定は直列)。
  let cached: { id: number; until: number } | undefined, active = 0
  const waiting: (() => void)[] = [], styles = new WeakMap<Buffer, number>()
  async function resolveStyle(cancel?: AbortSignal): Promise<number> {
    if (cached && cached.until > now()) return cached.id
    try {
      const r = await fetcher(`${url}/speakers`, { signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), redirect: 'error' }); if (!r.ok) throw Error()
      const speakers: unknown = await r.json()
      if (!Array.isArray(speakers)) throw Error()
      const speaker = speakers.find(x => x?.speaker_uuid === KOHAKU.speakerUuid)
      const style = Array.isArray(speaker?.styles) && speaker.styles.find((x: { name?: unknown; id?: unknown }) => x.name === KOHAKU.styleName && typeof x.id === 'number' && Number.isFinite(x.id))
      if (!style) throw new TtsError('voice_unavailable')
      cached = { id: style.id, until: now() + 600000 }; return style.id
    } catch (e) { if (e instanceof TtsError) throw e; throw new TtsError(cancel?.aborted ? 'cancelled' : 'tts_failed') }
  }
  async function status() {
    const info = { voice: KOHAKU.label, credit: KOHAKU.credit, modelUuid: KOHAKU.modelUuid, speakerUuid: KOHAKU.speakerUuid, style: KOHAKU.styleName }
    try { return { available: true, ...info, styleId: await resolveStyle() } } catch (e) { return { available: false, ...info, error: e instanceof TtsError ? e.code : 'tts_failed' } }
  }
  async function synthesize(text: unknown, cancel?: AbortSignal): Promise<Buffer> {
    if (typeof text !== 'string' || !text.trim() || text.length > 300) throw new TtsError('invalid')
    if (cancel?.aborted) throw new TtsError('cancelled')
    if (active >= concurrency) {
      if (waiting.length >= 4) throw new TtsError('busy')
      // 停止/切断で待機中のまま不要になった合成はキューから外し、後続の音声を遅らせない
      await new Promise<void>((resolve, reject) => {
        const turn = () => { cancel?.removeEventListener('abort', drop); resolve() }
        const drop = () => { const i = waiting.indexOf(turn); if (i >= 0) waiting.splice(i, 1); reject(new TtsError('cancelled')) }
        waiting.push(turn); cancel?.addEventListener('abort', drop, { once: true })
      })
    } else active++
    try {
      if (cancel?.aborted) throw new TtsError('cancelled')
      const styleId = await resolveStyle(cancel), params = new URLSearchParams({ speaker: String(styleId), text: text.trim() })
      try {
        const query = await fetcher(`${url}/audio_query?${params}`, { method: 'POST', signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), redirect: 'error' }); if (!query.ok) throw Error()
        const body = await query.json()
        const response = await fetcher(`${url}/synthesis?speaker=${styleId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), redirect: 'error' }); if (!response.ok) throw Error()
        const audio = Buffer.from(await response.arrayBuffer()); if (!/^audio\/wav(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') && audio.subarray(0, 4).toString() !== 'RIFF') throw Error()
        styles.set(audio, styleId); return audio
      } catch { throw new TtsError(cancel?.aborted ? 'cancelled' : 'tts_failed') }
    } finally { const next = waiting.shift(); if (next) next(); else active-- }
  }
  return { resolveStyle: () => resolveStyle(), status, synthesize, styleIdFor: (audio: Buffer) => styles.get(audio) }
}
