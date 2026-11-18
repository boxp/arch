import { expect, it } from 'vitest'
import {
  CANCEL_SECONDS,
  FIRST_GAP,
  GAP,
  QUIET_GAP,
  RESUME_GAP,
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

it('待機に入ってすぐは何もせず、最初の間（5〜10 秒）をあけてから 1 つ出す', () => {
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

it('同じしぐさを続けて出さず、間は不規則な長さ（見た目の変化が無い「じっと落ち着く」の後だけ短い）', () => {
  const d = new IdleDirector(Math.random),
    starts: { t: number; act: IdleAct }[] = []
  let before: IdleAct | null = null,
    endedAt = 0
  const gaps: number[] = [],
    quietGaps: number[] = []
  for (const { t, f } of run(d, 0, 3000)) {
    if (f.act && !before) {
      if (starts.length > 0) (starts[starts.length - 1].act === 'still' ? quietGaps : gaps).push(t - endedAt)
      starts.push({ t, act: f.act })
    }
    if (!f.act && before) endedAt = t
    before = f.act
  }
  expect(starts.length).toBeGreaterThan(120)
  for (let i = 1; i < starts.length; i++) expect(starts[i].act).not.toBe(starts[i - 1].act)
  expect(new Set(starts.map((s) => s.act)).size).toBe(idleActNames.length)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(GAP[0] - 0.06)
  expect(Math.max(...gaps)).toBeLessThanOrEqual(GAP[1] + 0.06)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(6)
  expect(Math.min(...quietGaps)).toBeGreaterThanOrEqual(QUIET_GAP[0] - 0.06)
  expect(Math.max(...quietGaps)).toBeLessThanOrEqual(QUIET_GAP[1] + 0.06)
  // しぐさが出ている時間は全体の 4 割未満（常に動き続けない）。
  const busy = run(new IdleDirector(Math.random), 0, 3000).filter((x) => x.f.act && x.f.act !== 'still').length
  expect(busy / (3000 / 0.05)).toBeLessThan(0.4)
})

it('出せない状況になったら短く戻し、次は通常の間をあけてから出す', () => {
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
  // 中断したしぐさが戻り切った時点から通常の間（seq(0) なので GAP の下限）をあけて次を出す。
  const next = frames.find((x) => x.t > 3 && x.f.act)
  expect(next?.t).toBeCloseTo(1.5 + CANCEL_SECONDS + HOLD_MARGIN + GAP[0], 0)
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
  // その後落ち着いても、すぐには出さず短い間（RESUME_GAP）をあける。
  expect(run(d, 100, 100 + RESUME_GAP[0] - 0.1).every((x) => !x.f.act)).toBe(true)
})

it('頭が正面近くに来るまで待ち、来なければ SETTLE_WAIT 秒で始める', () => {
  const d = new IdleDirector(seq(0))
  const frames = run(d, 0, 40, (t) => ({ ...calm, settled: () => t >= 7 }))
  expect(frames.find((x) => x.f.act)?.t).toBeCloseTo(7, 1)
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

it('通常の戻りの途中で中断しても、その時点の強さから短く戻す', () => {
  const d = new IdleDirector(seq(0))
  d.force('tilt')
  // seq(0): 保ち 1.8 秒 → 戻りは 2.7 秒から 1.1 秒。戻り始めて 0.3 秒の 3.0 秒で中断する。
  const end = IN_SECONDS + idleActs.tilt.seconds[0],
    cut = end + 0.3
  const frames = run(d, 0, 6, (t) => ({ ...calm, calm: t < cut }))
  const at = (t: number) => frames.find((x) => Math.abs(x.t - t) < 0.026)?.f as IdleFrame
  expect(Math.abs(at(cut - 0.05).pose.headZ)).toBeGreaterThan(4)
  expect(size(at(cut + CANCEL_SECONDS + 0.05))).toBeLessThan(0.01)
  expect(at(cut + CANCEL_SECONDS + HOLD_MARGIN + 0.1).hold).toBe(false)
  expect(cut + CANCEL_SECONDS).toBeLessThan(end + OUT_SECONDS)
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i].f.pose.headZ - frames[i - 1].f.pose.headZ)).toBeLessThan(1.5)
})

// 待機クリップの頭の振り（±13° を約 12.6 秒周期）を模した「正面近く」。実画面と同じく、始まりが少し遅れる。
const swing = (t: number) => Math.abs(13 * Math.sin((2 * Math.PI * t) / 12.6)) < 4
/** 目に見える変化（じっと落ち着く以外）の始まりから次の始まりまでの秒数。 */
function visibleIntervals(d: IdleDirector, seconds: number, input: (t: number) => IdleInput) {
  const out: number[] = []
  let before: IdleAct | null = null,
    last: number | null = null
  for (const { t, f } of run(d, 0, seconds, input)) {
    if (f.act && f.act !== 'still' && f.act !== before) {
      if (last !== null) out.push(t - last)
      last = t
    }
    before = f.act
  }
  return out.sort((a, b) => a - b)
}

it('目に見える変化の間隔: 中央は 20 秒前後、長くても 45 秒を超えない（1 分あかない）', () => {
  const xs = visibleIntervals(new IdleDirector(Math.random), 20000, (t) => ({ ...calm, settled: () => swing(t) }))
  const median = xs[Math.floor(xs.length / 2)],
    p95 = xs[Math.floor(xs.length * 0.95)]
  expect(xs.length).toBeGreaterThan(600)
  expect(median).toBeGreaterThan(14)
  expect(median).toBeLessThan(24)
  expect(p95).toBeLessThan(36)
  expect(xs[xs.length - 1]).toBeLessThan(45)
  // せわしなくしない: 続けざまには出さない。
  expect(xs[0]).toBeGreaterThan(GAP[0] + IN_SECONDS + OUT_SECONDS)
})

it('ときどき手を動かしても（20 秒ごとに 1 秒）、数え直しで出なくならない', () => {
  // 動かしている 1 秒とその後 4 秒は出せない（main.ts の IDLE_POINTER_QUIET_MS と同じ）。
  const input = (t: number): IdleInput => ({ ...calm, calm: t % 20 >= 5, settled: () => swing(t) })
  const d = new IdleDirector(Math.random)
  let before: IdleAct | null = null,
    starts = 0
  const frames = run(d, 0, 6000, input)
  for (const { f } of frames) {
    if (f.act && !before) starts++
    before = f.act
  }
  // 15 秒の静かな時間ごとに、平均して 0.5 回以上は出る（以前は最初の間 9〜18 秒から数え直しで 0.3 回ほど）。
  expect(starts / 300).toBeGreaterThan(0.5)
  // 出せない間に新しく始めない。
  expect(frames.every((x, i) => !(x.f.act && !frames[i - 1]?.f.act) || input(x.t).calm)).toBe(true)
})

it('中断から落ち着いた直後は、予定が過ぎていても短い間をあけてから出す', () => {
  const d = new IdleDirector(seq(0.5))
  // 100 秒まで出せない（会話など）。最初の予定は立たないので、落ち着いてから最初の間を数える。
  const first = run(d, 0, 140, (t) => ({ ...calm, calm: t >= 100 })).find((x) => x.f.act)
  expect(first?.t).toBeCloseTo(100 + (FIRST_GAP[0] + FIRST_GAP[1]) / 2, 0)
  // 予定が立った後に長く中断し、予定が過ぎた: 落ち着いてから RESUME_GAP をあける。
  const e = new IdleDirector(seq(0.5))
  const frames = run(e, 0, 80, (t) => ({ ...calm, calm: t < 2 || t >= 60 }))
  const next = frames.find((x) => x.f.act)
  expect(next?.t).toBeCloseTo(60 + (RESUME_GAP[0] + RESUME_GAP[1]) / 2, 0)
})
