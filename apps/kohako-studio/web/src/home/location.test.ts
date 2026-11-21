import { describe, expect, it, vi } from 'vitest'
import {
  acquire,
  COARSE_TIMEOUT_MS,
  settle,
  describe as describeLocation,
  FRESH_MS,
  isVisitText,
  fixOf,
  missOf,
  chipOf,
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
  it('keeps the composer chip to a few characters and flags states that do not send a fresh location', () => {
    const fix = { lat: 35.68123, lon: 139.76712, accuracy: 25, capturedAt: NOW - 3 * 60_000 }
    expect(chipOf(fix, null, NOW)).toEqual({ label: '11:57', warn: false })
    expect(chipOf(fix, 'timeout', NOW)).toEqual({ label: '11:57', warn: true })
    expect(chipOf(null, 'denied', NOW)).toEqual({ label: '未許可', warn: true })
    expect(chipOf(null, 'unsupported', NOW)).toEqual({ label: '非対応', warn: true })
    expect(chipOf(null, 'timeout', NOW)).toEqual({ label: '取得失敗', warn: true })
    expect(chipOf(null, 'unavailable', NOW)).toEqual({ label: '取得失敗', warn: true })
    expect(chipOf({ ...fix, capturedAt: NOW - FRESH_MS - 1 }, null, NOW)).toEqual({ label: '古い位置', warn: true })
    expect(chipOf(null, null, NOW)).toEqual({ label: 'ON', warn: false })
    for (const miss of [null, 'denied', 'timeout', 'unsupported', 'stale'] as const)
      expect(chipOf(miss ? null : fix, miss, NOW).label.length).toBeLessThanOrEqual(5)
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
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 2000 + COARSE_TIMEOUT_MS + 2000)
      expect(await pending).toEqual({ fix: null, miss: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TD-01 transient failures', () => {
  it('retries once with coarse accuracy after a precise timeout', async () => {
    const calls: PositionOptions[] = []
    const getCurrentPosition = vi.fn((ok: PositionCallback, ng?: PositionErrorCallback | null, o?: PositionOptions) => {
      calls.push(o ?? {})
      if (o?.enableHighAccuracy) ng?.({ code: 3 } as GeolocationPositionError)
      else ok({ coords: { ...coords, accuracy: 800 }, timestamp: NOW - 60_000 } as unknown as GeolocationPosition)
    })
    expect(await acquire({ getCurrentPosition }, () => NOW)).toEqual({
      fix: { lat: 35.68123, lon: 139.76712, accuracy: 800, capturedAt: NOW - 60_000 },
      miss: 'unavailable',
    })
    expect(calls.map((o) => o.enableHighAccuracy)).toEqual([true, false])
    expect(calls[1].maximumAge).toBe(FRESH_MS)
  })
  it('does not retry a denial and keeps the precise reason when both fail', async () => {
    const denied = vi.fn((_ok: PositionCallback, ng?: PositionErrorCallback | null) =>
      ng?.({ code: 1 } as GeolocationPositionError),
    )
    expect(await acquire({ getCurrentPosition: denied }, () => NOW)).toEqual({ fix: null, miss: 'denied' })
    expect(denied).toHaveBeenCalledTimes(1)
    const fails = vi.fn((_ok: PositionCallback, ng?: PositionErrorCallback | null, o?: PositionOptions) =>
      ng?.({ code: o?.enableHighAccuracy ? 3 : 2 } as GeolocationPositionError),
    )
    expect(await acquire({ getCurrentPosition: fails }, () => NOW)).toEqual({ fix: null, miss: 'timeout' })
    expect(fails).toHaveBeenCalledTimes(2)
  })
  it('keeps a fresh previous fix on a transient failure only', () => {
    const prev = { lat: 1, lon: 2, accuracy: 30, capturedAt: NOW - 4 * 60_000 }
    expect(settle(prev, { fix: null, miss: 'timeout' }, NOW)).toEqual({ fix: prev, miss: 'timeout' })
    expect(settle(prev, { fix: null, miss: 'unavailable' }, NOW)).toEqual({ fix: prev, miss: 'unavailable' })
    expect(settle(prev, { fix: null, miss: 'denied' }, NOW)).toEqual({ fix: null, miss: 'denied' })
    const old = { ...prev, capturedAt: NOW - FRESH_MS - 1 }
    expect(settle(old, { fix: null, miss: 'timeout' }, NOW)).toEqual({ fix: null, miss: 'timeout' })
    const next = { ...prev, capturedAt: NOW }
    expect(settle(prev, { fix: next, miss: 'unavailable' }, NOW)).toEqual({ fix: next, miss: null })
    expect(payloadOf(prev, 'timeout', NOW)).toEqual({ status: 'ok', ...prev })
    expect(noteOf(prev, 'timeout', NOW)).toContain('最新の取り直しに失敗したため、この位置を取得時刻つきで伝えます')
  })
})

describe('isVisitText', () => {
  it('matches typed or resent visit requests so no location is attached', () => {
    for (const t of [
      '見てきて',
      ' 見てきて。',
      '見てきて!',
      '現場を見てきて',
      '自宅クラスタを見てきて',
      'プラグインして',
    ])
      expect(isVisitText(t)).toBe(true)
    for (const t of ['近くのカフェは？', '駅を見てきて', '']) expect(isVisitText(t)).toBe(false)
  })
})
