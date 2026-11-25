// BOXP-698: 期待値は vault の Projects/kohako-home/seat-spec.md（S8・S7・S2.1）の数字から書いている。
import { describe, expect, it } from 'vitest'
import {
  ART,
  artOpacity,
  CHAIR_RISE,
  chairCorners,
  coatPoint,
  followPoint,
  followWeight,
  legOpacity,
  SEAT_RISE,
  seatLift,
  seatPoint,
  shinCorners,
} from './seat'

describe('S7 座っていない間は今までどおり', () => {
  it('座り具合 0 では、どの点も動かさず、絵は見えず、立ち姿の脚は濃さ 1', () => {
    for (const y of [900, 1012, 1150, 1302, 1368, 1700, 1990]) {
      expect(seatPoint(600, y, y, 0)).toEqual([600, y])
      expect(coatPoint(700, y, y, 0)).toEqual([700, y])
      expect(seatLift(y, 0)).toBe(0)
    }
    expect(artOpacity(0)).toBe(0)
    expect(legOpacity(0)).toBe(1)
  })
})

describe('S8 表: 絵を置く場所', () => {
  it('BOXP-702 の manifest の矩形とひざの位置のまま', () => {
    expect(ART.chair.box).toEqual([166, 926, 810, 519])
    expect(ART.shadow.box).toEqual([228, 986, 689, 172])
    expect(ART.thighs.box).toEqual([243, 820, 659, 352])
    expect(ART.shinLeft.box).toEqual([421, 1078, 147, 709])
    expect(ART.shinLeft.pivot).toEqual([508, 1155])
    expect(ART.shinRight.box).toEqual([577, 1078, 147, 708])
    expect(ART.shinRight.pivot).toEqual([636, 1155])
  })
})

describe('S8.1 絵と立ち姿の脚の濃さ', () => {
  it('例の値', () => {
    expect(artOpacity(0.3)).toBe(0)
    expect(legOpacity(0.3)).toBe(1)
    expect(artOpacity(0.55)).toBeCloseTo(0.5, 9)
    expect(legOpacity(0.55)).toBe(1)
    expect(artOpacity(0.8)).toBe(1)
    expect(legOpacity(0.8)).toBe(1)
    expect(artOpacity(0.9)).toBe(1)
    expect(legOpacity(0.9)).toBeCloseTo(0.5, 9)
    expect(artOpacity(1)).toBe(1)
    expect(legOpacity(1)).toBe(0)
  })
  it('どの座り具合でも、絵か立ち姿の脚のどちらかは濃さ 1（向こうが透けない）。濃さは行って戻らない', () => {
    let a = 0,
      l = 1
    for (let i = 0; i <= 1000; i++) {
      const level = i / 1000
      expect(Math.max(artOpacity(level), legOpacity(level))).toBe(1)
      expect(artOpacity(level)).toBeGreaterThanOrEqual(a)
      expect(legOpacity(level)).toBeLessThanOrEqual(l)
      a = artOpacity(level)
      l = legOpacity(level)
    }
  })
})

describe('S8.2 立ち姿の脚を絵の位置へ寄せる', () => {
  it('付け根（1012）より上は動かず、ひざ当ての上端（1302）から下は 213 上がって一定（ひざ 1368 → 1155）', () => {
    expect(seatLift(1012, 1)).toBe(0)
    expect(seatLift(950, 1)).toBe(0)
    expect(SEAT_RISE).toBeCloseTo(213, 9)
    expect(seatLift(1302, 1)).toBeCloseTo(213, 9)
    expect(seatLift(1900, 1)).toBeCloseTo(213, 9)
    expect(seatPoint(632, 1368, 1368, 1)[1]).toBeCloseTo(ART.shinRight.pivot[1], 9)
  })
  it('上下の順は入れ替わらず、座り具合に比例する。ひざから下は拡大も開きもしない', () => {
    const at = (y: number) => y - seatLift(y, 1)
    for (let y = 950; y < 1400; y += 1) expect(at(y + 1)).toBeGreaterThan(at(y))
    expect(seatLift(1500, 0.5)).toBeCloseTo(106.5, 9)
    expect(seatPoint(600, 1900, 1900, 1)).toEqual([600, 1900 - SEAT_RISE])
    expect(seatPoint(540, 1900, 1900, 0.5)).toEqual([540, 1900 - SEAT_RISE / 2])
  })
})

describe('S8.3 ひざから下の絵は、入れ替わる間 立ち姿のひざから下と同じ位置', () => {
  it('213 ×（1 − 座り具合）下にずれ、座り切ると定位置', () => {
    const [x, y, w, h] = ART.shinRight.box
    expect(shinCorners('right', 1, 0)).toEqual([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ])
    for (const level of [0.3, 0.5, 0.8]) {
      const c = shinCorners('left', level, 0)
      expect(c[0][1] - ART.shinLeft.box[1]).toBeCloseTo(213 * (1 - level), 9)
      // 立ち姿のひざ（1368）を寄せた位置と、絵のひざが同じ高さ。
      expect(ART.shinLeft.pivot[1] + 213 * (1 - level)).toBeCloseTo(seatPoint(512, 1368, 1368, level)[1], 9)
    }
  })
})

