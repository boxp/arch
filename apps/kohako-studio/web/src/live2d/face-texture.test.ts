import { describe, expect, it } from 'vitest'
import { arcX, fitAffine, luma, over, rebakeBrows, rebakeEye, type Atlas, type EyeSpec, type Rgba } from './face-texture'

const clear: Rgba = [0, 0, 0, 0]
function atlas(width: number, height: number): Atlas & { data: Map<string, Rgba> } {
  const data = new Map<string, Rgba>()
  return { width, height, data, get: (x, y) => data.get(`${x},${y}`) ?? clear, set: (x, y, p) => { data.set(`${x},${y}`, p) } }
}
const copy = (a: ReturnType<typeof atlas>) => { const b = atlas(a.width, a.height); for (const [k, v] of a.data) b.data.set(k, v); return b }
const identity = { forward: (x: number, y: number): [number, number] => [x, y], inverse: (u: number, v: number): [number, number] => [u, v] }
const shifted = (dx: number) => ({ forward: (x: number, y: number): [number, number] => [x + dx, y], inverse: (u: number, v: number): [number, number] => [u - dx, v] })

describe('アトラスの組み替えの部品', () => {
  it('折れ線を補間し範囲外は端の値を使う', () => {
    const arc = [[10, 100], [20, 120]] as const
    expect(arcX(arc, 15)).toBe(110)
    expect(arcX(arc, 0)).toBe(100)
    expect(arcX(arc, 30)).toBe(120)
  })
  it('事前乗算の over は不透明な上の層をそのまま返す', () => {
    expect(over([10, 20, 30, 255], [200, 200, 200, 255])).toEqual([10, 20, 30, 255])
    expect(over(clear, [200, 200, 200, 255])).toEqual([200, 200, 200, 255])
  })
  it('透明な画素の輝度は明るい扱い', () => { expect(luma(clear)).toBe(255) })
  it('頂点と UV の対からアフィン変換を復元する', () => {
    const map = (x: number, y: number) => [x * 2 + y * 0.1 + 5, y * 2 - x * 0.1 + 7] as const
    const points = [[0, 0], [10, 0], [0, 10], [10, 10], [4, 7]].map(([x, y]) => [x as number, y as number, ...map(x as number, y as number)] as [number, number, number, number])
    const { forward, inverse } = fitAffine(points)
    expect(forward(3, 4)[0]).toBeCloseTo(map(3, 4)[0])
    const [x, y] = inverse(...forward(3, 4))
    expect(x).toBeCloseTo(3); expect(y).toBeCloseTo(4)
  })
})

describe('眉の組み替え', () => {
  it('顔の層の焼き込み眉を上下の肌で埋め、眉の層の前髪の断片を除く', () => {
    const source = atlas(800, 400), brow = shifted(100), face = identity
    const skin: Rgba = [240, 220, 210, 255], ink: Rgba = [20, 20, 25, 255], hair: Rgba = [120, 120, 130, 255]
    for (let x = 520; x < 540; x++) for (let y = 236; y < 258; y++) source.set(x, y, y >= 245 && y <= 247 ? ink : skin)
    for (let x = 520; x < 540; x++) for (let y = 245; y <= 247; y++) source.set(x + 100, y, ink)
    source.set(650, 240, hair)
    const target = copy(source), result = rebakeBrows(source, target, brow, face)
    expect(result.erased).toBeGreaterThan(0)
    expect(luma(target.get(530, 246))).toBeGreaterThan(200) // 顔の層の眉は肌色へ
    expect(target.get(630, 246)).toEqual(ink) // 動く眉の層は残す
    expect(target.get(650, 240)).toEqual(clear) // 前髪の断片は除く
  })
  it('前髪の束と交差する眉は髪の色で埋め、髪と肌の境目は混ぜない', () => {
    const source = atlas(800, 400), hair: Rgba = [90, 90, 105, 255], skin: Rgba = [240, 220, 210, 255], ink: Rgba = [20, 20, 25, 255]
    for (let y = 236; y < 258; y++) { source.set(530, y, y >= 245 && y <= 247 ? ink : hair); source.set(534, y, y >= 245 && y <= 247 ? ink : y < 246 ? hair : skin) }
    for (const x of [530, 534]) for (let y = 245; y <= 247; y++) source.set(x + 100, y, ink)
    const target = copy(source)
    rebakeBrows(source, target, shifted(100), identity)
    expect(target.get(530, 246)).toEqual(hair)
    expect([hair, skin]).toContainEqual(target.get(534, 246))
  })
  it('前髪に隠れた列（上下が暗い）は埋めない', () => {
    const source = atlas(800, 400), hair: Rgba = [40, 40, 50, 255], ink: Rgba = [20, 20, 25, 255]
    for (let y = 236; y < 258; y++) source.set(530, y, hair)
    for (let y = 245; y <= 247; y++) source.set(630, y, ink)
    const target = copy(source)
    rebakeBrows(source, target, shifted(100), identity)
    expect(target.get(530, 246)).toEqual(hair)
  })
})

describe('目の組み替え', () => {
  const spec: EyeSpec = { lash: 13, iris: 14, white: 15, top: 279, bottom: 297, strip: 275, left: [[279, 510], [297, 510]], right: [[279, 540], [297, 540]] }
  const lash = shifted(0), iris = shifted(100), white = shifted(200)
  it('輪郭線を虹彩へ移し、白目の抜きを埋め、虹彩の外の影をまつ毛へ移す', () => {
    const source = atlas(900, 400), ring: Rgba = [10, 10, 40, 255], blue: Rgba = [40, 60, 200, 255], sclera: Rgba = [250, 250, 252, 255], shade: Rgba = [80, 50, 110, 255]
    for (let y = 279; y <= 297; y++) source.set(510, y, ring)
    for (let x = 512; x <= 538; x++) for (let y = 282; y <= 295; y++) source.set(x + 100, y, blue)
    for (let x = 500; x <= 550; x++) for (let y = 276; y <= 297; y++) if (x < 509 || x > 541) source.set(x + 200, y, sclera)
    source.set(601, 276, shade) // 虹彩の層の外側（まぶたの影）。白目のマスク内
    source.set(701, 276, sclera)
    const target = copy(source), count = rebakeEye(source, target, spec, lash, iris, white)
    expect(count.ring).toBeGreaterThan(0)
    expect(target.get(510, 285)).toEqual(clear) // まつ毛の層から輪郭線が消える
    expect(target.get(610, 285)).toEqual(over(ring, clear)) // 虹彩の層に輪郭線が移る
    expect(target.get(725, 288)[3]).toBe(255) // 虹彩の下の白目は抜けない
    expect(target.get(601, 276)).toEqual(clear) // 影は虹彩の層から消える
    expect(target.get(501, 276)).toEqual(shade) // まつ毛の層へ移る
  })
})
