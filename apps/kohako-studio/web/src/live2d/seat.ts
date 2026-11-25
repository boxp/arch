// BOXP-698: 宙に浮く椅子へ腰かけた姿。腰から下は描いた座り姿の絵（素材は BOXP-702、public/kohako/live2d/seat/）に入れ替える。
// 決まりは vault の Projects/kohako-home/seat-spec.md の S8。ここは絵を置く場所・濃さ・入れ替わる間の立ち姿の脚の寄せ方だけを持つ。
// いつ座るか・立つかは home/seat.ts が決める。座り具合 level が 0 の間は何も動かさない（立ち姿は従来と画素一致）。
export type Vec = readonly [number, number]
type Box = readonly [number, number, number, number]

/** v11r の層番号（モデル座標 1143x2048、画面の右側が right）。 */
export const LEGS = { right: { leg: 29, foot: 27 }, left: { leg: 30, foot: 28 } } as const
/** 上着の裾（左右）。 */
export const COATS = { right: 24, left: 25 } as const
export const SEAT_MESHES: ReadonlySet<number> = new Set([29, 30, 27, 28, 24, 25])
/** 絵と入れ替わって消える立ち姿の層（脚・足）。裾は消さずに絵の内側へ隠す。 */
export const LEG_MESHES: ReadonlySet<number> = new Set([29, 30, 27, 28])

/** 描いた絵（BOXP-702 の manifest.json の矩形とひざの位置。モデル座標）。 */
export const ART = {
  chair: { file: 'seat-chair.png', box: [166, 926, 810, 519] as Box },
  shadow: { file: 'seat-contact-shadow.png', box: [228, 986, 689, 172] as Box },
  thighs: { file: 'seat-hips-thighs.png', box: [243, 820, 659, 352] as Box },
  shinLeft: { file: 'seat-shin-left.png', box: [421, 1078, 147, 709] as Box, pivot: [508, 1155] as Vec },
  shinRight: { file: 'seat-shin-right.png', box: [577, 1078, 147, 708] as Box, pivot: [636, 1155] as Vec },
} as const

export const SEAT = {
  /** 立ち姿の太ももの区間（脚の付け根の下〜ひざ当ての上端）。両端の ease の幅だけ、縮め方をなだらかに始めて終える。 */
  top: 1012,
  knee: 1302,
  ease: 46,
  /** 立ち姿のひざの高さ。座り切ると絵のひざ（1155）へ上がる。 */
  kneeY: 1368,
  /** 絵が出始める・出切る座り具合、立ち姿の脚が消え始める座り具合。 */
  artFrom: 0.3,
  artFull: 0.8,
  /** 立ち姿の裾: この高さから下を縦に縮めて絵の内側へ隠す。 */
  coatTop: 875,
  coatShrink: 0.78,
  /** 絵がはっきり描かれている範囲（高さ coatEdgeY での左右の端と、下へ 1 行くごとの広がり）。寄せ方を効かせ始める幅。 */
  coatEdgeY: 880,
  coatEdge: [403, 741] as Vec,
  coatSlope: 0.7,
  coatEase: 40,
  /** 足のぶらぶら: ひざから下の伸び縮みの割合と、振れる角度（ラジアン）。 */
  dangle: 0.03,
  swing: 0.03,
  /** 腰のつなぎ: 体の層に付いていく重みが 1 の高さと 0 になる高さ、体の層の腰の 2 点。 */
  followTop: 850,
  followBottom: 1000,
  waist: [
    [500, 850],
    [644, 850],
  ] as readonly [Vec, Vec],
} as const

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const ease = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
/** 台形の重み（区間の両端 e で 0→1→0）を top から y まで積分した長さ。 */
function trapezoid(y: number, top: number, bottom: number, e: number): number {
  const ramp = (d: number) => (d <= 0 ? 0 : d >= e ? e / 2 : (d * d) / (2 * e))
  if (y <= top) return 0
  const yy = Math.min(y, bottom)
  // 上りの斜面 + 平らな部分 + 下りの斜面
  const up = ramp(yy - top),
    flat = Math.max(0, Math.min(yy, bottom - e) - (top + e)),
    down = e / 2 - ramp(bottom - yy)
  return up + flat + (yy > bottom - e ? down : 0)
}
/** ひざから下が上がる長さ（座り切った時）。立ち姿のひざ → 絵のひざ。 */
export const SEAT_RISE = SEAT.kneeY - ART.shinRight.pivot[1]
const SHRINK = SEAT_RISE / trapezoid(SEAT.knee, SEAT.top, SEAT.knee, SEAT.ease)
/** 立ち姿の高さ ry の点が、座り具合 level でどれだけ上へ上がるか（0 以上、下ほど大きく、ひざから下は一定）。 */
export function seatLift(ry: number, level: number): number {
  return ry >= SEAT.knee
    ? SEAT_RISE * clamp01(level)
    : SHRINK * trapezoid(ry, SEAT.top, SEAT.knee, SEAT.ease) * clamp01(level)
}

