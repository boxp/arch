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

/** 1 つの目: 輪郭線と下部の色を虹彩へ、上まぶたの影をまつ毛へ移し、白目の抜きを埋める。 */
export function rebakeEye(source: Atlas, target: Atlas, spec: EyeSpec, lash: Layer, iris: Layer, white: Layer): { ring: number; filled: number; strip: number } {
  const readLash = sampler(source, lash), readIris = sampler(source, iris), readWhite = sampler(source, white)
  const count = { ring: 0, filled: 0, strip: 0 }
  const box = { x0: Math.min(arcX(spec.left, spec.top), arcX(spec.left, spec.bottom)) - 5, y0: spec.top - 8, x1: Math.max(arcX(spec.right, spec.top), arcX(spec.right, spec.bottom)) + 5, y1: spec.bottom + 1 }
  const onRing = (x: number, y: number) => y >= spec.top && y <= spec.bottom && (Math.abs(x - arcX(spec.left, y)) <= RING || Math.abs(x - arcX(spec.right, y)) <= RING)
  const nearRing = (x: number, y: number) => y >= spec.top && y <= spec.bottom - 1.5 && Math.min(Math.abs(x - arcX(spec.left, y)), Math.abs(x - arcX(spec.right, y))) <= RING_FRINGE
  const inside = (x: number, y: number) => y >= spec.top && y <= spec.bottom && x >= arcX(spec.left, y) && x <= arcX(spec.right, y)
  eachTexel(target, lash, box, (u, v, x, y) => { const alpha = source.get(u, v)[3]; if (alpha > 0 && (onRing(x, y) || (alpha < 200 && nearRing(x, y)))) { target.set(u, v, [0, 0, 0, 0]); count.ring++ } })
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
    const ring = onRing(x, y) ? readLash(x, y) : null
    if (inside(x, y)) {
      const own = readIris(x, y)
      // ハイライトは虹彩のメッシュの穴なので触らない。虹彩の上の角も透明のまま、下部の抜きだけ白目の色で埋める。
      if (own[3] < 128 && y < spec.top + 5 && Math.min(x - arcX(spec.left, y), arcX(spec.right, y) - x) < 4 && !ring) return
      // 虹彩の上半分の穴はハイライト。白目の色を透かすと濁るので白で埋め、虹彩と一緒に動かす。
      let body = over(own, own[3] < 128 && y < (spec.top + spec.bottom) / 2 ? WHITE : readWhite(x, y))
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
  meshes: { vertices: number; uvs: Float32Array; texture: number }[]
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
    const models = [{ x: 480, y: 200 }, { x: 680, y: 320 }]
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
    const eyes = EYE_SPECS.map(s => rebakeEye(source, target, s, of(s.lash), of(s.iris), of(s.white)))
    gl.bindTexture(gl.TEXTURE_2D, p.textures[0] as WebGLTexture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, output)
    return { patched: true, brows, eyes, rect: [x0, y0, x1, y1] }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
}
