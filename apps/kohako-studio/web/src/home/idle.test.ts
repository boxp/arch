import { expect, it } from 'vitest'
import {
  CANCEL_SECONDS,
  FIRST_GAP,
  GAP,
  HOLD_MARGIN,
  IN_SECONDS,
  type IdleAct,
  IdleDirector,
  type IdleFrame,
  type IdleInput,
  idleActNames,
  idleActs,
  OUT_SECONDS,
  SETTLE_WAIT,
  SUBTLE_SCALE,
  settledHead,
} from './idle'

const calm: IdleInput = { calm: true, settled: () => true, daypart: 'day', subtle: false }
/** 決まった列を繰り返す乱数。 */
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}
/** [from, to) を 0.05 秒刻みで進め、各時刻の結果を返す。 */
function run(d: IdleDirector, from: number, to: number, input: IdleInput | ((t: number) => IdleInput) = calm) {
  const out: { t: number; f: IdleFrame }[] = []
  for (let t = from; t < to - 1e-9; t += 0.05)
    out.push({ t, f: d.step(t, typeof input === 'function' ? input(t) : input) })
  return out
}
const size = (f: IdleFrame) => Math.max(...Object.values(f.pose).map(Math.abs))

it('待機に入ってすぐは何もせず、最初の間（9〜18 秒）をあけてから 1 つ出す', () => {
  const d = new IdleDirector(seq(0)),
    frames = run(d, 0, 30)
  const first = frames.find((x) => x.f.act)
  expect(first?.t).toBeGreaterThanOrEqual(FIRST_GAP[0] - 1e-6)
  expect(first?.t).toBeLessThan(FIRST_GAP[0] + 0.1)
  expect(frames.filter((x) => x.t < FIRST_GAP[0] - 0.01).every((x) => !x.f.act && !x.f.hold && size(x.f) === 0)).toBe(
    true,
  )
})

it('しぐさは入り・保ち・戻りで滑らかに変わり、終わると待機クリップへ返す', () => {
  const d = new IdleDirector()
  d.force('moon')
  const frames = run(d, 0, 12),
    on = frames.filter((x) => x.f.act === 'moon')
  expect(on[0].t).toBe(0)
  expect(size(on[0].f)).toBe(0)
  // 1 刻み（0.05 秒）で頭が 1.2° を超えて動かない。
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i].f.pose.headX - frames[i - 1].f.pose.headX)).toBeLessThan(1.2)
  const peak = Math.max(...on.map((x) => x.f.pose.headX))
  expect(peak).toBeCloseTo(idleActs.moon.pose.headX ?? 0, 5)
  expect(on.every((x) => x.f.hold)).toBe(true)
  // 月は画面の右上（左右は反転しない）。視線も同じ向き。
  expect(Math.max(...on.map((x) => x.f.pose.eyeX))).toBeGreaterThan(0.4)
  expect(Math.max(...on.map((x) => x.f.pose.headY))).toBeGreaterThan(4)
  const end = on[on.length - 1].t,
    [lo, hi] = idleActs.moon.seconds
  expect(end).toBeGreaterThan(IN_SECONDS + lo + OUT_SECONDS)
  expect(end).toBeLessThan(IN_SECONDS + hi + OUT_SECONDS + HOLD_MARGIN + 0.1)
  const after = frames.filter((x) => x.t > end + 0.01 && x.t < end + GAP[0] - 0.1)
  expect(after.every((x) => !x.f.act && !x.f.hold && !x.f.gaze && size(x.f) === 0)).toBe(true)
  // 戻り切る直前の姿勢はほぼ 0（クリップ再開時に跳ばない）。
  expect(size(on[on.length - 1].f)).toBeLessThan(0.01)
})

