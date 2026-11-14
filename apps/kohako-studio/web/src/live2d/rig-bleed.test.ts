import { describe, expect, it } from 'vitest'
import { bleedBaseWidth, bleedZoom } from './rig'

// BOXP-510 TD-02: 左右へ余白を足した canvas でも、余白なしの時と同じ画面上の大きさで描く。
const M = { width: 1143, height: 2048 }
const pixelScale = (r: { zoom: number }, w: number, h: number) => Math.min(w / M.width, h / M.height) * r.zoom

describe('bleedZoom', () => {
  it('全身・幅で決まる箱: 余白で広げても画面上の倍率は余白なしと同じ', () => {
    const base = 300,
      h = 800,
      wide = base * 1.5
    const r = bleedZoom(1, base, wide, h, M.width, M.height)
    expect(pixelScale(r, wide, h)).toBeCloseTo(Math.min(base / M.width, h / M.height))
    expect(r.zoom).toBeLessThan(1)
  })
  it('全身・高さで決まる箱: 倍率は変わらず zoom は 1 のまま', () => {
    const r = bleedZoom(1, 600, 900, 800, M.width, M.height)
    expect(r.zoom).toBeCloseTo(1)
  })
  it('上半身: 拡大 1.8 倍と縦位置用の fit を保つ', () => {
    const h = 740,
      base = bleedBaseWidth(true, { width: 900, height: h }, 366, M)
    const r = bleedZoom(1.8, base, 900, h, M.width, M.height)
    expect(r.zoom).toBeCloseTo(1.8)
    expect(r.fit).toBeCloseTo(h / M.height)
  })
  it('非表示（大きさ 0）でも NaN にしない', () => {
    expect(bleedZoom(1, 0, 0, 0, M.width, M.height)).toEqual({ zoom: 1, fit: 0 })
  })
})

describe('bleedBaseWidth', () => {
  it('上半身枠は親が狭くてもモデルの縦横比の幅（親の幅で縮めない）', () => {
    expect(bleedBaseWidth(true, { width: 600, height: 551 }, 201, M)).toBeCloseTo((551 * M.width) / M.height)
  })
  it('全身は親の幅、親が無い時は canvas 幅', () => {
    expect(bleedBaseWidth(false, { width: 450, height: 800 }, 300, M)).toBe(300)
    expect(bleedBaseWidth(false, { width: 450, height: 800 }, undefined, M)).toBe(450)
  })
})
