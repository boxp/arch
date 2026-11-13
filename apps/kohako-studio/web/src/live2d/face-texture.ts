// BOXP-476 TD-04: v11r の焼き込みを、比較版の実行時だけアトラス上で組み替える（モデルファイルと通常表示は変えない）。
// 実描画の層別切分けで確定した原因:
// - 眉: 動く眉の層 (mesh 1) を動かすと、顔の層 (mesh 18) に焼き込まれた同じ眉が残り二重になる。mesh 1 には前髪の断片も混ざる。
// - 瞳: 虹彩の輪郭線がまつ毛の層に、虹彩の下部の色と輪郭の抜きが白目の層に、上まぶたの影が虹彩の層にある。視線を動かすと別々に動く。
// 座標はモデル座標（1143x2048）。層ごとの頂点と UV から最小二乗でアトラスへの変換を作る。
export type Rgba = [number, number, number, number]
type Arc = readonly (readonly [number, number])[]
export type EyeSpec = { lash: number; iris: number; white: number; top: number; bottom: number; strip: number; left: Arc; right: Arc }

export const EYE_SPECS: readonly EyeSpec[] = [
  { lash: 13, iris: 14, white: 15, top: 279, bottom: 297.5, strip: 275,
    left: [[279, 510], [282, 509.8], [284, 509.8], [286, 510.2], [288, 510.8], [290, 511.5], [292, 512.2], [294, 513.2], [296, 514.5], [298, 516]],
    right: [[279, 538.5], [282, 539], [284, 538.8], [286, 538.8], [288, 538.5], [290, 538], [292, 537.5], [294, 536.2], [296, 535], [298, 532]] },
  { lash: 10, iris: 11, white: 12, top: 280, bottom: 299.5, strip: 278,
    left: [[280, 610.2], [282, 610.5], [284, 610.5], [286, 610.3], [288, 610.5], [290, 610.8], [292, 611.2], [294, 612], [296, 613], [298, 614], [300, 615.5]],
    right: [[280, 638.5], [282, 639], [284, 639.2], [286, 639.2], [288, 639.2], [290, 638.8], [292, 638], [294, 637.2], [296, 636.2], [298, 635], [300, 633]] },
]
const RING = 1.7
/** 白目の層で元の虹彩の輪郭が残る帯の幅。弧から外へ見て、この範囲は色味によらず周囲の白目で埋める。 */
const WHITE_BAND = 6
/** 弧のそばで「輪郭の抜き」とみなす距離。これより遠い透明は元の白目の外なので埋めない。 */
const RING_HOLE = 3
/** まつ毛の層で輪郭線の淡い縁も消す距離。 */
const RING_FRINGE = 3
const WHITE: Rgba = [255, 255, 255, 255]
export const BROW_MESH = 1
export const FACE_MESH = 18
export const BANGS_MESH = 0
const BROW_BOX = { x0: 505, y0: 234, x1: 650, y1: 260 }
/** 左の眉の内端だけが前髪の層にも焼き込まれている範囲。 */
const BANGS_BROW_BOX = { x0: 546, y0: 243, x1: 560, y1: 254 }
/** 眉の層に混ざった髪の断片（線に接しているので色では分けられない）。 */
const BROW_FRAGMENTS = [{ x0: 601, y0: 247, x1: 607, y1: 253 }] as const
const SCLERA: Rgba = [246, 246, 250, 255]
/** ハイライトの穴とみなす閉路の大きさの上限（モデル座標）。最大の穴は幅約 3、別の島の縁は幅 40 以上。 */
const HIGHLIGHT_MAX = 8
const STRAND_LUMA = 30, EDGE_LUMA = 60, EDGE_REACH = 12

export function arcX(arc: Arc, y: number): number {
  const first = arc[0] as readonly [number, number], last = arc[arc.length - 1] as readonly [number, number]
  if (y <= first[0]) return first[1]
  for (let i = 1; i < arc.length; i++) {
    const a = arc[i - 1] as readonly [number, number], b = arc[i] as readonly [number, number]
    if (y <= b[0]) return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0])
  }
  return last[1]
}
/** 事前乗算の over 合成（top を bottom の上に）。 */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const k = 1 - top[3] / 255
  return [top[0] + bottom[0] * k, top[1] + bottom[1] * k, top[2] + bottom[2] * k, top[3] + bottom[3] * k]
}
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
/** 事前乗算を戻した輝度。透明は 255 扱い。 */
export function luma(p: Rgba): number { return p[3] < 8 ? 255 : (p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11) * 255 / p[3] }

/** 両頬の中心から縁まで連続して薄くなる赤み。 */
export function blushWeight(x: number, y: number): number {
  const d = Math.min(...[514, 630].map(cx => ((x - cx) / 28) ** 2 + ((y - 319) / 13) ** 2))
  return d >= 1 ? 0 : (1 - d) ** 1.5 * 0.55
}

