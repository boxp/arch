import { must } from './must.js'
import type { Geo, Place, View } from './views.js'

const kanji = (n: number) =>
  n < 10
    ? '〇一二三四五六七八九'[n]
    : n < 100
      ? `${n >= 20 ? '〇一二三四五六七八九'[Math.floor(n / 10)] : ''}十${n % 10 ? '〇一二三四五六七八九'[n % 10] : ''}`
      : ''
export function normalizeChome(address: string): string | null {
  const match = address.match(/^(.+?)([0-9０-９]{1,2})(?:丁目|[-−ー－])(?:.*)$/)
  if (!match) return null
  const n = Number(match[2].replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)))
  return n > 0 && n < 100 ? `${match[1]}${kanji(n)}丁目` : null
}

// 都道府県を含む住所から自治体までを取り出す。政令市の区と郡内の町村も含める。
// 自治体名自体に「市」「区」「町」「村」「郡」を含む例（市川市・町田市・東村山市・名古屋市中村区・余市郡余市町など）を
// 文字クラスの除外で切らないよう、最短一致と名前に区切り文字を含む市の例外表で切り出す。
const DESIGNATED_CITY =
  /^(?:札幌|仙台|さいたま|千葉|横浜|川崎|相模原|新潟|静岡|浜松|名古屋|京都|大阪|堺|神戸|岡山|広島|北九州|福岡|熊本)市/
const TOKYO_WARD =
  /^(?:千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川)区/
const CITY_WITH_DELIMITER = /^(?:四日市|廿日市|野々市|大和郡山|郡山|郡上|小郡)市/
export function municipality(address: string): string | null {
  const match = address.match(/^(北海道|東京都|京都府|大阪府|.{2,3}?県)(.+)$/)
  if (!match) return null
  const [, pref, rest] = match
  const designated = rest.match(DESIGNATED_CITY)?.[0]
  if (designated) return pref + designated + (rest.slice(designated.length).match(/^.{1,4}?区/)?.[0] ?? '')
  const special = (pref === '東京都' ? rest.match(TOKYO_WARD) : null)?.[0] ?? rest.match(CITY_WITH_DELIMITER)?.[0]
  if (special) return pref + special
  const city = rest.match(/^.+?市/)?.[0]
  const county = rest.match(/^(.+?郡)(.+?[町村])/)
  // 郡名が「余市郡」のように市を含む時は、市の直後が郡なら郡として扱う。それより前で市が終わる時は市を優先する。
  if (county && (!city || city.length >= county[1].length - 1)) return pref + county[0]
  if (city) return pref + city
  const local = rest.match(/^.+?[区町村]/)?.[0]
  return local ? pref + local : null
}
/** 末尾の「〜店」を除いた名称（例: 「Cafe Renoir 芝大門店」→「Cafe Renoir」）。除けない時は null。 */
export function branchless(name: string): string | null {
  return name.match(/^(.+?)[\s　]+\S+店$/)?.[1].trim() || null
}
function town(address: string): string | null {
  const match = address.match(
    /^(.+?)[\s　]*[0-9０-９〇零一二三四五六七八九十百千]+(?:丁目|番地|番|号|[-−ー－‐‑–—―]|\s|　|$)/,
  )
  return match?.[1].trim() || null
}

/**
 * BOXP-749: 1 件の目的地・候補の位置決めで送りうる検索の最大回数（住所 1・範囲の段 3・範囲内の名称 最大 5）。
 * 検索は intervalMs 間隔で 1 件ずつ送るので、期限はこの回数から決める（最後の別表記まで届かず正しいピンが欠けないように）。
 */
export const MAX_QUERIES_PER_PLACE = 9
/** 地図 1 枚の位置決めの最長時間の目安（候補 5 件 × 最大回数 × 間隔 + 応答待ちの余裕）。会話側の保険の打ち切りに使う。 */
export const MAX_GEOCODE_MS = 5 * MAX_QUERIES_PER_PLACE * 1000 + 7000
export function plannedQueries(target: Place): number {
  const { address, name } = target
  if (!address) return 1
  const areas = new Set(
    [normalizeChome(address), town(address), municipality(address)].filter((c) => c && c !== address),
  )
  const names = new Set([name, branchless(name), ...(target.aliases ?? [])].filter((n) => n && n !== address))
  return Math.min(MAX_QUERIES_PER_PLACE, 1 + areas.size + names.size)
}

