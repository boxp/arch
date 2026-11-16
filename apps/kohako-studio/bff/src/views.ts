export type Geo = {
  lat: number
  lon: number
  bbox: [number, number, number, number]
  precision: 'exact' | 'area'
  label: string
  source: 'openstreetmap'
}
export type View =
  | { kind: 'usage'; title?: string }
  | {
      kind: 'map'
      title: string
      destination: { name: string; address?: string }
      origin?: string
      geo?: Geo
      mode?: 'transit' | 'walking' | 'driving' | 'bicycling'
    }
  | { kind: 'html'; title: string; html: string }
export const VIEW_INSTRUCTIONS = `地図・経路や図表が役立つ場合、返答末尾に最大一つだけ次の形式のブロックを置いてください: \`\`\`kohako-view\n{JSON}\n\`\`\`。本文だけで読み上げ可能にし、会話で明示された場合を除き自宅住所や個人情報を出発地にせず、数値を捏造しないでください。利用枠は {"kind":"usage"}（実データを画面が描画）を使います。地図には目的地の正式名称と、分かれば番地までの住所を必ず入れてください。地図は {"kind":"map","title":"題名","destination":{"name":"目的地","address":"住所"},"origin":"出発地","mode":"transit|walking|driving|bicycling"}（住所・出発地・modeは任意）。その他の図表は {"kind":"html","title":"題名","html":"自己完結したHTMLとインラインCSS/SVG（JavaScript・リンク・外部資源は使えず除去されます）"}。`
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k))
const str = (v: unknown, max: number, html = false) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: view 本文の制御文字を拒否する（html は改行・タブを許可するため範囲指定が必要）
  !(html ? /[\x00-\x08\x0b-\x1f\x7f-\x9f]/ : /\p{Cc}/u).test(v)
export function validateView(v: unknown): View | null {
  if (!object(v)) return null
  if (v.kind === 'usage')
    return keys(v, ['kind', 'title']) && (v.title === undefined || str(v.title, 60)) ? (v as View) : null
  if (!str(v.title, 60)) return null
  if (v.kind === 'html') return keys(v, ['kind', 'title', 'html']) && str(v.html, 20000, true) ? (v as View) : null
  if (
    v.kind === 'map' &&
    keys(v, ['kind', 'title', 'destination', 'origin', 'mode']) &&
    object(v.destination) &&
    keys(v.destination, ['name', 'address']) &&
    str(v.destination.name, 80) &&
    (v.destination.address === undefined || str(v.destination.address, 120)) &&
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
