// BOXP-521: 胸の控えめな揺れ（二次動作）。v11r では胸は体の層（mesh 26）に描き込まれており、胸だけの層・パラメータ・物理は無い。
// 体の層の頂点は胸のあたりで約 35px 間隔と粗いので、胸の範囲だけ体の層と同じ絵（テクスチャ・UV）を細かい格子で重ね、その格子を局所的に変形する。
// 揺れの入力は体の層が実際に動いた量（待機の呼吸・身振りの体の傾き）で、ばねで遅れて追従させる。独立した周期の揺れは足さない。
type Vec = readonly [number, number]

/** 胸の格子の範囲（モデル座標 1143x2048、v11r の描画を実測）。上は襟の合わせの下、下は帯の上端、左右は袖の内側。 */
export const CHEST_BOX = { x0: 452, y0: 470, x1: 692, y1: 646, cols: 24, rows: 18 } as const
/** 左右の胸の中心と半径。ウェイトは中心で 1、楕円の縁と格子の外周で 0（襟・帯・袖・髪とのつながりを動かさない）。 */
export const BUST = { left: [524, 578] as Vec, right: [620, 578] as Vec, rx: 64, up: 76, down: 60 } as const
/**
 * 胸のばね。約 2.6Hz・減衰比 0.42 で、体の動きから少し遅れて 1〜2 回揺れて止まる。
 * quiet（モデル px）以下の小さな遅れは揺れにしない（待機の呼吸のようなゆっくりした動きでは胸を落ち着かせ、身振りのときだけ揺らす）。
 */
export const SPRING = { hz: 2.6, damping: 0.42, quiet: 0.45, gain: 4, gainY: 5.6, max: 9, maxDt: 1 / 30 } as const

const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x) }

/** 格子点（モデル座標）の揺れのウェイト 0..1。 */
export function chestWeight(x: number, y: number): number {
  const { x0, y0, x1, y1 } = CHEST_BOX
  if (x <= x0 || x >= x1 || y <= y0 || y >= y1) return 0
  const one = (c: Vec) => { const dx = (x - c[0]) / BUST.rx, dy = (y - c[1]) / (y < c[1] ? BUST.up : BUST.down), r = Math.hypot(dx, dy); return r >= 1 ? 0 : 1 - smooth01(r) }
  // 格子の外周の近くでは必ず 0 へ落とす（重ねた格子の縁と下の体の層がずれないように）。
  const edge = smooth01(Math.min(x - x0, x1 - x, y - y0, y1 - y) / 12)
  return Math.max(one(BUST.left), one(BUST.right)) * edge
}

export type ChestSpring = { pos: [number, number]; vel: [number, number]; anchor: [number, number] | null; offset: [number, number] }
export const createChestSpring = (): ChestSpring => ({ pos: [0, 0], vel: [0, 0], anchor: null, offset: [0, 0] })

/**
 * 胸の重心（pos）を、体の層の胸の位置（anchor）へばねで追従させる。返す offset は「体の動きに対する遅れ」で、
 * 体が止まれば減衰して 0 に戻る。無効のとき・初回・大きな dt（タブ復帰など）は、遅れを持ち越さず anchor へそろえる。
 */
export function stepChest(s: ChestSpring, anchor: Vec, dt: number, enabled: boolean): [number, number] {
  if (enabled && s.anchor && !(dt > 0)) return s.offset // 同じ時刻の描画（dt = 0）は状態を変えない
  if (!enabled || !s.anchor || dt > 0.5) { s.pos = [anchor[0], anchor[1]]; s.vel = [0, 0]; s.anchor = [anchor[0], anchor[1]]; s.offset = [0, 0]; return s.offset }
  const w = 2 * Math.PI * SPRING.hz, c = 2 * SPRING.damping * w
  // 描画の間隔が長いときも発散しないよう、細かく刻んで積分する。
  const steps = Math.max(1, Math.ceil(dt / SPRING.maxDt)), h = dt / steps, from = s.anchor
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, ax = from[0] + (anchor[0] - from[0]) * t, ay = from[1] + (anchor[1] - from[1]) * t
    for (let k = 0; k < 2; k++) {
      const a = k ? ay : ax, acc = -w * w * ((s.pos[k] as number) - a) - c * (s.vel[k] as number)
      s.vel[k] = (s.vel[k] as number) + acc * h; s.pos[k] = (s.pos[k] as number) + (s.vel[k] as number) * h
    }
  }
  s.anchor = [anchor[0], anchor[1]]
  const lx = s.pos[0] - anchor[0], ly = s.pos[1] - anchor[1], lag = Math.hypot(lx, ly), q = lag > SPRING.quiet ? (lag - SPRING.quiet) / lag : 0
  const ox = lx * q * SPRING.gain, oy = ly * q * SPRING.gainY, len = Math.hypot(ox, oy), k = len > 1e-9 ? SPRING.max * Math.tanh(len / SPRING.max) / len : 0 // 上限へなめらかに近づける（張り付いて平らにならない）
  s.offset = [ox * k, oy * k]
  return s.offset
}

/** 三角形 abc の中の点 p の重心座標。外なら null。 */
export function barycentric(p: Vec, a: Vec, b: Vec, c: Vec): [number, number, number] | null {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(d) < 1e-9) return null
  const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d, v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d, w = 1 - u - v
  const e = -1e-6
  return u >= e && v >= e && w >= e ? [u, v, w] : null
}

export type Bind = { tri: [number, number, number]; bary: [number, number, number] } | null
/** 点を、体の層のどの三角形のどこにあるかで表す（体の層が動いても同じ絵の位置に付いていく）。 */
export function bindPoint(p: Vec, vertices: ArrayLike<number>, indices: ArrayLike<number>): Bind {
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri: [number, number, number] = [indices[i] as number, indices[i + 1] as number, indices[i + 2] as number]
    const at = (n: number): Vec => [vertices[2 * n] as number, vertices[2 * n + 1] as number]
    const bary = barycentric(p, at(tri[0]), at(tri[1]), at(tri[2]))
    if (bary) return { tri, bary }
  }
  return null
}
export const atBind = (b: NonNullable<Bind>, data: ArrayLike<number>, k: 0 | 1): number => b.bary[0] * (data[2 * b.tri[0] + k] as number) + b.bary[1] * (data[2 * b.tri[1] + k] as number) + b.bary[2] * (data[2 * b.tri[2] + k] as number)

/** 格子の点（モデル座標）と三角形。体の層の外にかかる点を含む三角形は描かない。 */
export function chestGrid(vertices: ArrayLike<number>, indices: ArrayLike<number>): { points: Vec[]; binds: Bind[]; weights: number[]; triangles: number[] } {
  const { x0, y0, x1, y1, cols, rows } = CHEST_BOX, points: Vec[] = []
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) points.push([x0 + (x1 - x0) * c / cols, y0 + (y1 - y0) * r / rows])
  const binds = points.map(p => bindPoint(p, vertices, indices)), weights = points.map(p => chestWeight(p[0], p[1])), triangles: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1
    for (const t of [[a, b, e], [a, e, d]]) if (t.every(n => binds[n])) triangles.push(...t)
  }
  return { points, binds, weights, triangles }
}
