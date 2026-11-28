import { it, expect, vi } from 'vitest'
import { createGeocoder, normalizeChome, municipality } from './geocode.js'
import { validateView, type View } from './views.js'
const map: View = {
  kind: 'map',
  title: '地図',
  destination: { name: '店名', address: '港区芝5-16-14' },
  origin: '秘密の出発地',
}
const hit = [{ lat: '35.65', lon: '139.75', place_rank: 30, boundingbox: ['35.64', '35.66', '139.74', '139.76'] }],
  areaHit = [{ ...hit[0], place_rank: 22 }]
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
it('tries address, normalized chome and name without origin and marks area', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response(areaHit))
    .mockResolvedValueOnce(response([]))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(fetcher.mock.calls.map((c) => new URL(c[0]).searchParams.get('q'))).toEqual([
    '港区芝5-16-14',
    '港区芝五丁目',
    '店名',
  ])
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
  expect(fetcher.mock.calls[0][1].headers['User-Agent']).toContain('kohako-home/1.0')
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', bbox: [139.74, 35.64, 139.76, 35.66] })
  expect(normalizeChome('芝5丁目16-14')).toBe('芝五丁目')
  expect(validateView({ ...map, geo: { lat: 1 } })).toBeNull()
})
it('caches and serializes requests at the configured interval', async () => {
  const times: number[] = [],
    fetcher = vi.fn(async () => {
      times.push(Date.now())
      return response(hit)
    })
  const geocode = createGeocoder({ fetcher, intervalMs: 30 })
  const other: View = { kind: 'map', title: 'x', destination: { name: '駅' } }
  const [a] = await Promise.all([geocode([map]), geocode([other]), geocode([map])])
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(25)
  expect(a[0].kind === 'map' && a[0].geo?.precision).toBe('exact')
  await geocode([map])
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('returns no geo on failure, timeout or disabled search', async () => {
  const simple: View = { kind: 'map', title: 'x', destination: { name: '駅' } }
  for (const fetcher of [vi.fn().mockRejectedValue(Error('failure')), vi.fn(() => new Promise<Response>(() => {}))]) {
    expect(await createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 10 })([simple])).toEqual([simple])
  }
  const fetcher = vi.fn()
  expect(await createGeocoder({ fetcher, url: 'off' })([simple])).toEqual([simple])
  expect(fetcher).not.toHaveBeenCalled()
})
it('treats neighbourhood-level matches as area and prefers a later exact match', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(areaHit)).mockResolvedValueOnce(response(hit))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(result.kind === 'map' && result.geo?.precision).toBe('exact')
  expect(fetcher).toHaveBeenCalledTimes(2)
  const only = vi.fn().mockResolvedValue(response(areaHit))
  const [area] = await createGeocoder({ fetcher: only, intervalMs: 0 })([
    { kind: 'map', title: 'x', destination: { name: '芝五丁目' } },
  ])
  expect(area.kind === 'map' && area.geo?.precision).toBe('area')
})
it('ignores a same-name exact match outside the address area and does not trust the name alone when the address is unresolved', async () => {
  const far = [{ ...hit[0], lat: '34.70', lon: '135.50' }]
  const fetcher = vi.fn().mockResolvedValueOnce(response(areaHit)).mockResolvedValueOnce(response(far))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([map])
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', lat: 35.65 })
  const none = vi.fn().mockResolvedValue(response([]))
  expect(await createGeocoder({ fetcher: none, intervalMs: 0 })([map])).toEqual([map])
  expect(none).toHaveBeenCalledTimes(3)
})
it('keeps an already found area when later searches time out', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(areaHit))
    .mockImplementation(() => new Promise<Response>(() => {}))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 50 })([map])
  expect(result.kind === 'map' && result.geo?.precision).toBe('area')
})
it('aborts a hung search at its own timeout so it does not block later ones', async () => {
  let hang = true
  const fetcher = vi.fn((_: string, init?: RequestInit) =>
    hang
      ? new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Error('aborted'))))
      : Promise.resolve(response(hit)),
  )
  const geocode = createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 40 })
  const views = Array.from(
    { length: 5 },
    (_, i): View => ({ kind: 'map', title: 'x', destination: { name: `店${i}` } }),
  )
  const timedOut = await Promise.all(views.map((v) => geocode([v])))
  expect(timedOut.every(([v]) => v.kind === 'map' && !v.geo)).toBe(true)
  await new Promise((r) => setTimeout(r, 20))
  const calls = fetcher.mock.calls.length
  // 応答待ち上限を過ぎた検索は中断され、キューに残らない
  expect(fetcher.mock.calls.every((c) => c[1]?.signal?.aborted)).toBe(true)
  hang = false
  const started = Date.now()
  const [after] = await geocode([{ kind: 'map', title: 'y', destination: { name: '駅' } }])
  expect(Date.now() - started).toBeLessThan(200)
  expect(after.kind === 'map' && after.geo?.precision).toBe('exact')
  expect(fetcher.mock.calls.length).toBe(calls + 1)
})

