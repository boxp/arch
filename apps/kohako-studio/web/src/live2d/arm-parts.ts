// BOXP-476 TD-02/05: 比較版だけで使う腕と手の追加パーツ（通常の v11r とモデルファイルは変えない）。
// v11r の腕は 1 枚のメッシュで、肩・上腕・前腕が 1 枚の絵になっている。肘を曲げるとマントが裂け、上腕の下の絵も無い。
// ここでは腕の絵を前腕の縁（金の V 字）を境に画素単位で 2 枚に分け、隠れていた上腕と、掌や口元の手の生成素材を重ねる。
import { fitAffine, type Layer } from './face-texture'

export type Vec = readonly [number, number]
export type Polygon = readonly Vec[]
/** 右腕（画面右）の前腕の範囲。上辺は金の縁の外側の線。外周は余白へ広くとる。モデル座標。 */
export const FOREARM_POLY: Polygon = [[729, 758.5], [745, 761.5], [760, 759.5], [769, 753], [773, 746], [777, 733], [781, 713], [784, 702], [787, 697.5], [793, 707], [802, 724], [905, 860], [905, 965], [790, 965], [700, 800], [712, 765]]
/** 右手の袖口（金の輪と、その上の紫）の範囲。生成の手はこの下へ差し込む。 */
export const CUFF_POLY: Polygon = [[800, 870], [880, 870], [880, 905], [868, 919], [860, 929], [853, 934], [843, 939], [830, 942], [818, 943], [800, 943]]

export function inPolygon(poly: Polygon, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Vec, [xj, yj] = poly[j] as Vec
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
/** 多角形を CX で左右反転する。 */
export const mirrorPolygon = (poly: Polygon, cx: number): Polygon => poly.map(([x, y]) => [2 * cx - x, y] as const)

type Mesh = { vertices: number; uvs: Float32Array; indices: Uint16Array | Uint32Array; texture: number; uvBuffer?: WebGLBuffer | null; indexBuffer?: WebGLBuffer | null; blend?: number; alphaBlend?: number; culling?: boolean; fixed?: boolean; masks?: number[]; invertMask?: boolean }
export type PartsPlayer = {
  gl: WebGLRenderingContext; textures: (WebGLTexture | undefined)[]; rig: number; meshes: Mesh[]
  rt: { memory: WebAssembly.Memory; p2l_mesh_vertices(rig: number, mesh: number): number; p2l_alloc(n: number): number; p2l_dealloc(p: number, n: number): void; p2l_texture_png(rig: number, i: number, a: number, b: number, c: number): number }
}
function atlasSize(p: PartsPlayer): [number, number] {
  const out = p.rt.p2l_alloc(16)
  try { const pointer = p.rt.p2l_texture_png(p.rig, 0, out, out + 8, out + 12), header = new DataView(p.rt.memory.buffer, pointer + 16, 8); return [header.getUint32(0), header.getUint32(4)] }
  finally { p.rt.p2l_dealloc(out, 16) }
}
function layerOf(p: PartsPlayer, mesh: number, width: number, height: number): Layer {
  const info = p.meshes[mesh] as Mesh, v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, mesh), info.vertices * 2), points: [number, number, number, number][] = []
  for (let i = 0; i < info.vertices; i++) points.push([v[2 * i] as number, v[2 * i + 1] as number, (info.uvs[2 * i] as number) * width, (info.uvs[2 * i + 1] as number) * height])
  return fitAffine(points)
}

