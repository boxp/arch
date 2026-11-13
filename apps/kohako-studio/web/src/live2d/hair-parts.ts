// BOXP-525 TD-01: 髪の層の描画の欠けと混入を、読み込み時に v11r のアトラス/UV だけで直す（モデルファイルと新素材は使わない）。
// 層別の実描画と UV 図で確定した原因:
// - 頬・もみあげのゴミ: 左右の髪房 (ArtMeshLayerL/R) の三角形が、アトラス上で隣に置かれた別素材（肌色の欠片、桜の飾りの一部）まで覆い、髪房の縁に桃/白の断片として描かれる。
// - 髪飾りの先端の欠け: 前髪 (ArtMeshFrontHair) の外周の頂点が、桜の花びらと房の輪郭線の 1〜3 画素内側を通り、先端の輪郭が直線で切れる。
import { boundaryLoops } from './face-texture'
import { addTexture, inPolygon, triangleCoverage, type PartsPlayer, type Polygon } from './arm-parts'

export const HAIR_STRANDS = [16, 17] as const
export const FRONT_HAIR = 0
/** 髪房の上側（頬・もみあげの横）だけを対象にする割合（アトラス上の縦の範囲）。下端の三つ編みの先に重なる桜は、着物の紐飾りの正しい絵なので残す。 */
export const STRAND_TOP = 0.4
/** 前髪の層で、桜の飾りと房のある範囲（モデル座標、読み込み時の姿勢）。この範囲の外周だけを外へ広げる。 */
export const ORNAMENT_BOX = { x0: 425, y0: 100, x1: 540, y1: 315 } as const
/** 外周を外へ広げる量（アトラス画素）。輪郭線のはみ出しは最大約 3 画素。 */
export const ORNAMENT_GROW = 3.5

/** 髪房の層に混ざった別素材の画素か（ストレートアルファの色）。髪は暗い紫か、明るくても青み（b > r）。肌・桜・白は明るく赤み寄り。 */
export function isForeignToHair(r: number, g: number, b: number): boolean {
  return r * 0.3 + g * 0.59 + b * 0.11 > 140 && r >= b
}

/**
 * 閉路の頂点の UV を、閉路の外向きに amount だけ動かした新しい配列を返す（select が真の頂点だけ）。
 * 位置は変えないので、変形（毎フレームの頂点）にはそのまま追従し、外周の三角形が元絵の輪郭まで写す。
 * uvPx は画素単位の UV（[u0, v0, u1, v1, ...]）。
 */
export function growLoopUv(uvPx: ArrayLike<number>, loop: readonly number[], select: (n: number) => boolean, amount: number): Float32Array {
  const out = Float32Array.from(uvPx), at = (n: number): [number, number] => [uvPx[2 * n] as number, uvPx[2 * n + 1] as number]
  const poly: Polygon = loop.map(at)
  for (let k = 0; k < loop.length; k++) {
    const n = loop[k] as number
    if (!select(n)) continue
    const [px, py] = at(loop[(k + loop.length - 1) % loop.length] as number), [nx, ny] = at(loop[(k + 1) % loop.length] as number), [x, y] = at(n)
    let dx = ny - py, dy = -(nx - px)
    const length = Math.hypot(dx, dy)
    if (!length) continue
    dx /= length; dy /= length
    // 向きは閉路の巻き方に依らず、少し動かして閉路の外に出る側を選ぶ。
    if (inPolygon(poly, x + dx * 0.5, y + dy * 0.5)) { dx = -dx; dy = -dy }
    out[2 * n] = x + dx * amount; out[2 * n + 1] = y + dy * amount
  }
  return out
}

/** 閉路のうち、囲む範囲が最大のもの（外周）。 */
export function outerLoop(loops: readonly number[][], at: (n: number) => readonly [number, number]): number[] {
  let best: number[] = [], bestArea = -1
  for (const loop of loops) {
    let area = 0
    for (let i = 0; i < loop.length; i++) { const [ax, ay] = at(loop[i] as number), [bx, by] = at(loop[(i + 1) % loop.length] as number); area += ax * by - bx * ay }
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop }
  }
  return best
}

type Mesh = PartsPlayer['meshes'][number]
function atlasSize(p: PartsPlayer): [number, number] {
  const out = p.rt.p2l_alloc(16)
  try { const pointer = p.rt.p2l_texture_png(p.rig, 0, out, out + 8, out + 12), header = new DataView(p.rt.memory.buffer, pointer + 16, 8); return [header.getUint32(0), header.getUint32(4)] }
  finally { p.rt.p2l_dealloc(out, 16) }
}

