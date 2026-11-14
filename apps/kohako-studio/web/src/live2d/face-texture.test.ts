import { describe, expect, it } from 'vitest'
import {
  eraseJawRow,
  arcX,
  boundaryLoops,
  capLoops,
  fitAffine,
  fillLashSlots,
  highlightHoles,
  luma,
  over,
  paintHighlight,
  rebakeBrows,
  rebakeEye,
  stitchSlit,
  type Atlas,
  type EyeSpec,
  type Rgba,
} from './face-texture'

const clear: Rgba = [0, 0, 0, 0]
function atlas(width: number, height: number): Atlas & { data: Map<string, Rgba> } {
  const data = new Map<string, Rgba>()
  return {
    width,
    height,
    data,
    get: (x, y) => data.get(`${x},${y}`) ?? clear,
    set: (x, y, p) => {
      data.set(`${x},${y}`, p)
    },
  }
}
const copy = (a: ReturnType<typeof atlas>) => {
  const b = atlas(a.width, a.height)
  for (const [k, v] of a.data) b.data.set(k, v)
  return b
}
const identity = {
  forward: (x: number, y: number): [number, number] => [x, y],
  inverse: (u: number, v: number): [number, number] => [u, v],
}
const shifted = (dx: number) => ({
  forward: (x: number, y: number): [number, number] => [x + dx, y],
  inverse: (u: number, v: number): [number, number] => [u - dx, v],
})

describe('アトラスの組み替えの部品', () => {
  it('折れ線を補間し範囲外は端の値を使う', () => {
    const arc = [
      [10, 100],
      [20, 120],
    ] as const
    expect(arcX(arc, 15)).toBe(110)
    expect(arcX(arc, 0)).toBe(100)
    expect(arcX(arc, 30)).toBe(120)
  })
  it('事前乗算の over は不透明な上の層をそのまま返す', () => {
    expect(over([10, 20, 30, 255], [200, 200, 200, 255])).toEqual([10, 20, 30, 255])
    expect(over(clear, [200, 200, 200, 255])).toEqual([200, 200, 200, 255])
  })
  it('透明な画素の輝度は明るい扱い', () => {
    expect(luma(clear)).toBe(255)
  })
  it('頂点と UV の対からアフィン変換を復元する', () => {
    const map = (x: number, y: number) => [x * 2 + y * 0.1 + 5, y * 2 - x * 0.1 + 7] as const
    const points = [
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
      [4, 7],
    ].map(([x, y]) => [x as number, y as number, ...map(x as number, y as number)] as [number, number, number, number])
    const { forward, inverse } = fitAffine(points)
    expect(forward(3, 4)[0]).toBeCloseTo(map(3, 4)[0])
    const [x, y] = inverse(...forward(3, 4))
    expect(x).toBeCloseTo(3)
    expect(y).toBeCloseTo(4)
  })
})

describe('白目の切れ目の縫合', () => {
  const arc = [
    [280, 610],
    [300, 610],
  ] as const
  // 2 枚の帯の間に幅 1 の切れ目がある。切れ目の両岸は 1-2 と 4-7。
  const points = [
    [605, 282],
    [610, 282],
    [610, 290],
    [605, 290],
    [611, 282],
    [616, 282],
    [616, 290],
    [611, 290],
  ] as const
  const at = (n: number) => points[n] as readonly [number, number]
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
  it('向かい合う境界の辺を三角形でつなぐ', () => {
    const added = stitchSlit(indices, at, arc, 280, 298)
    expect(added).toHaveLength(6)
    expect([...new Set(added)].sort((a, b) => a - b)).toEqual([1, 2, 4, 7])
  })
  it('離れた辺や弧から遠い辺はつながない', () => {
    expect(stitchSlit(indices, (n) => (n >= 4 ? [at(n)[0] + 8, at(n)[1]] : at(n)), arc, 280, 298)).toEqual([])
    expect(stitchSlit(indices, (n) => [at(n)[0] + 30, at(n)[1]], arc, 280, 298)).toEqual([])
  })
})

