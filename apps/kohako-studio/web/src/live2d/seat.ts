// BOXP-698: 宙に浮く椅子へ腰かけた姿。新しい絵は足さず、v11r の脚・足の頂点を描画直前に動かして作る。
// 正面向きに腰かけると、太ももは手前へ向かうので短く見え（短縮）、ひざから下はそのまま下へ垂れる。
// ここでは「太ももの区間だけを縦に縮め、ひざから下を縮めたぶんだけ持ち上げる」写像と、椅子の絵（コードで描く）だけを持つ。
// いつ座るか・立つかは home/seat.ts が決める。座り具合 level が 0 の間は何も動かさない（立ち姿は従来と画素一致）。
export type Vec = readonly [number, number]

/** v11r の層番号（モデル座標 1143x2048、画面の右側が right）。 */
export const LEGS = { right: { leg: 29, foot: 27 }, left: { leg: 30, foot: 28 } } as const
/** 上着の裾（左右）。座面の上へ広がって載る。 */
export const COATS = { right: 24, left: 25 } as const
export const SEAT_MESHES: ReadonlySet<number> = new Set([29, 30, 27, 28, 24, 25])
const CX = 572

export const SEAT = {
  /** 太ももの縮める区間（脚の付け根の下〜ひざ当ての上端）。両端の ease の幅だけ、縮め方をなだらかに始めて終える。 */
  top: 1012,
  knee: 1302,
  ease: 46,
  /** 区間の中ほどの縦の倍率（正面から見た太ももの短縮）。 */
  thigh: 0.4,
  /** ひざの中心（右脚）。ひざから下は、ここを支点に少しだけ大きくし（手前に来る）、足先を外へ開く。 */
  kneeC: [632, 1368] as Vec,
  /** ひざから下の拡大（手前に来るぶん）。 */
  near: 1.045,
  /** 足先を外へ開く角度（ラジアン。ひざをそろえて足先が少し開く）。 */
  splay: 0.035,
  /** 足をぶらぶらさせる時の、すねの縦の伸び縮みの割合（手前・奥へ振ると長さが変わって見える）。 */
  dangle: 0.035,
  /** 上着の裾: 腰から下の区間を縦に縮め（座面の上へ寝る）、縮めたぶんに比例して外へ広げる。 */
  coatTop: 1000,
  coatHem: 1252,
  coatEase: 70,
  coat: 0.5,
  coatSpread: 0.3,
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
/** 立ち姿の高さ ry の点が、座り具合 level でどれだけ上へ上がるか（モデル座標の長さ。0 以上、下ほど大きく、ひざから下は一定）。 */
export function seatLift(ry: number, level: number): number {
  return (1 - SEAT.thigh) * trapezoid(ry, SEAT.top, SEAT.knee, SEAT.ease) * clamp01(level)
}
/** ひざから下が上がる長さ（座り切った時）。 */
export const SEAT_RISE = seatLift(SEAT.knee, 1)

/**
 * 脚・足の頂点 1 つを座り姿へ動かす。(x, y) はいまの位置、(rx, ry) は立ち姿の位置。
 * mirror は画面の左側の脚。swing は足のぶらぶら（-1〜1。正で手前）。
 */
export function seatPoint(x: number, y: number, ry: number, level: number, mirror: boolean, swing = 0): Vec {
  const s = clamp01(level)
  if (s <= 0) return [x, y]
  const lifted = y - seatLift(ry, s)
  // ひざから下だけ: ひざを支点に拡大・足先を開く・ぶらぶら。ひざ当ての上端〜中心でなだらかに効かせる。
  const below = ease((ry - SEAT.knee) / (SEAT.kneeC[1] - SEAT.knee)) * s
  if (below <= 0) return [x, lifted]
  const kx = mirror ? 2 * CX - SEAT.kneeC[0] : SEAT.kneeC[0],
    ky = SEAT.kneeC[1] - seatLift(SEAT.kneeC[1], s),
    dx = x - kx,
    dy = lifted - ky,
    scale = 1 + (SEAT.near - 1) * below,
    stretch = 1 + SEAT.dangle * swing * below * (dy > 0 ? 1 : 0),
    a = (mirror ? 1 : -1) * SEAT.splay * below,
    c = Math.cos(a),
    n = Math.sin(a),
    px = dx * scale,
    py = dy * scale * stretch
  return [kx + px * c - py * n, ky + px * n + py * c]
}

/** 上着の裾の頂点 1 つを、座面の上へ載った形へ動かす。 */
export function coatPoint(x: number, y: number, ry: number, level: number, mirror: boolean): Vec {
  const s = clamp01(level)
  if (s <= 0) return [x, y]
  const lift = (1 - SEAT.coat) * trapezoid(ry, SEAT.coatTop, SEAT.coatHem, SEAT.coatEase) * s
  return [x + (mirror ? -1 : 1) * SEAT.coatSpread * lift, y - lift]
}

/** 椅子の絵を置く範囲（モデル座標。x, y, 幅, 高さ）。 */
export const CHAIR_BOX = [142, 820, 860, 640] as const
/** 椅子が現れる時に下から上がってくる長さ。 */
export const CHAIR_RISE = 46
export function chairCorners(shown: number): Vec[] {
  const [x, y, w, h] = CHAIR_BOX,
    dy = CHAIR_RISE * (1 - ease(shown))
  return [
    [x, y + dy],
    [x + w, y + dy],
    [x + w, y + h + dy],
    [x, y + h + dy],
  ]
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
/**
 * 椅子の絵。サイバー空間の、宙に浮く簡素な腰かけ（座面の円盤と、その下の器・光の輪）。生成画像ではなくコードで描く。
 * 座標は CHAIR_BOX の左上を原点にしたモデル座標。k は解像度の倍率。
 */
export function drawChair(g: Ctx, k: number): void {
  const [bx, by, bw, bh] = CHAIR_BOX,
    cx = CX - bx,
    seatY = 1092 - by
  g.save()
  g.scale(k, k)
  g.clearRect(0, 0, bw, bh)
  const cyan = 'rgba(96, 232, 244,',
    lilac = 'rgba(236, 228, 255,',
    violet = 'rgba(150, 120, 220,'
  // 下の光（床へ落ちる淡い光の柱と輪）
  const beam = g.createLinearGradient(0, seatY + 150, 0, bh)
  beam.addColorStop(0, `${cyan} 0.20)`)
  beam.addColorStop(1, `${cyan} 0)`)
  g.fillStyle = beam
  g.beginPath()
  g.moveTo(cx - 120, seatY + 160)
  g.lineTo(cx + 120, seatY + 160)
  g.lineTo(cx + 210, bh)
  g.lineTo(cx - 210, bh)
  g.closePath()
  g.fill()
  for (const [dy, rx, a] of [
    [230, 150, 0.55],
    [295, 110, 0.38],
    [350, 74, 0.22],
  ] as const) {
    g.strokeStyle = `${cyan} ${a})`
    g.lineWidth = 3
    g.shadowColor = `${cyan} 0.9)`
    g.shadowBlur = 14
    g.beginPath()
    g.ellipse(cx, seatY + dy, rx, rx * 0.2, 0, 0, Math.PI * 2)
    g.stroke()
  }
  g.shadowBlur = 0
  // 座面の下の器（下へすぼまる）
  const bowl = g.createLinearGradient(0, seatY, 0, seatY + 130)
  bowl.addColorStop(0, `${violet} 0.80)`)
  bowl.addColorStop(1, 'rgba(84, 62, 150, 0.86)')
  g.fillStyle = bowl
  g.beginPath()
  g.moveTo(cx - 400, seatY)
  g.bezierCurveTo(cx - 388, seatY + 130, cx - 180, seatY + 176, cx, seatY + 176)
  g.bezierCurveTo(cx + 180, seatY + 176, cx + 388, seatY + 130, cx + 400, seatY)
  g.closePath()
  g.fill()
  g.strokeStyle = 'rgba(214, 178, 106, 0.9)'
  g.lineWidth = 3
  g.stroke()
  // 座面（円盤の上の面）
  const top = g.createLinearGradient(0, seatY - 52, 0, seatY + 52)
  top.addColorStop(0, `${lilac} 0.96)`)
  top.addColorStop(1, 'rgba(206, 190, 246, 0.96)')
  g.fillStyle = top
  g.beginPath()
  g.ellipse(cx, seatY, 400, 76, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = `${cyan} 0.95)`
  g.lineWidth = 4
  g.shadowColor = `${cyan} 1)`
  g.shadowBlur = 16
  g.stroke()
  g.shadowBlur = 0
  g.restore()
}
