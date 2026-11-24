// BOXP-698: 期待値は vault の Projects/kohako-home/seat-spec.md（S1〜S6）の数字から書いている。
import { describe, expect, it } from 'vitest'
import { SeatDirector, seatOffsetPx, seatOption, type SeatFrame, type SeatInput } from './seat'

const OK: SeatInput = { calm: true, keep: true, free: true, subtle: false }
/** rng を固定（0.5）: 最初の予定 30 秒、座っている長さ 77.5 秒、次の予定 165 秒、落ち着いた後の間 11.5 秒。 */
const director = () => new SeatDirector(() => 0.5)
const STEP = 0.05
/** from から to まで 0.05 秒ずつ進め、全コマを返す。 */
function run(d: SeatDirector, from: number, to: number, input: SeatInput | ((t: number) => SeatInput) = OK) {
  const out: (SeatFrame & { t: number })[] = []
  for (let i = 0; from + i * STEP <= to + 1e-9; i++) {
    const t = from + i * STEP
    out.push({ t, ...d.step(t, typeof input === 'function' ? input(t) : input) })
  }
  return out
}
/** 座り切った直後（t=31.3）まで進めた係。 */
function seated() {
  const d = director()
  run(d, 0, 31.3)
  return d
}

describe('S1 座り始める条件', () => {
  it('最初の予定（30 秒）までは立ち姿のまま、過ぎたら座り始める', () => {
    const rows = run(director(), 0, 30.05)
    expect(rows.filter((r) => r.t < 30).every((r) => r.phase === 'standing' && r.level === 0 && r.chair === 0)).toBe(
      true,
    )
    expect(rows.at(-1)?.phase).toBe('sitting')
  })
  it('落ち着いていない・しぐさが出ている間は座らず、済んだら座る', () => {
    for (const blocked of [{ calm: false }, { free: false }]) {
      const d = director(),
        rows = run(d, 0, 40, (t) => (t < 35 ? { ...OK, ...blocked } : OK))
      expect(rows.filter((r) => r.t < 35).every((r) => r.phase === 'standing')).toBe(true)
      expect(rows.find((r) => r.phase === 'sitting')?.t).toBeCloseTo(35, 5)
    }
  })
  it('座っていてよい が偽の間は座らず、真に戻ってから 8〜15 秒（rng 0.5 で 11.5 秒）はあける', () => {
    const rows = run(director(), 0, 60, (t) => (t < 40 ? { ...OK, keep: false, calm: false } : OK))
    expect(rows.filter((r) => r.t < 51.5 - 1e-9).every((r) => r.phase === 'standing')).toBe(true)
    expect(rows.find((r) => r.phase === 'sitting')?.t).toBeCloseTo(51.5, 5)
  })
  it('?seat=now は最初の予定だけ 4〜6 秒、?seat=off は座らない、指定なしは 20〜40 秒', () => {
    expect(seatOption('?seat=now')).toEqual({ enabled: true, first: [4, 6] })
    expect(seatOption('?seat=off').enabled).toBe(false)
    expect(seatOption('')).toEqual({ enabled: true, first: [20, 40] })
    const rows = run(new SeatDirector(() => 0.5, seatOption('?seat=now').first), 0, 6)
    expect(rows.find((r) => r.phase === 'sitting')?.t).toBeCloseTo(5, 5)
  })
})

describe('S2 座る流れ', () => {
  const rows = run(director(), 0, 32)
    .filter((r) => r.t >= 30 - 1e-9)
    .map((r) => ({ ...r, t: r.t - 30 }))
  const at = (t: number) => rows.find((r) => Math.abs(r.t - t) < 1e-6) as (typeof rows)[number]
  it('椅子が先に現れ、0.35 秒後から 0.9 秒かけて腰を下ろす（例の数字）', () => {
    expect(at(0.35).level).toBeCloseTo(0, 9)
    expect(at(0.35).chair).toBeCloseTo(0.583, 2)
    expect(at(0.8).level).toBeCloseTo(0.5, 5)
    expect(at(0.8).chair).toBe(1)
    expect(at(1.2).phase).toBe('sitting')
    expect(at(1.25).phase).toBe('seated')
    expect(at(1.25).level).toBe(1)
  })
  it('座り具合は行って戻らず、体は 40 下がる', () => {
    const sitting = rows.filter((r) => r.phase === 'sitting')
    for (let i = 1; i < sitting.length; i++) expect(sitting[i].level).toBeGreaterThanOrEqual(sitting[i - 1].level)
    expect(sitting.every((r) => Math.abs(r.offset - 40 * r.level) < 1e-9 && r.moving)).toBe(true)
  })
  it('着いた直後の 0.55 秒は最大 4 ほど沈んで戻る', () => {
    const settle = rows.filter((r) => r.phase === 'seated' && r.t <= 1.25 + 0.55).map((r) => r.offset - 40)
    expect(Math.max(...settle)).toBeGreaterThan(3)
    expect(Math.max(...settle)).toBeLessThan(5)
    expect(settle.every((x) => x > -0.6)).toBe(true)
  })
})

