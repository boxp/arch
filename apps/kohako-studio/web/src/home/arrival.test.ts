import { describe, expect, it } from 'vitest'
import { arrivalNote, arrivalPhase, LANDING_MS } from './arrival'
const base = { rigLoading: false, visit: false, returnedAt: null, now: 10_000 }
describe('家へ戻る演出（BOXP-599 TD-01）', () => {
  it('実際の処理状態から段階を決める', () => {
    expect(arrivalPhase({ ...base, rigLoading: true })).toBe('arriving')
    expect(arrivalPhase({ ...base, visit: true })).toBe('away')
    expect(arrivalPhase({ ...base, rigLoading: true, visit: true })).toBe('away')
    expect(arrivalPhase(base)).toBe('home')
  })
  it('戻った直後だけ短く着地し、待たせない', () => {
    expect(arrivalPhase({ ...base, returnedAt: 10_000 })).toBe('landing')
    expect(arrivalPhase({ ...base, returnedAt: 10_000 - LANDING_MS + 1 })).toBe('landing')
    expect(arrivalPhase({ ...base, returnedAt: 10_000 - LANDING_MS })).toBe('home')
    expect(LANDING_MS).toBeLessThanOrEqual(1000)
  })
  it('段階ごとの短い案内', () => {
    expect(arrivalNote.arriving).toContain('戻っています')
    expect(arrivalNote.away).toContain('現場')
    expect(arrivalNote.home).toBe('')
  })
})