/** 虹彩下部の控えめな潤み。 */
export function tearWeight(x: number, y: number, cx: number, cy: number): number {
  const d = ((x - cx) / 2.3) ** 2 + ((y - cy) / 1.1) ** 2
  return d >= 1 ? 0 : (1 - d) * 0.65
}

/** 点対 (x,y)→(u,v) の最小二乗アフィン。 */
export function fitAffine(points: readonly (readonly [number, number, number, number])[]): { forward(x: number, y: number): [number, number]; inverse(u: number, v: number): [number, number] } {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0, sxu = 0, syu = 0, su = 0, sxv = 0, syv = 0, sv = 0
  for (const [x, y, u, v] of points) { sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; n++; sxu += x * u; syu += y * u; su += u; sxv += x * v; syv += y * v; sv += v }
  const d = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx)
  if (!d) throw new Error('アフィンを解けません')
  const solve = (a: number, b: number, c: number) => [
    (a * (syy * n - sy * sy) - sxy * (b * n - c * sy) + sx * (b * sy - c * syy)) / d,
    (sxx * (b * n - c * sy) - a * (sxy * n - sy * sx) + sx * (sxy * c - b * sx)) / d,
    (sxx * (syy * c - b * sy) - sxy * (sxy * c - b * sx) + a * (sxy * sy - syy * sx)) / d,
  ] as const
  const [ax, ay, ac] = solve(sxu, syu, su), [bx, by, bc] = solve(sxv, syv, sv)
  const det = ax * by - ay * bx
  return { forward: (x, y) => [ax * x + ay * y + ac, bx * x + by * y + bc], inverse: (u, v) => [(by * (u - ac) - ay * (v - bc)) / det, (ax * (v - bc) - bx * (u - ac)) / det] }
}

export type Atlas = { width: number; height: number; get(x: number, y: number): Rgba; set(x: number, y: number, p: Rgba): void }
export type Layer = { forward(x: number, y: number): [number, number]; inverse(u: number, v: number): [number, number] }
/** 元のアトラスの見え方を読むための層別の参照。 */
function sampler(source: Atlas, layer: Layer) { return (x: number, y: number): Rgba => { const [u, v] = layer.forward(x, y); return source.get(Math.round(u), Math.round(v)) } }
function eachTexel(atlas: Atlas, layer: Layer, box: { x0: number; y0: number; x1: number; y1: number }, fn: (tx: number, ty: number, x: number, y: number) => void) {
  const corners = [layer.forward(box.x0, box.y0), layer.forward(box.x1, box.y0), layer.forward(box.x0, box.y1), layer.forward(box.x1, box.y1)]
  const u0 = Math.floor(Math.min(...corners.map(c => c[0]))), u1 = Math.ceil(Math.max(...corners.map(c => c[0]))), v0 = Math.floor(Math.min(...corners.map(c => c[1]))), v1 = Math.ceil(Math.max(...corners.map(c => c[1])))
  for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
    if (u < 0 || v < 0 || u >= atlas.width || v >= atlas.height) continue
    const [x, y] = layer.inverse(u, v)
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) fn(u, v, x, y)
  }
}

