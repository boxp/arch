import { describe, expect, it } from 'vitest'
import { boundaryTime, makeVisemes, visemeAt } from './viseme'
describe('text visemes', () => {
  it('distinguishes vowels and closes at the end', () => {
    const seq = makeVisemes('いうお', 3)
    expect(visemeAt(seq, 0.5).width).toBeGreaterThan(1)
    expect(visemeAt(seq, 1.5).width).toBeCloseTo(0.8)
    expect(visemeAt(seq, 2.5).open).toBeGreaterThan(visemeAt(seq, 1.5).open)
    expect(visemeAt(seq, 3)).toMatchObject({ vowel: 'closed', open: 0, width: 1 })
  })
  it('extends long vowels, closes for sokuon and nearly closes for n', () => {
    const seq = makeVisemes('うーっん', 3.5)
    expect(visemeAt(seq, 1.5).vowel).toBe('u')
    expect(visemeAt(seq, 2.25).vowel).toBe('closed')
    expect(visemeAt(seq, 3).vowel).toBe('n')
  })
  it('resynchronizes to a character index', () => {
    const seq = makeVisemes('あいう', 3)
    expect(visemeAt(seq, boundaryTime(seq, 2) + 0.2).vowel).toBe('u')
  })
})
