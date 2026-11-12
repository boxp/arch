import { it, expect, vi } from 'vitest'
import { createGeocoder, normalizeChome, municipality } from './geocode.js'
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
  const none = vi.fn().mockResolvedValue(response([]))
  expect(await createGeocoder({ fetcher: none, intervalMs: 0 })([map])).toEqual([map]); expect(none).toHaveBeenCalledTimes(3)
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

it('falls back through town and municipality without searching the origin', async () => {
  const view: View = { kind: 'map', title: '地図', destination: { name: 'ゲームアルカナ', address: '愛知県稲沢市朝府町2-33' }, origin: '秘密の出発地' }
  const townHit = [{ lat: '35.25', lon: '136.78', place_rank: 20, boundingbox: ['35.24', '35.26', '136.77', '136.79'] }]
  const cityHit = [{ lat: '35.25', lon: '136.78', place_rank: 16, boundingbox: ['35.17', '35.33', '136.70', '136.86'] }]
  for (const [townResult, expected, bbox] of [[townHit, '愛知県稲沢市朝府町', [136.77, 35.24, 136.79, 35.26]], [[], '愛知県稲沢市', [136.70, 35.17, 136.86, 35.33]]] as const) {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q')
      return response(q === '愛知県稲沢市朝府町' ? townResult : q === '愛知県稲沢市' ? cityHit : [])
    })
    const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([view])
    const queries = fetcher.mock.calls.map(c => new URL(String(c[0])).searchParams.get('q'))
    expect(queries.slice(0, expected === '愛知県稲沢市' ? 4 : 3)).toEqual(['愛知県稲沢市朝府町2-33', '愛知県稲沢市朝府町二丁目', '愛知県稲沢市朝府町', ...(expected === '愛知県稲沢市' ? ['愛知県稲沢市'] : [])])
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
    expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', label: expected, bbox })
  }
})
it('falls back to ward and county municipality names without duplicate queries', async () => {
  for (const [address, city] of [['東京都港区芝5丁目1番2号', '東京都港区'], ['北海道虻田郡倶知安町北一条西2丁目', '北海道虻田郡倶知安町']]) {
    const fetcher = vi.fn(async (url: string | URL | Request) => response(new URL(String(url)).searchParams.get('q') === city ? areaHit : []))
    const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([{ kind: 'map', title: '地図', destination: { name: '目的地', address } }])
    const queries = fetcher.mock.calls.map(c => new URL(String(c[0])).searchParams.get('q'))
    expect(queries).toContain(city)
    expect(new Set(queries).size).toBe(queries.length)
    expect(result.kind === 'map' && result.geo?.label).toBe(city)
  }
})
it('extracts municipalities whose names contain 市・区・町・村・郡', () => {
  const cases: Array<[string, string]> = [
    ['千葉県市川市八幡1-1-1', '千葉県市川市'],
    ['愛知県名古屋市中村区名駅1-1-4', '愛知県名古屋市中村区'],
    ['愛知県稲沢市朝府町2-33', '愛知県稲沢市'],
    ['東京都町田市原町田6-1-1', '東京都町田市'],
    ['東京都東村山市本町1-2-3', '東京都東村山市'],
    ['東京都武蔵村山市本町1-1-1', '東京都武蔵村山市'],
    ['東京都港区芝5丁目1番2号', '東京都港区'],
    ['新潟県十日町市千歳町3-3', '新潟県十日町市'],
    ['三重県四日市市諏訪町1-5', '三重県四日市市'],
    ['奈良県大和郡山市北郡山町248-4', '奈良県大和郡山市'],
    ['福島県郡山市朝日1-23-7', '福島県郡山市'],
    ['北海道余市郡余市町朝日町26', '北海道余市郡余市町'],
    ['北海道虻田郡倶知安町北一条西2丁目', '北海道虻田郡倶知安町'],
    ['栃木県芳賀郡市貝町市塙1280', '栃木県芳賀郡市貝町'],
    ['神奈川県横浜市中区本町6-50-10', '神奈川県横浜市中区'],
    ['三重県津市広明町13', '三重県津市'],
    ['東京都大島町元町1-1-14', '東京都大島町'],
  ]
  for (const [address, expected] of cases) expect(municipality(address), address).toBe(expected)
})
