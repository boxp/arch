/**
 * BOXP-749: 会話内地図。OpenStreetMap のタイルを並べ、候補ごとに番号・店名付きの印を重ねる（仕様: Projects/kohako-home/map-view-spec.md）。
 * 位置が「正確」な候補だけにピンを立て、丁目程度の「範囲」は点線の枠（ピンではない）、広い範囲や位置なしは印を付けない。
 */
import type { Geo, Place, View } from './views'

export type MapPlace = Place & { geo?: Geo }
export type MapMark =
  | { kind: 'pin'; n: number; label: string; left: number; top: number; side?: 'left' }
  | { kind: 'area'; n: number; label: string; left: number; top: number; width: number; height: number }
export type MapLayout = {
  zoom: number
  tiles: { src: string; left: number; top: number; width: number; height: number }[]
  marks: MapMark[]
}

/** 地図枠の論理サイズ（px）。表示は幅に合わせて拡縮し、位置は % で持つ。 */
export const MAP_WIDTH = 640
export const MAP_HEIGHT = 360
const TILE = 256
/** 点線の枠で示す範囲の上限（度）。これより広い範囲（市区町村など）は印を付けない。 */
const AREA_SPAN = 0.05
const PAD = 48

export function mapPlaces(view: Extract<View, { kind: 'map' }>): MapPlace[] {
  if (view.places) return view.places
  if (!view.destination) return []
  return [{ ...view.destination, ...(view.geo ? { geo: view.geo } : {}) }]
}

const project = (lat: number, lon: number, zoom: number) => {
  const scale = TILE * 2 ** zoom,
    sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  }
}
const round = (v: number) => Math.round(v * 100) / 100

export function markable(geo: Geo | undefined): 'pin' | 'area' | null {
  if (!geo) return null
  if (geo.precision === 'exact') return 'pin'
  const [w, s, e, n] = geo.bbox
  return e - w <= AREA_SPAN && n - s <= AREA_SPAN ? 'area' : null
}

export function layoutMap(places: MapPlace[]): MapLayout | null {
  const items = places
    .map((p, i) => ({ n: i + 1, name: p.name, geo: p.geo, kind: markable(p.geo) }))
    .filter((x): x is { n: number; name: string; geo: Geo; kind: 'pin' | 'area' } => x.kind !== null)
  if (!items.length) return null
  // 印の位置（ピンは点、範囲は枠の 4 隅）をすべて収める最大の縮尺を選ぶ。1 本だけのピンは周辺が分かる 16 に留める。
  const corners = items.flatMap(({ geo, kind }) =>
    kind === 'pin'
      ? [[geo.lat, geo.lon]]
      : [
          [geo.bbox[1], geo.bbox[0]],
          [geo.bbox[3], geo.bbox[2]],
        ],
  )
  let zoom = items.length === 1 && items[0].kind === 'pin' ? 16 : 17
  // 縮尺 0 では世界全体が 256px 四方に収まり、枠（余白を除き 544×264px）に必ず入る。離れた候補でも全ピンを出すため 0 まで下げる。
  for (; zoom > 0; zoom--) {
    const pts = corners.map(([lat, lon]) => project(lat, lon, zoom))
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y)
    if (
      Math.max(...xs) - Math.min(...xs) <= MAP_WIDTH - 2 * PAD &&
      Math.max(...ys) - Math.min(...ys) <= MAP_HEIGHT - 2 * PAD
    )
      break
  }
  const pts = corners.map(([lat, lon]) => project(lat, lon, zoom))
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y)
  const ox = (Math.max(...xs) + Math.min(...xs)) / 2 - MAP_WIDTH / 2,
    oy = (Math.max(...ys) + Math.min(...ys)) / 2 - MAP_HEIGHT / 2
  const count = 2 ** zoom,
    tiles: MapLayout['tiles'] = []
  for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + MAP_HEIGHT) / TILE); ty++) {
    if (ty < 0 || ty >= count) continue
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + MAP_WIDTH) / TILE); tx++) {
      const x = ((tx % count) + count) % count
      tiles.push({
        src: `https://tile.openstreetmap.org/${zoom}/${x}/${ty}.png`,
        left: round(((tx * TILE - ox) / MAP_WIDTH) * 100),
        top: round(((ty * TILE - oy) / MAP_HEIGHT) * 100),
        width: round((TILE / MAP_WIDTH) * 100),
        height: round((TILE / MAP_HEIGHT) * 100),
      })
    }
  }
  const at = (lat: number, lon: number) => {
    const p = project(lat, lon, zoom)
    return { left: round(((p.x - ox) / MAP_WIDTH) * 100), top: round(((p.y - oy) / MAP_HEIGHT) * 100) }
  }
  const marks = items.map(({ n, name, geo, kind }): MapMark => {
    if (kind === 'pin') {
      // 右寄りのピンは店名を左側に出し、地図枠の外へはみ出さないようにする。
      const pos = at(geo.lat, geo.lon)
      return { kind, n, label: name, ...pos, ...(pos.left > 55 ? { side: 'left' as const } : {}) }
    }
    const nw = at(geo.bbox[3], geo.bbox[0]),
      se = at(geo.bbox[1], geo.bbox[2])
    return { kind, n, label: `${name}（付近）`, ...nw, width: round(se.left - nw.left), height: round(se.top - nw.top) }
  })
  return { zoom, tiles, marks }
}