it('falls back through town and municipality without searching the origin', async () => {
  const view: View = {
    kind: 'map',
    title: '地図',
    destination: { name: 'ゲームアルカナ', address: '愛知県稲沢市朝府町2-33' },
    origin: '秘密の出発地',
  }
  const townHit = [{ lat: '35.25', lon: '136.78', place_rank: 20, boundingbox: ['35.24', '35.26', '136.77', '136.79'] }]
  const cityHit = [{ lat: '35.25', lon: '136.78', place_rank: 16, boundingbox: ['35.17', '35.33', '136.70', '136.86'] }]
  for (const [townResult, expected, bbox] of [
    [townHit, '愛知県稲沢市朝府町', [136.77, 35.24, 136.79, 35.26]],
    [[], '愛知県稲沢市', [136.7, 35.17, 136.86, 35.33]],
  ] as const) {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const q = new URL(String(url)).searchParams.get('q')
      return response(q === '愛知県稲沢市朝府町' ? townResult : q === '愛知県稲沢市' ? cityHit : [])
    })
    const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([view])
    const queries = fetcher.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q'))
    expect(queries.slice(0, expected === '愛知県稲沢市' ? 4 : 3)).toEqual([
      '愛知県稲沢市朝府町2-33',
      '愛知県稲沢市朝府町二丁目',
      '愛知県稲沢市朝府町',
      ...(expected === '愛知県稲沢市' ? ['愛知県稲沢市'] : []),
    ])
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
    expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', label: expected, bbox })
  }
})
it('falls back to ward and county municipality names without duplicate queries', async () => {
  for (const [address, city] of [
    ['東京都港区芝5丁目1番2号', '東京都港区'],
    ['北海道虻田郡倶知安町北一条西2丁目', '北海道虻田郡倶知安町'],
  ]) {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      response(new URL(String(url)).searchParams.get('q') === city ? areaHit : []),
    )
    const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
      { kind: 'map', title: '地図', destination: { name: '目的地', address } },
    ])
    const queries = fetcher.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q'))
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

