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
export const BROW_MESH = 1
export const FACE_MESH = 18
const BROW_BOX = { x0: 505, y0: 234, x1: 650, y1: 260 }
const SCLERA: Rgba = [246, 246, 250, 255]

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
  const inside = (x: number, y: number) => y >= spec.top && y <= spec.bottom && x >= arcX(spec.left, y) && x <= arcX(spec.right, y)
  eachTexel(target, lash, box, (u, v, x, y) => { if (onRing(x, y) && source.get(u, v)[3] > 0) { target.set(u, v, [0, 0, 0, 0]); count.ring++ } })
  eachTexel(target, white, box, (u, v, x, y) => {
    if (y < spec.strip + 1 || y > spec.bottom || x < arcX(spec.left, y) - 4 || x > arcX(spec.right, y) + 4) return
    // 輪郭線の抜きの上端（まつ毛の陰）は側方が見えないので白目色で埋める。
    if (y < spec.top && source.get(u, v)[3] < 128 && Math.min(Math.abs(x - arcX(spec.left, y)), Math.abs(x - arcX(spec.right, y))) <= 3) { target.set(u, v, SCLERA); count.filled++; return }
    const a = readWhite(arcX(spec.left, y) - 5, y), b = readWhite(arcX(spec.right, y) + 5, y)
    if (a[3] < 200 && b[3] < 200) return
    const t = (x - arcX(spec.left, y) + 4) / (arcX(spec.right, y) - arcX(spec.left, y) + 8)
    target.set(u, v, mix(a[3] < 200 ? SCLERA : a, b[3] < 200 ? SCLERA : b, t)); count.filled++
  })
  eachTexel(target, iris, box, (u, v, x, y) => {
    const ring = onRing(x, y) ? readLash(x, y) : null
    if (inside(x, y)) {
      const own = readIris(x, y)
      // 虹彩の上の角（丸みの外）は透明のまま。ハイライトと下部の抜きだけを埋める。
      if (own[3] < 128 && y < spec.top + 5 && Math.min(x - arcX(spec.left, y), arcX(spec.right, y) - x) < 4 && !ring) return
      let body = over(own, readWhite(x, y))
      // 虹彩の上部の抜きはハイライト。元の描画と同じ純白にする（下部の抜きは白目の淡い色のまま）。
      if (y < spec.top + 7) body = over(own, [255, 255, 255, 255])
      else if (body[3] < 200) body = over(body, [255, 255, 255, 255])
      target.set(u, v, ring ? over(ring, body) : body)
    } else if (ring && ring[3] > 0) target.set(u, v, over(ring, readIris(x, y)))
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

/** 眉: 眉の層から前髪の断片を除き、顔の層に焼き込まれた眉を上下の肌で埋める。 */
export function rebakeBrows(source: Atlas, target: Atlas, brow: Layer, face: Layer): { removed: number; erased: number } {
  const readBrow = sampler(source, brow), readFace = sampler(source, face)
  const isInk = (x: number, y: number) => { const p = readBrow(x, y); return p[3] > 32 && luma(p) < 95 }
  // アトラスの解像度に依存しないように 0.5 刻みで近傍を見る。
  const near = (x: number, y: number) => { for (let dx = -1.5; dx <= 1.5; dx += 0.5) for (let dy = -1.5; dy <= 1.5; dy += 0.5) if (isInk(x + dx, y + dy)) return true; return false }
  const result = { removed: 0, erased: 0 }
  eachTexel(target, brow, BROW_BOX, (u, v, x, y) => { const p = source.get(u, v); if (p[3] > 0 && !near(x, y)) { target.set(u, v, [0, 0, 0, 0]); result.removed++ } })
  eachTexel(target, face, BROW_BOX, (u, v, x, y) => {
    if (!near(x, y)) return
    let up = y, down = y
    while (near(x, up) && y - up < 12) up -= 0.5
    while (near(x, down) && down - y < 12) down += 0.5
    const a = readFace(x, up), b = readFace(x, down)
    if (luma(a) < 150 || luma(b) < 150 || a[3] < 200 || b[3] < 200) return
    target.set(u, v, mix(a, b, (y - up) / (down - up))); result.erased++
  })
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
  for (const m of [BROW_MESH, FACE_MESH, ...EYE_SPECS.flatMap(s => [s.lash, s.iris, s.white])]) layers.set(m, layerOf(p, m, width, height))
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
    const brows = rebakeBrows(source, target, of(BROW_MESH), of(FACE_MESH))
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
