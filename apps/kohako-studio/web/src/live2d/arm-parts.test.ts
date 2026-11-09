import { describe, expect, it } from 'vitest'
import { CUFF_POLY, FOREARM_POLY, inPolygon, mirrorPolygon, paintCapeCorner, triangleCoverage } from './arm-parts'

describe('arm-parts', () => {
  it('前腕の範囲は前腕の中央を含み、上腕とマントを含まない', () => {
    expect(inPolygon(FOREARM_POLY, 790, 820)).toBe(true) // 前腕
    expect(inPolygon(FOREARM_POLY, 755, 700)).toBe(false) // 上腕
    expect(inPolygon(FOREARM_POLY, 810, 690)).toBe(false) // マントの裏地
  })
  it('袖口の範囲は金の輪を含み、手の甲を含まない', () => {
    expect(inPolygon(CUFF_POLY, 842, 925)).toBe(true)
    expect(inPolygon(CUFF_POLY, 842, 960)).toBe(false)
  })
  it('左右反転で同じ点が判定できる', () => {
    expect(inPolygon(mirrorPolygon(FOREARM_POLY, 572), 2 * 572 - 790, 820)).toBe(true)
  })
  it('マントの角は裏地色で塗り、下端だけ線を引く', () => {
    expect(paintCapeCorner(790, 722)).toEqual([118, 76, 67])
    expect(paintCapeCorner(790, 722, [1, 2, 3])).toEqual([1, 2, 3])
    expect(paintCapeCorner(793.5, 731.5)).toEqual([38, 28, 34])
    expect(paintCapeCorner(760, 700)).toBeNull()
  })
  it('三角形の覆う画素だけを立てる', () => {
    const uvs = new Float32Array([0.2, 0.2, 0.8, 0.2, 0.8, 0.8]), out = triangleCoverage(uvs, [0, 1, 2], 10, 10, 0, 0, 10, 10)
    expect(out[5 * 10 + 7]).toBe(1) // 内側
    expect(out[8 * 10 + 1]).toBe(0) // 左下は対角の外
  })
})