describe('眉の組み替え', () => {
  it('顔の層の焼き込み眉を上下の肌で埋め、眉の層の前髪の断片を除く', () => {
    const source = atlas(800, 400),
      brow = shifted(100),
      face = identity
    const skin: Rgba = [240, 220, 210, 255],
      ink: Rgba = [20, 20, 25, 255],
      hair: Rgba = [120, 120, 130, 255]
    for (let x = 520; x < 540; x++) for (let y = 236; y < 258; y++) source.set(x, y, y >= 245 && y <= 247 ? ink : skin)
    for (let x = 520; x < 540; x++) for (let y = 245; y <= 247; y++) source.set(x + 100, y, ink)
    source.set(650, 240, hair)
    const target = copy(source),
      result = rebakeBrows(source, target, brow, face)
    expect(result.erased).toBeGreaterThan(0)
    expect(luma(target.get(530, 246))).toBeGreaterThan(200) // 顔の層の眉は肌色へ
    expect(target.get(630, 246)).toEqual(ink) // 動く眉の層は残す
    expect(target.get(650, 240)).toEqual(clear) // 前髪の断片は除く
  })
  it('前髪の束と交差する眉は髪の色で埋め、髪と肌の境目は混ぜない', () => {
    const source = atlas(800, 400),
      hair: Rgba = [90, 90, 105, 255],
      skin: Rgba = [240, 220, 210, 255],
      ink: Rgba = [20, 20, 25, 255]
    for (let y = 236; y < 258; y++) {
      source.set(530, y, y >= 245 && y <= 247 ? ink : hair)
      source.set(534, y, y >= 245 && y <= 247 ? ink : y < 246 ? hair : skin)
    }
    for (const x of [530, 534]) for (let y = 245; y <= 247; y++) source.set(x + 100, y, ink)
    const target = copy(source)
    rebakeBrows(source, target, shifted(100), identity)
    expect(target.get(530, 246)).toEqual(hair)
    expect([hair, skin]).toContainEqual(target.get(534, 246))
  })
  it('上下とも線画の濃さの列は埋めない', () => {
    const source = atlas(800, 400),
      line: Rgba = [22, 22, 30, 255],
      ink: Rgba = [5, 5, 8, 255]
    for (let y = 236; y < 258; y++) source.set(530, y, y >= 245 && y <= 247 ? ink : line)
    for (let y = 245; y <= 247; y++) source.set(630, y, ink)
    const target = copy(source)
    rebakeBrows(source, target, shifted(100), identity)
    expect(target.get(530, 246)).toEqual(ink)
  })
  it('左の眉の内端は前髪の層の焼き込みも消す', () => {
    const source = atlas(1000, 400),
      hair: Rgba = [90, 90, 105, 255],
      ink: Rgba = [20, 20, 25, 255]
    for (let y = 240; y < 256; y++) source.set(752, y, y >= 247 && y <= 249 ? ink : hair)
    for (let y = 247; y <= 249; y++) source.set(652, y, ink)
    const target = copy(source)
    rebakeBrows(source, target, shifted(100), identity, shifted(200))
    expect(target.get(752, 248)).toEqual(hair)
  })
})

