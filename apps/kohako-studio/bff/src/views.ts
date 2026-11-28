export type Geo = {
  lat: number
  lon: number
  bbox: [number, number, number, number]
  precision: 'exact' | 'area'
  label: string
  source: 'openstreetmap'
}
/** BOXP-749: aliases は OpenStreetMap 上の別表記（住所の範囲内の検索にだけ使う）。 */
export type Place = { name: string; address?: string; aliases?: string[] }
export type View =
  | { kind: 'usage'; title?: string }
  | {
      kind: 'map'
      title: string
      /** 単一の目的地。places（2〜5件の比較候補）とどちらか一方だけ。 */
      destination?: Place
      places?: (Place & { geo?: Geo })[]
      origin?: string
      geo?: Geo
      mode?: 'transit' | 'walking' | 'driving' | 'bicycling'
    }
  | { kind: 'html'; title: string; html: string }
export const VIEW_INSTRUCTIONS = `地図・経路や図表が役立つ場合、返答末尾に最大一つだけ次の形式のブロックを置いてください: \`\`\`kohako-view\n{JSON}\n\`\`\`。本文だけで読み上げ可能にし、会話で明示された場合を除き自宅住所や個人情報を出発地にせず、数値を捏造しないでください。利用枠は {"kind":"usage"}（実データを画面が描画）を使います。地図には目的地の正式名称と、分かれば番地までの住所を必ず入れてください。地図は {"kind":"map","title":"題名","destination":{"name":"目的地","address":"住所","aliases":["地図上の別表記"]},"origin":"出発地","mode":"transit|walking|driving|bicycling"}（住所・aliases・出発地・modeは任意）。複数の候補を比べる時は destination の代わりに "places":[{"name":"店名","address":"住所","aliases":["別表記"]}, …]（2〜5件）を使うと、1枚の地図に店名付きピンで並べます。aliases には OpenStreetMap で使われていそうな別表記（日本語・英語の店名やチェーン名。例: Cafe Renoir 芝大門店 に対して ルノアール）を3つまで入れてください。位置が分からない時に座標を書かないでください。その他の図表は {"kind":"html","title":"題名","html":"自己完結したHTMLとインラインCSS/SVG（JavaScript・リンク・外部資源は使えず除去されます）"}。`
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k))
const str = (v: unknown, max: number, html = false) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: view 本文の制御文字を拒否する（html は改行・タブを許可するため範囲指定が必要）
  !(html ? /[\x00-\x08\x0b-\x1f\x7f-\x9f]/ : /\p{Cc}/u).test(v)
const numberIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
/** BFF 自身が付けた geo を検証する（モデルが書いた座標は受け付けない: 抽出時は geo なしの欄だけを許す）。 */
function validGeo(v: unknown): v is Geo {
  if (!object(v) || !keys(v, ['lat', 'lon', 'bbox', 'precision', 'label', 'source'])) return false
  if (!numberIn(v.lat, -90, 90) || !numberIn(v.lon, -180, 180) || !Array.isArray(v.bbox) || v.bbox.length !== 4)
    return false
  const [west, south, east, north] = v.bbox
  return (
    numberIn(west, -180, 180) &&
    numberIn(east, -180, 180) &&
    numberIn(south, -90, 90) &&
    numberIn(north, -90, 90) &&
    west < east &&
    south < north &&
    v.lon >= west &&
    v.lon <= east &&
    v.lat >= south &&
    v.lat <= north &&
    (v.precision === 'exact' || v.precision === 'area') &&
    str(v.label, 120) &&
    v.source === 'openstreetmap'
  )
}
function place(v: unknown, withGeo: boolean): boolean {
  // withGeo: BFF が位置を付けた後の検証だけで geo を許す。
  return (
    object(v) &&
    keys(v, withGeo ? ['name', 'address', 'aliases', 'geo'] : ['name', 'address', 'aliases']) &&
    str(v.name, 80) &&
    (v.address === undefined || str(v.address, 120)) &&
    (v.aliases === undefined ||
      (Array.isArray(v.aliases) && v.aliases.length <= 3 && v.aliases.every((a) => str(a, 80)))) &&
    (v.geo === undefined || validGeo(v.geo))
  )
}
/** trusted=false（モデルの出力）では geo を受け付けない。trusted=true は BFF が位置を付けた後の検証。 */
export function validateView(v: unknown, trusted = false): View | null {
  if (!object(v)) return null
  if (v.kind === 'usage')
    return keys(v, ['kind', 'title']) && (v.title === undefined || str(v.title, 60)) ? (v as View) : null
  if (!str(v.title, 60)) return null
  if (v.kind === 'html') return keys(v, ['kind', 'title', 'html']) && str(v.html, 20000, true) ? (v as View) : null
  if (
    v.kind === 'map' &&
    keys(v, ['kind', 'title', 'destination', 'places', 'origin', 'mode', ...(trusted ? ['geo'] : [])]) &&
    (v.destination === undefined) !== (v.places === undefined) &&
    (v.destination === undefined || place(v.destination, false)) &&
    (v.places === undefined ||
      (Array.isArray(v.places) &&
        v.places.length >= 2 &&
        v.places.length <= 5 &&
        v.places.every((p) => place(p, trusted)))) &&
    (v.geo === undefined || (v.destination !== undefined && validGeo(v.geo))) &&
    (v.origin === undefined || str(v.origin, 120)) &&
    (v.mode === undefined || ['transit', 'walking', 'driving', 'bicycling'].includes(v.mode as string))
  )
    return v as View
  return null
}
export function extractViews(text: string): { text: string; views: View[] } {
  const views: View[] = []
  const cleaned = text.replace(
    /```kohako-view(?=[\s{]|```|$)[^\S\r\n]*([\s\S]*?)(?:```|$)/gi,
    (block, content: string) => {
      if (block.endsWith('```') && !views.length) {
        try {
          const v = validateView(JSON.parse(content))
          if (v) views.push(v)
        } catch {
          /* 不正なブロックは捨てる */
        }
      }
      return ''
    },
  )
  return { text: cleaned.trim(), views }
}
