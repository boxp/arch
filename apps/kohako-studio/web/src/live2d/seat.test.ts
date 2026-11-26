// BOXP-698: 期待値は vault の Projects/kohako-home/seat-spec.md（S8・S7・S2.1）の数字から書いている。
import { describe, expect, it } from 'vitest'
import {
  ART,
  artOpacity,
  artZone,
  CHAIR_RISE,
  chairCorners,
  followPoint,
  followWeight,
  legOpacity,
  mendThighs,
  paintedSkirt,
  SEAT_RISE,
  seatLift,
  thighEdge,
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

describe('S8.9 太ももの絵に描き込まれた裾は描かない（TD-05）', () => {
  it('例の値: 桜・金の縁・留め具は透明、太もも・水色の線・太ももの外の縁は残る', () => {
    for (const [x, y] of [
      [100, 250],
      [30, 280],
      [230, 30],
      [204, 103],
      [558, 250],
    ] as const)
      expect(paintedSkirt(x, y), `${x},${y}`).toBe(true)
    for (const [x, y] of [
      [300, 150],
      [200, 150],
      [140, 245],
      [205, 103],
      [358, 150],
    ] as const)
      expect(paintedSkirt(x, y), `${x},${y}`).toBe(false)
  })
  it('折れ線の角: 縁の点そのものは残り、1 つ外側は透明', () => {
    for (const [y, x] of [
      [0, 260],
      [58, 252],
      [68, 238],
      [103, 205],
      [124, 184],
      [150, 169],
      [190, 154],
      [226, 143],
      [238, 136],
      [351, 136],
    ] as const) {
      expect(paintedSkirt(x, y), `${x},${y}`).toBe(false)
      expect(paintedSkirt(x - 1, y), `${x - 1},${y}`).toBe(true)
    }
  })
  it('右は左右対称（x → 658 − x）。どの行も、透明なのは左右の端から続く 1 区間ずつで、真ん中は残る', () => {
    for (let y = 0; y < 352; y++) {
      let changes = 0
      for (let x = 0; x < 659; x++) {
        expect(paintedSkirt(658 - x, y)).toBe(paintedSkirt(x, y))
        if (x > 0 && paintedSkirt(x, y) !== paintedSkirt(x - 1, y)) changes++
      }
      expect(changes, `y=${y}`).toBe(2)
      expect(paintedSkirt(0, y)).toBe(true)
      expect(paintedSkirt(329, y)).toBe(false)
    }
  })
})

describe('S8.10 太ももの絵を切った境目は裾の層の下に入れる（TD-05）', () => {
  const width = 659,
    height = 352,
    image = (color: (x: number, y: number) => readonly [number, number, number, number]) => {
      const data = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), 4 * (y * width + x))
      return data
    },
    at = (data: Uint8ClampedArray, x: number, y: number) =>
      Array.from(data.slice(4 * (y * width + x), 4 * (y * width + x) + 4))
  it('残す線: y ≤ 226 は S8.9 の折れ線より 8 内側、226〜238 で 0 へ、238 から下は 136', () => {
    expect(thighEdge(103)).toBeCloseTo(213, 9)
    expect(thighEdge(0)).toBeCloseTo(268, 9)
    expect(thighEdge(226)).toBeCloseTo(151, 9)
    expect(thighEdge(232)).toBeCloseTo(143.5, 9)
    expect(thighEdge(238)).toBeCloseTo(136, 9)
    expect(thighEdge(300)).toBeCloseTo(136, 9)
  })
  it('例の値: 元のまま・塗り足し・透明の区分け（右は左右対称）', () => {
    expect(artZone(213, 103)).toBe('keep')
    expect(artZone(212, 103)).toBe('fill')
    expect(artZone(157, 103)).toBe('fill')
    expect(artZone(156, 103)).toBe('clear')
    expect(artZone(445, 103)).toBe('keep')
    expect(artZone(446, 103)).toBe('fill')
    expect(artZone(501, 103)).toBe('fill')
    expect(artZone(502, 103)).toBe('clear')
    expect(artZone(144, 232)).toBe('keep')
    expect(artZone(143, 232)).toBe('fill')
    expect(artZone(136, 300)).toBe('keep')
    expect(artZone(135, 300)).toBe('clear')
    expect(artZone(135, 238)).toBe('clear')
    expect(artZone(135, 237)).toBe('fill')
  })
  it('どの行も、外から 透明 → 塗り足し（y < 238 だけ、幅 56）→ 元のまま の順に並び、絵に描き込まれた裾の側は元のまま残らない', () => {
    for (let y = 0; y < height; y++) {
      const row = Array.from({ length: 330 }, (_, x) => artZone(x, y)),
        fill = row.filter((z) => z === 'fill').length
      expect(row.join('').replace(/(clear)+(fill)*(keep)+/, ''), `y=${y}`).toBe('')
      expect(fill, `y=${y}`).toBe(y < 238 ? 56 : 0)
      for (let x = 0; x < 330; x++) {
        expect(artZone(658 - x, y)).toBe(row[x])
        if (paintedSkirt(x, y)) expect(row[x], `${x},${y}`).not.toBe('keep')
      }
    }
  })
  it('絵の画素: 元のままの画素は変わらず、透明の画素は 4 成分とも 0、塗り足しはその行の色', () => {
    const data = image(() => [200, 200, 200, 200])
    mendThighs(data, width)
    expect(at(data, 213, 103)).toEqual([200, 200, 200, 200])
    expect(at(data, 300, 150)).toEqual([200, 200, 200, 200])
    expect(at(data, 212, 103)).toEqual([200, 200, 200, 200])
    expect(at(data, 157, 103)).toEqual([200, 200, 200, 200])
    expect(at(data, 501, 103)).toEqual([200, 200, 200, 200])
    expect(at(data, 156, 103)).toEqual([0, 0, 0, 0])
    expect(at(data, 502, 103)).toEqual([0, 0, 0, 0])
    expect(at(data, 100, 250)).toEqual([0, 0, 0, 0])
    expect(at(data, 135, 300)).toEqual([0, 0, 0, 0])
    expect(at(data, 136, 300)).toEqual([200, 200, 200, 200])
  })
  it('塗り足しの色は、線に近い 12 画素のうちいちばん暗い画素（水色の線・明るい縁取りを引き伸ばさない）。外側の裾の色は使わない', () => {
    // 残す画素は水色の線 (80, 220, 230)。線から 10 個目の画素だけスーツの地 (40, 40, 60)、13 個目はもっと暗い (0, 0, 0)（12 画素の外なので使わない）。線の外（絵の裾にあたる側）は紫。
    const data = image((x, y) => {
      const lx = Math.min(x, 658 - x),
        first = Math.ceil(thighEdge(y))
      return lx < first
        ? [180, 120, 230, 255]
        : lx === first + 9
          ? [40, 40, 60, 255]
          : lx === first + 12
            ? [0, 0, 0, 255]
            : [80, 220, 230, 255]
    })
    mendThighs(data, width)
    for (const y of [20, 103, 180, 237]) {
      const first = Math.ceil(thighEdge(y))
      expect(at(data, first - 1, y), `y=${y}`).toEqual([40, 40, 60, 255])
      expect(at(data, first - 56, y), `y=${y}`).toEqual([40, 40, 60, 255])
      expect(at(data, 658 - (first - 56), y), `y=${y}`).toEqual([40, 40, 60, 255])
      expect(at(data, first + 3, y), `y=${y}`).toEqual([80, 220, 230, 255])
    }
  })
  it('塗り足しの色は上下 3 行で平均する（例: 120 行目を境に 100 → 200 なら、120 行目は 157）', () => {
    const data = image((_, y) => (y < 120 ? [100, 100, 100, 255] : [200, 200, 200, 255]))
    mendThighs(data, width)
    const fillAt = (y: number) => at(data, Math.ceil(thighEdge(y)) - 5, y)
    expect(fillAt(116)).toEqual([100, 100, 100, 255])
    expect(fillAt(117)).toEqual([114, 114, 114, 255])
    expect(fillAt(120)).toEqual([157, 157, 157, 255])
    expect(fillAt(123)).toEqual([200, 200, 200, 255])
    // 端の行は、0〜237 行の中だけで平均する（238 行目から下の色は混ぜない）
    const edge = image((_, y) => (y < 238 ? [100, 100, 100, 255] : [0, 0, 0, 255]))
    mendThighs(edge, width)
    expect(at(edge, Math.ceil(thighEdge(237)) - 5, 237)).toEqual([100, 100, 100, 255])
  })
  it('濃さの違う行の平均: 色は濃さで重みを付け、透明な行の色（黒）を混ぜない', () => {
    // 0〜19 行は透明（色は 0）、20 行目から下は濃さ 255 の 200
    const data = image((_, y) => (y < 20 ? [0, 0, 0, 0] : [200, 200, 200, 255]))
    mendThighs(data, width)
    const fillAt = (y: number) => at(data, Math.ceil(thighEdge(y)) - 5, y)
    // 20 行目: 17〜19 行が透明、20〜23 行が 255 → 濃さ 255×4÷7 = 146、色は 200 のまま
    expect(fillAt(20)).toEqual([200, 200, 200, 146])
    expect(fillAt(16)).toEqual([0, 0, 0, 0])
  })
})
