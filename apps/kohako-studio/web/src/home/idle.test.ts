import { expect, it } from 'vitest'
import {
  ARM_OVERSHOOT,
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
  releaseCurve,
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
  expect(s.some((x) => x.f.emotion === 'smileClosed')).toBe(true)
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

// ---- 腕と体のしぐさ（Owner 要望: 顔だけでなくジェスチャーも）----
const armSize = (f: IdleFrame) =>
  Math.max(0, ...[f.arms?.right, f.arms?.left].flatMap((a) => [a?.up ?? 0, a?.fo ?? 0, a?.ha ?? 0]).map(Math.abs))

it('腕や体を使うしぐさが 3 割前後あり、顔だけのしぐさも残る', () => {
  const body = idleActNames.filter(
      (a) => idleActs[a].arms || idleActs[a].peak?.arms || idleActs[a].sway || idleActs[a].gesture,
    ),
    total = idleActNames.reduce((s, a) => s + idleActs[a].weight, 0),
    share = body.reduce((s, a) => s + idleActs[a].weight, 0) / total
  expect(body.sort()).toEqual(['giggle', 'mouth', 'shy', 'stretch', 'sway', 'tidy', 'wave'])
  expect(share).toBeGreaterThan(0.25)
  expect(share).toBeLessThan(0.45)
})

it('腕のしぐさは 0 から滑らかに入り、保って、0 へ戻る（終われば腕は null）', () => {
  const d = new IdleDirector(seq(0))
  d.force('tidy')
  const frames = run(d, 0, 9),
    on = frames.filter((x) => x.f.act === 'tidy')
  expect(frames[0].f.arms).toBeNull()
  expect(Math.max(...on.map((x) => armSize(x.f)))).toBeCloseTo(1.05, 5)
  // 50ms で動く量は小さい（跳ばない）。体の横から前まで 1 秒強かけて運ぶ。
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(armSize(frames[i].f) - armSize(frames[i - 1].f))).toBeLessThan(0.08)
  expect(frames.at(-1)?.f.arms).toBeNull()
  expect(frames.at(-1)?.f.act).toBeNull()
})

it('腕の角度は、実描画で破綻が無いと確かめた範囲に留める（肘 1.1・肩 0.2 まで。腕を外へ開く形は使わない）', () => {
  for (const a of idleActNames)
    for (const arm of [
      idleActs[a].arms?.right,
      idleActs[a].arms?.left,
      idleActs[a].peak?.arms?.right,
      idleActs[a].peak?.arms?.left,
    ]) {
      expect(Math.abs(arm?.fo ?? 0)).toBeLessThanOrEqual(1.1)
      expect(Math.abs(arm?.up ?? 0)).toBeLessThanOrEqual(0.2)
      // 外へ開く（up が負）と、翼を広げたように見える。
      expect(arm?.up ?? 0).toBeGreaterThanOrEqual(0)
    }
})

// ---- 伸び・手を前でそろえる・体を揺らすの作り直し（Owner 指摘「不自然でかわいくない」）----
it('手を前でそろえるしぐさは、両手が体の中央で重なるまで肘を曲げ、左右を少し変えて、小首をかしげてほほえむ', () => {
  const d = new IdleDirector(seq(0.5))
  d.force('tidy')
  const frames = run(d, 0, 9),
    held = frames.find((x) => armSize(x.f) > 1.04)
  // 実描画では肘 0.9 で両手が寄り、1.0 前後で重なる。0.28（以前）では手が太ももの横で止まった。
  expect(held?.f.arms?.right.fo).toBeGreaterThan(0.95)
  expect(held?.f.arms?.left.fo).toBeGreaterThan(0.95)
  expect(held?.f.arms?.right.fo).not.toBeCloseTo(held?.f.arms?.left.fo ?? 0, 2)
  expect(held?.f.emotion).toBe('smile')
  expect(Math.abs(held?.f.pose.headZ ?? 0)).toBeGreaterThan(4)
})

it('力を抜く曲線は 1 から 0 へ滑らかに下り、途中で指定の割合だけ行き過ぎる', () => {
  expect(releaseCurve(-1, 0.2)).toBe(1)
  expect(releaseCurve(0, 0.2)).toBe(1)
  expect(releaseCurve(1, 0.2)).toBe(0)
  expect(releaseCurve(2, 0.2)).toBe(0)
  const xs = Array.from({ length: 201 }, (_, i) => releaseCurve(i / 200, 0.2))
  expect(Math.min(...xs)).toBeLessThan(-0.15)
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.2 - 1e-9)
  for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.02)
  expect(Math.min(...Array.from({ length: 201 }, (_, i) => releaseCurve(i / 200, 0)))).toBeGreaterThanOrEqual(0)
})

