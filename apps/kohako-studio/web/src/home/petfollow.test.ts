import { expect, it } from 'vitest'
import { petFollow, zeroPet } from './petfollow'
const rect = { x: 0, y: 0, w: 100, h: 100 }
const options = { enabled: true, reduced: false, subtle: false }
const point = (x: number) => ({ x, y: 50, time: 0 })
it('requires a pressed, moved head track and limits offsets', () => {
  expect(petFollow(zeroPet(), null, 1, options)).toEqual(zeroPet())
  expect(petFollow(zeroPet(), { rect, points: [point(70), point(72)] }, 1, options)).toEqual(zeroPet())
  const moved = petFollow(zeroPet(), { rect, points: [point(50), point(1000)] }, 1, options)
  expect(Math.abs(moved.headX)).toBeLessThanOrEqual(8); expect(Math.abs(moved.headZ)).toBeLessThanOrEqual(6)
  expect(petFollow(zeroPet(), { rect, points: [point(50), point(90)] }, 1, { ...options, reduced: true })).toEqual(zeroPet())
  let returning = moved
  for (let i = 0; i < 100; i++) returning = petFollow(returning, null, 0.1, options)
  expect(returning.headX).toBeCloseTo(0, 5)
})
