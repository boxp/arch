import { it, expect } from 'vitest'
import { layoutMap, mapPlaces } from './mapview'
import type { Geo, View } from './views'
// BOXP-749: 期待値は仕様 Projects/kohako-home/map-view-spec.md の表示の表から決める。
const exact = (lat: number, lon: number, label: string): Geo => ({
  lat,
  lon,
  bbox: [lon - 0.004, lat - 0.004, lon + 0.004, lat + 0.004],
  precision: 'exact',
  label,
  source: 'openstreetmap',
})
const renoir = exact(35.6567309, 139.7538194, 'Cafe Renoir 芝大門店')
const excelsior = exact(35.6467756, 139.7461783, 'エクセルシオール カフェ 三田店')
const roberts = exact(35.6552218, 139.7357248, 'ロバーツコーヒー 麻布十番店')
const chome: Geo = {
  lat: 35.655,
  lon: 139.7538,
  bbox: [139.751, 35.653, 139.757, 35.658],
  precision: 'area',
  label: '東京都港区芝大門二丁目',
  source: 'openstreetmap',
}
const city: Geo = { ...chome, bbox: [139.7, 35.6, 139.8, 35.7], label: '東京都港区' }
const inside = (v: number) => v >= 0 && v <= 100
it('places a numbered, named pin for every exact candidate on one map', () => {
  const layout = layoutMap([
    { name: 'Cafe Renoir 芝大門店', geo: renoir },
    { name: 'エクセルシオール カフェ 三田店', geo: excelsior },
    { name: 'ロバーツコーヒー 麻布十番店', geo: roberts },
  ])
  if (!layout) throw Error('layout expected')
  expect(layout.marks.map((m) => [m.kind, m.n, m.label])).toEqual([
    ['pin', 1, 'Cafe Renoir 芝大門店'],
    ['pin', 2, 'エクセルシオール カフェ 三田店'],
    ['pin', 3, 'ロバーツコーヒー 麻布十番店'],
  ])
  for (const m of layout.marks) expect(inside(m.left) && inside(m.top), JSON.stringify(m)).toBe(true)
  // 右寄りのピンの店名は左側に出す（枠の外へはみ出さない）
  for (const m of layout.marks) expect(m.kind === 'pin' && m.side === 'left').toBe(m.left > 55)
  // 西にあるロバーツは左、北にあるルノアールはエクセルシオールより上
  expect(layout.marks[2].left).toBeLessThan(layout.marks[0].left)
  expect(layout.marks[0].top).toBeLessThan(layout.marks[1].top)
  expect(layout.tiles.length).toBeGreaterThan(0)
  for (const t of layout.tiles) expect(t.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/)
  // タイルは地図枠を隙間なく覆う
  expect(Math.min(...layout.tiles.map((t) => t.left))).toBeLessThanOrEqual(0)
  expect(Math.max(...layout.tiles.map((t) => t.left + t.width))).toBeGreaterThanOrEqual(100)
  expect(Math.min(...layout.tiles.map((t) => t.top))).toBeLessThanOrEqual(0)
  expect(Math.max(...layout.tiles.map((t) => t.top + t.height))).toBeGreaterThanOrEqual(100)
})
it('puts a single exact destination pin in the middle', () => {
  const layout = layoutMap([{ name: 'Cafe Renoir 芝大門店', geo: renoir }])
  expect(layout?.marks).toEqual([{ kind: 'pin', n: 1, label: 'Cafe Renoir 芝大門店', left: 50, top: 50 }])
  expect(layout?.zoom).toBeGreaterThanOrEqual(15)
})
it('draws a narrow area as a dashed range (never a pin) and leaves wide areas and unknown places unmarked', () => {
  const layout = layoutMap([
    { name: 'A', geo: renoir },
    { name: 'B', geo: chome },
    { name: 'C', geo: city },
    { name: 'D' },
  ])
  if (!layout) throw Error('layout expected')
  expect(layout.marks.map((m) => [m.kind, m.n])).toEqual([
    ['pin', 1],
    ['area', 2],
  ])
  const area = layout.marks[1]
  expect(area.kind === 'area' && area.width > 0 && area.height > 0).toBe(true)
  expect(area.label).toBe('B（付近）')
})
it('returns no map when no candidate has a usable position', () => {
  expect(layoutMap([{ name: 'A' }, { name: 'B', geo: city }])).toBeNull()
  expect(layoutMap([])).toBeNull()
})
it('reads both single-destination and multi-place map views', () => {
  const single: Extract<View, { kind: 'map' }> = {
    kind: 'map',
    title: '地図',
    destination: { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1' },
    geo: renoir,
  }
  expect(mapPlaces(single)).toEqual([{ name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1', geo: renoir }])
  const multi: Extract<View, { kind: 'map' }> = {
    kind: 'map',
    title: '候補',
    places: [{ name: 'A', geo: renoir }, { name: 'B' }],
  }
  expect(mapPlaces(multi)).toEqual([{ name: 'A', geo: renoir }, { name: 'B' }])
})
