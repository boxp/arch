// BOXP-698: 宙に浮く椅子へ腰かけた姿。腰から下は描いた座り姿の絵（素材は BOXP-702、public/kohako/live2d/seat/）に入れ替える。
// 決まりは vault の Projects/kohako-home/seat-spec.md の S8。ここは絵を置く場所・濃さ・入れ替わる間の立ち姿の脚の寄せ方・裾の板の動かし方だけを持つ。
// いつ座るか・立つかは home/seat.ts が決める。座り具合 level が 0 の間は何も動かさない（立ち姿は従来と画素一致）。
export type Vec = readonly [number, number]
type Box = readonly [number, number, number, number]

/** v11r の層番号（モデル座標 1143x2048、画面の右側が right）。 */
export const LEGS = { right: { leg: 29, foot: 27 }, left: { leg: 30, foot: 28 } } as const
/** 上着の裾（左右）。 */
export const COATS = { right: 24, left: 25 } as const
export const SEAT_MESHES: ReadonlySet<number> = new Set([29, 30, 27, 28, 24, 25])
/** 絵と入れ替わって消える立ち姿の層（脚・足）。裾は消さず、硬い板として絵の手前で動かす（skirtPoint）。 */
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

/**
 * 上着の裾（左右）は硬い板（S8.4。BOXP-698 TD-04）。腰の付け根 hinge を支点に外へ回り、座面に押されて手前へ持ち上がるぶん、長さ方向だけ見かけで縮む。
 * 板の上のどの点にも同じ 1 次変換を掛けるので、折れもたわみもしない。turn と fore は、絵に描き込まれた裾が座り切った板の下に隠れる値。
 */