/** 髪房の層だけに、別素材を消した切り出しテクスチャを与える（アトラスは他の層と共有なので直接は消さない）。消した画素数を返す。 */
export function isolateHairStrand(p: PartsPlayer, mesh: number): number {
  const gl = p.gl, [width, height] = atlasSize(p), info = p.meshes[mesh] as Mesh
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
  for (let i = 0; i < info.vertices; i++) { const u = (info.uvs[2 * i] as number) * width, v = (info.uvs[2 * i + 1] as number) * height; u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v) }
  const x0 = Math.max(0, Math.floor(u0) - 2), y0 = Math.max(0, Math.floor(v0) - 2), x1 = Math.min(width, Math.ceil(u1) + 2), y1 = Math.min(height, Math.ceil(v1) + 2), w = x1 - x0, h = y1 - y0
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.textures[info.texture] as WebGLTexture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer) }
  const covered = triangleCoverage(info.uvs, info.indices, width, height, x0, y0, w, h)
  let erased = 0
  for (let i = 0; i < w * h; i++) {
    const a = pixels[4 * i + 3] as number
    if (!a) continue
    // アトラスは乗算済みアルファなので、色を戻してから判定する。
    const top = (Math.floor(i / w) + y0 + 0.5 - v0) / (v1 - v0) < STRAND_TOP
    if (covered[i] && (!top || !isForeignToHair((pixels[4 * i] as number) * 255 / a, (pixels[4 * i + 1] as number) * 255 / a, (pixels[4 * i + 2] as number) * 255 / a))) continue
    pixels[4 * i] = pixels[4 * i + 1] = pixels[4 * i + 2] = pixels[4 * i + 3] = 0
    if (covered[i]) erased++
  }
  const texture = gl.createTexture() as WebGLTexture
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const uvs = new Float32Array(info.uvs.length)
  for (let i = 0; i < info.vertices; i++) { uvs[2 * i] = ((info.uvs[2 * i] as number) * width - x0) / w; uvs[2 * i + 1] = ((info.uvs[2 * i + 1] as number) * height - y0) / h }
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  // 全部そろってから差し替える（途中で失敗したら元のまま）。
  info.texture = addTexture(p, texture); info.uvs = uvs; info.uvBuffer = uvBuffer
  return erased
}

/** 乗算済みアルファの画素が桜色（明るく赤み寄り）か。 */
export function isOrnamentPink([r, g, b, a]: readonly [number, number, number, number]): boolean {
  if (a < 64) return false
  const k = 255 / a, R = r * k, G = g * k, B = b * k
  return R * 0.3 + G * 0.59 + B * 0.11 > 140 && R > B + 8 && R > G + 15
}
/** (u, v) の周り reach 画素以内に桜色の画素があるか。 */
export function nearOrnament(at: (x: number, y: number) => readonly [number, number, number, number], u: number, v: number, reach: number): boolean {
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (dx * dx + dy * dy <= reach * reach && isOrnamentPink(at(Math.floor(u) + dx, Math.floor(v) + dy))) return true
  return false
}
/** 前髪の外周のうち飾りの範囲の頂点の UV を外へ広げ、花びらと房の輪郭線まで写す。動かした頂点数を返す。 */
export function extendOrnament(p: PartsPlayer, mesh: number = FRONT_HAIR, box = ORNAMENT_BOX, amount = ORNAMENT_GROW): number {
  const gl = p.gl, [width, height] = atlasSize(p), info = p.meshes[mesh] as Mesh
  const v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, mesh), info.vertices * 2)
  const uvPx = new Float32Array(info.uvs.length)
  for (let i = 0; i < info.vertices; i++) { uvPx[2 * i] = (info.uvs[2 * i] as number) * width; uvPx[2 * i + 1] = (info.uvs[2 * i + 1] as number) * height }
  const loop = outerLoop(boundaryLoops(info.indices), n => [uvPx[2 * n] as number, uvPx[2 * n + 1] as number])
  const inBox = (n: number) => { const x = v[2 * n] as number, y = v[2 * n + 1] as number; return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 }
  // 範囲内でも、すぐそばに桜色の画素がある頂点だけ広げる（隣の髪束の縁まで広げると、アトラス上の別素材の線を拾う）。
  const near = loop.filter(inBox)
  if (!near.length) return 0
  const us = near.map(n => uvPx[2 * n] as number), vs = near.map(n => uvPx[2 * n + 1] as number), reach = Math.ceil(amount) + 1
  const x0 = Math.max(0, Math.floor(Math.min(...us)) - reach), y0 = Math.max(0, Math.floor(Math.min(...vs)) - reach), x1 = Math.min(width, Math.ceil(Math.max(...us)) + reach), y1 = Math.min(height, Math.ceil(Math.max(...vs)) + reach), w = x1 - x0, h = y1 - y0
  const framebuffer = gl.createFramebuffer(), previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.textures[info.texture] as WebGLTexture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer) }
  const select = (n: number) => inBox(n) && nearOrnament((x, y) => {
    const px = x - x0, py = y - y0
    if (px < 0 || py < 0 || px >= w || py >= h) return [0, 0, 0, 0]
    const i = (py * w + px) * 4; return [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number, pixels[i + 3] as number]
  }, uvPx[2 * n] as number, uvPx[2 * n + 1] as number, reach)
  const grown = growLoopUv(uvPx, loop, select, amount), uvs = new Float32Array(info.uvs.length)
  let moved = 0
  for (let i = 0; i < info.vertices; i++) {
    uvs[2 * i] = (grown[2 * i] as number) / width; uvs[2 * i + 1] = (grown[2 * i + 1] as number) / height
    if (grown[2 * i] !== uvPx[2 * i] || grown[2 * i + 1] !== uvPx[2 * i + 1]) moved++
  }
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  info.uvs = uvs; info.uvBuffer = uvBuffer
  return moved
}

/** 読み込み時に一度だけ呼ぶ。失敗した処理は元の描画のまま。 */
export function patchHair(p: PartsPlayer): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const mesh of HAIR_STRANDS) {
    try { result[`strand${mesh}`] = isolateHairStrand(p, mesh) } catch (e) { result[`strand${mesh}`] = e instanceof Error ? e.message : String(e) }
  }
  try { result.ornament = extendOrnament(p) } catch (e) { result.ornament = e instanceof Error ? e.message : String(e) }
  return result
}