export type Split = { uvs: Float32Array; uvBuffer: WebGLBuffer; inside: WebGLTexture; outside: WebGLTexture; rectUv(x: number, y: number): [number, number] }
/** 前腕の金の縁の裏（マントの右下の角）は元の絵に無い。茶の裏地で塗り、下端の線をつなぐ。右腕の座標。 */
const CAPE_CORNER: Polygon = [[776, 693], [812, 708], [805, 724], [784, 742], [776, 733]]
export function paintCapeCorner(x: number, y: number, lining: [number, number, number] = [118, 76, 67]): [number, number, number] | null {
  if (!inPolygon(CAPE_CORNER, x, y)) return null
  const ax = 803, ay = 722, bx = 784, by = 741, length = Math.hypot(bx - ax, by - ay), distance = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / length
  return distance < 1.5 ? [38, 28, 34] : lining
}
/** メッシュの三角形が覆うアトラスの画素（隣の絵の混入を避ける）。座標は切り出し範囲。 */
export function triangleCoverage(uvs: Float32Array, indices: ArrayLike<number>, width: number, height: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const at = (n: number): Vec => [(uvs[2 * (indices[t + n] as number)] as number) * width - x0, (uvs[2 * (indices[t + n] as number) + 1] as number) * height - y0], [a, b, c] = [at(0), at(1), at(2)]
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (!area) continue
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])) - 1), right = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])) + 1), top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])) - 1), bottom = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])) + 1), pad = 1.2 / Math.sqrt(Math.abs(area))
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const px = x + 0.5, py = y + 0.5, u = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area, v = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area, w2 = 1 - u - v
      if (u > -pad && v > -pad && w2 > -pad) out[y * w + x] = 1
    }
  }
  return out
}
/** メッシュの絵を、多角形の内側と外側の 2 枚のテクスチャへ分ける（UV は切り出し範囲へ張り替える）。paint は外側の絵に重ねる塗り。 */
export function splitMesh(p: PartsPlayer, mesh: number, poly: Polygon, paint?: (x: number, y: number, sample: (sx: number, sy: number) => [number, number, number]) => [number, number, number] | null): Split {
  const gl = p.gl, [width, height] = atlasSize(p), info = p.meshes[mesh] as Mesh, layer = layerOf(p, mesh, width, height)
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
  for (let i = 0; i < info.vertices; i++) { const u = (info.uvs[2 * i] as number) * width, v = (info.uvs[2 * i + 1] as number) * height; u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v) }
  const x0 = Math.max(0, Math.floor(u0) - 2), y0 = Math.max(0, Math.floor(v0) - 2), x1 = Math.min(width, Math.ceil(u1) + 2), y1 = Math.min(height, Math.ceil(v1) + 2), w = x1 - x0, h = y1 - y0
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, source = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.textures[0] as WebGLTexture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, source)
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer) }
  const inside = new Uint8Array(w * h * 4), outside = new Uint8Array(w * h * 4), covered = triangleCoverage(info.uvs, info.indices, width, height, x0, y0, w, h)
  /** モデル座標の周囲 5x5 の元の色の平均（マントの裏地色の採取用）。 */
  const sample = (sx: number, sy: number): [number, number, number] => {
    const [cu, cv] = layer.forward(sx, sy), total = [0, 0, 0]; let n = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (Math.max(0, Math.min(h - 1, Math.round(cv - y0) + dy)) * w + Math.max(0, Math.min(w - 1, Math.round(cu - x0) + dx))) * 4, a = source[i + 3] as number; if (!a) continue; total[0] = (total[0] as number) + (source[i] as number) * 255 / a; total[1] = (total[1] as number) + (source[i + 1] as number) * 255 / a; total[2] = (total[2] as number) + (source[i + 2] as number) * 255 / a; n++ }
    return n ? [(total[0] as number) / n, (total[1] as number) / n, (total[2] as number) / n] : [118, 76, 67]
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!covered[y * w + x]) continue
    const [mx, my] = layer.inverse(x + x0 + 0.5, y + y0 + 0.5), i = (y * w + x) * 4, isInside = inPolygon(poly, mx, my), target = isInside ? inside : outside
    target[i] = source[i] as number; target[i + 1] = source[i + 1] as number; target[i + 2] = source[i + 2] as number; target[i + 3] = source[i + 3] as number
    const color = paint ? paint(mx, my, sample) : null // 前腕の輪郭が外側に残る分も、角の範囲は塗り直す
    if (color) { outside[i] = color[0]; outside[i + 1] = color[1]; outside[i + 2] = color[2]; outside[i + 3] = 255 }
  }
  const upload = (pixels: Uint8Array) => {
    const texture = gl.createTexture() as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }
  const uvs = new Float32Array(info.uvs.length)
  for (let i = 0; i < info.vertices; i++) { uvs[2 * i] = ((info.uvs[2 * i] as number) * width - x0) / w; uvs[2 * i + 1] = ((info.uvs[2 * i + 1] as number) * height - y0) / h }
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  return { uvs, uvBuffer, inside: upload(inside), outside: upload(outside), rectUv: (x, y) => { const [u, v] = layer.forward(x, y); return [(u - x0) / w, (v - y0) / h] } }
}