export const SKIRT = {
  hinge: { left: [458, 790] as Vec, right: [688, 790] as Vec },
  /** 立ち姿で板の長さ方向が鉛直から外へ傾いている角度、座り切りまでに外へ回る角度（ラジアン）、長さ方向の見かけの倍率。 */
  axis: 0.28,
  turn: 0.2,
  fore: 0.9,
} as const
/** 裾の板の動き（座り具合 level での 1 次変換）。板の上のどの点にも同じ変換を掛ける。 */
export function skirtPoint(side: 'left' | 'right', x: number, y: number, level: number): Vec {
  const s = clamp01(level)
  if (s <= 0) return [x, y]
  const [hx, hy] = SKIRT.hinge[side],
    out = side === 'left' ? -1 : 1,
    dx = (x - hx) * out,
    dy = y - hy,
    a0 = SKIRT.axis,
    a1 = SKIRT.axis + SKIRT.turn * s,
    k = 1 - (1 - SKIRT.fore) * s,
    // 板の座標（長さ方向 along・幅方向 across）
    along = dx * Math.sin(a0) + dy * Math.cos(a0),
    across = dx * Math.cos(a0) - dy * Math.sin(a0),
    nx = along * k * Math.sin(a1) + across * Math.cos(a1),
    ny = along * k * Math.cos(a1) - across * Math.sin(a1)
  return [hx + nx * out, hy + ny]
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

/**
 * 太ももの絵（seat-hips-thighs.png、659x352）に描き込まれた上着の裾は描かない（S8.9。BOXP-698 TD-05）。
 * 裾は立ち姿の層が硬い板として動くので、絵の裾が残ると、板の外や下からのぞいて「裾の下の残骸」に見える。
 * edge は左の裾の内側の縁（絵の画素の [y, x]。y の間は直線でつなぐ）。その外側（左は x が小さい側）を透明にする。右は左右対称。
 */
export const ART_SKIRT = {
  width: 659,
  edge: [
    [0, 260],
    [58, 252],
    [68, 238],
    [103, 205],
    [124, 184],
    [150, 169],
    [190, 154],
    [226, 143],
    [238, 136],
    [352, 136],
  ] as readonly Vec[],
} as const
/** 絵の画素 (x, y) が、描き込まれた裾の側（透明にする側）か。 */
export function paintedSkirt(x: number, y: number): boolean {
  // 左右対称（画素の中心で折り返す）
  return Math.min(x, ART_SKIRT.width - 1 - x) < skirtEdge(y)
}

/**
 * 太ももの絵を切った境目は、いつも裾の板の下に入れる（S8.10。BOXP-698 TD-05 の再指摘）。
 * 裾の板は体の揺れ・視線の追従・しぐさで左右に動くが、絵の下のほうは座面に止まっている。板が開いた時に、
 * 折れ線の内側に残った絵の裾（縁取りと紫）と、太ももを切った断面・その外の隙間がのぞかないよう、
 * 残す線を内側へ寄せ、線の外へ太ももの色を塗り足す（絵のファイルは変えず、読む時に行う）。
 */
export const THIGH_MEND = {
  /** 残す線を S8.9 の折れ線より内側へ寄せる幅。y が taperFrom から end へ進む間に 0 へ減らす。end から下は塗り足さない。 */
  inset: 8,
  taperFrom: 226,
  end: 238,
  /** 塗り足す幅、色を選ぶ画素の数（線から内側へ。その中でいちばん暗い画素の色を使う）、色を平均する上下の行数。 */
  fill: 56,
  sample: 12,
  blur: 3,
} as const
/** S8.9 の折れ線（左の裾の内側の縁）の、行 y での x。 */
function skirtEdge(y: number): number {
  const e = ART_SKIRT.edge
  let i = 1
  while (i < e.length - 1 && y > (e[i] as Vec)[0]) i++
  const [y0, x0] = e[i - 1] as Vec,
    [y1, x1] = e[i] as Vec
  return x0 + (x1 - x0) * clamp01((y - y0) / (y1 - y0))
}
/** 残す線（左）。x がこれ以上の画素は元の絵のまま。 */
export function thighEdge(y: number): number {
  const m = THIGH_MEND
  return skirtEdge(y) + m.inset * clamp01((m.end - y) / (m.end - m.taperFrom))
}
/** 絵の画素 (x, y) の扱い: 元のまま keep・太ももの色で塗り足す fill・透明 clear。右は左右対称。 */
export function artZone(x: number, y: number): 'keep' | 'fill' | 'clear' {
  const lx = Math.min(x, ART_SKIRT.width - 1 - x),
    edge = thighEdge(y)
  return lx >= edge ? 'keep' : y < THIGH_MEND.end && lx >= edge - THIGH_MEND.fill ? 'fill' : 'clear'
}
/** 絵の画素（RGBA、width 列）を S8.9・S8.10 のとおりに直す: 描き込まれた裾を透明にし、残す線の外へ太ももの色を塗り足す。 */
export function mendThighs(data: Uint8ClampedArray, width: number): void {
  const height = data.length / 4 / width,
    m = THIGH_MEND,
    rows = Math.min(height, m.end),
    first = (y: number) => Math.ceil(thighEdge(y)),
    // 行ごと・左右ごとの色（線に近い sample 画素のうち、いちばん暗い画素。水色の線や明るい縁取りを横へ引き伸ばさない）
    picked = [false, true].map((right) =>
      Array.from({ length: rows }, (_, y) => {
        let best = -1,
          dark = Infinity
        for (let k = 0; k < m.sample; k++) {
          const lx = first(y) + k,
            i = 4 * (y * width + (right ? width - 1 - lx : lx)),
            sum = (data[i] as number) + (data[i + 1] as number) + (data[i + 2] as number)
          if (sum < dark) {
            dark = sum
            best = i
          }
        }
        return Array.from(data.slice(best, best + 4))
      }),
    ),
    // 上下 blur 行で平均（色は濃さで重み付け）
    colors = picked.map((side) =>
      side.map((_, y) => {
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0,
          n = 0
        for (let yy = Math.max(0, y - m.blur); yy <= Math.min(rows - 1, y + m.blur); yy++) {
          const [cr, cg, cb, ca] = side[yy] as [number, number, number, number]
          r += cr * ca
          g += cg * ca
          b += cb * ca
          alpha += ca
          n++
        }
        return alpha === 0 ? [0, 0, 0, 0] : [r / alpha, g / alpha, b / alpha, alpha / n].map(Math.round)
      }),
    )
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const zone = artZone(x, y)
      if (zone === 'keep') continue
      const i = 4 * (y * width + x)
      if (zone === 'clear') data.fill(0, i, i + 4)
      else data.set((colors[x * 2 >= width ? 1 : 0] as number[][])[y] as number[], i)
    }
}