// BOXP-749: 仕様 Projects/kohako-home/map-view-spec.md の例から期待値を決める。
const shibaChome = [
  { lat: '35.6550', lon: '139.7538', place_rank: 22, boundingbox: ['35.6530', '35.6580', '139.7510', '139.7570'] },
]
const renoirNode = [
  { lat: '35.6567', lon: '139.7538', place_rank: 30, boundingbox: ['35.6566', '35.6568', '139.7537', '139.7539'] },
]
it('finds the Cafe Renoir pin by searching the name, the name without the branch and aliases inside the chome', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q')
    return response(q === '東京都港区芝大門二丁目' ? shibaChome : q === 'ルノアール' ? renoirNode : [])
  })
  const view: View = {
    kind: 'map',
    title: '地図',
    destination: { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1 常泉ビル2F', aliases: ['ルノアール'] },
    origin: '秘密の出発地',
  }
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([view])
  const urls = fetcher.mock.calls.map((c) => new URL(String(c[0])))
  expect(urls.map((u) => u.searchParams.get('q'))).toEqual([
    '東京都港区芝大門2-3-1 常泉ビル2F',
    '東京都港区芝大門二丁目',
    'Cafe Renoir 芝大門店',
    'Cafe Renoir',
    'ルノアール',
  ])
  // 名称の検索は丁目の範囲内に限る
  for (const u of urls.slice(2)) {
    expect(u.searchParams.get('bounded')).toBe('1')
    expect(u.searchParams.get('viewbox')).toBe('139.751,35.658,139.757,35.653')
  }
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'exact', lat: 35.6567, lon: 139.7538 })
})
it('keeps the chome as an area (not a pin) when no name matches inside it', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    response(new URL(String(url)).searchParams.get('q') === '東京都港区芝大門二丁目' ? shibaChome : []),
  )
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
    { kind: 'map', title: '地図', destination: { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1' } },
  ])
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', label: '東京都港区芝大門二丁目' })
})
it('only searches the full branch name when the area widened to the municipality', async () => {
  // 丁目・町域が見つからず港区まで広がった時、同じ区内の別店舗（「Cafe Renoir」「ルノアール」の一致）をピンにしない。
  const minato = [
    { lat: '35.658', lon: '139.751', place_rank: 12, boundingbox: ['35.62', '35.69', '139.72', '139.78'] },
  ]
  const otherBranch = [
    { lat: '35.67', lon: '139.74', place_rank: 30, boundingbox: ['35.6699', '35.6701', '139.7399', '139.7401'] },
  ]
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q')
    return response(q === '東京都港区' ? minato : q === 'Cafe Renoir' || q === 'ルノアール' ? otherBranch : [])
  })
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
    {
      kind: 'map',
      title: '地図',
      destination: { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1', aliases: ['ルノアール'] },
    },
  ])
  const qs = fetcher.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q'))
  expect(qs).not.toContain('Cafe Renoir')
  expect(qs).not.toContain('ルノアール')
  expect(qs.at(-1)).toBe('Cafe Renoir 芝大門店')
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'area', label: '東京都港区' })
})
it('finds a name without a branch inside the municipality when the area widened to it', async () => {
  // 支店名を持たない目的地（駅など）は、市区町村まで広がった範囲でも名称そのもので探し、範囲内の点の一致をピンにする。
  const chiyoda = [
    { lat: '35.694', lon: '139.753', place_rank: 12, boundingbox: ['35.66', '35.71', '139.72', '139.79'] },
  ]
  const station = [
    { lat: '35.6812', lon: '139.7671', place_rank: 30, boundingbox: ['35.6811', '35.6813', '139.767', '139.7672'] },
  ]
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q')
    return response(q === '東京都千代田区' ? chiyoda : q === '東京駅' ? station : [])
  })
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
    { kind: 'map', title: '地図', destination: { name: '東京駅', address: '東京都千代田区丸の内1-9-1' } },
  ])
  expect(result.kind === 'map' && result.geo).toMatchObject({ precision: 'exact', label: '東京駅', lat: 35.6812 })
})
it('does not use aliases or the branch-less name without an address', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([]))
  await createGeocoder({ fetcher, intervalMs: 0 })([
    { kind: 'map', title: '地図', destination: { name: 'ロバーツコーヒー 麻布十番店', aliases: ["Robert's Coffee"] } },
  ])
  const urls = fetcher.mock.calls.map((c) => new URL(String(c[0])))
  expect(urls.map((u) => u.searchParams.get('q'))).toEqual(['ロバーツコーヒー 麻布十番店'])
  expect(urls[0].searchParams.has('bounded')).toBe(false)
})
it('geocodes every candidate of a multi-place map and leaves unknown ones without geo', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q')
    return response(
      q === '東京都港区芝大門二丁目' ? shibaChome : q === 'ルノアール' ? renoirNode : q === '東京駅' ? hit : [],
    )
  })
  const view: View = {
    kind: 'map',
    title: '候補',
    places: [
      { name: 'Cafe Renoir 芝大門店', address: '東京都港区芝大門2-3-1', aliases: ['ルノアール'] },
      { name: '東京駅' },
      { name: '存在しない店' },
    ],
    origin: '秘密の出発地',
  }
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([view])
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('秘密の出発地')
  if (result.kind !== 'map' || !result.places) throw Error('places expected')
  expect(result.places.map((p) => p.geo?.precision)).toEqual(['exact', 'exact', undefined])
  expect(result.places[0].geo).toMatchObject({ lat: 35.6567 })
  expect(validateView(result, true)).not.toBeNull()
  // モデルが座標を書いたブロックは受け付けない
  expect(validateView(result)).toBeNull()
})
it('validates single and multi-place map blocks', () => {
  const place = { name: '店', address: '東京都港区芝1-1' }
  const base = { kind: 'map', title: '候補' }
  expect(validateView({ ...base, places: [place, { name: '別の店', aliases: ['別名'] }] })).not.toBeNull()
  expect(validateView({ ...base, destination: { ...place, aliases: ['a', 'b', 'c'] } })).not.toBeNull()
  for (const bad of [
    { ...base, places: [place] },
    { ...base, places: Array(6).fill(place) },
    { ...base, places: [place, place], destination: place },
    { ...base },
    { ...base, destination: { ...place, aliases: ['a', 'b', 'c', 'd'] } },
    { ...base, destination: { ...place, aliases: [''] } },
    { ...base, places: [place, { ...place, extra: 1 }] },
    { ...base, places: [place, { ...place, geo: { lat: 1 } }] },
  ])
    expect(validateView(bad), JSON.stringify(bad)).toBeNull()
})
it('drops an area result whose real extent is missing or wider than the limit instead of inventing a small box', async () => {
  // 市区町村の実際の範囲が上限(0.3 度)を超える・範囲が無い時、中心付近の代替範囲を丁目程度の付近として返さない。
  for (const cityHit of [
    [{ lat: '43.06', lon: '141.35', place_rank: 16, boundingbox: ['42.76', '43.19', '140.99', '141.52'] }],
    [{ lat: '43.06', lon: '141.35', place_rank: 16 }],
  ]) {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      response(new URL(String(url)).searchParams.get('q') === '北海道札幌市中央区' ? cityHit : []),
    )
    const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
      { kind: 'map', title: '地図', destination: { name: '喫茶 札幌店', address: '北海道札幌市中央区南1条西2-3' } },
    ])
    expect(fetcher.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q'))).toContain('北海道札幌市中央区')
    expect(result.kind === 'map' && result.geo).toBeFalsy()
  }
  // 丁目の結果も範囲が無ければ付近にしない（点線枠を捏造しない）。
  const fetcher = vi.fn().mockResolvedValue(response([{ lat: '35.65', lon: '139.75', place_rank: 22 }]))
  const [result] = await createGeocoder({ fetcher, intervalMs: 0 })([
    { kind: 'map', title: '地図', destination: { name: '店', address: '東京都港区芝大門2-3-1' } },
  ])
  expect(result.kind === 'map' && result.geo).toBeFalsy()
})
it('gives a 5-place map enough time for every place to reach its last alias search', async () => {
  // 各候補: 住所 0 件 → 丁目の範囲 → 名称 0 件 → 支店名なし 0 件 → 別表記で点の一致（1 候補あたり 5 検索、計 25 検索）。
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q') ?? ''
    return response(
      /^東京都港区芝大門[一二三四五]丁目$/.test(q) ? shibaChome : /^ルノアール[1-5]$/.test(q) ? renoirNode : [],
    )
  })
  const view: View = {
    kind: 'map',
    title: '候補',
    places: [1, 2, 3, 4, 5].map((i) => ({
      name: `Cafe Renoir 芝大門${i}号店`,
      address: `東京都港区芝大門${i}-3-1`,
      aliases: [`ルノアール${i}`],
    })),
  }
  const [result] = await createGeocoder({ fetcher, intervalMs: 30 })([view])
  if (result.kind !== 'map' || !result.places) throw Error('places expected')
  expect(result.places.map((p) => p.geo?.precision)).toEqual(['exact', 'exact', 'exact', 'exact', 'exact'])
})
it('never drops a later place because earlier searches were slow but within their own timeout', async () => {
  // 21 検索がそれぞれ応答待ち上限(200ms)内の 40ms かかっても、後半の候補が別表記検索まで届き全件が正確なピンになる。
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    await new Promise((r) => setTimeout(r, 40))
    const q = new URL(String(url)).searchParams.get('q') ?? ''
    return response(
      /^東京都港区芝大門[一二三四五]丁目$/.test(q) ? shibaChome : /^ルノアール[1-5]$/.test(q) ? renoirNode : [],
    )
  })
  const view: View = {
    kind: 'map',
    title: '候補',
    places: [1, 2, 3, 4, 5].map((i) => ({
      name: `Cafe Renoir 芝大門${i}号店`,
      address: `東京都港区芝大門${i}-3-1`,
      aliases: [`ルノアール${i}`],
    })),
  }
  const [result] = await createGeocoder({ fetcher, intervalMs: 5, timeoutMs: 200 })([view])
  if (result.kind !== 'map' || !result.places) throw Error('places expected')
  expect(fetcher).toHaveBeenCalledTimes(21) // 「Cafe Renoir」(支店名なし)は 2 件目以降キャッシュ
  expect(result.places.map((p) => p.geo?.precision)).toEqual(['exact', 'exact', 'exact', 'exact', 'exact'])
})
it('does not count the wait behind other maps against a map, and still finishes every map', async () => {
  // 地図 1 枚の上限(400ms)は自分の番が来てから数える。先の 2 枚(各 2 検索 × 140ms = 280ms)の後ろで 560ms 待っても、
  // 後から来た地図は打ち切られず自分の検索で正確なピンになる（共有キューの待ちで位置なしにしない）。
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const q = new URL(String(url)).searchParams.get('q') ?? ''
    if (q.startsWith('遅い')) await new Promise((r) => setTimeout(r, 140))
    return response(q === '東京駅' ? hit : [])
  })
  const geocode = createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 200, mapBudgetMs: 400 })
  const slowMap = (k: string): View => ({
    kind: 'map',
    title: k,
    places: [1, 2].map((i) => ({ name: `遅い店${k}${i}` })),
  })
  const started = Date.now()
  const [a, b, [c]] = await Promise.all([
    geocode([slowMap('A')]),
    geocode([slowMap('B')]),
    geocode([{ kind: 'map', title: '後', destination: { name: '東京駅' } }]),
  ])
  expect(Date.now() - started).toBeGreaterThanOrEqual(500)
  expect(c.kind === 'map' && c.geo?.precision).toBe('exact')
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect([a, b].every(([v]) => v.kind === 'map')).toBe(true)
})
it('stops a map whose own turn exceeds its bound and skips its remaining searches without position', async () => {
  // 1 件の検索が応答待ち上限を無視して返らない異常時でも、その地図の番は上限で終わり、残りの検索は送らず位置なしで返す。
  let calls = 0
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    calls++
    const q = new URL(String(url)).searchParams.get('q') ?? ''
    return response(q === '東京駅' ? hit : [])
  })
  const geocode = createGeocoder({ fetcher, intervalMs: 0, timeoutMs: 200, mapBudgetMs: 0 })
  const [result] = await geocode([{ kind: 'map', title: '地図', places: [{ name: '東京駅' }, { name: '新橋駅' }] }])
  if (result.kind !== 'map' || !result.places) throw Error('places expected')
  expect(calls).toBe(0)
  expect(result.places.every((p) => !p.geo)).toBe(true)
})
