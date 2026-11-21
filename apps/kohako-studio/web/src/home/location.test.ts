import { describe, expect, it, vi } from 'vitest'
import {
  acquire,
  describe as describeLocation,
  FRESH_MS,
  fixOf,
  missOf,
  noteOf,
  payloadOf,
  TIMEOUT_MS,
} from './location'

// 架空の位置（本人の実位置ではない）。
const NOW = Date.UTC(2026, 10, 21, 3, 0, 0)
const coords = { latitude: 35.6812345, longitude: 139.7671234, accuracy: 24.6 }

describe('location helpers', () => {
  it('maps geolocation error codes', () => {
    expect(missOf(1)).toBe('denied')
    expect(missOf(2)).toBe('unavailable')
    expect(missOf(3)).toBe('timeout')
    expect(missOf(undefined)).toBe('unavailable')
  })
  it('rounds the fix and rejects invalid coordinates', () => {
    expect(fixOf(coords, NOW)).toEqual({ lat: 35.68123, lon: 139.76712, accuracy: 25, capturedAt: NOW })
    expect(fixOf({ ...coords, latitude: 95 }, NOW)).toBeNull()
    expect(fixOf({ ...coords, accuracy: Number.NaN }, NOW)).toBeNull()
  })
  it('sends only fresh fixes, otherwise the reason', () => {
    const fix = { lat: 1, lon: 2, accuracy: 3, capturedAt: NOW - 1000 }
    expect(payloadOf(fix, 'unavailable', NOW)).toEqual({ status: 'ok', ...fix })
    expect(payloadOf({ ...fix, capturedAt: NOW - FRESH_MS - 1 }, 'unavailable', NOW)).toEqual({ status: 'stale' })
    expect(payloadOf(null, 'denied', NOW)).toEqual({ status: 'denied' })
  })
  it('describes each state without showing coordinates', () => {
    const fix = { lat: 35.68123, lon: 139.76712, accuracy: 25, capturedAt: NOW - 3 * 60_000 }
    expect(describeLocation(false, fix, null, NOW)).toContain('共有していません')
    const on = describeLocation(true, fix, null, NOW)
    expect(on).toContain('11:57取得（3分前）')
    expect(on).toContain('精度約25m')
    expect(on).not.toMatch(/35\.6|139\.7/)
    expect(describeLocation(true, { ...fix, accuracy: 2500 }, null, NOW)).toContain('約2.5km（おおまか）')
    expect(describeLocation(true, null, 'denied', NOW)).toContain('許可されていません')
    expect(describeLocation(true, null, 'timeout', NOW)).toContain('時間内に取得できませんでした')
    expect(describeLocation(true, null, 'unavailable', NOW)).toContain('取得できませんでした')
    expect(describeLocation(true, null, 'unsupported', NOW)).toContain('取得できません')
    expect(describeLocation(true, { ...fix, capturedAt: NOW - FRESH_MS - 1 }, null, NOW)).toContain('古いため')
    expect(describeLocation(true, null, null, NOW)).toContain('次の送信時に位置を取得')
    expect(noteOf(fix, null, NOW)).toBe('📍 位置を共有中（11:57取得・精度約25m）')
    expect(noteOf(null, 'denied', NOW)).toContain('許可されていません')
  })
})

describe('acquire', () => {
  it('reports unsupported without geolocation', async () => {
    expect(await acquire(undefined, () => NOW)).toEqual({ fix: null, miss: 'unsupported' })
  })
  it('requests a single position and returns the fix', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords, timestamp: NOW } as unknown as GeolocationPosition),
    )
    expect(await acquire({ getCurrentPosition }, () => NOW)).toEqual({
      fix: { lat: 35.68123, lon: 139.76712, accuracy: 25, capturedAt: NOW },
      miss: 'unavailable',
    })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
  it('returns the denial reason', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, ng?: PositionErrorCallback | null) =>
      ng?.({ code: 1 } as GeolocationPositionError),
    )
    expect(await acquire({ getCurrentPosition }, () => NOW)).toEqual({ fix: null, miss: 'denied' })
  })
  it('gives up when the browser never answers', async () => {
    vi.useFakeTimers()
    try {
      const pending = acquire({ getCurrentPosition: () => undefined }, () => NOW)
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 2000)
      expect(await pending).toEqual({ fix: null, miss: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })
})
