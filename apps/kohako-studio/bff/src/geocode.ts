import type { Geo, View } from './views.js'

const kanji = (n: number) => n < 10 ? '〇一二三四五六七八九'[n] : n < 100 ? `${n >= 20 ? '〇一二三四五六七八九'[Math.floor(n / 10)] : ''}十${n % 10 ? '〇一二三四五六七八九'[n % 10] : ''}` : ''
export function normalizeChome(address: string): string | null {
  const match = address.match(/^(.+?)([0-9０-９]{1,2})(?:丁目|[-−ー－])(?:.*)$/)
  if (!match) return null
  const n = Number(match[2].replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)))
  return n > 0 && n < 100 ? `${match[1]}${kanji(n)}丁目` : null
}

// 都道府県を含む住所から自治体までを取り出す。政令市の区と郡内の町村も含める。
// 自治体名自体に「市」「区」「町」「村」「郡」を含む例（市川市・町田市・東村山市・名古屋市中村区・余市郡余市町など）を
// 文字クラスの除外で切らないよう、最短一致と名前に区切り文字を含む市の例外表で切り出す。
const DESIGNATED_CITY = /^(?:札幌|仙台|さいたま|千葉|横浜|川崎|相模原|新潟|静岡|浜松|名古屋|京都|大阪|堺|神戸|岡山|広島|北九州|福岡|熊本)市/
const TOKYO_WARD = /^(?:千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川)区/
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
function town(address: string): string | null {
  const match = address.match(/^(.+?)[\s　]*[0-9０-９〇零一二三四五六七八九十百千]+(?:丁目|番地|番|号|[-−ー－‐‑–—―]|\s|　|$)/)
  return match?.[1].trim() || null
}

export function createGeocoder({ fetcher = fetch, url = process.env.KOHAKO_GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/search', intervalMs = 1000, timeoutMs = 4000, deadlineMs = 7000 }: { fetcher?: typeof fetch; url?: string; intervalMs?: number; timeoutMs?: number; deadlineMs?: number } = {}) {
  const cache = new Map<string, { at: number; value: Geo | null }>()
  let queue = Promise.resolve(), last = 0
  const queryRaw = async (q: string, requested: Geo['precision'], deadline?: AbortSignal, municipal = false): Promise<Geo | null> => {
    if (deadline?.aborted) return null
    const key = `${requested}:${municipal}:${q}`, cached = cache.get(key)
    if (cached && Date.now() - cached.at < 86400_000) return cached.value
    let resolve!: (v: Geo | null) => void
    const result = new Promise<Geo | null>(r => { resolve = r })
    queue = queue.then(async () => {
      const again = cache.get(key)
      if (again && Date.now() - again.at < 86400_000) { resolve(again.value); return }
      // 期限切れの検索は送らずにキューを空ける（タイムアウトした検索が後続を塞がないように）。
      if (deadline?.aborted) { resolve(null); return }
      const wait = Math.max(0, last + intervalMs - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait))
      if (deadline?.aborted) { resolve(null); return }
      last = Date.now()
      let value: Geo | null = null, cacheable = false, precision = requested
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
      const onDeadline = () => controller.abort()
      deadline?.addEventListener('abort', onDeadline, { once: true })
      try {
        const p = new URL(url); for (const [k, v] of Object.entries({ format: 'jsonv2', limit: '1', countrycodes: 'jp', 'accept-language': 'ja', q })) p.searchParams.set(k, v)
        const response = await Promise.race([fetcher(p.toString(), { headers: { 'User-Agent': 'kohako-home/1.0 (+https://github.com/boxp/arch)' }, signal: controller.signal, redirect: 'error' }), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }))])
        if (!response.ok) throw Error('upstream')
        const data: unknown = await Promise.race([response.json(), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }))])
        if (!Array.isArray(data)) throw Error('schema')
        cacheable = true
        const item = data[0], lat = Number(item?.lat), lon = Number(item?.lon)
        if (item && typeof item.lat === 'string' && typeof item.lon === 'string' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          // 番地・建物・駅など点で示せる結果(place_rank 26 以上)だけを exact とし、丁目や町域の一致は付近表示にする。
          if (precision === 'exact' && !(Number(item.place_rank) >= 26)) precision = 'area'
          const delta = precision === 'exact' ? .004 : .006
          let bbox: [number, number, number, number] = [Math.max(-180, lon - delta), Math.max(-90, lat - delta), Math.min(180, lon + delta), Math.min(90, lat + delta)]
          if (precision === 'area' && Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
            const [south, north, west, east] = item.boundingbox.map(Number)
            if ([south, north, west, east].every(Number.isFinite) && south >= -90 && north <= 90 && west >= -180 && east <= 180 && south < north && west < east && north - south <= (municipal ? .3 : .05) && east - west <= (municipal ? .3 : .05) && lat >= south && lat <= north && lon >= west && lon <= east) bbox = [west, south, east, north]
          }
          value = { lat, lon, bbox, precision, label: q.slice(0, 120), source: 'openstreetmap' }
        }
      } catch { /* 検索失敗は地図位置なしで返す */ } finally { clearTimeout(timer); deadline?.removeEventListener('abort', onDeadline) }
      if (cacheable) { cache.delete(key); cache.set(key, { at: Date.now(), value }); while (cache.size > 200) cache.delete(cache.keys().next().value!) }
      resolve(value)
    }).catch(() => resolve(null))
    return result
  }
  // 住所が与えられた時は住所由来の位置を正とし、名称検索の結果はその範囲内にある時だけ採用する（同名の別店舗を避ける）。
  // deadlineMs を過ぎたら、それまでに得た最良の位置（概略でも）を返す。
  const resolveView = async (view: Extract<View, { kind: 'map' }>, best: { geo: Geo | null }, deadline: AbortSignal): Promise<Geo | null> => {
    const { address, name } = view.destination
    const query = (q: string, p: Geo['precision'], municipal = false) => queryRaw(q, p, deadline, municipal)
    if (address) {
      const exact = await query(address, 'exact'); best.geo = exact
      if (exact?.precision === 'exact') return exact
      let area = exact
      const city = municipality(address)
      const seen = new Set([address])
      for (const candidate of [normalizeChome(address), town(address), city]) {
        if (area || deadline.aborted) break
        if (!candidate || seen.has(candidate)) continue
        seen.add(candidate)
        area = await query(candidate, 'area', candidate === city)
        best.geo = area
      }
      if (!area || !name || name === address) return area
      const named = await query(name, 'exact')
      const m = .002, [w, s, e, n] = area.bbox
      return named?.precision === 'exact' && named.lon >= w - m && named.lon <= e + m && named.lat >= s - m && named.lat <= n + m ? named : area
    }
    const named = await query(name, 'exact'); best.geo = named
    return named
  }
  return async (views: View[]): Promise<View[]> => {
    if (url === 'off') return views
    return Promise.all(views.map(async view => {
      if (view.kind !== 'map') return view
      const best: { geo: Geo | null } = { geo: null }
      const deadline = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      // 期限で deadline を中断し、送信中の検索の打ち切り・未送信の検索の取り止めを行う。
      const geo = await Promise.race([resolveView(view, best, deadline.signal).catch(() => best.geo), new Promise<Geo | null>(r => { timer = setTimeout(() => { deadline.abort(); r(best.geo) }, deadlineMs); timer.unref?.() })])
      clearTimeout(timer); deadline.abort()
      return geo ? { ...view, geo } : view
    }))
  }
}
