import { describe, expect, it } from 'vitest'
import { barycentric, BUST, CHEST_BOX, chestGrid, chestWeight, createChestSpring, SPRING, stepChest } from './chest'
import { parsePrefs } from '../home/prefs'

const run = (
  s: ReturnType<typeof createChestSpring>,
  path: (t: number) => [number, number],
  seconds: number,
  enabled = true,
  dt = 1 / 60,
) => {
  const out: [number, number][] = []
  for (let t = 0; t <= seconds; t += dt) out.push([...stepChest(s, path(t), dt, enabled)])
  return out
}
const len = (v: readonly [number, number]) => Math.hypot(v[0], v[1])

describe('胸の揺れ（BOXP-521）', () => {
  it('体が止まっていれば揺れない（独立した周期の揺れを足さない）', () => {
    const s = createChestSpring()
    expect(run(s, () => [572, 578], 3).every((o) => len(o) === 0)).toBe(true)
  })
  it('体が動くと遅れて追従し、止まると 1.5 秒以内に収まる', () => {
    const s = createChestSpring()
    // 0.3 秒で 4px 下へ動いて止まる（身振りの体の傾き程度）
    const path = (t: number): [number, number] => [572, 578 + 4 * Math.min(1, t / 0.3)]
    const out = run(s, path, 2)
    const during = out.slice(0, 30),
      after = out.slice(Math.round(1.8 * 60))
    expect(Math.max(...during.map((o) => Math.abs(o[1])))).toBeGreaterThan(1)
    // 動いた向きと逆（上）へ遅れる
    expect(during[10]?.[1]).toBeLessThan(0)
    expect(Math.max(...after.map(len))).toBeLessThan(0.15)
  })
  it('待機の呼吸のようなゆっくりした動きでは揺らさない', () => {
    const s = createChestSpring()
    // 待機の揺れ（周期約 3 秒、上下 ±4.5px 程度を実測）。動き始めの立ち上がりの後は 0。
    const out = run(s, (t) => [572 + 1.5 * Math.sin(t * 2), 578 + 4.5 * Math.sin(t * 2.1)], 6)
    expect(Math.max(...out.slice(90).map(len))).toBe(0)
  })
  it('変位は上限で止める', () => {
    const s = createChestSpring()
    const out = run(s, (t) => [572 + 200 * t, 578 + 200 * t], 1)
    expect(Math.max(...out.map(len))).toBeLessThanOrEqual(SPRING.max + 1e-9)
  })
  it('無効のとき・大きな dt のときは 0 で、遅れを持ち越さない', () => {
    const s = createChestSpring()
    run(s, (t) => [572, 578 + 60 * t], 0.2)
    expect(len(s.offset)).toBeGreaterThan(0)
    expect(stepChest(s, [572, 590], 0, true)).toEqual(s.offset)
    expect(stepChest(s, [572, 590], 1 / 60, false)).toEqual([0, 0])
    expect(stepChest(s, [572, 590], 1 / 60, true)).toEqual([0, 0])
    run(s, (t) => [572, 590 + 60 * t], 0.2)
    expect(stepChest(s, [572, 600], 2, true)).toEqual([0, 0])
  })
  it('描画の間隔が長くても発散しない', () => {
    const s = createChestSpring()
    const out = run(s, (t) => [572, 578 + 3 * Math.sin(t * 9)], 5, true, 0.2)
    expect(out.every((o) => Number.isFinite(o[0]) && Number.isFinite(o[1]) && len(o) <= SPRING.max)).toBe(true)
  })
  it('ウェイトは胸の中心で大きく、襟・帯・袖側の縁と格子の外では 0', () => {
    expect(chestWeight(...BUST.left)).toBeGreaterThan(0.9)
    expect(chestWeight(...BUST.right)).toBeGreaterThan(0.9)
    expect(chestWeight(CHEST_BOX.x0, 578)).toBe(0)
    expect(chestWeight(CHEST_BOX.x1, 578)).toBe(0)
    expect(chestWeight(572, CHEST_BOX.y0)).toBe(0)
    expect(chestWeight(572, CHEST_BOX.y1)).toBe(0)
    expect(chestWeight(572, 700)).toBe(0)
    expect(chestWeight(572, 300)).toBe(0)
    for (let x = CHEST_BOX.x0; x <= CHEST_BOX.x1; x += 4) {
      expect(chestWeight(x, CHEST_BOX.y0 + 1)).toBeLessThan(0.1)
      expect(chestWeight(x, CHEST_BOX.y1 - 1)).toBeLessThan(0.1)
    }
  })
  it('格子は体の層の三角形に重なる点だけで張る', () => {
    expect(barycentric([1, 1], [0, 0], [4, 0], [0, 4])).not.toBeNull()
    expect(barycentric([5, 5], [0, 0], [4, 0], [0, 4])).toBeNull()
    // 胸の範囲の左半分だけを覆う 2 枚の三角形
    const mx = (CHEST_BOX.x0 + CHEST_BOX.x1) / 2,
      v = [
        CHEST_BOX.x0 - 1,
        CHEST_BOX.y0 - 1,
        mx + 0.01,
        CHEST_BOX.y0 - 1,
        mx + 0.01,
        CHEST_BOX.y1 + 1,
        CHEST_BOX.x0 - 1,
        CHEST_BOX.y1 + 1,
      ]
    const g = chestGrid(v, [0, 1, 2, 0, 2, 3])
    expect(g.triangles.length / 3).toBe((CHEST_BOX.cols / 2) * CHEST_BOX.rows * 2)
    expect(g.points.length).toBe((CHEST_BOX.cols + 1) * (CHEST_BOX.rows + 1))
  })
  it('設定「胸の揺れ」は既定 ON で、保存値を読み戻す', () => {
    expect(parsePrefs(null).chestSway).toBe(true)
    expect(parsePrefs('{"chestSway":false}').chestSway).toBe(false)
    expect(parsePrefs('{"chestSway":"no"}').chestSway).toBe(true)
  })
})