describe('S8.4 立ち姿の裾は絵の内側へ隠す', () => {
  it('875 より上は動かず、下端 1250 は約 957 へ。絵の範囲の内側の点は横に動かない', () => {
    expect(coatPoint(700, 875, 875, 1)).toEqual([700, 875])
    expect(coatPoint(300, 800, 800, 1)).toEqual([300, 800])
    const hem = coatPoint(500, 1250, 1250, 1)
    expect(hem[0]).toBe(500)
    expect(hem[1]).toBeCloseTo(875 + 375 * 0.22, 9)
    expect(coatPoint(500, 1250, 1250, 0.5)[1]).toBeCloseTo(875 + 375 * 0.61, 9)
  })
  it('絵からはみ出る点は端へ寄せる（例の値。左右対称、座り具合に比例）', () => {
    const left = coatPoint(300, 1250, 1250, 1),
      right = coatPoint(844, 1250, 1250, 1)
    expect(left[0]).toBeCloseTo(348.75, 9)
    expect(left[1]).toBeCloseTo(957.5, 9)
    expect(right[0]).toBeCloseTo(795.25, 9)
    expect(coatPoint(300, 1250, 1250, 0.5)[0]).toBeGreaterThan(300)
    expect(coatPoint(300, 1250, 1250, 0.5)[0]).toBeLessThan(348.75)
    // 875 のすぐ下では、まだほとんど寄せない（段ができない）。
    expect(Math.abs(coatPoint(380, 877, 877, 1)[0] - 380)).toBeLessThan(2)
  })
})

describe('S8.5 足のぶらぶら', () => {
  it('振れ 0 では動かさない。振れ 1 でひざから下が 1.03 倍・右は +0.03、左は −0.03 ラジアン。ひざは動かない', () => {
    const [px, py] = ART.shinRight.pivot,
      b = ART.shinRight.box,
      bottom = (side: 'left' | 'right', swing: number) => {
        const c = shinCorners(side, 1, swing)
        return [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2]
      },
      rest = bottom('right', 0),
      out = bottom('right', 1),
      len = Math.hypot(rest[0] - px, rest[1] - py)
    expect(rest[1]).toBe(b[1] + b[3])
    expect(Math.hypot(out[0] - px, out[1] - py) / len).toBeCloseTo(1.03, 2)
    const angle = (q: number[], p: readonly number[]) => Math.atan2(q[0] - p[0], q[1] - p[1])
    expect(angle(out, [px, py]) - angle(rest, [px, py])).toBeCloseTo(-0.03, 2)
    const lp = ART.shinLeft.pivot
    expect(angle(bottom('left', 1), lp) - angle(bottom('left', 0), lp)).toBeCloseTo(0.03, 2)
    expect(Math.hypot(bottom('right', -1)[0] - px, bottom('right', -1)[1] - py) / len).toBeCloseTo(0.97, 2)
  })
})

describe('S8.6 腰のつなぎ', () => {
  it('重みは 850 以上で 1、1000 から下で 0、あいだは単調', () => {
    expect(followWeight(820)).toBe(1)
    expect(followWeight(850)).toBe(1)
    expect(followWeight(1000)).toBe(0)
    expect(followWeight(1172)).toBe(0)
    for (let y = 850; y < 1000; y += 5) expect(followWeight(y + 5)).toBeLessThanOrEqual(followWeight(y))
  })
  it('体が動いていなければ置いた場所のまま。腰が平行に動けば上のほうは同じだけ動き、座面のところは動かない', () => {
    const a = [500, 850] as const,
      b = [644, 850] as const
    expect(followPoint([400, 830], a, b, a, b)).toEqual([400, 830])
    const moved = followPoint([400, 830], a, b, [506, 853], [650, 853])
    expect(moved[0]).toBeCloseTo(406, 9)
    expect(moved[1]).toBeCloseTo(833, 9)
    expect(followPoint([400, 1100], a, b, [506, 853], [650, 853])).toEqual([400, 1100])
  })
  it('腰が傾けば、腰の 2 点はその位置へ付いていく', () => {
    const a = [500, 850] as const,
      b = [644, 850] as const,
      na = [501, 846] as const,
      nb = [644.8, 854] as const,
      p = followPoint(a, a, b, na, nb)
    expect(p[0]).toBeCloseTo(na[0], 1)
    expect(p[1]).toBeCloseTo(na[1], 1)
  })
})

describe('S2.1 椅子は下から上がって現れる', () => {
  it('出始めは 46 下、出切ると定位置', () => {
    expect(CHAIR_RISE).toBe(46)
    const hidden = chairCorners(0),
      shown = chairCorners(1)
    expect(shown[0]).toEqual([166, 926])
    expect(shown[2]).toEqual([166 + 810, 926 + 519])
    hidden.forEach((c, i) => {
      expect(c[0]).toBe(shown[i][0])
      expect(c[1] - shown[i][1]).toBeCloseTo(46, 9)
    })
  })
})