/** 立ち姿の脚・足の頂点 1 つを、絵の位置へ寄せる。(x, y) はいまの位置、ry は立ち姿の高さ。 */
export function seatPoint(x: number, y: number, ry: number, level: number): Vec {
  return level <= 0 ? [x, y] : [x, y - seatLift(ry, level)]
}

/** 立ち姿の裾の頂点 1 つを、絵の裾の内側へ隠す（縦に縮め、絵からはみ出る点は端へ寄せる）。 */
export function coatPoint(x: number, y: number, ry: number, level: number): Vec {
  const s = clamp01(level)
  if (s <= 0 || ry <= SEAT.coatTop) return [x, y]
  const dy = (ry - SEAT.coatTop) * SEAT.coatShrink,
    // 座り切った時の高さでの、絵がはっきり描かれている範囲。
    out = SEAT.coatSlope * (ry - dy - SEAT.coatEdgeY),
    inside = Math.max(SEAT.coatEdge[0] - out, Math.min(SEAT.coatEdge[1] + out, x))
  return [x + (inside - x) * s * clamp01((ry - SEAT.coatTop) / SEAT.coatEase), y - dy * s]
}

/** 絵（太もも・ひざから下・影）の濃さ。 */
export const artOpacity = (level: number) => ease((level - SEAT.artFrom) / (SEAT.artFull - SEAT.artFrom))
/** 立ち姿の脚・足の濃さ。絵が出切ってから消える（どの座り具合でも、どちらかは濃さ 1）。 */
export const legOpacity = (level: number) => 1 - ease((level - SEAT.artFull) / (1 - SEAT.artFull))

export function boxCorners([x, y, w, h]: Box): Vec[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
}

/** ひざから下の絵の四隅。入れ替わる間は立ち姿のひざから下と同じ位置へずらし、ぶらぶら swing（-1〜1）でひざを支点に伸び縮み・振れる。 */
export function shinCorners(side: 'left' | 'right', level: number, swing: number): Vec[] {
  const art = side === 'left' ? ART.shinLeft : ART.shinRight,
    slide = SEAT_RISE * (1 - clamp01(level)),
    corners = boxCorners(art.box)
  if (swing === 0) return slide === 0 ? corners : corners.map(([x, y]) => [x, y + slide])
  const [px, py] = art.pivot,
    a = (side === 'left' ? -1 : 1) * SEAT.swing * swing,
    c = Math.cos(a),
    n = Math.sin(a),
    k = 1 + SEAT.dangle * swing
  return corners.map(([x, y]) => {
    const dx = x - px,
      dy = (y - py) * k
    return [px + dx * c - dy * n, py + dx * n + dy * c + slide]
  })
}

/** 腰のつなぎの重み（上のほうは体の層に付いていき、座面に着いたところは動かない）。 */
export const followWeight = (y: number) => 1 - ease((y - SEAT.followTop) / (SEAT.followBottom - SEAT.followTop))
/** 絵の点 p を、体の層の腰の 2 点（置いた時 a, b → いま na, nb）の動き（平行移動と傾き）へ、重みのぶんだけ付いていかせる。 */
export function followPoint(p: Vec, a: Vec, b: Vec, na: Vec, nb: Vec): Vec {
  const w = followWeight(p[1])
  if (w <= 0) return p
  const mx = (a[0] + b[0]) / 2,
    my = (a[1] + b[1]) / 2,
    nx = (na[0] + nb[0]) / 2,
    ny = (na[1] + nb[1]) / 2,
    r = Math.atan2(nb[1] - na[1], nb[0] - na[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
  if (nx === mx && ny === my && r === 0) return p
  const c = Math.cos(r),
    n = Math.sin(r),
    dx = p[0] - mx,
    dy = p[1] - my,
    tx = nx + dx * c - dy * n,
    ty = ny + dx * n + dy * c
  return [p[0] + (tx - p[0]) * w, p[1] + (ty - p[1]) * w]
}

/** 椅子が現れる時に下から上がってくる長さ。 */
export const CHAIR_RISE = 46
export function chairCorners(shown: number): Vec[] {
  const dy = CHAIR_RISE * (1 - ease(shown))
  return boxCorners(ART.chair.box).map(([x, y]) => [x, y + dy])
}