/** アトラスの絵のうち、述語が真の画素を透明にする（体の層に残る下塗りの断片の除去）。 */
export function eraseAtlas(p: PartsPlayer, mesh: number, region: Polygon, keep: (r: number, g: number, b: number, x: number, y: number) => boolean): number {
  const gl = p.gl, [width, height] = atlasSize(p), layer = layerOf(p, mesh, width, height), span = region.map(c => layer.forward(c[0], c[1]))
  const x0 = Math.max(0, Math.floor(Math.min(...span.map(s => s[0]))) - 2), y0 = Math.max(0, Math.floor(Math.min(...span.map(s => s[1]))) - 2), x1 = Math.min(width, Math.ceil(Math.max(...span.map(s => s[0]))) + 2), y1 = Math.min(height, Math.ceil(Math.max(...span.map(s => s[1]))) + 2), w = x1 - x0, h = y1 - y0
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.textures[0] as WebGLTexture, 0)
  try { gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels) } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer) }
  let erased = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [mx, my] = layer.inverse(x + x0 + 0.5, y + y0 + 0.5), i = (y * w + x) * 4, a = pixels[i + 3] as number
    if (!a || !inPolygon(region, mx, my) || keep((pixels[i] as number) * 255 / a, (pixels[i + 1] as number) * 255 / a, (pixels[i + 2] as number) * 255 / a, mx, my)) continue
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0; erased++
  }
  gl.bindTexture(gl.TEXTURE_2D, p.textures[0] as WebGLTexture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return erased
}

/** 4 頂点の追加メッシュ。頂点は毎フレーム呼び出し側が書く。 */
export function addQuad(p: PartsPlayer, uvs: Float32Array, texture: number): { index: number; pointer: number } {
  const gl = p.gl, indices = new Uint32Array([0, 1, 2, 0, 2, 3]), pointer = p.rt.p2l_alloc(32), uvBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  p.meshes.push({ vertices: 4, uvs, indices, texture, uvBuffer, indexBuffer, blend: 0, alphaBlend: 0, culling: false, fixed: true, masks: [], invertMask: false })
  return { index: p.meshes.length - 1, pointer }
}
/** メッシュと同じ形の追加メッシュ（頂点は元のメッシュと共有する）。 */
export function addShared(p: PartsPlayer, base: number, split: Split, texture: number): number {
  const gl = p.gl, info = p.meshes[base] as Mesh, indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, info.indices, gl.STATIC_DRAW)
  p.meshes.push({ vertices: info.vertices, uvs: split.uvs, indices: info.indices, texture, uvBuffer: split.uvBuffer, indexBuffer, blend: 0, alphaBlend: 0, culling: false, fixed: true, masks: [], invertMask: false })
  return p.meshes.length - 1
}
export function addTexture(p: PartsPlayer, texture?: WebGLTexture): number { p.textures.push(texture); return p.textures.length - 1 }
export async function loadTexture(gl: WebGLRenderingContext, url: string): Promise<WebGLTexture> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`素材の取得に失敗 (${response.status})`)
  const image = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' }), texture = gl.createTexture() as WebGLTexture
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  image.close()
  return texture
}
