import { it, expect, vi } from 'vitest'
import { createGeocoder, normalizeChome } from './geocode.js'
import { validateView, type View } from './views.js'
const map: View = { kind: 'map', title: '地図', destination: { name: '店名', address: '港区芝5-16-14' }, origin: '秘密の出発地' }
const hit = [{ lat: '35.65', lon: '139.75', place_rank: 30, boundingbox: ['35.64', '35.66', '139.74', '139.76'] }], areaHit = [{ ...hit[0], place_rank: 22 }]
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
it('tries address, normalized chome and name without origin and marks area', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(areaHit)).mockResolvedValueOnce(response([]))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(fetcher.mock.calls.map(c => new URL(c[0]).searchParams.get('q'))).toEqual(['港区芝5-16-14', '港区芝五丁目', '店名'])
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
  expect(fetcher.mock.calls[0][1].headers['User-Agent']).toContain('kohako-home/1.0')
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', bbox: [139.74, 35.64, 139.76, 35.66] })
  expect(normalizeChome('芝5丁目16-14')).toBe('芝五丁目')
  expect(validateView({ ...map, geo: { lat: 1 } })).toBeNull()
})
it('caches and serializes requests at the configured interval', async () => {
  const times: number[] = [], fetcher = vi.fn(async () => { times.push(Date.now()); return response(hit) })
  const geocode = createGeocoder({ fetcher, intervalMs: 30 })
  const other: View = { kind: 'map', title: 'x', destination: { name: '駅' } }
  const [a] = await Promise.all([geocode([map]), geocode([other]), geocode([map])])
  expect(fetcher).toHaveBeenCalledTimes(2); expect(times[1] - times[0]).toBeGreaterThanOrEqual(25)
  expect(a[0].kind === 'map' && a[0].geo?.precision).toBe('exact')
  await geocode([map]); expect(fetcher).toHaveBeenCalledTimes(2)
})
it('returns no geo on failure, timeout or disabled search', async () => {
  const simple: View = { kind: 'map', title: 'x', destination: { name: '駅' } }
  for (const fetcher of [vi.fn().mockRejectedValue(Error('failure')), vi.fn(() => new Promise<Response>(() => {}))]) {
    expect(await createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 10 })([simple])).toEqual([simple])
  }
  const fetcher = vi.fn(); expect(await createGeocoder({ fetcher, url: 'off' })([simple])).toEqual([simple]); expect(fetcher).not.toHaveBeenCalled()
})
it('treats neighbourhood-level matches as area and prefers a later exact match', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(areaHit)).mockResolvedValueOnce(response(hit))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(result.kind === 'map' && result.geo?.precision).toBe('exact'); expect(fetcher).toHaveBeenCalledTimes(2)
  const only = vi.fn().mockResolvedValue(response(areaHit))
  const [area] = await createGeocoder({ fetcher: only, intervalMs: 0 })([{ kind: 'map', title: 'x', destination: { name: '芝五丁目' } }])
  expect(area.kind === 'map' && area.geo?.precision).toBe('area')
})
it('ignores a same-name exact match outside the address area and does not trust the name alone when the address is unresolved', async () => {
  const far = [{ ...hit[0], lat: '34.70', lon: '135.50' }]
  const fetcher = vi.fn().mockResolvedValueOnce(response(areaHit)).mockResolvedValueOnce(response(far))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', lat: 35.65 })
  const none = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])).mockResolvedValue(response(hit))
  expect(await createGeocoder({ fetcher: none, intervalMs: 0 })([map])).toEqual([map]); expect(none).toHaveBeenCalledTimes(2)
})
it('keeps an already found area when later searches time out at the deadline', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(areaHit)).mockImplementation(() => new Promise<Response>(() => {}))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 1000, deadlineMs: 50 })([map])
  expect(result.kind === 'map' && result.geo?.precision).toBe('area')
})
it('drops queued searches after the deadline so timed-out lookups do not block later ones', async () => {
  let hang = true
  const fetcher = vi.fn((_: string, init?: RequestInit) => hang
    ? new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Error('aborted'))))
    : Promise.resolve(response(hit)))
  const geocode = createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 10_000, deadlineMs: 40 })
  const views = Array.from({ length: 5 }, (_, i): View => ({ kind: 'map', title: 'x', destination: { name: `店${i}` } }))
  const timedOut = await Promise.all(views.map(v => geocode([v])))
  expect(timedOut.every(([v]) => v.kind === 'map' && !v.geo)).toBe(true)
  await new Promise(r => setTimeout(r, 20))
  const calls = fetcher.mock.calls.length
  // 期限を過ぎた検索は送信中なら中断され、キューに残らない
  expect(fetcher.mock.calls.every(c => c[1]?.signal?.aborted)).toBe(true)
  hang = false
  const started = Date.now()
  const [after] = await geocode([{ kind: 'map', title: 'y', destination: { name: '駅' } }])
  expect(Date.now() - started).toBeLessThan(200)
  expect(after.kind === 'map' && after.geo?.precision).toBe('exact')
  expect(fetcher.mock.calls.length).toBe(calls + 1)
})