describe('目の組み替え', () => {
  const spec: EyeSpec = {
    lash: 13,
    iris: 14,
    white: 15,
    top: 279,
    bottom: 297,
    strip: 275,
    left: [
      [279, 510],
      [297, 510],
    ],
    right: [
      [279, 540],
      [297, 540],
    ],
  }
  const lash = shifted(0),
    iris = shifted(100),
    white = shifted(200)
  it('輪郭線がまつ毛の尾と続く行は残し、離れた行だけ消す', () => {
    const source = atlas(900, 400),
      ink: Rgba = [30, 20, 40, 255]
    for (let y = 279; y <= 297; y++) source.set(510, y, ink)
    source.set(507, 281, ink) // 尾は行 281 だけ輪郭の外へ続く
    const target = copy(source)
    rebakeEye(source, target, spec, lash, iris, white)
    expect(target.get(510, 281)).toEqual(ink)
    expect(target.get(510, 290)).toEqual(clear)
  })
  it('輪郭線を虹彩へ移し、白目の抜きを埋め、虹彩の外の影をまつ毛へ移す', () => {
    const source = atlas(900, 400),
      ring: Rgba = [10, 10, 40, 255],
      blue: Rgba = [40, 60, 200, 255],
      sclera: Rgba = [250, 250, 252, 255],
      shade: Rgba = [80, 50, 110, 255]
    for (let y = 279; y <= 297; y++) source.set(510, y, ring)
    for (let x = 512; x <= 538; x++) for (let y = 282; y <= 295; y++) source.set(x + 100, y, blue)
    for (let x = 500; x <= 550; x++)
      for (let y = 276; y <= 297; y++) if (x < 509 || x > 541) source.set(x + 200, y, sclera)
    source.set(601, 276, shade) // 虹彩の層の外側（まぶたの影）。白目のマスク内
    source.set(701, 276, sclera)
    const target = copy(source),
      count = rebakeEye(source, target, spec, lash, iris, white)
    expect(count.ring).toBeGreaterThan(0)
    expect(target.get(510, 285)).toEqual(clear) // まつ毛の層から輪郭線が消える
    expect(target.get(610, 285)).toEqual(over(ring, clear)) // 虹彩の層に輪郭線が移る
    expect(target.get(725, 288)[3]).toBe(255) // 虹彩の下の白目は抜けない
    expect(target.get(601, 276)).toEqual(clear) // 影は虹彩の層から消える
    expect(target.get(501, 276)).toEqual(shade) // まつ毛の層へ移る
  })
  it('白目の層に残る元の虹彩の淡い輪郭は、色味によらず周囲の白目で埋める', () => {
    const source = atlas(900, 400),
      sclera: Rgba = [250, 250, 252, 255],
      ghost: Rgba = [200, 190, 200, 255]
    for (let x = 495; x <= 555; x++) for (let y = 276; y <= 297; y++) source.set(x + 200, y, sclera)
    source.set(745, 288, ghost)
    const target = copy(source)
    rebakeEye(source, target, spec, lash, iris, white)
    expect(target.get(745, 288)).toEqual(sclera)
  })
  it('元の白目の形の外へは塗り広げず、弧のそばの抜きだけ埋める', () => {
    const source = atlas(900, 400),
      sclera: Rgba = [250, 250, 252, 255]
    for (let y = 279; y <= 297; y++) for (let x = 500; x <= 503; x++) source.set(x + 200, y, sclera)
    for (let y = 279; y <= 297; y++) for (let x = 512; x <= 538; x++) source.set(x + 200, y, sclera)
    const target = copy(source)
    rebakeEye(source, target, spec, lash, iris, white)
    expect(target.get(705, 288)).toEqual(clear) // 弧から 5 離れた透明はシルエットの外
    expect(target.get(708, 288)[3]).toBe(255) // 弧から 2 の抜きは埋める
  })
  it('虹彩の上端より上は縁色で埋め、内部の穴は白く保つ', () => {
    const source = atlas(900, 400),
      rim: Rgba = [30, 40, 80, 255]
    for (let y = 283; y <= 296; y++) if (y !== 285) source.set(620, y, rim)
    const target = copy(source)
    rebakeEye(source, target, spec, lash, iris, white)
    expect(target.get(620, 281)).toEqual(rim)
    expect(target.get(620, 285)).toEqual([255, 255, 255, 255])
  })
  it('虹彩の上半分の穴（ハイライト）は白で埋めて虹彩と一緒に動かす', () => {
    const source = atlas(900, 400),
      blue: Rgba = [40, 60, 200, 255],
      pale: Rgba = [230, 225, 240, 255]
    for (let x = 512; x <= 538; x++)
      for (let y = 280; y <= 296; y++) {
        if (x !== 520 || y !== 283) source.set(x + 100, y, blue)
        source.set(x + 200, y, pale)
      }
    const target = copy(source)
    rebakeEye(source, target, spec, lash, iris, white)
    expect(target.get(620, 283)).toEqual([255, 255, 255, 255])
  })
})

describe('ハイライトの穴', () => {
  // 外周 0-3 の四角の中に、穴 4-7 がある。穴の周りを 8 枚の三角形で囲む。
  const ring = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
  const points: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40],
    [18, 18],
    [22, 18],
    [22, 22],
    [18, 22],
  ]
  const at = (n: number) => points[n] as [number, number]

  it('小さな閉路だけを穴として拾い、外周はふさがない', () => {
    expect(boundaryLoops(ring).map((l) => [...l].sort((a, b) => a - b))).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ])
    expect(highlightHoles(ring, at, 8).map((l) => [...l].sort((a, b) => a - b))).toEqual([[4, 5, 6, 7]])
  })

  it('ふさぐと穴の閉路がなくなる', () => {
    const closed = [...ring, ...capLoops(highlightHoles(ring, at, 8))]
    expect(closed.length).toBe(ring.length + 6)
    expect(highlightHoles(closed, at, 8)).toEqual([])
    expect(boundaryLoops(closed).length).toBe(1)
  })

  it('穴の中を白にし、縁の半透明は白へなじませ、離れた画素は変えない', () => {
    const source = atlas(16, 16),
      target = atlas(16, 16),
      blue: Rgba = [40, 60, 200, 255]
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const p: Rgba = x >= 6 && x <= 9 && y >= 6 && y <= 9 ? clear : blue
        source.set(x, y, p)
        target.set(x, y, p)
      }
    source.set(5, 7, [40, 60, 200, 100])
    target.set(5, 7, [40, 60, 200, 100])
    paintHighlight(source, target, [
      [6, 6],
      [10, 6],
      [10, 10],
      [6, 10],
    ])
    expect(target.get(7, 7)).toEqual([255, 255, 255, 255])
    expect(target.get(5, 7)[3]).toBeCloseTo(255, 6)
    expect(target.get(5, 7)[0]).toBeGreaterThan(100)
    expect(target.get(2, 2)).toEqual(blue)
  })
})

