import { describe, expect, it } from 'vitest'
import {
  barycentric,
  CROWN_HAIR_LUMA,
  fillCyan,
  fillUnderCrownStrip,
  dimRim,
  growLoopUv,
  growTassel,
  isCyan,
  isForeignToHair,
  isOrnamentPink,
  nearOrnament,
  outerLoop,
  pasteOver,
  powerOfTwo,
  stepTasselVertices,
  trimOuterFringe,
} from './hair-parts'

describe('isForeignToHair (BOXP-525 頬・もみあげのゴミ)', () => {
  it('髪房に混ざった肌色・桜・白は別素材とみなす', () => {
    expect(isForeignToHair(246, 216, 210)).toBe(true) // 肌
    expect(isForeignToHair(245, 190, 205)).toBe(true) // 桜
    expect(isForeignToHair(250, 250, 248)).toBe(true) // 白
  })
  it('髪の暗い紫・青みのハイライト・紐の紫は残す', () => {
    expect(isForeignToHair(52, 46, 70)).toBe(false)
    expect(isForeignToHair(150, 142, 190)).toBe(false)
    expect(isForeignToHair(140, 100, 200)).toBe(false)
    expect(isForeignToHair(120, 80, 60)).toBe(false) // 暗い茶の結び目
  })
})

describe('growLoopUv (BOXP-525 髪飾りの先端の欠け)', () => {
  // 10x10 の正方形（時計回り・反時計回りの両方）。
  const square = [0, 0, 10, 0, 10, 10, 0, 10]
  it('選んだ頂点だけを閉路の外へ動かす', () => {
    const out = growLoopUv(square, [0, 1, 2, 3], (n) => n === 0, 2)
    expect(out[0]).toBeLessThan(0)
    expect(out[1]).toBeLessThan(0)
    expect(Math.hypot(out[0] as number, out[1] as number)).toBeCloseTo(2, 5)
    expect(Array.from(out.slice(2))).toEqual(square.slice(2))
  })
  it('巻き方が逆でも外へ動かす', () => {
    const out = growLoopUv(square, [3, 2, 1, 0], (n) => n === 2, 2)
    expect(out[4]).toBeGreaterThan(10)
    expect(out[5]).toBeGreaterThan(10)
  })
  it('外周は囲む範囲が最大の閉路', () => {
    const at = (n: number) =>
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [4, 4],
        [5, 4],
        [5, 5],
      ][n] as [number, number]
    expect(
      outerLoop(
        [
          [4, 5, 6],
          [0, 1, 2, 3],
        ],
        at,
      ),
    ).toEqual([0, 1, 2, 3])
  })
})

describe('nearOrnament (BOXP-525 広げる頂点の選択)', () => {
  it('桜の花びらのそばだけを選び、髪束の縁や白い線は選ばない', () => {
    expect(isOrnamentPink([245, 190, 205, 255])).toBe(true)
    expect(isOrnamentPink([122, 95, 102, 128])).toBe(true) // 乗算済みの縁
    expect(isOrnamentPink([52, 46, 70, 255])).toBe(false)
    expect(isOrnamentPink([240, 240, 245, 255])).toBe(false)
    const pink = (x: number, y: number) =>
      (x === 10 && y === 10 ? [245, 190, 205, 255] : [0, 0, 0, 0]) as [number, number, number, number]
    expect(nearOrnament(pink, 7.5, 10.2, 4)).toBe(true)
    expect(nearOrnament(pink, 2, 10, 4)).toBe(false)
  })
})

describe('後ろ髪アトラスの孤立片', () => {
  it('桜の左上に浮く欠片だけを対象にする', async () => {
    const { isBackHairFragment } = await import('./hair-parts')
    expect(isBackHairFragment(256, 76)).toBe(true)
    expect(isBackHairFragment(249, 76)).toBe(false)
    expect(isBackHairFragment(264, 76)).toBe(false)
    expect(isBackHairFragment(256, 85)).toBe(false)
    expect(isBackHairFragment(280, 55)).toBe(false)
  })
  it('頭頂の帯（CROWN_STRIP）の範囲の画素は孤立片として消さない', async () => {
    const { isBackHairFragment, CROWN_STRIP } = await import('./hair-parts')
    for (let x = CROWN_STRIP.x0; x < CROWN_STRIP.x1; x++)
      for (let y = CROWN_STRIP.y0; y < CROWN_STRIP.y1 + CROWN_STRIP.depth; y++)
        expect(isBackHairFragment(x, y)).toBe(false)
  })
})

