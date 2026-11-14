import { expect, it } from 'vitest'
import { clipHold, isPetting, petFollow, petShown, zeroPet, type PetOffset, type PetTrack } from './petfollow'
const rect = { x: 0, y: 0, w: 100, h: 100 }
const options = { enabled: true, reduced: false, subtle: false }
const point = (x: number, y = 50, time = 0) => ({ x, y, time })
const run = (track: PetTrack | null, seconds: number, from: PetOffset = zeroPet(), opts = options) => {
  let o = from
  for (let t = 0; t < seconds; t += 1 / 60) o = petFollow(o, track, 1 / 60, opts)
  return o
}
/** 往復のなで（start→end→start…）。最後の点で止まっている。 */
const strokes = (from: number, to: number, axis: 'x' | 'y' = 'x') =>
  Array.from({ length: 40 }, (_, i) => {
    const v = i % 10 < 5 ? from + ((to - from) * (i % 5)) / 4 : to - ((to - from) * (i % 5)) / 4
    return axis === 'x' ? point(v, 50, i * 16) : point(50, v, i * 16)
  })
it('requires a pressed, moved head track and limits offsets', () => {
  expect(petFollow(zeroPet(), null, 1, options)).toEqual(zeroPet())
  expect(petFollow(zeroPet(), { rect, points: [point(70), point(72)] }, 1, options)).toEqual(zeroPet())
  const moved = run({ rect, points: [point(50), point(1000)] }, 2)
  expect(Math.abs(moved.headX)).toBeLessThanOrEqual(7)
  expect(Math.abs(moved.headZ)).toBeLessThanOrEqual(11)
  expect(Math.abs(moved.headY)).toBeLessThanOrEqual(3)
  expect(petFollow(zeroPet(), { rect, points: [point(50), point(90)] }, 1, { ...options, reduced: true })).toEqual(
    zeroPet(),
  )
  expect(petFollow(zeroPet(), { rect, points: [point(50), point(90)] }, 1, { ...options, enabled: false })).toEqual(
    zeroPet(),
  )
  const returning = run(null, 3, moved)
  for (const v of Object.values(returning)) expect(Math.abs(v)).toBeLessThan(0.05)
})
// TD-01: PC の頭（幅約 110px）でも見える大きさで、往復しても打ち消し合わず、縦のなででも動くこと。
it('leans visibly toward the stroking hand and keeps the side across back-and-forth strokes', () => {
  const right = run({ rect, points: strokes(60, 95), now: 39 * 16 + 500 }, 1)
  expect(right.headZ).toBeGreaterThan(7)
  expect(right.headX).toBeGreaterThan(3)
  expect(right.headY).toBeLessThan(-2)
  const left = run({ rect, points: strokes(40, 5), now: 39 * 16 + 500 }, 1)
  expect(left.headZ).toBeLessThan(-7)
  expect(left.headX).toBeLessThan(-3)
  // 中央をまたぐ左右の往復でも、頭が寄った姿勢を保つ（以前は手の位置と向きの符号が往復ごとに反転して ±0 付近に戻った）
  let across = zeroPet(),
    min = Infinity
  for (let i = 10; i <= 40; i++) {
    across = run({ rect, points: strokes(20, 80).slice(0, i), now: i * 16 }, 0.05, across)
    if (i > 20) min = Math.min(min, Math.abs(across.headZ))
  }
  expect(min).toBeGreaterThan(4)
})
it('responds to vertical (front-to-back) strokes too', () => {
  const vertical = run({ rect, points: strokes(20, 70, 'y'), now: 39 * 16 + 500 }, 1)
  expect(Math.abs(vertical.headZ)).toBeGreaterThan(5)
  expect(vertical.headY).toBeLessThan(-2)
})
it('halves the motion in the subtle setting', () => {
  const normal = run({ rect, points: strokes(60, 95), now: 2000 }, 1),
    subtle = run({ rect, points: strokes(60, 95), now: 2000 }, 1, zeroPet(), { ...options, subtle: true })
  expect(Math.abs(subtle.headZ)).toBeLessThan(Math.abs(normal.headZ))
  expect(Math.abs(subtle.headZ)).toBeGreaterThan(4)
})
it('pauses the idle clip only while petting and resumes the latest requested clip', () => {
  const played: (string | null)[] = [],
    clips = clipHold((id) => played.push(id))
  clips.play('idle')
  clips.hold(true)
  clips.hold(true)
  clips.play('nod') // 止めている間の状態変化は覚えておき、再生しない
  expect(played).toEqual(['idle', null])
  clips.hold(false)
  expect(played).toEqual(['idle', null, 'nod'])
  clips.play('idle')
  expect(played.at(-1)).toBe('idle')
})
it('treats pressing without moving as not petting and reports when the head has returned', () => {
  expect(isPetting({ rect, points: [point(50), point(52, 52)] }, options)).toBe(false)
  expect(isPetting({ rect, points: [point(50, 40), point(50, 50)] }, options)).toBe(true)
  expect(isPetting({ rect, points: [point(50, 40), point(50, 50)] }, { ...options, enabled: false })).toBe(false)
  expect(petShown({ headX: 0, headY: 0, headZ: 0.2 })).toBe(false)
  expect(petShown({ headX: 0, headY: 0, headZ: 2 })).toBe(true)
})

it('なでている手が頭の内側にある間だけ閉眼する', async () => {
  const { petEyesWanted } = await import('./petfollow')
  const track = { rect, points: strokes(20, 80) }
  expect(petEyesWanted(null, options)).toBe(false)
  expect(petEyesWanted({ rect, points: [point(50)] }, options)).toBe(false)
  expect(petEyesWanted({ rect, points: [point(50), point(50)] }, options)).toBe(false)
  expect(petEyesWanted(track, { ...options, enabled: false })).toBe(false)
  expect(petEyesWanted(track, { ...options, reduced: true })).toBe(false)
  expect(petEyesWanted(track, options)).toBe(true)
  expect(petEyesWanted({ rect, points: [point(50), point(100)] }, options)).toBe(true)
  expect(petEyesWanted({ rect, points: [point(50), point(101)] }, options)).toBe(false)
  expect(petEyesWanted({ rect, points: [point(50), point(120)] }, options, true)).toBe(true)
  expect(petEyesWanted({ rect, points: [point(50), point(136)] }, options, true)).toBe(false)
})
// BOXP-525: スマホの不規則な入力間隔（8〜40ms）でも、なで中の頭がフレームごとに小刻みに跳ばない。
it('なで中の頭の揺れは入力間隔が不規則でもフレームごとに大きく跳ばない', () => {
  const pts: { x: number; y: number; time: number }[] = []
  let o = zeroPet(),
    t = 0,
    maxStep = 0
  const gaps = [8, 31, 12, 40, 9, 22, 35, 11]
  for (let i = 0, nextAt = 0; t < 3000; t += 1000 / 60) {
    while (nextAt <= t) {
      pts.push(point(50 + 38 * Math.sin((nextAt / 1000) * 2 * Math.PI * 1.8), 50, nextAt))
      nextAt += gaps[i++ % gaps.length]
    }
    const next = petFollow(o, { rect, points: pts, now: t }, 1 / 60, options)
    if (t > 800) maxStep = Math.max(maxStep, Math.abs(next.headZ - o.headZ), Math.abs(next.headX - o.headX))
    o = next
  }
  expect(maxStep).toBeLessThan(0.5)
})
