// BOXP-698: 期待値は vault の Projects/kohako-home/seat-spec.md（S3.1・S7・S2.1）の数字から書いている。
import { describe, expect, it } from 'vitest'
import { CHAIR_RISE, chairCorners, coatPoint, SEAT, SEAT_RISE, seatLift, seatPoint } from './seat'

describe('S7 座っていない間は今までどおり', () => {
  it('座り具合 0 では、どの点も動かさない', () => {
    for (const y of [900, 1012, 1150, 1302, 1368, 1700, 1990]) {
      expect(seatPoint(600, y, y, 0, false)).toEqual([600, y])
      expect(seatPoint(540, y, y, 0, true, 1)).toEqual([540, y])
      expect(coatPoint(700, y, y, 0, false)).toEqual([700, y])
      expect(seatLift(y, 0)).toBe(0)
    }
  })
})

describe('S3.1 座った脚の形', () => {
  it('付け根（1012）より上は動かず、ひざ当ての上端（1302）から下は約 146 上がって一定', () => {
    expect(seatLift(1012, 1)).toBe(0)
    expect(seatLift(950, 1)).toBe(0)
    expect(SEAT_RISE).toBeCloseTo(146.4, 1)
    expect(seatLift(1302, 1)).toBeCloseTo(SEAT_RISE, 9)
    expect(seatLift(1900, 1)).toBeCloseTo(SEAT_RISE, 9)
  })
  it('太ももの中ほどは縦に 0.4 倍、区間の両端はなだらか、上下の順は入れ替わらない', () => {
    const at = (y: number) => y - seatLift(y, 1)
    expect((at(1200) - at(1100)) / 100).toBeCloseTo(0.4, 9)
    expect(at(1014) - at(1012)).toBeGreaterThan(1.9)
    expect(at(1302) - at(1300)).toBeGreaterThan(1.9)
    for (let y = 950; y < 1400; y += 1) expect(at(y + 1)).toBeGreaterThan(at(y))
  })
  it('座り具合の途中は、上がる長さが比例する', () => {
    expect(seatLift(1500, 0.5)).toBeCloseTo(SEAT_RISE / 2, 9)
  })
  it('ひざから下は 1.045 倍になり、足先が外へ 0.035 ラジアン開く（左右対称）', () => {
    const [kx, ky] = SEAT.kneeC,
      knee = seatPoint(kx, ky, ky, 1, false),
      foot = seatPoint(kx, ky + 500, ky + 500, 1, false),
      left = seatPoint(2 * 572 - kx, ky + 500, ky + 500, 1, true)
    expect(knee[0]).toBeCloseTo(kx, 9)
    expect(knee[1]).toBeCloseTo(ky - SEAT_RISE, 9)
    expect(Math.hypot(foot[0] - knee[0], foot[1] - knee[1])).toBeCloseTo(500 * 1.045, 6)
    expect(Math.atan2(foot[0] - knee[0], foot[1] - knee[1])).toBeCloseTo(0.035, 6)
    expect(left[0]).toBeCloseTo(2 * 572 - foot[0], 9)
    expect(left[1]).toBeCloseTo(foot[1], 9)
  })
  it('足のぶらぶらで、すねの長さが最大 ±3.5% 変わる（ひざより上は変わらない）', () => {
    const [kx, ky] = SEAT.kneeC,
      length = (swing: number) => seatPoint(kx, ky + 400, ky + 400, 1, false, swing)[1] - (ky - SEAT_RISE)
    expect(length(1) / length(0)).toBeCloseTo(1.035, 3)
    expect(length(-1) / length(0)).toBeCloseTo(0.965, 3)
    expect(seatPoint(600, 1100, 1100, 1, false, 1)).toEqual(seatPoint(600, 1100, 1100, 1, false, 0))
  })
  it('上着の裾は上がりながら外へ広がる（腰より上は動かない）', () => {
    expect(coatPoint(700, 990, 990, 1, false)).toEqual([700, 990])
    const hem = coatPoint(800, 1252, 1252, 1, false),
      mirror = coatPoint(344, 1252, 1252, 1, true)
    expect(hem[1]).toBeCloseTo(1252 - 91, 0)
    expect(hem[0]).toBeCloseTo(800 + 0.3 * 91, 0)
    expect(mirror[0]).toBeCloseTo(2 * 572 - hem[0], 9)
    expect(mirror[1]).toBeCloseTo(hem[1], 9)
  })
})

describe('S2.1 椅子は下から上がって現れる', () => {
  it('出始めは 46 下、出切ると定位置', () => {
    expect(CHAIR_RISE).toBe(46)
    const hidden = chairCorners(0),
      shown = chairCorners(1)
    hidden.forEach((c, i) => {
      expect(c[0]).toBe(shown[i][0])
      expect(c[1] - shown[i][1]).toBeCloseTo(46, 9)
    })
  })
})