describe('dimRim (BOXP-525 r21 髪の左上の白い線)', () => {
  // 1 行 12 画素: 透明 2 / 輪郭線 1 / 明るい帯 3 / 髪の地 6。
  const row = () => {
    const px = new Uint8Array(12 * 4)
    const set = (x: number, r: number, g: number, b: number) => px.set([r, g, b, 255], x * 4)
    set(2, 20, 18, 30)
    for (const x of [3, 4, 5]) set(x, 120, 118, 140)
    for (let x = 6; x < 12; x++) set(x, 58, 56, 75)
    return px
  }
  it('外側に近い明るい帯だけを髪の地の輝度へ落とし、輪郭線と髪の地は変えない', () => {
    const px = row()
    expect(dimRim(px, 12, 1, 4)).toBe(3)
    for (const x of [3, 4, 5]) {
      const luma = (px[x * 4] as number) * 0.3 + (px[x * 4 + 1] as number) * 0.59 + (px[x * 4 + 2] as number) * 0.11
      expect(luma).toBeGreaterThan(CROWN_HAIR_LUMA - 2)
      expect(luma).toBeLessThan(CROWN_HAIR_LUMA + 2)
      expect(px[x * 4 + 2]).toBeGreaterThan(px[x * 4] as number) // 青みは残す
    }
    expect([...px.subarray(8, 12)]).toEqual([20, 18, 30, 255])
    expect([...px.subarray(6 * 4, 6 * 4 + 4)]).toEqual([58, 56, 75, 255])
  })
  it('透明な外側から遠い明るい画素（髪の中のつや）と桜色は変えない', () => {
    const px = new Uint8Array(30 * 4)
    for (let x = 0; x < 30; x++) px.set([58, 56, 75, 255], x * 4)
    px.set([140, 138, 160, 255], 20 * 4)
    px.set([250, 190, 200, 255], 1 * 4)
    px.set([0, 0, 0, 0], 0)
    expect(dimRim(px, 30, 1, 9)).toBe(0)
    expect([...px.subarray(80, 84)]).toEqual([140, 138, 160, 255])
    expect([...px.subarray(4, 8)]).toEqual([250, 190, 200, 255])
  })
})

describe('dimRim のぼかし (BOXP-525 r21 背景が透ける白い線)', () => {
  it('外周の半透明を gain 倍に締め、色（ストレート）は保つ', () => {
    // 透明 1 / 不透明度 40 の暗い輪郭 / 不透明度 120 の髪の地 / 不透明の髪の地。
    const px = new Uint8Array([0, 0, 0, 0, 3, 3, 5, 40, 27, 26, 35, 120, 58, 56, 75, 255])
    expect(dimRim(px, 4, 1, 1, 3)).toBe(2)
    expect([...px.subarray(4, 8)]).toEqual([9, 9, 15, 120])
    expect(px[11]).toBe(255)
    expect(px[8]).toBeGreaterThan(55)
    expect(px[8]).toBeLessThan(60)
    expect([...px.subarray(12, 16)]).toEqual([58, 56, 75, 255])
  })
})

describe('powerOfTwo (BOXP-525 r21 ミップマップ用の切り出し)', () => {
  it('n 以上の最小の 2 のべき乗', () => {
    expect([1, 2, 3, 255, 256, 257, 1100].map(powerOfTwo)).toEqual([1, 2, 4, 256, 256, 512, 2048])
  })
})

describe('房飾りの 3 段目右 (BOXP-525 r22 組み飾りの下部の途切れ)', () => {
  it('pasteOver は写し元を上から重ね、下端だけ不透明度を下げる', () => {
    // 1x4: 上 2 行が写し元（不透明の赤）、下 2 行が写し先（不透明の紺）。
    const px = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 80, 255, 0, 0, 80, 255])
    const n = pasteOver(px, 1, 4, { x0: 0, y0: 0, x1: 1, y1: 2 }, [0, 2], 1)
    expect(n).toBe(2)
    expect(Array.from(px.slice(8, 12))).toEqual([255, 0, 0, 255])
    // 最下行は半分だけ重なる。
    expect(px[12]).toBe(128)
    expect(px[14]).toBe(40)
    expect(px[15]).toBe(255)
  })
  it('barycentric は三角形の外でも外挿する', () => {
    const [a, b, c] = barycentric([2, 0], [0, 0], [1, 0], [0, 1])
    expect(a).toBeCloseTo(-1)
    expect(b).toBeCloseTo(2)
    expect(c).toBeCloseTo(0)
  })
  it('growTassel は指定の外周の頂点の UV を動かし、位置は動かさない三角形からの外挿で同じだけ動かす', () => {
    // 2x2 の格子（UV = 位置）。頂点 3 (10,10) を (+2, +1) 広げる。
    const uv = new Float32Array([0, 0, 10, 0, 0, 10, 10, 10, 20, 0])
    const indices = [0, 1, 2, 1, 3, 2, 1, 4, 3]
    const rig = growTassel(uv, indices, [{ at: [10, 10], by: [2, 1] }])
    expect(rig.moved.map((m) => m.n)).toEqual([3])
    expect(Array.from(uv.slice(6, 8))).toEqual([12, 11])
    // 位置が UV と同じ配置なら、外挿の結果も同じ位置になる（絵が縮まない）。
    const v = new Float32Array([0, 0, 10, 0, 0, 10, 10, 10, 20, 0])
    stepTasselVertices(v, rig)
    expect(v[6]).toBeCloseTo(12)
    expect(v[7]).toBeCloseTo(11)
    // 全体が平行移動しても付いていく。
    const moved = v.map((x, i) => x + (i % 2 ? 5 : -3))
    stepTasselVertices(moved, rig)
    expect(moved[6]).toBeCloseTo(9)
    expect(moved[7]).toBeCloseTo(16)
  })
  it('頂点が見つからなければ失敗する', () => {
    const uv = new Float32Array([0, 0, 10, 0, 0, 10])
    expect(() => growTassel(uv, [0, 1, 2], [{ at: [50, 50], by: [1, 1] }])).toThrow()
  })
})