it('伸びは、ゆっくり力んで（目を閉じてあごを上げ、両手を前へ下ろす）、ふっと抜いて少し沈み、ほほえんで終わる', () => {
  const d = new IdleDirector(seq(0.5))
  d.force('stretch')
  const frames = run(d, 0, 9),
    on = frames.filter((x) => x.f.act === 'stretch'),
    y = on.map((x) => x.f.pose.headY),
    top = y.indexOf(Math.max(...y)),
    closed = on.filter((x) => x.f.eyes),
    smile = on.filter((x) => x.f.emotion === 'smile')
  // 力む: あごが 5° 以上上がり、両手は体の前（肘 0.6 以上）。入りは 1 秒以上かける。
  expect(y[top]).toBeGreaterThan(5)
  expect(on[top].t - on[0].t).toBeGreaterThan(1)
  expect(on[top].f.arms?.right.fo).toBeGreaterThan(0.6)
  expect(on[top].f.arms?.left.fo).toBeGreaterThan(0.6)
  // 目は力んでいる間だけ閉じ（1 秒以上）、抜いた後は開けてほほえむ（1 秒以上）。順序は 閉じる → ほほえむ。
  expect(closed.length * 0.05).toBeGreaterThan(1)
  expect(smile.length * 0.05).toBeGreaterThan(1)
  expect((closed.at(-1)?.t ?? 0) < (smile[0]?.t ?? 0)).toBe(true)
  expect(smile.some((x) => x.f.eyes)).toBe(false)
  // 抜く: あごは山から 1 秒ほどで下り、いったん正面より下へ沈んでから戻る。腕は待機の位置より外へはほとんど出ない。
  const after = on.slice(top)
  expect(Math.min(...after.map((x) => x.f.pose.headY))).toBeLessThan(-1)
  expect(Math.min(...after.map((x) => x.f.arms?.right.fo ?? 0))).toBeGreaterThan(-0.72 * 0.22 * ARM_OVERSHOOT - 1e-6)
  // 跳ばない。
  for (let i = 1; i < frames.length; i++) {
    expect(Math.abs(frames[i].f.pose.headY - frames[i - 1].f.pose.headY)).toBeLessThan(1)
    expect(Math.abs(armSize(frames[i].f) - armSize(frames[i - 1].f))).toBeLessThan(0.08)
  }
  expect(frames.at(-1)?.f.act).toBeNull()
})

it('伸びの途中（力んでいる時・抜いている時）で中断しても、跳ばずに短く戻り、目も開ける', () => {
  for (const cut of [0.7, 1.5, 2.4, 3.0, 3.4, 4.2]) {
    const d = new IdleDirector(seq(0.5))
    d.force('stretch')
    const frames = run(d, 0, cut + 2, (t) => ({ ...calm, calm: t < cut }))
    for (let i = 1; i < frames.length; i++) {
      expect(Math.abs(frames[i].f.pose.headY - frames[i - 1].f.pose.headY)).toBeLessThan(1.6)
      expect(Math.abs(armSize(frames[i].f) - armSize(frames[i - 1].f))).toBeLessThan(0.2)
    }
    const after = frames.filter((x) => x.t >= cut + CANCEL_SECONDS)
    expect(Math.max(...after.map((x) => size(x.f)))).toBeLessThan(1e-6)
    expect(after.every((x) => x.f.arms === null)).toBe(true)
    expect(frames.filter((x) => x.t >= cut).some((x) => x.f.eyes || x.f.emotion)).toBe(false)
  }
})

it('体を揺らすしぐさは、体が先に動き、頭・腕・手先が順に遅れて付いてくる。腕の振りは小さい', () => {
  const d = new IdleDirector(seq(0.9))
  d.force('sway')
  // 入り・戻りを除いた、揺れが保たれている間で比べる。
  const frames = run(d, 0, 9).filter((x) => x.t > 1.2 && x.t < 5.2),
    firstPeak = (v: (f: IdleFrame) => number) => {
      for (let i = 1; i < frames.length - 1; i++)
        if (v(frames[i].f) > v(frames[i - 1].f) && v(frames[i].f) >= v(frames[i + 1].f)) return frames[i].t
      return Number.NaN
    }
  // 腕と手先は体の傾きと同じ側へ振れる（swing・hand は負）ので、同じ向きの山どうしを比べる。頭は体と逆へ傾く。
  const body = firstPeak((f) => f.pose.bodyZ),
    head = firstPeak((f) => -f.pose.headZ),
    arm = firstPeak((f) => -(f.arms?.right.up ?? 0)),
    hand = firstPeak((f) => -(f.arms?.right.ha ?? 0))
  const later = (a: number, b: number) => (((b - a) % 3.2) + 3.2) % 3.2
  expect(later(body, head)).toBeGreaterThan(0.2)
  expect(later(body, head)).toBeLessThan(later(body, arm))
  expect(later(body, arm)).toBeLessThan(later(body, hand))
  expect(later(body, hand)).toBeLessThan(1.1)
  // 以前の 0.12 は棒の腕が左右へ倒れるように見えた。
  expect(Math.max(...frames.map((x) => Math.abs(x.f.arms?.right.up ?? 0)))).toBeLessThan(0.06)
})