describe('S3 座っている間', () => {
  it('落ち着いていなくても（マウス・なでる・しぐさ）座ったまま', () => {
    const rows = run(seated(), 31.35, 60, { ...OK, calm: false, free: false })
    expect(rows.every((r) => r.phase === 'seated' && r.level === 1 && r.chair === 1 && !r.moving)).toBe(true)
  })
  it('4.4 秒で 1 往復、±4 の浮き沈み', () => {
    const offs = run(seated(), 31.35, 60)
      .filter((r) => r.t > 34)
      .map((r) => r.offset - 40)
    expect(Math.max(...offs)).toBeGreaterThan(3.9)
    expect(Math.max(...offs)).toBeLessThanOrEqual(4)
    expect(Math.min(...offs)).toBeLessThan(-3.9)
    expect(Math.min(...offs)).toBeGreaterThanOrEqual(-4)
  })
  it('足のぶらぶらは 13 秒ごとに 5 秒間、左右は逆の拍', () => {
    const rows = run(seated(), 31.35, 31.25 + 26)
    const since = (r: { t: number }) => r.t - 31.25
    expect(rows.filter((r) => since(r) < 8 || (since(r) > 13 && since(r) < 21)).every((r) => r.swingRight === 0)).toBe(
      true,
    )
    const burst = rows.filter((r) => since(r) > 8 && since(r) < 13).map((r) => r.swingRight)
    expect(Math.max(...burst)).toBeGreaterThan(0.6)
    expect(Math.min(...burst)).toBeLessThan(-0.6)
    expect(rows.every((r) => Math.abs(r.swingRight + r.swingLeft) < 1e-12 && Math.abs(r.swingRight) <= 1)).toBe(true)
  })
  it('控えめでは、ぶらぶら無し・浮き沈み半分', () => {
    const rows = run(seated(), 31.35, 60, { ...OK, subtle: true }).filter((r) => r.t > 34)
    expect(rows.every((r) => r.swingRight === 0)).toBe(true)
    const offs = rows.map((r) => r.offset - 40)
    expect(Math.max(...offs)).toBeGreaterThan(1.9)
    expect(Math.max(...offs)).toBeLessThanOrEqual(2)
  })
})

describe('S4 自分から立つ', () => {
  it('座っている長さ（77.5 秒）が過ぎたら 0.8 秒で立ち、0.5 秒で椅子が消える。次は 165 秒後', () => {
    const d = seated(),
      rows = run(d, 31.35, 31.25 + 77.5 + 170)
    const rising = rows.filter((r) => r.phase === 'rising'),
      t0 = (rising[0] as (typeof rows)[number]).t
    expect(t0).toBeCloseTo(31.25 + 77.5, 1)
    const at = (dt: number) => rising.find((r) => Math.abs(r.t - t0 - dt) < 1e-6) as (typeof rows)[number]
    expect(at(0.4).level).toBeCloseTo(0.5, 5)
    expect(at(0.8).level).toBe(0)
    expect(at(0.8).chair).toBeCloseTo(1, 9)
    expect(at(1.05).chair).toBeCloseTo(0.5, 5)
    const stood = rows.find((r) => r.t > t0 && r.phase === 'standing') as (typeof rows)[number]
    expect(stood.t - t0).toBeCloseTo(1.3, 5)
    expect(stood).toMatchObject({ level: 0, chair: 0, offset: 0, swingRight: 0, swingLeft: 0 })
    expect(rows.find((r) => r.t > stood.t && r.phase === 'sitting')?.t).toBeCloseTo(stood.t + 165, 1)
  })
  it('しぐさが出ている間は立たず、切れ目で立つ', () => {
    const rows = run(seated(), 31.35, 130, (t) => ({ ...OK, free: t >= 120 }))
    expect(rows.find((r) => r.phase === 'rising')?.t).toBeCloseTo(120, 5)
  })
})

