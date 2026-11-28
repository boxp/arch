// BOXP-779: 本人が自分で始めた画面共有とマイクの間だけ、「コハコ」への呼びかけに共有画面 1 枚を見て返事する試作。
// 仕様は Obsidian の Projects/kohako-home/watch-together-spec.md、順序の決まりは contract/watch-model（Lean）。

// ---- 呼びかけの判定（決まり 4） ----
const NAMES = ['こはこ', 'kohako', '小箱']
/** 呼びかけの名前が始まってよい最後の位置（0 始まり）。 */
export const CALL_MAX_INDEX = 8

/** NFKC・小文字・カタカナ→ひらがなにし、空白と句読点・記号を除く。 */
export function normalizeCall(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export function wakeCalled(text: string): boolean {
  const t = normalizeCall(text)
  return NAMES.some((name) => {
    const i = t.indexOf(name)
    return i >= 0 && i <= CALL_MAX_INDEX
  })
}

// ---- 発話の区切り（決まり 3） ----
export const SEGMENT = { voiceRms: 0.015, endSilenceMs: 800, minMs: 400, maxMs: 10000 }

/** マイクの音を受け取り、区切れた 1 発話の音（声の始まり直前から）を返す。それ以外は null。 */
export function createSegmenter(sampleRate: number) {
  let active = false,
    parts: Float32Array[] = [],
    total = 0,
    voicedEnd = 0,
    silence = 0,
    pre: Float32Array | null = null
  const ms = (n: number) => (n * 1000) / sampleRate
  const reset = () => {
    active = false
    parts = []
    total = 0
    voicedEnd = 0
    silence = 0
    pre = null
  }
  const finish = (): Float32Array | null => {
    const keep = ms(voicedEnd) >= SEGMENT.minMs,
      out = new Float32Array(total)
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length
    }
    reset()
    return keep ? out : null
  }
  function push(chunk: Float32Array): Float32Array | null {
    let sum = 0
    for (const v of chunk) sum += v * v
    const voiced = chunk.length > 0 && Math.sqrt(sum / chunk.length) >= SEGMENT.voiceRms
    if (!active) {
      if (!voiced) {
        pre = chunk
        return null
      }
      active = true
      if (pre) {
        parts.push(pre)
        total += pre.length
      }
      pre = null
    }
    parts.push(chunk)
    total += chunk.length
    if (voiced) {
      voicedEnd = total
      silence = 0
    } else silence += chunk.length
    if (ms(silence) >= SEGMENT.endSilenceMs || ms(total) >= SEGMENT.maxMs) return finish()
    return null
  }
  return { push, reset }
}

/** 共有画面の静止画の大きさ（長辺 1280px 以下、縦横比を保つ）。 */
export function frameSize(width: number, height: number, max = 1280): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// ---- 状態（決まり 1・3・5・7・8、contract/watch-model と同じ規則） ----
export type WatchPhase = 'off' | 'starting' | 'watching' | 'transcribing' | 'asking' | 'replying'
export type WatchState = { phase: WatchPhase; gen: number }
export type Heard = 'yes' | 'busy' | 'no'
export type WatchEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'utter' }
  | { type: 'ready'; gen: number }
  | { type: 'fail'; gen: number }
  | { type: 'heard'; gen: number; heard: Heard }
  | { type: 'replied'; gen: number }
  | { type: 'spoken'; gen: number }
export type WatchEffect =
  | 'none'
  | 'acquire'
  | 'release'
  | 'transcribe'
  | 'discard'
  | 'send'
  | 'busy'
  | 'error'
  | 'speak'

export function watchStep(s: WatchState, e: WatchEvent): { state: WatchState; effect: WatchEffect } {
  const to = (phase: WatchPhase, effect: WatchEffect, gen = s.gen) => ({ state: { phase, gen }, effect })
  const same = { state: s, effect: 'none' as const }
  if (e.type === 'start') return s.phase === 'off' ? to('starting', 'acquire', s.gen + 1) : same
  if (e.type === 'stop') return s.phase === 'off' ? same : to('off', 'release')
  if (e.type === 'utter') return s.phase === 'watching' ? to('transcribing', 'transcribe') : same
  // ここから先は非同期の結果。止める前の回（番号が違う）の結果では何もしない。
  if (e.gen !== s.gen) return same
  switch (e.type) {
    case 'ready':
      return s.phase === 'starting' ? to('watching', 'none') : same
    case 'fail':
      return s.phase === 'starting'
        ? to('off', 'release')
        : s.phase === 'transcribing' || s.phase === 'asking'
          ? to('watching', 'error')
          : same
    case 'heard':
      if (s.phase !== 'transcribing') return same
      return e.heard === 'yes'
        ? to('asking', 'send')
        : e.heard === 'busy'
          ? to('watching', 'busy')
          : to('watching', 'discard')
    case 'replied':
      return s.phase === 'asking' ? to('replying', 'speak') : same
    case 'spoken':
      return s.phase === 'replying' ? to('watching', 'none') : same
  }
}