it('体を揺らすしぐさは 0 から始まって左右へ振れ、両腕は画面の同じ向きへ振れる。向きは毎回選ぶ', () => {
  const d = new IdleDirector(seq(0.9))
  d.force('sway')
  const frames = run(d, 0, 9),
    z = frames.map((x) => x.f.pose.bodyZ)
  expect(Math.abs(z[1])).toBeLessThan(0.2)
  expect(Math.max(...z)).toBeGreaterThan(4.5)
  expect(Math.min(...z)).toBeLessThan(-4.5)
  for (let i = 1; i < z.length; i++) expect(Math.abs(z[i] - z[i - 1])).toBeLessThan(0.8)
  // 右腕と左腕の up は逆符号（鏡映の書き方）＝画面では同じ向き。頭は体と逆へ少し残す。
  const peak = frames.find((x) => x.f.pose.bodyZ > 4.5)
  expect(peak?.f.arms?.left.up).toBeCloseTo(-(peak?.f.arms?.right.up ?? 0), 6)
  expect(peak?.f.arms?.left.ha).toBeCloseTo(-(peak?.f.arms?.right.ha ?? 0), 6)
  expect(peak?.f.pose.headZ).toBeLessThan(0)
  expect(frames.at(-1)?.f.arms).toBeNull()
  const other = new IdleDirector(seq(0.1))
  other.force('sway')
  const first = (fs: ReturnType<typeof run>) => fs.find((x) => Math.abs(x.f.pose.bodyZ) > 2)?.f.pose.bodyZ ?? 0
  expect(Math.sign(first(run(other, 0, 9)))).toBe(-Math.sign(first(frames)))
})

it('体を揺らす途中で中断しても、体と腕の角度は跳ばずに短く戻る（揺れの位相は続ける）', () => {
  // 揺れの山・谷・0 付近のどこで中断しても同じ。
  for (const cut of [0.6, 0.8, 1.6, 2.4, 3.3, 4.8]) {
    const d = new IdleDirector(seq(0.9))
    d.force('sway')
    const frames = run(d, 0, cut + 2, (t) => ({ ...calm, calm: t < cut })),
      z = frames.map((x) => x.f.pose.bodyZ),
      up = frames.map((x) => x.f.arms?.right.up ?? 0)
    for (let i = 1; i < z.length; i++) {
      expect(Math.abs(z[i] - z[i - 1])).toBeLessThan(1.2)
      expect(Math.abs(up[i] - up[i - 1])).toBeLessThan(0.03)
    }
    const after = frames.filter((x) => x.t >= cut + CANCEL_SECONDS)
    expect(Math.max(...after.map((x) => Math.abs(x.f.pose.bodyZ)))).toBeLessThan(1e-6)
  }
})

it('身振りを借りるしぐさは、保っている間だけ身振りを出し、長さは身振りのクリップを覆う', () => {
  const d = new IdleDirector(seq(0))
  d.force('wave')
  const frames = run(d, 0, 6),
    on = frames.filter((x) => x.f.gesture === 'greet')
  expect(frames[0].f.gesture).toBe('greet')
  // 挨拶のクリップは 2.6 秒。
  expect(on.length * 0.05).toBeGreaterThan(2.6)
  expect(on.length * 0.05).toBeLessThan(3.2)
  expect(frames.some((x) => x.f.emotion === 'smile')).toBe(true)
  expect(frames.at(-1)?.f.gesture).toBeNull()
  const m = new IdleDirector(seq(0))
  m.force('mouth')
  const mouth = run(m, 0, 7).filter((x) => x.f.gesture === 'shyHand')
  expect(mouth.length * 0.05).toBeGreaterThan(3.9)
  expect(mouth.length * 0.05).toBeLessThan(4.5)
})