describe('右の横髪の外側の縁 (BOXP-525 r22 上の右側のズレ)', () => {
  // w×h の不透明な横帯（各行 0..edge-1 が不透明）を作る。
  const band = (w: number, edges: number[]) => {
    const px = new Uint8Array(w * edges.length * 4)
    edges.forEach((e, y) => {
      for (let x = 0; x < e; x++) px.set([40, 40, 60, 255], (y * w + x) * 4)
    })
    return px
  }
  it('外周を上下の中央値で平らにしてから一定の幅を透明にする（1 行だけ飛び出た画素も消える）', () => {
    const w = 20,
      edges = [15, 15, 18, 15, 15]
    const px = band(w, edges)
    const n = trimOuterFringe(px, w, edges.length, 4, 1, 2, 1)
    expect(n).toBeGreaterThan(0)
    // 最下行は taper で削らないので、それより上を見る。
    for (let y = 0; y < edges.length - 1; y++) {
      expect(px[(y * w + 9) * 4 + 3]).toBe(255)
      expect(px[(y * w + 11) * 4 + 3]).toBe(0)
    }
  })
  it('下端では削る幅を 0 へ戻す', () => {
    const w = 20,
      edges = [15, 15, 15, 15, 15]
    const px = band(w, edges)
    trimOuterFringe(px, w, edges.length, 4, 1, 2, 4)
    // 最下行は削らない。
    expect(px[(4 * w + 14) * 4 + 3]).toBe(255)
    expect(px[(0 * w + 14) * 4 + 3]).toBe(0)
  })
  it('水色の飾りを左側の髪の地の色で埋め、輪郭線の色は使わない', () => {
    expect(isCyan(80, 200, 240, 255)).toBe(true)
    expect(isCyan(150, 142, 190, 255)).toBe(false)
    // [地, 線, 水色, 水色]
    const px = new Uint8Array([60, 55, 90, 255, 10, 10, 20, 255, 80, 200, 240, 255, 80, 200, 240, 255])
    expect(fillCyan(px, 4, 1, 0, 0, 4, 1)).toBe(2)
    expect(Array.from(px.slice(8, 12))).toEqual([60, 55, 90, 255])
    expect(Array.from(px.slice(12, 16))).toEqual([60, 55, 90, 255])
  })
})

describe('後ろ髪の頭頂の帯の下 (BOXP-525 r23 髪の左上の白い線)', () => {
  const strip = { x0: 0, full: 2, x1: 6, y0: 0, y1: 10, depth: 3 }
  // 6×10、各列 y=1..3 が帯（輪郭線 y=1 と地 y=2,3）、その下は透明。
  const make = () => {
    const w = 6,
      h = 10,
      px = new Uint8Array(w * h * 4)
    for (let x = 0; x < w; x++) {
      px.set([10, 10, 20, 255], (1 * w + x) * 4)
      px.set([60, 55, 90, 255], (2 * w + x) * 4)
      px.set([62, 57, 92, 255], (3 * w + x) * 4)
    }
    return { px, w, h }
  }
  it('帯の直下を地の色で不透明にし、帯の上（背景側）は変えない', () => {
    const { px, w, h } = make()
    const n = fillUnderCrownStrip(px, w, h, 0, 0, strip)
    expect(n).toBeGreaterThan(0)
    // 先端側から増える: x=0 は 0 画素、x>=2 は 3 画素。
    expect(px[(4 * w + 0) * 4 + 3]).toBe(0)
    for (let y = 4; y <= 6; y++) expect(px[(y * w + 4) * 4 + 3]).toBe(255)
    expect(px[(7 * w + 4) * 4 + 3]).toBe(0)
    expect(px[(0 * w + 4) * 4 + 3]).toBe(0)
    // 輪郭線の色は使わない。
    expect(Array.from(px.slice((4 * w + 4) * 4, (4 * w + 4) * 4 + 3))).not.toEqual([10, 10, 20])
  })
  it('帯がない列は変えない', () => {
    const w = 4,
      h = 6,
      px = new Uint8Array(w * h * 4)
    expect(fillUnderCrownStrip(px, w, h, 0, 0, strip)).toBe(0)
  })
})
