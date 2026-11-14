import { describe, expect, it } from 'vitest'
import {
  addQuad,
  CUFF_POLY,
  FOREARM_POLY,
  inPolygon,
  isStaticUpper,
  mirrorPolygon,
  paintCapeCorner,
  triangleCoverage,
  type PartsPlayer,
} from './arm-parts'

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
  it('動かない上腕の暗い絵だけを消し、マントの色と輪郭線は残す', () => {
    const away = () => [60, 55, 70] as const,
      nearCape = () => [150, 110, 200] as const
    expect(isStaticUpper(755, 700, [60, 55, 70, 255], away)).toBe(true) // 上腕の黒
    expect(isStaticUpper(755, 700, [150, 110, 200, 255], away)).toBe(false) // マントの紫
    expect(isStaticUpper(755, 700, [130, 80, 60, 255], away)).toBe(false) // 裏地の茶
    expect(isStaticUpper(755, 700, [15, 12, 18, 255], nearCape)).toBe(false) // マントのそばの輪郭線は残す
    expect(isStaticUpper(755, 700, [15, 12, 18, 255], away)).toBe(true) // 上腕の中の皺の線は消す
    expect(isStaticUpper(600, 700, [60, 55, 70, 255], away)).toBe(false) // 範囲外
  })
  it('三角形の覆う画素だけを立てる', () => {
    const uvs = new Float32Array([0.2, 0.2, 0.8, 0.2, 0.8, 0.8]),
      out = triangleCoverage(uvs, [0, 1, 2], 10, 10, 0, 0, 10, 10)
    expect(out[5 * 10 + 7]).toBe(1) // 内側
    expect(out[8 * 10 + 1]).toBe(0) // 左下は対角の外
  })
  it.each([
    [0x1403, Uint16Array, 12],
    [0x1405, Uint32Array, 24],
  ] as const)('追加の四角形のインデックスは描画の型 %s に幅を合わせる', (indexType, expected, bytes) => {
    const uploads: ArrayBufferView[] = [],
      gl = {
        UNSIGNED_SHORT: 0x1403,
        UNSIGNED_INT: 0x1405,
        ARRAY_BUFFER: 1,
        ELEMENT_ARRAY_BUFFER: 2,
        STATIC_DRAW: 3,
        createBuffer: () => ({}),
        bindBuffer: () => undefined,
        bufferData: (target: number, data: ArrayBufferView) => {
          if (target === 2) uploads.push(data)
        },
      }
    const p = { gl, indexType, meshes: [], textures: [], rig: 0, rt: { p2l_alloc: () => 8 } } as unknown as PartsPlayer
    const { index } = addQuad(p, new Float32Array(8), 0)
    expect(p.meshes[index]?.indices).toBeInstanceOf(expected)
    expect(Array.from(p.meshes[index]?.indices ?? [])).toEqual([0, 1, 2, 0, 2, 3])
    expect(uploads[0]?.byteLength).toBe(bytes)
  })
})
