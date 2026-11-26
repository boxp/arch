export const defaults = {
  voice: 'kohaku',
  volume: 100,
  mix: true,
  touch: true,
  follow: true,
  lines: true,
  intensity: 'normal',
  pinned: false,
  reducedMotion: false,
  bgMotion: true,
  chestSway: true,
  idleActs: true,
  location: false,
} as const
export type Prefs = {
  /** BOXP-715: drama3 は本人限定の試用声（Drama-3-Japanese）。既定はコハク。 */
  voice: 'kohaku' | 'drama3' | 'browser'
  volume: number
  mix: boolean
  touch: boolean
  follow: boolean
  lines: boolean
  intensity: 'normal' | 'subtle'
  pinned: boolean
  reducedMotion: boolean
  bgMotion: boolean
  chestSway: boolean
  idleActs: boolean
  /** BOXP-648: 送信時に現在地をコハコへ添える（既定 OFF・本人が ON にした端末だけ）。 */
  location: boolean
}
/** 読み上げ音量（0〜100 の整数 %）。範囲外・数値以外は既定に戻す。 */
export function parseVolume(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : defaults.volume
}
export function parsePrefs(raw: string | null): Prefs {
  try {
    const p: unknown = JSON.parse(raw ?? '{}')
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ...defaults }
    const v = p as Record<string, unknown>
    return {
      voice: v.voice === 'browser' || v.voice === 'kohaku' || v.voice === 'drama3' ? v.voice : defaults.voice,
      volume: parseVolume(v.volume),
      mix: typeof v.mix === 'boolean' ? v.mix : defaults.mix,
      touch: typeof v.touch === 'boolean' ? v.touch : defaults.touch,
      follow: typeof v.follow === 'boolean' ? v.follow : defaults.follow,
      lines: typeof v.lines === 'boolean' ? v.lines : defaults.lines,
      intensity: v.intensity === 'subtle' || v.intensity === 'normal' ? v.intensity : defaults.intensity,
      pinned: typeof v.pinned === 'boolean' ? v.pinned : defaults.pinned,
      reducedMotion: typeof v.reducedMotion === 'boolean' ? v.reducedMotion : defaults.reducedMotion,
      bgMotion: typeof v.bgMotion === 'boolean' ? v.bgMotion : defaults.bgMotion,
      chestSway: typeof v.chestSway === 'boolean' ? v.chestSway : defaults.chestSway,
      idleActs: typeof v.idleActs === 'boolean' ? v.idleActs : defaults.idleActs,
      location: typeof v.location === 'boolean' ? v.location : defaults.location,
    }
  } catch {
    return { ...defaults }
  }
}
