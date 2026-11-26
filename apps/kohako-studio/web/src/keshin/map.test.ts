// BOXP-716: 期待値は vault の Projects/kohako-home/keshin2d-trial-716.md（K1〜K3）の数字から書いている。
import { describe, expect, it } from 'vitest'
import { K2D, lookAt, skirtK, stateAt, toK, toModel } from './map'

const near = (a: readonly number[], b: readonly number[], d = 0.02) => {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i], -Math.log10(d))
}

describe('K1 絵の写し方', () => {
  it('顔の型へ一様に拡大する', () => {
    expect(K2D.S).toBeCloseTo(4.3804, 4)
    near(toK(458, 790), [1006.15, 2910.41])
    near(toK(166, 926), [-272.94, 3506.15])
    near(toK(570.74, 392), [1500, 1167])
  })
  it('戻すと元の点', () => {
    const [x, y] = toK(347.46, 1174.42)
    near(toModel(x, y), [347.46, 1174.42], 0.001)
  })
})

describe('K2.3 裾は seat-spec S8.4 の板の動きを写す', () => {
  it('左、座り切り・座り具合 0.5', () => {
    const [x, y] = toK(347.46, 1174.42)
    near(skirtK('left', x, y, 1), [277.94, 4309.17], 0.2)
    near(skirtK('left', x, y, 0.5), [388.73, 4456.22], 0.2)
  })
  it('右は左右対称（x = 573 で折り返した点）', () => {
    const [x, y] = toK(798.54, 1174.42)
    near(skirtK('right', x, y, 1), toK(854.24, 1109.32), 0.2)
  })
  it('座り具合 0 では動かない', () => {
    near(skirtK('left', 400, 4000, 0), [400, 4000], 1e-6)
  })
})

describe('K3 台本', () => {
  it('A: 送信まで待機、測った時刻で考える・話す', () => {
    expect(stateAt(1, 4, 6.2, 9)).toBe('idle')
    expect(stateAt(4.5, 4, 6.2, 9)).toBe('listening')
    expect(stateAt(6.3, 4, 6.2, 9)).toBe('thinking')
    expect(stateAt(9, 4, 6.2, 9)).toBe('speaking')
  })
  it('B: 座り切って 2 秒後から 左 → 右 → 上 → まん中 を 2 秒ずつ', () => {
    expect(lookAt(0.5, 1)).toEqual([0, 0])
    expect(lookAt(3, 1)).toEqual([-0.9, 0])
    expect(lookAt(5, 1)).toEqual([0.9, 0])
    expect(lookAt(7, 1)).toEqual([0, -0.9])
    expect(lookAt(9, 1)).toEqual([0, 0])
    expect(lookAt(30, 1)).toEqual([0, 0])
  })
})