export function createGeocoder({
  fetcher = fetch,
  url = process.env.KOHAKO_GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/search',
  intervalMs = 1000,
  timeoutMs = 4000,
  deadlineMs = 7000,
}: {
  fetcher?: typeof fetch
  url?: string
  intervalMs?: number
  timeoutMs?: number
  deadlineMs?: number
} = {}) {
  const cache = new Map<string, { at: number; value: Geo | null }>()
  let queue = Promise.resolve(),
    last = 0
  const queryRaw = async (
    q: string,
    requested: Geo['precision'],
    deadline?: AbortSignal,
    municipal = false,
    within?: Geo['bbox'],
  ): Promise<Geo | null> => {
    if (deadline?.aborted) return null
    const key = `${requested}:${municipal}:${within?.join(',') ?? ''}:${q}`,
      cached = cache.get(key)
    if (cached && Date.now() - cached.at < 86400_000) return cached.value
    let resolve!: (v: Geo | null) => void
    const result = new Promise<Geo | null>((r) => {
      resolve = r
    })
    queue = queue
      .then(async () => {
        const again = cache.get(key)
        if (again && Date.now() - again.at < 86400_000) {
          resolve(again.value)
          return
        }
        // 期限切れの検索は送らずにキューを空ける（タイムアウトした検索が後続を塞がないように）。
        if (deadline?.aborted) {
          resolve(null)
          return
        }
        const wait = Math.max(0, last + intervalMs - Date.now())
        if (wait) await new Promise((r) => setTimeout(r, wait))
        if (deadline?.aborted) {
          resolve(null)
          return
        }
        last = Date.now()
        let value: Geo | null = null,
          cacheable = false,
          precision = requested
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), timeoutMs)
        const onDeadline = () => controller.abort()
        deadline?.addEventListener('abort', onDeadline, { once: true })
        try {
          const p = new URL(url)
          for (const [k, v] of Object.entries({
            format: 'jsonv2',
            limit: '1',
            countrycodes: 'jp',
            'accept-language': 'ja',
            q,
          }))
            p.searchParams.set(k, v)
          if (within) {
            // BOXP-749: 名称・別表記は住所の範囲内に限って検索する（同じチェーンの別店舗を拾わない）。
            const [w, south, e, n] = within
            p.searchParams.set('viewbox', `${w},${n},${e},${south}`)
            p.searchParams.set('bounded', '1')
          }
          const response = await Promise.race([
            fetcher(p.toString(), {
              headers: { 'User-Agent': 'kohako-home/1.0 (+https://github.com/boxp/arch)' },
              signal: controller.signal,
              redirect: 'error',
            }),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }),
            ),
          ])
          if (!response.ok) throw Error('upstream')
          const data: unknown = await Promise.race([
            response.json(),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }),
            ),
          ])
          if (!Array.isArray(data)) throw Error('schema')
          cacheable = true
          const item = data[0],
            lat = Number(item?.lat),
            lon = Number(item?.lon)
          if (
            item &&
            typeof item.lat === 'string' &&
            typeof item.lon === 'string' &&
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180
          ) {
            // 番地・建物・駅など点で示せる結果(place_rank 26 以上)だけを exact とし、丁目や町域の一致は付近表示にする。
            if (precision === 'exact' && !(Number(item.place_rank) >= 26)) precision = 'area'
            // 点の結果は周辺 ±0.004 度を範囲にする。範囲(area)の結果は検索結果の実際の範囲だけを使い、
            // 範囲が無い・壊れている・上限より広い時は代替の範囲を作らず「位置なし」にする
            // （中心付近の狭い代替範囲を丁目程度の付近として点線表示し、目的地から離れた場所を示さないため）。
            let bbox: [number, number, number, number] | null =
              precision === 'exact'
                ? [
                    Math.max(-180, lon - 0.004),
                    Math.max(-90, lat - 0.004),
                    Math.min(180, lon + 0.004),
                    Math.min(90, lat + 0.004),
                  ]
                : null
            if (precision === 'area' && Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
              const [south, north, west, east] = item.boundingbox.map(Number)
              if (
                [south, north, west, east].every(Number.isFinite) &&
                south >= -90 &&
                north <= 90 &&
                west >= -180 &&
                east <= 180 &&
                south < north &&
                west < east &&
                north - south <= (municipal ? 0.3 : 0.05) &&
                east - west <= (municipal ? 0.3 : 0.05) &&
                lat >= south &&
                lat <= north &&
                lon >= west &&
                lon <= east
              )
                bbox = [west, south, east, north]
            }
            if (bbox) value = { lat, lon, bbox, precision, label: q.slice(0, 120), source: 'openstreetmap' }
          }
        } catch {
          /* 検索失敗は地図位置なしで返す */
        } finally {
          clearTimeout(timer)
          deadline?.removeEventListener('abort', onDeadline)
        }
        if (cacheable) {
          cache.delete(key)
          cache.set(key, { at: Date.now(), value })
          while (cache.size > 200) cache.delete(must(cache.keys().next().value))
        }
        resolve(value)
      })
      .catch(() => resolve(null))
    return result
  }
  // 住所が与えられた時は住所由来の位置を正とし、名称検索の結果はその範囲内にある時だけ採用する（同名の別店舗を避ける）。
  // deadlineMs を過ぎたら、それまでに得た最良の位置（概略でも）を返す。
  const resolvePlace = async (target: Place, best: { geo: Geo | null }, deadline: AbortSignal): Promise<Geo | null> => {
    const { address, name } = target
    const query = (q: string, p: Geo['precision'], municipal = false, within?: Geo['bbox']) =>
      queryRaw(q, p, deadline, municipal, within)
    if (address) {
      const exact = await query(address, 'exact')
      best.geo = exact
      if (exact?.precision === 'exact') return exact
      let area = exact,
        broad = false
      const city = municipality(address)
      const seen = new Set([address])
      for (const candidate of [normalizeChome(address), town(address), city]) {
        if (area || deadline.aborted) break
        if (!candidate || seen.has(candidate)) continue
        seen.add(candidate)
        area = await query(candidate, 'area', candidate === city)
        broad = candidate === city
        best.geo = area
      }
      if (!area) return area
      // 名称 → 支店名を除いた名称 → 別表記の順に、住所の範囲内で点の一致を探す。
      // 範囲が市区町村まで広がった時は、同じ市区町村内の同じチェーンの別店舗を拾わないよう、
      // 与えられた名称そのものだけを探す（支店名除去・別表記は使わない。支店名の無い駅などの名称はそのまま探す）。
      const names = (broad ? [name] : [name, branchless(name), ...(target.aliases ?? [])]).filter(
        (n): n is string => !!n && n !== address,
      )
      const m = 0.002,
        [w, s, e, n] = area.bbox
      for (const candidate of [...new Set(names)]) {
        if (deadline.aborted) break
        const named = await query(candidate, 'exact', false, area.bbox)
        if (
          named?.precision === 'exact' &&
          named.lon >= w - m &&
          named.lon <= e + m &&
          named.lat >= s - m &&
          named.lat <= n + m
        ) {
          const found = { ...named, label: name.slice(0, 120) }
          best.geo = found
          return found
        }
      }
      return area
    }
    const named = await query(name, 'exact')
    best.geo = named
    return named
  }
  const locate = async (target: Place, budgetMs: number): Promise<Geo | null> => {
    const best: { geo: Geo | null } = { geo: null }
    const deadline = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // 期限で deadline を中断し、送信中の検索の打ち切り・未送信の検索の取り止めを行う。
    // deadlineMs を過ぎたら、それまでに得た最良の位置（概略でも）を返す。
    const geo = await Promise.race([
      resolvePlace(target, best, deadline.signal).catch(() => best.geo),
      new Promise<Geo | null>((r) => {
        timer = setTimeout(() => {
          deadline.abort()
          r(best.geo)
        }, budgetMs)
        timer.unref?.()
      }),
    ])
    clearTimeout(timer)
    deadline.abort()
    return geo
  }
  return async (views: View[]): Promise<View[]> => {
    if (url === 'off') return views
    return Promise.all(
      views.map(async (view) => {
        if (view.kind !== 'map') return view
        if (view.places) {
          // 検索は intervalMs 間隔で 1 件ずつ順に送るので、全候補が最後の検索まで届く回数分の時間に応答待ちの余裕 deadlineMs を足す。
          const planned = view.places.reduce((sum, { geo: _g, ...target }) => sum + plannedQueries(target), 0)
          const budget = deadlineMs + planned * intervalMs
          const started = Date.now()
          const places = await Promise.all(
            view.places.map(async ({ geo: _ignored, ...target }) => {
              const geo = await locate(target, Math.max(0, budget - (Date.now() - started)))
              return geo ? { ...target, geo } : target
            }),
          )
          return { ...view, places }
        }
        if (!view.destination) return view
        const geo = await locate(view.destination, deadlineMs + plannedQueries(view.destination) * intervalMs)
        return geo ? { ...view, geo } : view
      }),
    )
  }
}