/**
 * 表示後に店名ラベルの重なり・枠外へのはみ出しを避ける。ラベルを右上・左上・右下・左下の順に試し、
 * 先に置いたラベルと重ならず枠に収まる最初の位置にする（どれも無理なら最初の位置のまま。番号と一覧で区別できる）。
 */
export function declutterLabels(box: HTMLElement): void {
  const frame = box.getBoundingClientRect()
  if (!frame.width) return
  const placed: DOMRect[] = []
  for (const pin of box.querySelectorAll<HTMLElement>('.view-map-pin')) {
    const label = pin.querySelector<HTMLElement>('.view-map-label')
    if (!label) continue
    const sides = pin.dataset.side === 'left' ? ['left', 'right'] : ['right', 'left']
    const options = [...sides.map((x) => `${x}-above`), ...sides.map((x) => `${x}-below`)]
    let chosen = options[0]
    const at = pin.getBoundingClientRect().left
    // 選んだ側の余白に収まる幅まで縮める（収まらない分は省略記号。全名は下の一覧にある）。
    const room = (option: string) =>
      `${Math.max(48, Math.min(200, option.startsWith('left') ? at - frame.left - 18 : frame.right - at - 18))}px`
    for (const option of options) {
      label.dataset.place = option
      label.style.maxWidth = room(option)
      const r = label.getBoundingClientRect()
      const fits = r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom
      if (
        fits &&
        placed.every((p) => r.right <= p.left || r.left >= p.right || r.bottom <= p.top || r.top >= p.bottom)
      ) {
        chosen = option
        break
      }
    }
    label.dataset.place = chosen
    label.style.maxWidth = room(chosen)
    placed.push(label.getBoundingClientRect())
  }
}

/** 地図枠の DOM。文字はすべて textContent で入れ、URL は layoutMap が数値から組んだタイルだけを使う。 */
export function renderMap(doc: Document, layout: MapLayout, title: string): HTMLElement {
  const box = doc.createElement('div')
  box.className = 'view-map'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', `${title}: ${layout.marks.map((m) => `${m.n} ${m.label}`).join('、')}`)
  box.dataset.zoom = String(layout.zoom)
  const pct = (el: HTMLElement, k: 'left' | 'top' | 'width' | 'height', v: number) => {
    el.style[k] = `${v}%`
  }
  for (const t of layout.tiles) {
    const img = doc.createElement('img')
    img.className = 'view-map-tile'
    img.alt = ''
    img.decoding = 'async'
    img.draggable = false
    // タイル利用規約に従い Referer は送る（オリジンだけ。家の URL のパスは送らない）。
    img.referrerPolicy = 'strict-origin'
    img.src = t.src
    pct(img, 'left', t.left)
    pct(img, 'top', t.top)
    pct(img, 'width', t.width)
    pct(img, 'height', t.height)
    box.append(img)
  }
  for (const m of layout.marks) {
    const mark = doc.createElement('div')
    mark.className = m.kind === 'pin' ? 'view-map-pin' : 'view-map-area'
    mark.dataset.n = String(m.n)
    if (m.kind === 'pin' && m.side) mark.dataset.side = m.side
    pct(mark, 'left', m.left)
    pct(mark, 'top', m.top)
    if (m.kind === 'area') {
      pct(mark, 'width', m.width)
      pct(mark, 'height', m.height)
    }
    const badge = doc.createElement('span')
    badge.className = 'view-map-n'
    badge.textContent = String(m.n)
    const label = doc.createElement('span')
    label.className = 'view-map-label'
    label.textContent = m.label
    mark.append(badge, label)
    box.append(mark)
  }
  const credit = doc.createElement('a')
  credit.className = 'view-map-credit'
  credit.href = 'https://www.openstreetmap.org/copyright'
  credit.target = '_blank'
  credit.rel = 'noopener noreferrer'
  credit.textContent = '© OpenStreetMap contributors'
  box.append(credit)
  // 幅が決まってから（表示後・画面回転時）ラベルの重なりを解く。
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => declutterLabels(box)).observe(box)
  return box
}