it('同じしぐさを続けて出さず、間は 12〜32 秒の不規則な長さ', () => {
  const d = new IdleDirector(Math.random),
    starts: { t: number; act: IdleAct }[] = []
  let before: IdleAct | null = null,
    endedAt = 0
  const gaps: number[] = []
  for (const { t, f } of run(d, 0, 3000)) {
    if (f.act && !before) {
      starts.push({ t, act: f.act })
      if (starts.length > 1) gaps.push(t - endedAt)
    }
    if (!f.act && before) endedAt = t
    before = f.act
  }
  expect(starts.length).toBeGreaterThan(60)
  for (let i = 1; i < starts.length; i++) expect(starts[i].act).not.toBe(starts[i - 1].act)
  expect(new Set(starts.map((s) => s.act)).size).toBe(idleActNames.length)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(GAP[0] - 0.06)
  expect(Math.max(...gaps)).toBeLessThanOrEqual(GAP[1] + 0.06)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(8)
  // しぐさが出ている時間は全体の 3 割未満（常に動き続けない）。
  const busy = run(new IdleDirector(Math.random), 0, 3000).filter((x) => x.f.act && x.f.act !== 'still').length
  expect(busy / (3000 / 0.05)).toBeLessThan(0.3)
})

it('出せない状況になったら短く戻し、予定を捨てて落ち着いてから数え直す', () => {
  const d = new IdleDirector(seq(0))
  d.force('tilt')
  const frames = run(d, 0, 30, (t) => ({ ...calm, calm: t < 1.5 || t >= 4 }))
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.026)?.f as IdleFrame
  expect(Math.abs(at(1.45).pose.headZ)).toBeGreaterThan(6)
  // 中断から CANCEL_SECONDS で姿勢 0、その後クリップを返す。跳ばない。
  expect(size(at(1.5 + CANCEL_SECONDS + 0.05))).toBeLessThan(0.01)
  expect(at(1.5 + CANCEL_SECONDS + HOLD_MARGIN + 0.1).hold).toBe(false)
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i].f.pose.headZ - frames[i - 1].f.pose.headZ)).toBeLessThan(2)
  // 落ち着いた 4 秒から最初の間を数え直す。
  const next = frames.find((x) => x.t > 3 && x.f.act)
  expect(next?.t).toBeGreaterThanOrEqual(4 + FIRST_GAP[0] - 0.06)
})

it('入りの途中で中断しても、その時点の強さから戻す', () => {
  const d = new IdleDirector(seq(0.99))
  d.force('aside')
  const frames = run(d, 0, 3, (t) => ({ ...calm, calm: t < 0.4 }))
  const peak = Math.max(...frames.map((x) => Math.abs(x.f.pose.headX)))
  expect(peak).toBeGreaterThan(0.5)
  expect(peak).toBeLessThan(idleActs.aside.pose.headX ?? 0)
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i].f.pose.headX - frames[i - 1].f.pose.headX)).toBeLessThan(1)
})

it('出せない間は始めない（検証用の指定も捨てる）', () => {
  const d = new IdleDirector()
  d.force('moon')
  expect(run(d, 0, 100, { ...calm, calm: false }).every((x) => !x.f.act && !x.f.hold)).toBe(true)
  // その後落ち着いても、指定ではなく通常の間から始める。
  expect(run(d, 100, 100 + FIRST_GAP[0] - 0.1).every((x) => !x.f.act)).toBe(true)
})

it('頭が正面近くに来るまで待ち、来なければ SETTLE_WAIT 秒で始める', () => {
  const d = new IdleDirector(seq(0))
  const frames = run(d, 0, 40, (t) => ({ ...calm, settled: () => t >= 11 }))
  expect(frames.find((x) => x.f.act)?.t).toBeCloseTo(11, 1)
  const never = run(new IdleDirector(seq(0)), 0, 40, { ...calm, settled: () => false })
  expect(never.find((x) => x.f.act)?.t).toBeCloseTo(FIRST_GAP[0] + SETTLE_WAIT, 1)
})

