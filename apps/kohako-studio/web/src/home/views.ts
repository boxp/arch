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
function validGeo(v: unknown): v is Geo {
  if (
    !object(v) ||
    !keys(v, ['lat', 'lon', 'bbox', 'precision', 'label', 'source']) ||
    !numberIn(v.lat, -90, 90) ||
    !numberIn(v.lon, -180, 180) ||
    !Array.isArray(v.bbox) ||
    v.bbox.length !== 4
  )
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
export function osmUrl(geo: Geo): string {
  if (!validGeo(geo)) throw new Error('invalid geo')
  const p = new URLSearchParams({ bbox: geo.bbox.join(','), layer: 'mapnik' })
  if (geo.precision === 'exact') p.set('marker', `${geo.lat},${geo.lon}`)
  return `https://www.openstreetmap.org/export/embed.html?${p}`
}
export function validateView(v: unknown): View | null {
  if (!object(v)) return null
  if (v.kind === 'usage')
    return keys(v, ['kind', 'title']) && (v.title === undefined || str(v.title, 60)) ? (v as View) : null
  if (!str(v.title, 60)) return null
  if (v.kind === 'html') return keys(v, ['kind', 'title', 'html']) && str(v.html, 20000, true) ? (v as View) : null
  if (
    v.kind === 'map' &&
    keys(v, ['kind', 'title', 'destination', 'origin', 'mode', 'geo']) &&
    object(v.destination) &&
    keys(v.destination, ['name', 'address']) &&
    str(v.destination.name, 80) &&
    (v.destination.address === undefined || str(v.destination.address, 120)) &&
    (v.origin === undefined || str(v.origin, 120)) &&
    (v.geo === undefined || validGeo(v.geo)) &&
    (v.mode === undefined || ['transit', 'walking', 'driving', 'bicycling'].includes(v.mode as string))
  )
    return v as View
  return null
}

export function validateViews(v: unknown): View[] {
  return Array.isArray(v)
    ? v
        .map(validateView)
        .filter((x): x is View => x !== null)
        .slice(0, 1)
    : []
}
export function mapsUrl(view: Extract<View, { kind: 'map' }>, useOrigin: boolean): string {
  const p = new URLSearchParams({
    api: '1',
    destination: [view.destination.name, view.destination.address].filter(Boolean).join(' '),
  })
  if (view.mode) p.set('travelmode', view.mode)
  if (useOrigin && view.origin) p.set('origin', view.origin)
  return `https://www.google.com/maps/dir/?${p}`
}
// 生成HTMLはスクリプトを実行させず（sandbox="" と script-src 'none'）、さらに遷移・外部参照につながる要素と属性を除く。
const DROP =
  'script,noscript,meta,base,link,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,portal,template,animate,set,animatemotion,animatetransform,foreignobject'
const URL_ATTRS = new Set([
  'href',
  'xlink:href',
  'src',
  'srcset',
  'action',
  'formaction',
  'background',
  'poster',
  'ping',
  'data',
  'codebase',
  'cite',
  'longdesc',
  'usemap',
])
// 解析は閲覧文脈を持たない文書（DOMParser の結果, defaultView === null）でだけ行う。この文書では img/srcset/video/link/style
// 等の取得もスクリプトも走らないため、属性を除く前に外部URLへ通信しない（document 上の要素の innerHTML は取得が走るので使わない）。
// 確認: apps/kohako-studio/verify/home/inertparse.mjs（Chromium/Firefox/WebKit で通信0、対照の div.innerHTML は通信あり）。
export function sanitizeHtml(
  html: string,
  doc: Document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html'),
): string {
  if (doc.defaultView !== null) throw new Error('sanitizeHtml: browsing context を持つ文書では解析しない')
  doc.body.querySelectorAll(DROP).forEach((e) => {
    e.remove()
  })
  for (const e of Array.from(doc.body.querySelectorAll('*')))
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase(),
        v = a.value.trim()
      if (
        n.startsWith('on') ||
        n === 'target' ||
        n === 'http-equiv' ||
        (URL_ATTRS.has(n) && !(v.startsWith('#') || /^data:image\/(png|gif|jpeg|webp);/i.test(v)))
      )
        e.removeAttribute(a.name)
    }
  return doc.body.innerHTML
}
export function htmlSrcdoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`
}