import { blushWeight } from './face-texture'

it('頬の赤みは左右対称で縁の外では消える', () => {
  expect(blushWeight(514, 319)).toBeGreaterThan(0)
  expect(blushWeight(514, 319)).toBe(blushWeight(630, 319))
  expect(blushWeight(542, 319)).toBe(0)
  expect(blushWeight(514, 325)).toBeLessThan(blushWeight(514, 319))
})

it('潤みは虹彩下部の局所に限られる', async () => {
  const { tearWeight } = await import('./face-texture')
  expect(tearWeight(0, 0, 0, 0)).toBeCloseTo(0.65)
  expect(tearWeight(4, 0, 0, 0)).toBe(0)
})

describe('まつ毛の隙間（BOXP-525）', () => {
  const spec: EyeSpec = {
    lash: 13,
    iris: 14,
    white: 15,
    top: 279,
    bottom: 297,
    strip: 275,
    left: [
      [279, 510],
      [297, 510],
    ],
    right: [
      [279, 540],
      [297, 540],
    ],
  }
  const ink: Rgba = [40, 20, 50, 255],
    faint: Rgba = [30, 30, 30, 60]
  it('上下を濃い線に挟まれた細い隙間は線の色で不透明にする', () => {
    const target = atlas(900, 400)
    for (const y of [266, 267, 268, 272, 273]) target.set(520, y, ink) // 上 3 画素・下 2 画素の線の間に隙間 3 画素（269〜271）
    target.set(520, 270, faint)
    expect(fillLashSlots(target, spec, identity)).toBe(3)
    expect(target.get(520, 269)).toEqual([40, 20, 50, 255])
    expect(target.get(520, 270)[3]).toBe(255)
    expect(luma(target.get(520, 270))).toBeLessThan(60)
  })
  it('淡い二重まぶたの線との間・白目との広い間・虹彩より下は塗らない', () => {
    const target = atlas(900, 400),
      crease: Rgba = [60, 50, 70, 150]
    target.set(525, 266, crease)
    target.set(525, 270, ink) // 片側が淡い線
    for (const y of [262, 263, 264, 273, 274]) target.set(530, y, ink) // 8 画素の広い間
    target.set(540, 266, ink)
    for (const y of [272, 273, 274]) target.set(540, y, ink) // 濃くても 1 画素の細い二重まぶたの線
    target.set(535, 281, ink)
    target.set(535, 284, ink) // 虹彩の上端より下
    expect(fillLashSlots(target, spec, identity)).toBe(0)
  })
})

describe('まつ毛の隙間の 1 列の漏れ', () => {
  const spec: EyeSpec = {
    lash: 13,
    iris: 14,
    white: 15,
    top: 279,
    bottom: 297,
    strip: 275,
    left: [
      [279, 510],
      [297, 510],
    ],
    right: [
      [279, 540],
      [297, 540],
    ],
  }
  const ink: Rgba = [40, 20, 50, 255]
  it('左右が塗られた 1〜2 列の漏れもつなぐ', () => {
    const target = atlas(900, 400)
    for (const x of [520, 522]) for (const y of [266, 267, 268, 272, 273]) target.set(x, y, ink)
    for (const y of [266, 267, 268]) target.set(521, y, ink) // 下の線が欠けた列
    fillLashSlots(target, spec, identity)
    expect(target.get(521, 270)[3]).toBe(255)
  })
})

describe('あごの輪郭外の下地', () => {
  it('輪郭の外の肌だけを除き、内側・赤み・輪郭・髪を残す', () => {
    const skin: Rgba = [240, 200, 180, 255],
      blush: Rgba = [240, 170, 160, 255],
      ink: Rgba = [30, 20, 25, 255],
      hair: Rgba = [70, 55, 65, 255]
    const row = [skin, skin, hair, skin, skin, ink, blush, skin, skin]
    expect(eraseJawRow(row, 8, 7, 0, 330)).toEqual([4, 3, 1, 0])
    expect(eraseJawRow(row, 8, 7, 0, 280)).toEqual([])
    expect(eraseJawRow([...row].reverse(), 0, 1, 8, 330)).toEqual([4, 5, 7, 8])
  })
})