it('目を閉じる・ほほえむのは頭が動き出してから、頭が戻り始める時に戻す', () => {
  const rest = new IdleDirector()
  rest.force('rest')
  const r = run(rest, 0, 8)
  expect(r[0].f.eyes).toBe(false)
  const closed = r.filter((x) => x.f.eyes)
  expect(closed[0].t).toBeGreaterThan(IN_SECONDS * 0.4)
  expect(closed.length * 0.05).toBeGreaterThan(idleActs.rest.seconds[0])
  // 開いた後に頭が戻る（戻りの間は開いている）。
  const lastClosed = closed[closed.length - 1].t
  expect(r.some((x) => x.t > lastClosed && x.f.act === 'rest' && !x.f.eyes && size(x.f) > 0.5)).toBe(true)
  const smile = new IdleDirector()
  smile.force('smile')
  const s = run(smile, 0, 8)
  expect(s[0].f.emotion).toBeNull()
  expect(s.some((x) => x.f.emotion === 'smile')).toBe(true)
  expect(s[s.length - 1].f.emotion).toBeNull()
  // ほほえむ・じっとする間はカーソル追従を止めない。視線を動かすしぐさだけ退かせる。
  expect(s.every((x) => !x.f.gaze)).toBe(true)
  const moon = new IdleDirector()
  moon.force('moon')
  expect(run(moon, 0, 3).every((x) => x.f.gaze)).toBe(true)
})

it('左右のあるしぐさは向きを毎回選び、控えめでは 6 割の大きさ・1.5 倍の間', () => {
  const left = new IdleDirector(seq(0.1)),
    right = new IdleDirector(seq(0.9))
  left.force('tilt')
  right.force('tilt')
  const l = run(left, 0, 2).map((x) => x.f.pose.headZ),
    r = run(right, 0, 2).map((x) => x.f.pose.headZ)
  expect(Math.min(...l)).toBeCloseTo(-(idleActs.tilt.pose.headZ ?? 0), 5)
  expect(Math.max(...r)).toBeCloseTo(idleActs.tilt.pose.headZ ?? 0, 5)
  const subtle = new IdleDirector(seq(0.9))
  subtle.force('tilt')
  const s = run(subtle, 0, 2, { ...calm, subtle: true }).map((x) => x.f.pose.headZ)
  expect(Math.max(...s)).toBeCloseTo((idleActs.tilt.pose.headZ ?? 0) * SUBTLE_SCALE, 5)
  const first = run(new IdleDirector(seq(0)), 0, 40, { ...calm, subtle: true }).find((x) => x.f.act)
  expect(first?.t).toBeCloseTo(FIRST_GAP[0] * 1.5, 1)
})

it('時間帯で出やすさが変わる（夜は月とひと息が増える）', () => {
  const count = (daypart: 'day' | 'night') => {
    const d = new IdleDirector(Math.random),
      n: Record<string, number> = {}
    for (let i = 0; i < 4000; i++) {
      const a = d.pick(daypart)
      n[a] = (n[a] ?? 0) + 1
      d.force(a)
      d.step(i * 1000, calm)
      d.reset()
    }
    return n
  }
  const day = count('day'),
    night = count('night')
  expect(night.moon).toBeGreaterThan(day.moon * 1.15)
  expect(night.rest).toBeGreaterThan(day.rest * 1.15)
})

it('reset は出ているしぐさと予定を捨てる（非表示から戻った時にまとめて出さない）', () => {
  const d = new IdleDirector(seq(0))
  d.force('down')
  run(d, 0, 1)
  d.reset()
  const frames = run(d, 500, 500 + FIRST_GAP[0] - 0.1)
  expect(frames.every((x) => !x.f.act && !x.f.hold && size(x.f) === 0)).toBe(true)
})

it('しぐさの大きさは待機クリップ・首かしげの演技より小さい', () => {
  for (const a of idleActNames) {
    const p = idleActs[a].pose
    expect(Math.abs(p.headX ?? 0)).toBeLessThanOrEqual(8)
    expect(Math.abs(p.headY ?? 0)).toBeLessThanOrEqual(7)
    expect(Math.abs(p.headZ ?? 0)).toBeLessThanOrEqual(7)
    expect(Math.abs(p.eyeX ?? 0)).toBeLessThanOrEqual(0.6)
  }
})

it('settledHead は頭が正面近くの時だけ true', () => {
  expect(settledHead(0, 0)).toBe(true)
  expect(settledHead(3.9, -2.9)).toBe(true)
  expect(settledHead(4.1, 0)).toBe(false)
  expect(settledHead(0, -3.1)).toBe(false)
})
