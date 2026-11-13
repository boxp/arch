import { describe, expect, it } from 'vitest'
import { growLoopUv, isForeignToHair, isOrnamentPink, nearOrnament, outerLoop } from './hair-parts'

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
    const out = growLoopUv(square, [0, 1, 2, 3], n => n === 0, 2)
    expect(out[0]).toBeLessThan(0); expect(out[1]).toBeLessThan(0)
    expect(Math.hypot(out[0] as number, out[1] as number)).toBeCloseTo(2, 5)
    expect(Array.from(out.slice(2))).toEqual(square.slice(2))
  })
  it('巻き方が逆でも外へ動かす', () => {
    const out = growLoopUv(square, [3, 2, 1, 0], n => n === 2, 2)
    expect(out[4]).toBeGreaterThan(10); expect(out[5]).toBeGreaterThan(10)
  })
  it('外周は囲む範囲が最大の閉路', () => {
    const at = (n: number) => [[0, 0], [10, 0], [10, 10], [0, 10], [4, 4], [5, 4], [5, 5]][n] as [number, number]
    expect(outerLoop([[4, 5, 6], [0, 1, 2, 3]], at)).toEqual([0, 1, 2, 3])
  })
})

describe('nearOrnament (BOXP-525 広げる頂点の選択)', () => {
  it('桜の花びらのそばだけを選び、髪束の縁や白い線は選ばない', () => {
    expect(isOrnamentPink([245, 190, 205, 255])).toBe(true)
    expect(isOrnamentPink([122, 95, 102, 128])).toBe(true) // 乗算済みの縁
    expect(isOrnamentPink([52, 46, 70, 255])).toBe(false)
    expect(isOrnamentPink([240, 240, 245, 255])).toBe(false)
    const pink = (x: number, y: number) => (x === 10 && y === 10 ? [245, 190, 205, 255] : [0, 0, 0, 0]) as [number, number, number, number]
    expect(nearOrnament(pink, 7.5, 10.2, 4)).toBe(true)
    expect(nearOrnament(pink, 2, 10, 4)).toBe(false)
  })
})
