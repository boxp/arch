import type { Point, Rect } from './touch'
export type PetOffset = { headX: number; headY: number; headZ: number }
export const zeroPet = (): PetOffset => ({ headX: 0, headY: 0, headZ: 0 })
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
export function petFollow(current: PetOffset, track: { points: readonly Point[]; rect: Rect } | null, dt: number, options: { reduced: boolean; enabled: boolean; subtle: boolean }): PetOffset {
  const first = track?.points[0], last = track?.points.at(-1), previous = track?.points.at(-2)
  const moved = !!track && !!first && track.points.some(p => Math.abs(p.x - first.x) >= 5)
  const active = moved && options.enabled && !options.reduced && !!last && !!track
  let x = 0, y = 0, z = 0
  if (active && track && last) {
    const side = clamp((last.x - (track.rect.x + track.rect.w / 2)) / (track.rect.w / 2), -1, 1)
    const direction = previous ? clamp((last.x - previous.x) / 12, -1, 1) : 0
    const scale = options.subtle ? 0.5 : 1
    x = clamp((side * 6 + direction * 2) * scale, -8, 8); z = clamp((side * 4 + direction * 2) * scale, -6, 6)
    y = clamp((last.y - (track.rect.y + track.rect.h / 2)) / (track.rect.h / 2), -1, 1) * 2 * scale
  }
  const step = (value: number, target: number) => value + clamp((target - value) * (1 - Math.exp(-Math.max(0, dt) / (active ? 0.2 : 0.4))), -30 * dt, 30 * dt)
  return { headX: step(current.headX, x), headY: step(current.headY, y), headZ: step(current.headZ, z) }
}
