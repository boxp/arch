// BOXP-525 TD-01: 左右を向いた時（体の傾きを含む）の、肩より下の長い髪の段ズレを直す。
// v11r では肩より下の長い髪の大部分が、袖 (ArtMeshHandwearL2/R2) と体 (ArtMeshTopwear) の絵に描き込まれており、
// 後ろ髪の層 (ArtMeshBackHair) は外側の輪郭と四角い塗りだけを持つ。頂点の実測では頭の左右 +14° で、後ろ髪は
// 上端 +4.8・肩の高さで +1.6・下側で -1.6 動くのに袖と体は 0、体の傾き +4° でも後ろ髪の下側だけ袖より 8〜12 多く動く。
// このため描き込まれた髪と後ろ髪の輪郭・四角い塗りの縁が水平/垂直の段として見える。
// 後ろ髪の頂点のうち肩より下は、読み込み時の姿勢で重なる（または最も近い）袖・体の三角形に結び付け、毎フレーム
// その三角形と同じだけ動かす。肩の上は元の変形のまま（頭の向きに付いていく）で、間はなめらかにつなぐ。
type Vec = readonly [number, number]

export const BACK_HAIR = 31
/** 結び付け先。描画で上にあるもの（袖）を先に探す。 */
export const ANCHORS = [22, 23, 26] as const
/** 読み込み時の姿勢のモデル座標 y。KEEP_Y より上は元の変形、FOLLOW_Y より下は結び付け先と同じ動き。 */
export const KEEP_Y = 395,
  FOLLOW_Y = 445

export const followWeight = (y: number): number => {
  const t = Math.min(1, Math.max(0, (y - KEEP_Y) / (FOLLOW_Y - KEEP_Y)))
  return t * t * (3 - 2 * t)
}

export type HairBind = { mesh: number; tri: [number, number, number]; bary: [number, number, number] }

/** 三角形 abc 上で p に最も近い点の重心座標（中なら p そのもの）と距離の二乗。 */
export function closestBary(p: Vec, a: Vec, b: Vec, c: Vec): { bary: [number, number, number]; d2: number } {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(d) > 1e-9) {
    const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d,
      v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d,
      w = 1 - u - v
    if (u >= 0 && v >= 0 && w >= 0) return { bary: [u, v, w], d2: 0 }
  }
  // 外なら 3 辺への最近点のうち最も近いもの。
  let best = { bary: [1, 0, 0] as [number, number, number], d2: Number.POSITIVE_INFINITY }
  const edges: [Vec, Vec, (t: number) => [number, number, number]][] = [
    [a, b, (t) => [1 - t, t, 0]],
    [b, c, (t) => [0, 1 - t, t]],
    [c, a, (t) => [t, 0, 1 - t]],
  ]
  for (const [s, e, bary] of edges) {
    const ex = e[0] - s[0],
      ey = e[1] - s[1],
      l2 = ex * ex + ey * ey
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - s[0]) * ex + (p[1] - s[1]) * ey) / l2)) : 0
    const qx = s[0] + ex * t - p[0],
      qy = s[1] + ey * t - p[1],
      d2 = qx * qx + qy * qy
    if (d2 < best.d2) best = { bary: bary(t), d2 }
  }
  return best
}

export type AnchorMesh = { mesh: number; vertices: ArrayLike<number>; indices: ArrayLike<number> }

/** 点を、重なる結び付け先の三角形（先に並ぶ層を優先）、無ければ全体で最も近い三角形の最近点に結び付ける。 */
export function bindHairPoint(p: Vec, anchors: readonly AnchorMesh[]): HairBind | null {
  let near: (HairBind & { d2: number }) | null = null
  for (const a of anchors) {
    const at = (n: number): Vec => [a.vertices[2 * n] as number, a.vertices[2 * n + 1] as number]
    for (let i = 0; i + 2 < a.indices.length; i += 3) {
      const tri: [number, number, number] = [
        a.indices[i] as number,
        a.indices[i + 1] as number,
        a.indices[i + 2] as number,
      ]
      const r = closestBary(p, at(tri[0]), at(tri[1]), at(tri[2]))
      if (r.d2 === 0) return { mesh: a.mesh, tri, bary: r.bary }
      if (!near || r.d2 < near.d2) near = { mesh: a.mesh, tri, bary: r.bary, d2: r.d2 }
    }
  }
  return near && { mesh: near.mesh, tri: near.tri, bary: near.bary }
}

const atBind = (b: HairBind, data: ArrayLike<number>, k: 0 | 1): number =>
  b.bary[0] * (data[2 * b.tri[0] + k] as number) +
  b.bary[1] * (data[2 * b.tri[1] + k] as number) +
  b.bary[2] * (data[2 * b.tri[2] + k] as number)

export type BackHairRig = {
  rest: Float32Array
  anchorRest: Map<number, Float32Array>
  binds: (HairBind | null)[]
  weights: number[]
}

/** 読み込み時の姿勢から結び付けを作る。weight が 0 の頂点は結び付けない。 */
export function bindBackHair(rest: ArrayLike<number>, anchors: readonly AnchorMesh[]): BackHairRig {
  const n = rest.length / 2,
    binds: (HairBind | null)[] = [],
    weights: number[] = []
  for (let i = 0; i < n; i++) {
    const p: Vec = [rest[2 * i] as number, rest[2 * i + 1] as number],
      w = followWeight(p[1])
    weights.push(w)
    binds.push(w > 0 ? bindHairPoint(p, anchors) : null)
  }
  return {
    rest: Float32Array.from(rest),
    anchorRest: new Map(anchors.map((a) => [a.mesh, Float32Array.from(a.vertices)])),
    binds,
    weights,
  }
}

/**
 * 後ろ髪の今の頂点 v（その場で書き換える）を、肩より下は結び付け先の三角形の動き（読み込み時からの差）に合わせる。
 * 髪の揺れ（物理）による元の動きは肩の上では残り、下では結び付け先の動きに置き換わる。
 */
export function followAnchors(
  v: Float32Array,
  rig: BackHairRig,
  anchorNow: (mesh: number) => ArrayLike<number> | undefined,
): number {
  let moved = 0
  rig.binds.forEach((b, i) => {
    const w = rig.weights[i] as number
    if (!b || !(w > 0)) return
    const now = anchorNow(b.mesh),
      rest = rig.anchorRest.get(b.mesh)
    if (!now || !rest) return
    for (const k of [0, 1] as const) {
      const target = (rig.rest[2 * i + k] as number) + atBind(b, now, k) - atBind(b, rest, k),
        cur = v[2 * i + k] as number
      v[2 * i + k] = cur + (target - cur) * w
    }
    moved++
  })
  return moved
}
