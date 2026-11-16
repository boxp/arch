import { describe, expect, it } from 'vitest'
import { mippable } from './mipmaps'

describe('mippable (BOXP-525 r21 縮小表示の細い線の欠け・ちらつき)', () => {
  it('2 のべき乗で 256 以上の絵のテクスチャだけ', () => {
    expect(mippable(4096, 4096)).toBe(true)
    expect(mippable(512, 2048)).toBe(true)
    expect(mippable(1100, 2048)).toBe(false)
    expect(mippable(128, 128)).toBe(false)
    expect(mippable(0, 0)).toBe(false)
  })
})