it('中断されたら身振りと腕をすぐ手放す', () => {
  const d = new IdleDirector(seq(0))
  d.force('wave')
  const frames = run(d, 0, 3, (t) => ({ ...calm, calm: t < 1 }))
  expect(frames.filter((x) => x.t < 1).every((x) => x.f.gesture === 'greet')).toBe(true)
  expect(frames.filter((x) => x.t >= 1).every((x) => x.f.gesture === null)).toBe(true)
  const s = new IdleDirector(seq(0))
  s.force('tidy')
  const arms = run(s, 0, 3, (t) => ({ ...calm, calm: t < 1.5 }))
  expect(armSize(arms.find((x) => x.t >= 1.45)?.f as IdleFrame)).toBeGreaterThan(0.9)
  expect(arms.filter((x) => x.t > 1.5 + CANCEL_SECONDS + 0.05).every((x) => x.f.arms === null)).toBe(true)
})

it('控えめでは身振りを借りるしぐさを選ばず、腕の大きさは 6 割', () => {
  const d = new IdleDirector(Math.random),
    seen = new Set<IdleAct>()
  for (let i = 0; i < 3000; i++) {
    const a = d.pick('day', true)
    seen.add(a)
    d.force(a)
    d.step(i * 1000, calm)
    d.reset()
  }
  expect(seen.has('wave') || seen.has('mouth')).toBe(false)
  expect(seen.has('stretch') && seen.has('tidy') && seen.has('sway')).toBe(true)
  const s = new IdleDirector(seq(0))
  s.force('tidy')
  expect(Math.max(...run(s, 0, 3, { ...calm, subtle: true }).map((x) => armSize(x.f)))).toBeCloseTo(
    1.05 * SUBTLE_SCALE,
    5,
  )
  const p = new IdleDirector(seq(0))
  p.force('stretch')
  expect(Math.max(...run(p, 0, 3, { ...calm, subtle: true }).map((x) => armSize(x.f)))).toBeCloseTo(
    0.72 * SUBTLE_SCALE,
    2,
  )
})

// ---- もう少し女の子らしくかわいく（Owner 要望）----
it('はにかむしぐさは、照れてから途中でほほえみに替わり、戻る時には表情を返す', () => {
  const d = new IdleDirector(seq(0))
  d.force('shy')
  const frames = run(d, 0, 8),
    shy = frames.filter((x) => x.f.emotion === 'shy'),
    smile = frames.filter((x) => x.f.emotion === 'smile')
  expect(frames[0].f.emotion).toBeNull()
  expect(shy.length * 0.05).toBeGreaterThan(1.5)
  expect(smile.length * 0.05).toBeGreaterThan(1)
  // 照れが先、ほほえみが後で、行き来しない。
  expect(shy[shy.length - 1].t).toBeLessThan(smile[0].t)
  expect(frames.filter((x) => x.t > smile[smile.length - 1].t).every((x) => x.f.emotion === null)).toBe(true)
  // 目をそらす間はカーソル追従を退かせ、両手を体の前へ寄せる。
  expect(shy.every((x) => x.f.gaze)).toBe(true)
  expect(Math.max(...frames.map((x) => x.f.arms?.right.fo ?? 0))).toBeCloseTo(idleActs.shy.arms?.right?.fo ?? 0, 5)
  expect(frames.at(-1)?.f.act).toBeNull()
})

it('はにかむ途中で中断すると、表情を返して短く戻る（ほほえみへは進まない）', () => {
  const d = new IdleDirector(seq(0))
  d.force('shy')
  run(d, 0, 2)
  const after = run(d, 2, 4, { ...calm, calm: false })
  expect(after.every((x) => x.f.emotion === null)).toBe(true)
  expect(after.find((x) => x.t > 2 + CANCEL_SECONDS + 0.5)?.f.act ?? null).toBeNull()
})

it('くすっと笑うしぐさは短く、弾みは小さく、1 コマで跳ばない', () => {
  const d = new IdleDirector(seq(0))
  d.force('giggle')
  const frames = run(d, 0, 6),
    on = frames.filter((x) => x.f.act === 'giggle')
  expect(on.length * 0.05).toBeLessThan(IN_SECONDS + idleActs.giggle.seconds[1] + 1.6)
  expect(frames.some((x) => x.f.emotion === 'smileClosed')).toBe(true)
  for (let i = 1; i < frames.length; i++) {
    expect(Math.abs(frames[i].f.pose.headY - frames[i - 1].f.pose.headY)).toBeLessThan(2)
    expect(Math.abs(frames[i].f.pose.bodyZ - frames[i - 1].f.pose.bodyZ)).toBeLessThan(1.2)
  }
  expect(Math.max(...frames.map((x) => Math.abs(x.f.pose.headY)))).toBeLessThanOrEqual(6)
})

it('ほほえみや照れを伴うしぐさが半分以上を占める', () => {
  const warm = idleActNames.filter((a) => idleActs[a].emotion),
    total = idleActNames.reduce((s, a) => s + idleActs[a].weight, 0)
  expect(warm.reduce((s, a) => s + idleActs[a].weight, 0) / total).toBeGreaterThan(0.5)
})
