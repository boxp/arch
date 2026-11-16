import { describe, expect, it } from 'vitest'
import { inPolygon, mirrorPolygon } from './arm-parts'
import {
  bindBackHair,
  bindHairPoint,
  closestBary,
  FOLLOW_Y,
  followAnchors,
  followWeight,
  KEEP_Y,
  SHOULDER_NOTCH,
} from './back-hair'

// 2 枚の三角形で作る正方形（x 0..100, y 400..500）の結び付け先。
const square = (dx = 0, dy = 0) => [0 + dx, 400 + dy, 100 + dx, 400 + dy, 100 + dx, 500 + dy, 0 + dx, 500 + dy]
const indices = [0, 1, 2, 0, 2, 3]

describe('back hair follows the sleeves and body below the shoulders (BOXP-525)', () => {
  it('keeps the original motion above the shoulders and follows fully below', () => {
    expect(followWeight(KEEP_Y - 50)).toBe(0)
    expect(followWeight(KEEP_Y)).toBe(0)
    expect(followWeight(FOLLOW_Y)).toBe(1)
    expect(followWeight(FOLLOW_Y + 300)).toBe(1)
    const mid = followWeight((KEEP_Y + FOLLOW_Y) / 2)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('finds the closest point on a triangle from outside', () => {
    expect(closestBary([10, 10], [0, 0], [100, 0], [0, 100]).d2).toBe(0)
    const out = closestBary([50, -10], [0, 0], [100, 0], [0, 100])
    expect(out.d2).toBeCloseTo(100)
    expect(out.bary[0]).toBeCloseTo(0.5)
    expect(out.bary[1]).toBeCloseTo(0.5)
  })

  it('prefers the first anchor that covers the point, else the nearest one', () => {
    const anchors = [
      { mesh: 22, vertices: square(), indices },
      { mesh: 26, vertices: square(50), indices },
    ]
    expect(bindHairPoint([70, 450], anchors)?.mesh).toBe(22)
    expect(bindHairPoint([140, 450], anchors)?.mesh).toBe(26)
    expect(bindHairPoint([-30, 450], anchors)?.mesh).toBe(22)
  })

  it('moves hair below the shoulders with the anchor and leaves the top as evaluated', () => {
    const rest = [50, 300, 50, 480, -20, 470]
    const rig = bindBackHair(rest, [{ mesh: 26, vertices: square(), indices }])
    // 頭の向きで後ろ髪は全体に +4、体（結び付け先）は +2 だけ動いた。
    const v = Float32Array.from([54, 300, 54, 480, -16, 470])
    followAnchors(v, rig, () => square(2))
    expect(v[0]).toBeCloseTo(54) // 肩の上: 元の動きのまま
    expect(v[2]).toBeCloseTo(52) // 肩の下: 体と同じ +2
    expect(v[4]).toBeCloseTo(-18) // 体の外（最も近い縁に結び付け）も同じ +2
    expect(v[3]).toBeCloseTo(480)
  })
})

describe('shoulder notch of the body layer (BOXP-525)', () => {
  // 体の層の左の切り欠きの外周（読み込み時の姿勢の実測）と、着物の衿・肩の点。
  const notch = [
    [449.8, 404.4],
    [448.6, 427],
    [413.2, 434.6],
    [404.6, 449.1],
    [470.3, 396.7],
  ] as const
  const collar = [
    [540, 400],
    [572, 450],
    [500, 470],
    [465, 447],
    [469, 450],
  ] as const
  it('covers the notch on both sides and leaves the collar', () => {
    for (const [x, y] of notch) {
      expect(inPolygon(SHOULDER_NOTCH, x, y)).toBe(true)
      expect(inPolygon(mirrorPolygon(SHOULDER_NOTCH, 572), 2 * 572 - x, y)).toBe(true)
    }
    for (const [x, y] of collar) {
      expect(inPolygon(SHOULDER_NOTCH, x, y)).toBe(false)
      expect(inPolygon(mirrorPolygon(SHOULDER_NOTCH, 572), 2 * 572 - x, y)).toBe(false)
    }
  })
})
