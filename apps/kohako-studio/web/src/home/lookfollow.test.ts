import { describe, expect, it } from 'vitest'
import {
  blendLook,
  FOLLOW_MAX,
  followWeightFor,
  lookTarget,
  mapLook,
  MIN_REACH,
  POSE_LOOK_WEIGHT,
  smoothLook,
} from './lookfollow'
import { parsePrefs } from './prefs'
const face = { x: 500, y: 300 },
  viewport = { left: 0, top: 0, width: 1000, height: 600 }
describe('視線追従（BOXP-516）', () => {
  it('顔の中心では中立、右・上を正にする', () => {
    expect(mapLook(face, face, viewport)).toEqual({ x: 0, y: 0 })
    const r = mapLook({ x: 700, y: 300 }, face, viewport),
      u = mapLook({ x: 500, y: 150 }, face, viewport)
    expect(r.x).toBeGreaterThan(0.5)
    expect(r.y).toBe(0)
    expect(u.y).toBeGreaterThan(0.5)
    expect(u.x).toBe(0)
  })
  it('画面端の手前（顔から端までの 6 割）で向ききり、端より外でも 1 を超えない', () => {
    expect(mapLook({ x: 500 + 300, y: 300 }, face, viewport).x).toBeCloseTo(1)
    expect(mapLook({ x: 5000, y: 300 }, face, viewport).x).toBe(1)
    expect(mapLook({ x: -5000, y: 300 }, face, viewport).x).toBe(-1)
  })
  it('角では斜めの合成を円に収め、首を伸ばしすぎない', () => {
    for (const p of [
      { x: -100, y: -100 },
      { x: 2000, y: 900 },
      { x: 0, y: 600 },
      { x: 1000, y: 0 },
    ]) {
      const v = mapLook(p, face, viewport)
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(v.x)).toBeGreaterThan(0.5)
      expect(Math.abs(v.y)).toBeGreaterThan(0.5)
    }
  })
  it('顔が画面端に寄っていても最低距離までは向ききらない（端で過敏にならない）', () => {
    const edgeFace = { x: 990, y: 300 }
    expect(mapLook({ x: 999, y: 300 }, edgeFace, viewport).x).toBeLessThan(0.1)
    expect(mapLook({ x: 990 + MIN_REACH, y: 300 }, edgeFace, viewport).x).toBe(1)
    expect(mapLook({ x: 990 - 990 * 0.6, y: 300 }, edgeFace, viewport).x).toBeCloseTo(-1)
  })
  it('顔の上の小さな揺れは不感帯で消す（震えない）', () => {
    expect(mapLook({ x: 505, y: 302 }, face, viewport)).toEqual({ x: 0, y: 0 })
  })
  it('急に飛ばず、時間に応じて滑らかに近づく（フレームレートに依存しない）', () => {
    const one = smoothLook({ x: 0, y: 0 }, { x: 1, y: -1 }, 0.016)
    expect(one.x).toBeGreaterThan(0)
    expect(one.x).toBeLessThan(0.1)
    expect(one.y).toBeCloseTo(-one.x)
    let a = { x: 0, y: 0 }
    for (let i = 0; i < 6; i++) a = smoothLook(a, { x: 1, y: 0 }, 0.016)
    let b = { x: 0, y: 0 }
    for (let i = 0; i < 3; i++) b = smoothLook(b, { x: 1, y: 0 }, 0.032)
    expect(a.x).toBeCloseTo(b.x, 6)
  })
  it('カーソル不在・設定 OFF・動きを減らす・なで中は中立、控えめは 6 割', () => {
    const p = { x: 1000, y: 300 }
    expect(lookTarget(null, face, viewport, true, false, false)).toEqual({ x: 0, y: 0 })
    expect(lookTarget(p, face, viewport, false, false, false)).toEqual({ x: 0, y: 0 })
    expect(lookTarget(p, face, viewport, true, true, false)).toEqual({ x: 0, y: 0 })
    expect(lookTarget(p, face, viewport, true, false, false).x).toBeCloseTo(1)
    expect(lookTarget(p, face, viewport, true, false, true).x).toBeCloseTo(0.6)
  })
  it('状態の視線（考え中など）がある間は追従を弱めて混ぜる', () => {
    expect(followWeightFor([0, 0])).toBe(1)
    expect(followWeightFor([0.6, 0.5])).toBe(POSE_LOOK_WEIGHT)
    expect(blendLook([0.18, 0.15], { x: -1, y: 0 }, 0)).toEqual([0.18, 0.15])
    expect(blendLook([0, 0], { x: -1, y: 1 }, 1)).toEqual([-FOLLOW_MAX.x, FOLLOW_MAX.y])
    // 角（円に収めた ±0.707）でも lookAt は ±0.5 を超えない（±1 では髪が伸びる）。
    const corner = blendLook([0, 0], mapLook({ x: -1e4, y: -1e4 }, face, viewport), 1)
    expect(Math.abs(corner[0])).toBeLessThanOrEqual(FOLLOW_MAX.x)
    expect(Math.abs(corner[1])).toBeLessThanOrEqual(FOLLOW_MAX.y)
  })
  it('旧設定は追従を既定で有効にし、OFF を保存できる', () => {
    expect(parsePrefs('{"touch":false}').follow).toBe(true)
    expect(parsePrefs('{"follow":false}').follow).toBe(false)
    expect(parsePrefs('{"follow":"no"}').follow).toBe(true)
  })
})