describe('S5 急いで立つ', () => {
  const gone = { ...OK, keep: false, calm: false }
  it('座っている時: 0.4 秒で立ち姿、0.6 秒以内に椅子が消える', () => {
    const rows = run(seated(), 31.35, 45, (t) => (t < 40 ? OK : gone)).filter((r) => r.t >= 40 - 1e-9)
    const at = (dt: number) => rows.find((r) => Math.abs(r.t - 40 - dt) < 1e-6) as (typeof rows)[number]
    expect(at(0).phase).toBe('rising')
    expect(at(0.2).level).toBeCloseTo(0.5, 5)
    expect(at(0.4).level).toBe(0)
    expect(at(0.6).chair).toBe(0)
    expect(at(0.65).phase).toBe('standing')
  })
  it('座る途中・自分から立つ途中でも、その時点の値から短く戻す（増えない）', () => {
    for (const when of [30.8, 31.25 + 77.5 + 0.3]) {
      // 「その時点の値」= 中断が無かった場合の、その時刻の値。
      const d = director(),
        moment = run(director(), 0, when).at(-1) as SeatFrame
      run(d, 0, when - STEP)
      const rows = run(d, when, when + 1, gone)
      expect(moment.level).toBeGreaterThan(0.2)
      expect(rows[0].level).toBeCloseTo(moment.level, 9)
      expect(rows[0].chair).toBeCloseTo(moment.chair, 9)
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].level).toBeLessThanOrEqual(rows[i - 1].level)
        expect(rows[i].chair).toBeLessThanOrEqual(rows[i - 1].chair)
      }
      expect(rows.find((r) => Math.abs(r.t - when - 0.4) < 1e-6)?.level).toBe(0)
      expect(rows.find((r) => r.t >= when + 0.6 - 1e-9)?.chair).toBe(0)
    }
  })
})

describe('S6 非表示', () => {
  it('reset ですぐ立ち姿になり、最初の予定から数え直す', () => {
    const d = seated()
    d.reset()
    const rows = run(d, 50, 85)
    expect(rows[0]).toMatchObject({ phase: 'standing', level: 0, chair: 0, offset: 0 })
    expect(rows.find((r) => r.phase === 'sitting')?.t).toBeCloseTo(80, 5)
  })
})

describe('どの順でも守ること（乱数の操作列）', () => {
  it('椅子の濃さ ≥ 座り具合、値は 0〜1、偽になって 0.4 秒で座り具合 0・0.6 秒で椅子 0、立ち姿では全部 0', () => {
    let seed = 12345
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const broken: string[] = [],
      seen = new Set<string>()
    for (let trial = 0; trial < 300; trial++) {
      const d = new SeatDirector(rand, [0, 3])
      let input = { ...OK },
        falseSince: number | null = null
      for (let i = 0; i < 2400; i++) {
        const t = i * STEP
        // ときどき入力を切り替える（座る・立つの途中にも当たる）。検証用の指定も混ぜる。
        if (rand() < 0.03) input = { calm: rand() < 0.7, keep: rand() < 0.8, free: rand() < 0.7, subtle: rand() < 0.2 }
        if (rand() < 0.01) d.force(rand() < 0.5 ? 'sit' : 'stand')
        if (rand() < 0.002) {
          d.reset()
          expect(d.step(t, { ...input, calm: false })).toMatchObject({ phase: 'standing', level: 0, chair: 0 })
        }
        const f = d.step(t, input)
        falseSince = input.keep ? null : (falseSince ?? t)
        const late = (seconds: number) => falseSince !== null && t - falseSince >= seconds - 1e-9
        // 1 コマずつ expect を呼ぶと遅いので、破れた条件だけを集める。
        if (f.chair < f.level) broken.push(`椅子 < 座り具合 @${trial}/${t}`)
        if (f.level < 0 || f.chair > 1 || Math.abs(f.swingRight) > 1) broken.push(`範囲外 @${trial}/${t}`)
        if (f.phase === 'standing' && (f.level !== 0 || f.chair !== 0 || f.offset !== 0 || f.moving))
          broken.push(`立ち姿なのに 0 でない @${trial}/${t}`)
        if (late(0.4) && f.level !== 0) broken.push(`0.4 秒で座り具合が 0 でない @${trial}/${t}`)
        if (late(0.6) && f.chair !== 0) broken.push(`0.6 秒で椅子が 0 でない @${trial}/${t}`)
        if (!input.keep && f.phase !== 'standing' && f.phase !== 'rising')
          broken.push(`偽なのに座っている @${trial}/${t}`)
        seen.add(f.phase)
      }
    }
    expect(broken.slice(0, 5)).toEqual([])
    // 操作列が 4 つの状態すべてを通っていること（条件が空振りしていない）。
    expect([...seen].sort()).toEqual(['rising', 'seated', 'sitting', 'standing'])
  })
})

describe('体を下げる長さの換算', () => {
  it('モデル座標 → CSS px（canvas の高さ・拡大率に比例）', () => {
    expect(seatOffsetPx(40, 679, 2048, 1)).toBeCloseTo(13.26, 2)
    expect(seatOffsetPx(40, 679, 2048, 1.5)).toBeCloseTo(19.89, 2)
    expect(seatOffsetPx(0, 679, 2048, 1)).toBe(0)
    expect(seatOffsetPx(40, 679, 0, 1)).toBe(0)
  })
})