/** 三角形列の境界の辺をつないで閉路に分ける。 */
export function boundaryLoops(indices: ArrayLike<number>): number[][] {
  const edges = new Map<string, [number, number, number]>()
  for (let i = 0; i + 2 < indices.length; i += 3) for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]] as [number, number][]) {
    const key = a < b ? `${a},${b}` : `${b},${a}`, e = edges.get(key); if (e) e[2]++; else edges.set(key, [a, b, 1])
  }
  const next = new Map<number, number[]>()
  for (const [a, b, n] of edges.values()) if (n === 1) { next.set(a, [...(next.get(a) ?? []), b]); next.set(b, [...(next.get(b) ?? []), a]) }
  const seen = new Set<number>(), loops: number[][] = []
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    for (let at: number | undefined = start; at !== undefined && !seen.has(at); at = (next.get(at) as number[]).find(n => !seen.has(n))) { seen.add(at); loop.push(at) }
    loops.push(loop)
  }
  return loops
}
/** 虹彩のハイライトはメッシュの穴で、白目の層が透けて見える。小さな閉路だけを穴として三角形でふさぐ（輪郭や別の島は大きいので対象外）。 */
export function highlightHoles(indices: ArrayLike<number>, at: (n: number) => readonly [number, number], maxSize: number): number[][] {
  return boundaryLoops(indices).filter(loop => {
    if (loop.length < 3) return false
    const xs = loop.map(n => at(n)[0]), ys = loop.map(n => at(n)[1])
    return Math.max(...xs) - Math.min(...xs) <= maxSize && Math.max(...ys) - Math.min(...ys) <= maxSize
  })
}
/** 白目のメッシュには元の輪郭の位置に三角形の無い細い切れ目がある（虹彩は白目をマスクに描くので、そこで虹彩も切れる）。弧のそばで向かい合う境界の辺どうしを三角形でつなぐ。 */
export function stitchSlit(indices: ArrayLike<number>, at: (n: number) => readonly [number, number], arc: Arc, top: number, bottom: number, reach = 3, gap = 2.5): number[] {
  const count = new Map<string, [number, number, number]>()
  const edge = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`, e = count.get(k); if (e) e[2]++; else count.set(k, [a, b, 1]) }
  for (let i = 0; i + 2 < indices.length; i += 3) { const a = indices[i] as number, b = indices[i + 1] as number, c = indices[i + 2] as number; edge(a, b); edge(b, c); edge(c, a) }
  // 上下に伸びる境界の辺のうち、両端が弧のそばのものだけを切れ目の岸の候補にする。
  const banks = [...count.values()].filter(([a, b, n]) => {
    if (n !== 1) return false
    const [ax, ay] = at(a), [bx, by] = at(b)
    return Math.abs(by - ay) >= 2 && Math.max(ay, by) >= top && Math.min(ay, by) <= bottom && Math.abs(ax - arcX(arc, ay)) <= reach && Math.abs(bx - arcX(arc, by)) <= reach
  }).map(([a, b]) => (at(a)[1] <= at(b)[1] ? [a, b] : [b, a]) as [number, number])
  const xAt = ([a, b]: [number, number], y: number) => { const [ax, ay] = at(a), [bx, by] = at(b); return ax + (bx - ax) * (y - ay) / (by - ay) }
  const out: number[] = []
  for (let i = 0; i < banks.length; i++) for (let j = i + 1; j < banks.length; j++) {
    const p = banks[i] as [number, number], q = banks[j] as [number, number]
    const low = Math.max(at(p[0])[1], at(q[0])[1]), high = Math.min(at(p[1])[1], at(q[1])[1])
    if (high - low < 2 || p.some(n => q.includes(n))) continue
    if (Math.abs(xAt(p, (low + high) / 2) - xAt(q, (low + high) / 2)) > gap) continue
    out.push(p[0], q[0], p[1], p[1], q[0], q[1])
  }
  return out
}
export function capLoops(loops: number[][]): number[] { return loops.flatMap(l => l.slice(1, -1).flatMap((n, i) => [l[0] as number, n, l[i + 2] as number])) }
/** 穴の多角形の中を白にし、すぐ外の半透明の縁も白へなじませる（座標はアトラスの画素）。 */
export function paintHighlight(source: Atlas, target: Atlas, polygon: readonly (readonly [number, number])[]): number {
  const inPolygon = (x: number, y: number) => { let c = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [xi, yi] = polygon[i] as readonly [number, number], [xj, yj] = polygon[j] as readonly [number, number]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c } return c }
  const us = polygon.map(p => p[0]), vs = polygon.map(p => p[1])
  let painted = 0
  for (let v = Math.floor(Math.min(...vs)) - 2; v <= Math.ceil(Math.max(...vs)) + 2; v++) for (let u = Math.floor(Math.min(...us)) - 2; u <= Math.ceil(Math.max(...us)) + 2; u++) {
    if (inPolygon(u + 0.5, v + 0.5)) { target.set(u, v, WHITE); painted++; continue }
    const own = source.get(u, v), near = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([du, dv]) => inPolygon(u + 0.5 + (du as number), v + 0.5 + (dv as number)))
    if (near && own[3] < 200) { target.set(u, v, over(own, WHITE)); painted++ }
  }
  return painted
}

/** 1 つの目: 輪郭線と下部の色を虹彩へ、上まぶたの影をまつ毛へ移し、白目の抜きを埋める。 */
export function rebakeEye(source: Atlas, target: Atlas, spec: EyeSpec, lash: Layer, iris: Layer, white: Layer): { ring: number; filled: number; strip: number } {
  const readLash = sampler(source, lash), readIris = sampler(source, iris), readWhite = sampler(source, white)
  const count = { ring: 0, filled: 0, strip: 0 }
  const box = { x0: Math.min(arcX(spec.left, spec.top), arcX(spec.left, spec.bottom)) - 5, y0: spec.top - 8, x1: Math.max(arcX(spec.right, spec.top), arcX(spec.right, spec.bottom)) + 5, y1: spec.bottom + 1 }
  const onRing = (x: number, y: number) => y >= spec.top && y <= spec.bottom && (Math.abs(x - arcX(spec.left, y)) <= RING || Math.abs(x - arcX(spec.right, y)) <= RING)
  const nearRing = (x: number, y: number) => y >= spec.top && y <= spec.bottom - 1.5 && Math.min(Math.abs(x - arcX(spec.left, y)), Math.abs(x - arcX(spec.right, y))) <= RING_FRINGE
  const inside = (x: number, y: number) => y >= spec.top && y <= spec.bottom && x >= arcX(spec.left, y) && x <= arcX(spec.right, y)
  // 輪郭線がまつ毛の尾と続いている行は消さない（消すと尾が欠けて、隠れていた白目の角が四角く出る）。行は外側の不透明さで判定する。
  const joinsLash = (x: number, y: number) => { const left = Math.abs(x - arcX(spec.left, y)) <= Math.abs(x - arcX(spec.right, y)), edge = left ? arcX(spec.left, y) : arcX(spec.right, y), out = left ? -1 : 1; return [2, 2.5, 3].some(d => readLash(edge + out * d, y)[3] >= 200) }
  eachTexel(target, lash, box, (u, v, x, y) => { const alpha = source.get(u, v)[3]; if (alpha > 0 && (onRing(x, y) || (alpha < 200 && nearRing(x, y))) && !joinsLash(x, y)) { target.set(u, v, [0, 0, 0, 0]); count.ring++ } })
  // 帯の外側を読むので、白目の処理範囲は帯の外縁まで含める（box のままだと外縁に元の輪郭が残る）。
  eachTexel(target, white, { ...box, x0: box.x0 - WHITE_BAND - 3, x1: box.x1 + WHITE_BAND + 3 }, (u, v, x, y) => {
    if (y < spec.strip + 1 || y > spec.bottom || x < arcX(spec.left, y) - WHITE_BAND || x > arcX(spec.right, y) + WHITE_BAND) return
    // 輪郭線の抜きの上端（まつ毛の陰）は側方が見えないので白目色で埋める。
    if (y < spec.top && source.get(u, v)[3] < 128 && Math.min(Math.abs(x - arcX(spec.left, y)), Math.abs(x - arcX(spec.right, y))) <= 3) { target.set(u, v, SCLERA); count.filled++; return }
    // 白目の元の色（ハイライトの下の白や上の淡い影）は残し、抜きと虹彩下部の青い焼き込みだけを埋める。
    const original = source.get(u, v)
    const arcDistance = Math.min(Math.abs(x - arcX(spec.left, y)), Math.abs(x - arcX(spec.right, y)))
    // 元の白目の形の外は透明のまま（埋めるとまぶたの外へはみ出す）。
    if (original[3] < 128 && arcDistance > RING_HOLE && !inside(x, y)) return
    // 虹彩の内側は視線を動かしたときだけ見える面なので、段差が出ないよう左右の白目で通して埋める。
    const inBand = y >= spec.top && (arcDistance <= WHITE_BAND || inside(x, y))
    if (!inBand && original[3] >= 200 && (original[2] - original[0]) * 255 / original[3] <= 12) return
    // 目尻側はシルエットが内へ入るので、外から弧へ向かって最初に不透明な白目の色を取る。
    const sideColor = (edge: number, step: number): Rgba => { for (let d = WHITE_BAND + 2; d >= RING_HOLE + 0.5; d -= 0.5) { const p = readWhite(edge + step * d, y); if (p[3] >= 200) return p } return [0, 0, 0, 0] }
    const a = sideColor(arcX(spec.left, y), -1), b = sideColor(arcX(spec.right, y), 1)
    if (a[3] < 200 && b[3] < 200) return
    const t = (x - arcX(spec.left, y) + WHITE_BAND) / (arcX(spec.right, y) - arcX(spec.left, y) + WHITE_BAND * 2)
    target.set(u, v, mix(a[3] < 200 ? SCLERA : a, b[3] < 200 ? SCLERA : b, t)); count.filled++
  })
  eachTexel(target, iris, box, (u, v, x, y) => {
    const ring = onRing(x, y) && !joinsLash(x, y) ? readLash(x, y) : null
    if (inside(x, y)) {
      const own = readIris(x, y)
      // ハイライトは虹彩のメッシュの穴なので触らない。虹彩の上の角も透明のまま、下部の抜きだけ白目の色で埋める。
      if (own[3] < 128 && y < spec.top + 5 && Math.min(x - arcX(spec.left, y), arcX(spec.right, y) - x) < 4 && !ring) return
      // 虹彩上端より上は縁色、内側のハイライトの穴は白で埋める。
      let background = readWhite(x, y)
      if (own[3] < 128 && y < (spec.top + spec.bottom) / 2) {
        let above = false, top: Rgba | null = null
        for (let yy = spec.top; yy <= spec.bottom; yy += 0.5) {
          if (!inside(x, yy)) continue
          const pixel = readIris(x, yy)
          if (pixel[3] >= 128) { if (!top) top = pixel; if (yy < y) above = true }
        }
        background = above ? WHITE : top ?? background
      }
      let body = over(own, background)
      if (body[3] < 200) body = over(body, [255, 255, 255, 255])
      target.set(u, v, ring ? over(ring, body) : body)
    } else if (ring && ring[3] > 0 && (y >= spec.top + 3 || readIris(x, y)[3] >= 128)) target.set(u, v, over(ring, readIris(x, y)))
  })
  // 虹彩の外側に残る上まぶたの影は動かないので、まつ毛の層へ移す。
  const outsideArcs = (x: number, y: number) => x < arcX(spec.left, y) - RING || x > arcX(spec.right, y) + RING
  const stripBox = { x0: box.x0 - 16, y0: spec.strip - 10, x1: box.x1 + 8, y1: spec.bottom }
  eachTexel(target, iris, stripBox, (u, v, x, y) => { if (outsideArcs(x, y) && source.get(u, v)[3] > 0) target.set(u, v, [0, 0, 0, 0]) })
  eachTexel(target, lash, stripBox, (u, v, x, y) => {
    if (!outsideArcs(x, y)) return
    const s = readIris(x, y); if (s[3] === 0) return
    if (readWhite(x, y)[3] < 128) return // 虹彩の層と同じ白目のマスク（しきい値 0.5）
    target.set(u, v, over(source.get(u, v), s)); count.strip++
  })
  return count
}

/** まつ毛の上下の線の間にある細い隙間の最大の高さ（アトラスの画素）。実測で 6〜7。白目との間は 9 以上。 */
export const LASH_SLOT_MAX = 7
const LASH_SOLID = 200, LASH_INK = 110, LASH_BODY = 100
/** 二重まぶたの線は 1〜2 画素と細いので、上側は 3 画素以上の太い線に限る。 */
const LASH_THICK_UP = 3, LASH_THICK_DOWN = 2
/**
 * BOXP-525: 太いまつ毛の帯は上下 2 本の線の間が透明（または薄い）になっている。待機時はその下に虹彩上端の暗い影があるので黒く見えるが、
 * 下を見ると虹彩が下がって白目が透け、まつ毛が白く見える。上下を濃い線に挟まれた隙間だけを、挟む線の色で不透明に塗る。
 */
export function fillLashSlots(target: Atlas, spec: EyeSpec, lash: Layer, maxGap = LASH_SLOT_MAX): number {
  const box = { x0: arcX(spec.left, spec.top) - 22, y0: spec.top - 16, x1: arcX(spec.right, spec.top) + 10, y1: spec.top + 2 }
  const ink = (p: Rgba) => p[3] >= LASH_SOLID && luma(p) < LASH_INK
  const writes: [number, number, Rgba][] = []
  eachTexel(target, lash, box, (u, v) => {
    const own = target.get(u, v)
    if (own[3] >= LASH_SOLID) return
    let up = 0, down = 0
    for (let d = 1; d <= maxGap && !up; d++) if (ink(target.get(u, v - d))) up = d
    for (let d = 1; d <= maxGap && !down; d++) if (ink(target.get(u, v + d))) down = d
    if (!up || !down || up + down - 1 > maxGap) return
    const thick = (from: number, step: number) => { let n = 0; while (n < 8 && target.get(u, from + step * n)[3] >= LASH_BODY) n++; return n }
    if (thick(v - up, -1) < LASH_THICK_UP || thick(v + down, 1) < LASH_THICK_DOWN) return
    const a = target.get(u, v - up), b = target.get(u, v + down)
    const solid: Rgba = [0, 1, 2].map(k => ((a[k] as number) * 255 / a[3] + (b[k] as number) * 255 / b[3]) / 2) as unknown as Rgba
    solid[3] = 255
    writes.push([u, v, over(own, solid)])
  })
  // 列ごとの判定から 1〜2 列だけ漏れた隙間は、左右の塗った画素の平均でつなぐ。
  const done = new Map(writes.map(([u, v, p]) => [`${u},${v}`, p]))
  for (const [u, v, left] of [...writes]) {
    const k = [2, 3].find(k => done.has(`${u + k},${v}`) && ![...Array(k - 1)].some((_, i) => done.has(`${u + 1 + i},${v}`)))
    if (!k) continue
    const right = done.get(`${u + k},${v}`) as Rgba
    for (let i = 1; i < k; i++) {
      const gap = target.get(u + i, v)
      if (gap[3] >= LASH_SOLID) break
      const p = over(gap, mix(left, right, i / k)); writes.push([u + i, v, p]); done.set(`${u + i},${v}`, p)
    }
  }
  for (const [u, v, p] of writes) target.set(u, v, p)
  return writes.length
}

/** 顔の中心から輪郭を越えた肌だけを透明にする（RGB も 0 にするので線形補間で白い縁は出ない）。 */
export function eraseJawRow(pixels: Rgba[], center: number, start: number, end: number, modelY: number): number[] {
  if (modelY < 305 || modelY > 390) return []
  const step = end < start ? -1 : 1
  let edge = -1
  for (let i = start; step * (i - end) <= 0; i += step) {
    const p = pixels[i]
    if (p && p[3] >= 128 && luma(p) < 90) { edge = i; break }
  }
  if (edge < 0 || step * (edge - center) <= 0) return []
  const erased: number[] = []
  for (let i = edge + step; step * (i - end) <= 0; i += step) {
    const p = pixels[i]
    if (!p || p[3] < 128 || luma(p) <= 140 || p[0] < p[1] || p[1] < p[2]) continue
    erased.push(i)
  }
  return erased
}

/** 行 y で x から最も近い明暗の切り替わり（なければ null）。 */
function edgeNear(read: (x: number, y: number) => Rgba, x: number, y: number, threshold: number): number | null {
  const side = luma(read(x, y)) >= threshold
  for (let d = 0.5; d <= EDGE_REACH; d += 0.5) for (const at of [x - d, x + d]) if ((luma(read(at, y)) >= threshold) !== side) return at
  return null
}
/** 眉の下の画素が、上の行の色と同じ側か（髪の縁が斜めに眉を横切る場合）。縁が見つからなければ中点で分ける。 */
function sameSideAsUp(read: (x: number, y: number) => Rgba, x: number, up: number, down: number, t: number, threshold: number): boolean {
  const a = edgeNear(read, x, up, threshold), b = edgeNear(read, x, down, threshold)
  if (a === null || b === null) return t < 0.5
  return (x >= a + (b - a) * t) === (x >= a)
}

/** 眉: 眉の層から前髪の断片を除き、顔の層に焼き込まれた眉を上下の肌で埋める。 */
export function rebakeBrows(source: Atlas, target: Atlas, brow: Layer, face: Layer, bangs: Layer = face): { removed: number; erased: number } {
  const readBrow = sampler(source, brow)
  const isInk = (x: number, y: number) => { const p = readBrow(x, y); return p[3] > 32 && luma(p) < 95 }
  // アトラスの解像度に依存しないように 0.5 刻みで近傍を見る。
  const near = (x: number, y: number) => { for (let dx = -1.5; dx <= 1.5; dx += 0.5) for (let dy = -1.5; dy <= 1.5; dy += 0.5) if (isInk(x + dx, y + dy)) return true; return false }
  const result = { removed: 0, erased: 0 }
  const fragment = (x: number, y: number) => BROW_FRAGMENTS.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
  eachTexel(target, brow, BROW_BOX, (u, v, x, y) => { const p = source.get(u, v); if (p[3] > 0 && (!near(x, y) || fragment(x, y))) { target.set(u, v, [0, 0, 0, 0]); result.removed++ } })
  const erase = (layer: Layer, box: typeof BROW_BOX) => { const readFace = sampler(source, layer); eachTexel(target, layer, box, (u, v, x, y) => {
    if (!near(x, y)) return
    let up = y, down = y
    while (near(x, up) && y - up < 12) up -= 0.5
    while (near(x, down) && down - y < 12) down += 0.5
    const a = readFace(x, up), b = readFace(x, down)
    // 眉は前髪の束とも交差する。肌だけでなく髪色でも埋める（上下とも線画の濃さなら、線を消さないよう残す）。
    if (a[3] < 200 || b[3] < 200 || (luma(a) < STRAND_LUMA && luma(b) < STRAND_LUMA)) return
    const t = (y - up) / (down - up)
    // 髪と肌の境目を線形に埋めると淡いにじみになる。上下の行で境界を探し、その間を斜めにつないで髪か肌のどちらかで埋める。
    target.set(u, v, Math.abs(luma(a) - luma(b)) > EDGE_LUMA ? (sameSideAsUp(readFace, x, up, down, t, (luma(a) + luma(b)) / 2) ? a : b) : mix(a, b, t)); result.erased++
  }) }
  erase(face, BROW_BOX)
  if (bangs !== face) erase(bangs, BANGS_BROW_BOX)
  return result
}

type GlPlayer = {
  gl: WebGLRenderingContext; textures: WebGLTexture[]; rig: number
  meshes: { vertices: number; uvs: Float32Array; texture: number; indices: Uint16Array | Uint32Array; indexBuffer: WebGLBuffer }[]
  rt: { memory: WebAssembly.Memory; p2l_mesh_vertices(rig: number, mesh: number): number; p2l_alloc(n: number): number; p2l_dealloc(p: number, n: number): void; p2l_texture_png(rig: number, i: number, a: number, b: number, c: number): number }
}
function atlasSize(p: GlPlayer): [number, number] {
  const out = p.rt.p2l_alloc(16)
  try {
    const pointer = p.rt.p2l_texture_png(p.rig, 0, out, out + 8, out + 12)
    const header = new DataView(p.rt.memory.buffer, pointer + 16, 8)
    return [header.getUint32(0), header.getUint32(4)]
  } finally { p.rt.p2l_dealloc(out, 16) }
}
function layerOf(p: GlPlayer, mesh: number, width: number, height: number): Layer {
  const info = p.meshes[mesh] as GlPlayer['meshes'][number]
  const v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, mesh), info.vertices * 2)
  const points: [number, number, number, number][] = []
  for (let i = 0; i < info.vertices; i++) points.push([v[2 * i] as number, v[2 * i + 1] as number, (info.uvs[2 * i] as number) * width, (info.uvs[2 * i + 1] as number) * height])
  return fitAffine(points)
}
/** 比較版の読み込み時に一度だけ呼ぶ。失敗しても描画は元のまま続く。 */
export function patchFaceTexture(p: GlPlayer): Record<string, unknown> {
  const gl = p.gl, [width, height] = atlasSize(p)
  const layers = new Map<number, Layer>()
  for (const m of [BROW_MESH, FACE_MESH, BANGS_MESH, ...EYE_SPECS.flatMap(s => [s.lash, s.iris, s.white])]) layers.set(m, layerOf(p, m, width, height))
  const of = (m: number) => layers.get(m) as Layer
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.textures[0] as WebGLTexture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    // 必要な矩形だけ読む（顔の周りのみ）。
    const models = [{ x: 480, y: 200 }, { x: 700, y: 405 }]
    const span = [...layers.values()].flatMap(l => models.map(m => l.forward(m.x, m.y)))
    const x0 = Math.max(0, Math.floor(Math.min(...span.map(s => s[0]))) - 8), y0 = Math.max(0, Math.floor(Math.min(...span.map(s => s[1]))) - 8)
    const x1 = Math.min(width, Math.ceil(Math.max(...span.map(s => s[0]))) + 8), y1 = Math.min(height, Math.ceil(Math.max(...span.map(s => s[1]))) + 8)
    const w = x1 - x0, h = y1 - y0, original = new Uint8Array(w * h * 4)
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, original)
    const output = original.slice()
    const view = (data: Uint8Array): Atlas => ({ width, height,
      get(x, y) { if (x < x0 || y < y0 || x >= x1 || y >= y1) return [0, 0, 0, 0]; const i = ((y - y0) * w + (x - x0)) * 4; return [data[i] as number, data[i + 1] as number, data[i + 2] as number, data[i + 3] as number] },
      set(x, y, q) { if (x < x0 || y < y0 || x >= x1 || y >= y1) return; const i = ((y - y0) * w + (x - x0)) * 4; data[i] = q[0]; data[i + 1] = q[1]; data[i + 2] = q[2]; data[i + 3] = q[3] } })
    const source = view(original), target = view(output)
    const brows = rebakeBrows(source, target, of(BROW_MESH), of(FACE_MESH), of(BANGS_MESH))
    const eyes = EYE_SPECS.map(s => ({ ...rebakeEye(source, target, s, of(s.lash), of(s.iris), of(s.white)), lashSlots: fillLashSlots(target, s, of(s.lash)) }))
    const holes = EYE_SPECS.map(s => {
      const info = p.meshes[s.iris] as GlPlayer['meshes'][number], v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, s.iris), info.vertices * 2)
      const loops = highlightHoles(info.indices, n => [v[2 * n] as number, v[2 * n + 1] as number], HIGHLIGHT_MAX)
      for (const loop of loops) paintHighlight(source, target, loop.map(n => [(info.uvs[2 * n] as number) * width, (info.uvs[2 * n + 1] as number) * height] as const))
      return { iris: s.iris, loops }
    })
    const stitches = EYE_SPECS.map(s => {
      const info = p.meshes[s.white] as GlPlayer['meshes'][number], v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, s.white), info.vertices * 2), at = (n: number) => [v[2 * n] as number, v[2 * n + 1] as number] as const
      return { white: s.white, triangles: [...stitchSlit(info.indices, at, s.left, s.top - 2, s.bottom + 1), ...stitchSlit(info.indices, at, s.right, s.top - 2, s.bottom + 1)] }
    })
    gl.bindTexture(gl.TEXTURE_2D, p.textures[0] as WebGLTexture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    // あご輪郭の外（髪の下の下地）の肌色を透明にする。顔の島の中だけを書き換えるので共有アトラスへ直接書く
    // （他メッシュがこの画素を覆っていても、髪の上に肌色の欠片が出るのを防ぐ方向にしか効かない）。
    const jaw = { left: 0, right: 0 }, jawOffsets: number[] = []
    const face = of(FACE_MESH), centerU = face.forward(572, 350)[0]
    for (let v = y0; v < y1; v++) {
      const [, modelY] = face.inverse(centerU, v)
      if (modelY < 305 || modelY > 390) continue
      const center = Math.round(face.forward(572, modelY)[0]) - x0
      const row = Array.from({ length: w }, (_, x) => target.get(x + x0, v))
      for (const [side, inner, outer] of [['left', 535, 485], ['right', 610, 685]] as const) {
        const start = Math.max(0, Math.min(w - 1, Math.round(face.forward(inner, modelY)[0]) - x0))
        const end = Math.max(0, Math.min(w - 1, Math.round(face.forward(outer, modelY)[0]) - x0))
        for (const x of eraseJawRow(row, center, start, end, modelY)) { jawOffsets.push(((v - y0) * w + x) * 4); jaw[side]++ }
      }
    }
    for (const i of jawOffsets) output.fill(0, i, i + 4)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, output)
    // 顔レイヤーの画素だけを保存し、元の色から毎回合成する。
    const blushPixels: { i: number; weight: number }[] = []
    eachTexel(target, of(FACE_MESH), { x0: 486, y0: 306, x1: 658, y1: 332 }, (u, v, x, y) => {
      const weight = blushWeight(x, y), i = ((v - y0) * w + u - x0) * 4
      if (weight > 0 && i >= 0 && i + 3 < output.length && output[i + 3]! > 200) blushPixels.push({ i, weight })
    })
    const tearPixels: { i: number; weight: number }[] = []
    for (const spec of EYE_SPECS) {
      const cx = (arcX(spec.left, spec.bottom - 3) + arcX(spec.right, spec.bottom - 3)) / 2, cy = spec.bottom - 3
      eachTexel(target, of(spec.iris), { x0: cx - 3, x1: cx + 3, y0: cy - 2, y1: cy + 2 }, (u, v, x, y) => {
        const weight = tearWeight(x, y, cx, cy), i = ((v - y0) * w + u - x0) * 4
        if (weight > 0 && i >= 0 && i + 3 < output.length && output[i + 3]! > 200) tearPixels.push({ i, weight })
      })
    }
    let lastBlush = -1, lastWet = -1
    const setBlush = (amount: number, wet = 0) => {
      const level = Math.round(Math.max(0, Math.min(1, amount)) * 32) / 32
      const wetLevel = Math.round(Math.max(0, Math.min(1, wet)) * 32) / 32
      if (level === lastBlush && wetLevel === lastWet) return
      lastBlush = level; lastWet = wetLevel
      const pixels = output.slice()
      for (const { i, weight } of blushPixels) {
        const a = weight * level * output[i + 3]! / 255
        pixels[i] = output[i]! * (1 - weight * level) + 255 * a
        pixels[i + 1] = output[i + 1]! * (1 - weight * level) + 105 * a
        pixels[i + 2] = output[i + 2]! * (1 - weight * level) + 135 * a
      }
      for (const { i, weight } of tearPixels) for (let c = 0; c < 3; c++) pixels[i + c] = output[i + c]! + (output[i + 3]! - output[i + c]!) * weight * wetLevel
      gl.bindTexture(gl.TEXTURE_2D, p.textures[0] as WebGLTexture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    }
    // テクスチャの差し替えが通ってから穴をふさぐ（途中で失敗したら元のメッシュのまま）。
    for (const { iris, loops } of holes) {
      const info = p.meshes[iris] as GlPlayer['meshes'][number], Indices = info.indices.constructor as new (a: number[]) => Uint16Array | Uint32Array
      info.indices = new Indices([...info.indices, ...capLoops(loops)])
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, info.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, info.indices, gl.STATIC_DRAW)
    }
    for (const { white, triangles } of stitches) {
      const info = p.meshes[white] as GlPlayer['meshes'][number], Indices = info.indices.constructor as new (a: number[]) => Uint16Array | Uint32Array
      info.indices = new Indices([...info.indices, ...triangles])
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, info.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, info.indices, gl.STATIC_DRAW)
    }
    return { setBlush, patched: true, brows, eyes, jaw, highlightHoles: holes.map(h => h.loops.length), slitTriangles: stitches.map(s => s.triangles.length / 3), rect: [x0, y0, x1, y1] }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
}
