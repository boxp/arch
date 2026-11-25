// BOXP-698: 期待値は vault の Projects/kohako-home/seat-spec.md（S8・S7・S2.1）の数字から書いている。
import { describe, expect, it } from 'vitest'
import {
  ART,
  artOpacity,
  CHAIR_RISE,
  chairCorners,
  followPoint,
  followWeight,
  legOpacity,
  SEAT_RISE,
  seatLift,
  seatPoint,
  shinCorners,
  skirtPoint,
} from './seat'

describe('S7 座っていない間は今までどおり', () => {
  it('座り具合 0 では、どの点も動かさず、絵は見えず、立ち姿の脚は濃さ 1', () => {
    for (const y of [900, 1012, 1150, 1302, 1368, 1700, 1990]) {
      expect(seatPoint(600, y, y, 0)).toEqual([600, y])
      expect(skirtPoint('right', 700, y, 0)).toEqual([700, y])
      expect(skirtPoint('left', 300, y, 0)).toEqual([300, y])
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

describe('S8.4 上着の裾は硬い板として動かす（TD-04）', () => {
  // 仕様の数字: 支点 左 [458, 790]・右 [688, 790]、立ち姿の長さ方向は鉛直から外へ 0.28、外へ 0.2 × 座り具合 回り、長さ方向だけ 1 − 0.1 × 座り具合 倍。
  const HINGE = { left: [458, 790], right: [688, 790] } as const
  /** 立ち姿の板の上の点（長さ方向 along、幅方向 across（外が正））。 */
  const plate = (side: 'left' | 'right', along: number, across: number): [number, number] => {
    const out = side === 'left' ? -1 : 1
    return [
      HINGE[side][0] + out * (along * Math.sin(0.28) + across * Math.cos(0.28)),
      HINGE[side][1] + along * Math.cos(0.28) - across * Math.sin(0.28),
    ]
  }
  const LEVELS = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
  const dist = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])

  it('例の値（左・右、座り切りと座り具合 0.5）', () => {
    const p = plate('left', 400, 0)
    expect(p[0]).toBeCloseTo(347.46, 2)
    expect(p[1]).toBeCloseTo(1174.42, 2)
    const full = skirtPoint('left', p[0], p[1], 1)
    expect(full[0]).toBeCloseTo(291.76, 2)
    expect(full[1]).toBeCloseTo(1109.32, 2)
    const half = skirtPoint('left', p[0], p[1], 0.5)
    expect(half[0]).toBeCloseTo(317.05, 2)
    expect(half[1]).toBeCloseTo(1142.89, 2)
    const right = skirtPoint('right', 798.54, 1174.42, 1)
    expect(right[0]).toBeCloseTo(854.24, 2)
    expect(right[1]).toBeCloseTo(1109.32, 2)
  })
  it('① 支点は動かない', () => {
    for (const side of ['left', 'right'] as const)
      for (const level of LEVELS) {
        const q = skirtPoint(side, HINGE[side][0], HINGE[side][1], level)
        expect(q[0]).toBeCloseTo(HINGE[side][0], 9)
        expect(q[1]).toBeCloseTo(HINGE[side][1], 9)
      }
  })
  it('② 板の上で一直線に並ぶ点は一直線のまま、間隔の比も同じ（折れ・たわみが無い）', () => {
    // 板の中の斜めの線分 3 本。中点は中点へ、1/4 の点は 1/4 の点へ移る。
    const segments: [[number, number], [number, number]][] = [
      [
        [0, -40],
        [460, 60],
      ],
      [
        [50, 70],
        [440, -70],
      ],
      [
        [120, -60],
        [130, 75],
      ],
    ]
    for (const side of ['left', 'right'] as const)
      for (const level of LEVELS)
        for (const [[a0, c0], [a1, c1]] of segments) {
          const move = (t: number) => {
            const p = plate(side, a0 + (a1 - a0) * t, c0 + (c1 - c0) * t)
            return skirtPoint(side, p[0], p[1], level)
          }
          const from = move(0),
            to = move(1)
          for (const t of [0.25, 0.5, 0.8]) {
            const q = move(t)
            expect(q[0]).toBeCloseTo(from[0] + (to[0] - from[0]) * t, 6)
            expect(q[1]).toBeCloseTo(from[1] + (to[1] - from[1]) * t, 6)
          }
        }
  })
  it('③ 幅方向に並ぶ 2 点の距離は立ち姿と同じ。長さ方向は 1 − 0.1 × 座り具合 倍', () => {
    for (const side of ['left', 'right'] as const)
      for (const level of LEVELS)
        for (const along of [0, 150, 300, 460]) {
          const a = plate(side, along, -70),
            b = plate(side, along, 70)
          expect(dist(skirtPoint(side, a[0], a[1], level), skirtPoint(side, b[0], b[1], level))).toBeCloseTo(140, 6)
          const c = plate(side, along, 20),
            d = plate(side, along + 100, 20)
          expect(dist(skirtPoint(side, c[0], c[1], level), skirtPoint(side, d[0], d[1], level))).toBeCloseTo(
            100 * (1 - 0.1 * level),
            6,
          )
        }
  })
  it('向き: 長さ方向は、鉛直から外へ 0.28 + 0.2 × 座り具合 ラジアン', () => {
    for (const side of ['left', 'right'] as const)
      for (const level of LEVELS) {
        const p = plate(side, 300, 0),
          q = skirtPoint(side, p[0], p[1], level),
          out = side === 'left' ? -1 : 1
        expect(Math.atan2((q[0] - HINGE[side][0]) * out, q[1] - HINGE[side][1])).toBeCloseTo(0.28 + 0.2 * level, 9)
      }
  })
  it('④ 裾の先（長さ方向に 300 以上）の点は、座り具合が増えると必ず上がる', () => {
    for (const side of ['left', 'right'] as const)
      for (const along of [300, 380, 480])
        for (const across of [-80, 0, 80]) {
          const p = plate(side, along, across)
          let last = p[1]
          for (let i = 1; i <= 100; i++) {
            const y = skirtPoint(side, p[0], p[1], i / 100)[1]
            expect(y).toBeLessThan(last)
            last = y
          }
        }
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
