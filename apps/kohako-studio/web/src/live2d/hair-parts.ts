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
export function growLoopUv(
  uvPx: ArrayLike<number>,
  loop: readonly number[],
  select: (n: number) => boolean,
  amount: number,
): Float32Array {
  const out = Float32Array.from(uvPx),
    at = (n: number): [number, number] => [uvPx[2 * n] as number, uvPx[2 * n + 1] as number]
  const poly: Polygon = loop.map(at)
  for (let k = 0; k < loop.length; k++) {
    const n = loop[k] as number
    if (!select(n)) continue
    const [px, py] = at(loop[(k + loop.length - 1) % loop.length] as number),
      [nx, ny] = at(loop[(k + 1) % loop.length] as number),
      [x, y] = at(n)
    let dx = ny - py,
      dy = -(nx - px)
    const length = Math.hypot(dx, dy)
    if (!length) continue
    dx /= length
    dy /= length
    // 向きは閉路の巻き方に依らず、少し動かして閉路の外に出る側を選ぶ。
    if (inPolygon(poly, x + dx * 0.5, y + dy * 0.5)) {
      dx = -dx
      dy = -dy
    }
    out[2 * n] = x + dx * amount
    out[2 * n + 1] = y + dy * amount
  }
  return out
}

/** 閉路のうち、囲む範囲が最大のもの（外周）。 */
export function outerLoop(loops: readonly number[][], at: (n: number) => readonly [number, number]): number[] {
  let best: number[] = [],
    bestArea = -1
  for (const loop of loops) {
    let area = 0
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = at(loop[i] as number),
        [bx, by] = at(loop[(i + 1) % loop.length] as number)
      area += ax * by - bx * ay
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      best = loop
    }
  }
  return best
}

type Mesh = PartsPlayer['meshes'][number]
function atlasSize(p: PartsPlayer): [number, number] {
  const out = p.rt.p2l_alloc(16)
  try {
    const pointer = p.rt.p2l_texture_png(p.rig, 0, out, out + 8, out + 12),
      header = new DataView(p.rt.memory.buffer, pointer + 16, 8)
    return [header.getUint32(0), header.getUint32(4)]
  } finally {
    p.rt.p2l_dealloc(out, 16)
  }
}

/** n 以上の最小の 2 のべき乗。 */
export function powerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/**
 * 前髪の頭頂（桜の右上）の外周。元の絵は外周を約 16 画素かけて透明へぼかし、輪郭線のすぐ内側に明るい帯（輝度 110〜150）を描く。
 * 後ろ髪の層はこの下が四角く抜けているため、ぼかしから背景が透け、帯と合わせて「髪の左上の白い線」に見える
 * （BOXP-525 r21、Owner 画像で指摘。範囲を色で塗った検証描画で、この範囲は前髪の頭頂だけに出ることを確認）。
 * v11r の 4096px アトラス画素座標。
 */
export const CROWN_RIM = { x0: 3286, y0: 0, x1: 3392, y1: 42 } as const
/** 帯とみなす輝度（ストレートアルファ）と、透明な外側からの距離（画素）。髪の地は輝度 50〜70。 */
export const CROWN_RIM_LUMA = 85
export const CROWN_RIM_REACH = 9
/** 帯を置き換える髪の地の輝度。 */
export const CROWN_HAIR_LUMA = 62
/** ぼかしの不透明度に掛ける倍率（16 画素のぼかしを約 3 画素にし、最も外の輪郭線まで背景を透かさない）。 */
export const CROWN_ALPHA_GAIN = 6

/**
 * 乗算済みアルファの画素列で、外周のぼかしの不透明度を gain 倍に締め、透明な外側から reach 画素以内の明るい画素を
 * 色相を保ったまま髪の地の輝度へ落とす。桜色は対象外。変えた画素数を返す。
 */
export function dimRim(
  pixels: Uint8Array,
  w: number,
  h: number,
  reach = CROWN_RIM_REACH,
  gain = CROWN_ALPHA_GAIN,
): number {
  // 範囲の外は「外側」とみなさない（切り出しの縁で髪の中まで落とさない）。
  const clear = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && (pixels[(y * w + x) * 4 + 3] as number) < 8
  const edits: { i: number; color: [number, number, number]; alpha: number }[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        a = pixels[i + 3] as number
      if (a < 8) continue
      const px = [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number, a] as const
      if (isOrnamentPink(px)) continue
      let color: [number, number, number] = [(px[0] * 255) / a, (px[1] * 255) / a, (px[2] * 255) / a]
      const luma = color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11
      let bright = false
      if (luma > CROWN_RIM_LUMA)
        for (let dy = -reach; dy <= reach && !bright; dy++)
          for (let dx = -reach; dx <= reach && !bright; dx++)
            if (dx * dx + dy * dy <= reach * reach && clear(x + dx, y + dy)) bright = true
      if (bright) color = color.map((c) => (c * CROWN_HAIR_LUMA) / luma) as [number, number, number]
      const alpha = Math.min(255, a * gain)
      if (bright || alpha !== a) edits.push({ i, color, alpha })
    }
  for (const { i, color, alpha } of edits) {
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(alpha, Math.round(((color[c] as number) * alpha) / 255))
    pixels[i + 3] = alpha
  }
  return edits.length
}

/**
 * 前髪の頭頂の外周のぼかしを締め、明るい帯を髪の地の色にする（共有アトラスを直接変える）。変えた画素数を返す。
 * 顔のテクスチャ補正（patchFaceTexture）より前に呼ぶ: 顔の補正は読み込み時のアトラスの写しを赤みの変化ごとに書き戻すため、後で変えると上書きされる。
 */
export function dimCrownRim(p: PartsPlayer, mesh: number = FRONT_HAIR, box = CROWN_RIM): number {
  const gl = p.gl,
    [width, height] = atlasSize(p),
    info = p.meshes[mesh] as Mesh
  // 固定座標は v11r の 4096px アトラス専用。別サイズのモデルには適用しない。
  if (width !== 4096 || height !== 4096) throw new Error('前髪のアトラスサイズが異なります')
  const x0 = box.x0,
    y0 = box.y0,
    w = box.x1 - box.x0,
    h = box.y1 - box.y0,
    texture = p.textures[info.texture] as WebGLTexture,
    framebuffer = gl.createFramebuffer(),
    previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
  // 範囲内の明るい画素は前髪の頭頂の帯だけ（範囲を色で塗った検証描画で、他の層に出ないことを確認済み）。
  // 三角形の被覆で絞ると、外周の三角形の縁で描かれる帯の上端が残る。
  const changed = dimRim(pixels, w, h)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return changed
}

/** 後ろ髪の桜の左上に浮く孤立片。v11r アトラス画素座標。 */
export function isBackHairFragment(x: number, y: number): boolean {
  return x >= 250 && x < 264 && y >= 66 && y < 85
}

/** 対象の層だけに、別素材を消した切り出しテクスチャを与える。消した画素数を返す。 */
export function isolateHairStrand(p: PartsPlayer, mesh: number, fragmentOnly = false): number {
  const gl = p.gl,
    [width, height] = atlasSize(p),
    info = p.meshes[mesh] as Mesh
  // 固定座標は v11r の 4096px アトラス専用。別サイズのモデルには適用しない。
  if (fragmentOnly && (width !== 4096 || height !== 4096)) throw new Error('後ろ髪のアトラスサイズが異なります')
  let u0 = Infinity,
    v0 = Infinity,
    u1 = -Infinity,
    v1 = -Infinity
  for (let i = 0; i < info.vertices; i++) {
    const u = (info.uvs[2 * i] as number) * width,
      v = (info.uvs[2 * i + 1] as number) * height
    u0 = Math.min(u0, u)
    v0 = Math.min(v0, v)
    u1 = Math.max(u1, u)
    v1 = Math.max(v1, v)
  }
  const x0 = Math.max(0, Math.floor(u0) - 2),
    y0 = Math.max(0, Math.floor(v0) - 2),
    x1 = Math.min(width, Math.ceil(u1) + 2),
    y1 = Math.min(height, Math.ceil(v1) + 2),
    w = x1 - x0,
    h = y1 - y0
  const framebuffer = gl.createFramebuffer(),
    previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    p.textures[info.texture] as WebGLTexture,
    0,
  )
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
  const covered = fragmentOnly ? undefined : triangleCoverage(info.uvs, info.indices, width, height, x0, y0, w, h)
  let erased = 0
  for (let i = 0; i < w * h; i++) {
    const a = pixels[4 * i + 3] as number
    if (!a) continue
    // アトラスは乗算済みアルファなので、色を戻してから判定する。
    const top = (Math.floor(i / w) + y0 + 0.5 - v0) / (v1 - v0) < STRAND_TOP
    if (
      fragmentOnly
        ? !isBackHairFragment((i % w) + x0, Math.floor(i / w) + y0)
        : covered?.[i] &&
          (!top ||
            !isForeignToHair(
              ((pixels[4 * i] as number) * 255) / a,
              ((pixels[4 * i + 1] as number) * 255) / a,
              ((pixels[4 * i + 2] as number) * 255) / a,
            ))
    )
      continue
    pixels[4 * i] = pixels[4 * i + 1] = pixels[4 * i + 2] = pixels[4 * i + 3] = 0
    if (fragmentOnly || covered?.[i]) erased++
  }
  // 2 のべき乗の大きさに置き、p2l.js がミップマップを作れるようにする（縮小表示で細い線が欠けない）。
  const W = powerOfTwo(w),
    H = powerOfTwo(h),
    padded = new Uint8Array(W * H * 4)
  for (let y = 0; y < h; y++) padded.set(pixels.subarray(y * w * 4, (y + 1) * w * 4), y * W * 4)
  const texture = gl.createTexture() as WebGLTexture
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, padded)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const uvs = new Float32Array(info.uvs.length)
  for (let i = 0; i < info.vertices; i++) {
    uvs[2 * i] = ((info.uvs[2 * i] as number) * width - x0) / W
    uvs[2 * i + 1] = ((info.uvs[2 * i + 1] as number) * height - y0) / H
  }
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  // 全部そろってから差し替える（途中で失敗したら元のまま）。
  info.texture = addTexture(p, texture)
  info.uvs = uvs
  info.uvBuffer = uvBuffer
  return erased
}

/** 乗算済みアルファの画素が桜色（明るく赤み寄り）か。 */
export function isOrnamentPink([r, g, b, a]: readonly [number, number, number, number]): boolean {
  if (a < 64) return false
  const k = 255 / a,
    R = r * k,
    G = g * k,
    B = b * k
  return R * 0.3 + G * 0.59 + B * 0.11 > 140 && R > B + 8 && R > G + 15
}
/** (u, v) の周り reach 画素以内に桜色の画素があるか。 */
export function nearOrnament(
  at: (x: number, y: number) => readonly [number, number, number, number],
  u: number,
  v: number,
  reach: number,
): boolean {
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++)
      if (dx * dx + dy * dy <= reach * reach && isOrnamentPink(at(Math.floor(u) + dx, Math.floor(v) + dy))) return true
  return false
}
/** 前髪の外周のうち飾りの範囲の頂点の UV を外へ広げ、花びらと房の輪郭線まで写す。動かした頂点数を返す。 */
export function extendOrnament(
  p: PartsPlayer,
  mesh: number = FRONT_HAIR,
  box = ORNAMENT_BOX,
  amount = ORNAMENT_GROW,
): number {
  const gl = p.gl,
    [width, height] = atlasSize(p),
    info = p.meshes[mesh] as Mesh
  const v = new Float32Array(p.rt.memory.buffer, p.rt.p2l_mesh_vertices(p.rig, mesh), info.vertices * 2)
  const uvPx = new Float32Array(info.uvs.length)
  for (let i = 0; i < info.vertices; i++) {
    uvPx[2 * i] = (info.uvs[2 * i] as number) * width
    uvPx[2 * i + 1] = (info.uvs[2 * i + 1] as number) * height
  }
  const loop = outerLoop(boundaryLoops(info.indices), (n) => [uvPx[2 * n] as number, uvPx[2 * n + 1] as number])
  const inBox = (n: number) => {
    const x = v[2 * n] as number,
      y = v[2 * n + 1] as number
    return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
  }
  // 範囲内でも、すぐそばに桜色の画素がある頂点だけ広げる（隣の髪束の縁まで広げると、アトラス上の別素材の線を拾う）。
  const near = loop.filter(inBox)
  if (!near.length) return 0
  const us = near.map((n) => uvPx[2 * n] as number),
    vs = near.map((n) => uvPx[2 * n + 1] as number),
    reach = Math.ceil(amount) + 1
  const x0 = Math.max(0, Math.floor(Math.min(...us)) - reach),
    y0 = Math.max(0, Math.floor(Math.min(...vs)) - reach),
    x1 = Math.min(width, Math.ceil(Math.max(...us)) + reach),
    y1 = Math.min(height, Math.ceil(Math.max(...vs)) + reach),
    w = x1 - x0,
    h = y1 - y0
  const framebuffer = gl.createFramebuffer(),
    previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    p.textures[info.texture] as WebGLTexture,
    0,
  )
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
  const select = (n: number) =>
    inBox(n) &&
    nearOrnament(
      (x, y) => {
        const px = x - x0,
          py = y - y0
        if (px < 0 || py < 0 || px >= w || py >= h) return [0, 0, 0, 0]
        const i = (py * w + px) * 4
        return [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number, pixels[i + 3] as number]
      },
      uvPx[2 * n] as number,
      uvPx[2 * n + 1] as number,
      reach,
    )
  const grown = growLoopUv(uvPx, loop, select, amount),
    uvs = new Float32Array(info.uvs.length)
  let moved = 0
  for (let i = 0; i < info.vertices; i++) {
    uvs[2 * i] = (grown[2 * i] as number) / width
    uvs[2 * i + 1] = (grown[2 * i + 1] as number) / height
    if (grown[2 * i] !== uvPx[2 * i] || grown[2 * i + 1] !== uvPx[2 * i + 1]) moved++
  }
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  info.uvs = uvs
  info.uvBuffer = uvBuffer
  return moved
}

/** 読み込み時に一度だけ呼ぶ。失敗した処理は元の描画のまま。 */
export function patchHair(p: PartsPlayer): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const mesh of HAIR_STRANDS) {
    try {
      result[`strand${mesh}`] = isolateHairStrand(p, mesh)
    } catch (e) {
      result[`strand${mesh}`] = e instanceof Error ? e.message : String(e)
    }
  }
  try {
    result.backFragment = isolateHairStrand(p, 31, true)
  } catch (e) {
    result.backFragment = e instanceof Error ? e.message : String(e)
  }
  try {
    result.ornament = extendOrnament(p)
  } catch (e) {
    result.ornament = e instanceof Error ? e.message : String(e)
  }
  return result
}

/**
 * 房飾り（桜の下の組み紐に 2 列×3 段で下がる房）の 3 段目右（BOXP-525 r22、Owner 画像「組み飾りの下部が途切れている」）。
 * 元のアトラスでは 3 段目右の房の絵が描かれておらず、組み紐の右下が斜めに切れている。前髪の外周の頂点もその切れ目を通る。
 * 2 段目右の房（と周りの紺の地）を 1 段下へ写し、外周の頂点 3 つを位置と UV を同じだけ外へ出して写した房まで描く。
 * v11r の 4096px アトラス画素座標（写し元の範囲と、1 段の間隔）。
 */
export const TASSEL_SRC = { x0: 3274, y0: 161, x1: 3290, y1: 183 } as const
export const TASSEL_STEP: readonly [number, number] = [1, 23]
/** 広げる外周の頂点（UV のアトラス画素座標。位置は待機の動きで変わるため UV で探す）と UV の移動量（アトラス画素）。 */
export const TASSEL_GROW: readonly { at: readonly [number, number]; by: readonly [number, number] }[] = [
  { at: [3285.8, 192.5], by: [4.7, 0.5] },
  { at: [3281.5, 203.8], by: [8, 3.5] },
  { at: [3271.9, 208.0], by: [1, 2] },
]

/**
 * 乗算済みアルファの画素列 pixels（w×h、左上 = 範囲の (0,0)）で、src の範囲を step だけずらした先へ上から重ねる。
 * 3 段目右の位置は紺の地が不透明に描かれている（房だけが無い）ため、房と地をまとめて上に描く。
 * 写し元の下端 fade 行は不透明度を段階的に下げて縁をなじませる。変えた画素数を返す。
 */
export function pasteOver(
  pixels: Uint8Array,
  w: number,
  h: number,
  src: { x0: number; y0: number; x1: number; y1: number },
  step: readonly [number, number],
  fade = 2,
): number {
  const copy = pixels.slice()
  let changed = 0
  for (let y = src.y0; y < src.y1; y++)
    for (let x = src.x0; x < src.x1; x++) {
      const tx = x + step[0],
        ty = y + step[1]
      if (x < 0 || y < 0 || x >= w || y >= h || tx < 0 || ty < 0 || tx >= w || ty >= h) continue
      const s = (y * w + x) * 4,
        d = (ty * w + tx) * 4,
        k = Math.min(1, (src.y1 - y) / (fade + 1)),
        keep = 1 - ((copy[s + 3] as number) * k) / 255
      if (!(copy[s + 3] as number)) continue
      for (let c = 0; c < 4; c++)
        pixels[d + c] = Math.min(255, Math.round((copy[s + c] as number) * k + (copy[d + c] as number) * keep))
      changed++
    }
  return changed
}

/** 点 p の三角形 abc に対する重心座標（外でも外挿する）。 */
export function barycentric(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): [number, number, number] {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(d) < 1e-9) return [1, 0, 0]
  const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d,
    v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d
  return [u, v, 1 - u - v]
}

export type TasselRig = { moved: { n: number; tri: [number, number, number]; bary: [number, number, number] }[] }

/**
 * 外周の頂点を UV で by だけ動かし、位置は「動かさない頂点の最寄りの三角形」の重心座標で外挿して毎フレーム求める
 * （UV と位置が同じだけ動くので絵は縮まない）。uvPx は画素単位の UV（その場で書き換える）。
 */
export function growTassel(
  uvPx: Float32Array,
  indices: ArrayLike<number>,
  grow = TASSEL_GROW,
  tolerance = 1.5,
): TasselRig {
  const count = uvPx.length / 2,
    targets: { n: number; by: readonly [number, number] }[] = []
  for (const g of grow) {
    let best = -1,
      bestD = tolerance
    for (let n = 0; n < count; n++) {
      const d = Math.hypot((uvPx[2 * n] as number) - g.at[0], (uvPx[2 * n + 1] as number) - g.at[1])
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (best < 0) throw new Error('房飾りの外周の頂点が見つかりません')
    targets.push({ n: best, by: g.by })
  }
  const movedSet = new Set(targets.map((t) => t.n)),
    uvAt = (n: number): [number, number] => [uvPx[2 * n] as number, uvPx[2 * n + 1] as number]
  const moved = targets.map(({ n, by }) => {
    const goal: [number, number] = [(uvPx[2 * n] as number) + by[0], (uvPx[2 * n + 1] as number) + by[1]]
    let tri: [number, number, number] | null = null,
      bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const t: [number, number, number] = [indices[i] as number, indices[i + 1] as number, indices[i + 2] as number]
      if (t.some((k) => movedSet.has(k))) continue
      const [a, b, c] = t.map(uvAt) as [[number, number], [number, number], [number, number]],
        area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
      if (area < 4) continue
      const d = Math.hypot((a[0] + b[0] + c[0]) / 3 - goal[0], (a[1] + b[1] + c[1]) / 3 - goal[1])
      if (d < bestD) {
        bestD = d
        tri = t
      }
    }
    if (!tri) throw new Error('房飾りの外挿に使う三角形がありません')
    const bary = barycentric(goal, uvAt(tri[0]), uvAt(tri[1]), uvAt(tri[2]))
    uvPx[2 * n] = goal[0]
    uvPx[2 * n + 1] = goal[1]
    return { n, tri, bary }
  })
  return { moved }
}

/** 今の頂点 v（その場で書き換える）の広げた外周の頂点を、結び付けた三角形の今の位置から求める。 */
export function stepTasselVertices(v: Float32Array, rig: TasselRig): void {
  for (const { n, tri, bary } of rig.moved)
    for (const k of [0, 1] as const)
      v[2 * n + k] =
        bary[0] * (v[2 * tri[0] + k] as number) +
        bary[1] * (v[2 * tri[1] + k] as number) +
        bary[2] * (v[2 * tri[2] + k] as number)
}

/**
 * 房飾りの 3 段目右へ 2 段目右の房を写す（共有アトラスを直接変える）。写した画素数を返す。
 * 顔のテクスチャ補正（patchFaceTexture）より前に呼ぶ: 顔の補正は読み込み時のアトラスの写しを書き戻すため、後で変えると上書きされる。
 */
export function pasteTassel(p: PartsPlayer, mesh: number = FRONT_HAIR): number {
  const gl = p.gl,
    [width, height] = atlasSize(p),
    info = p.meshes[mesh] as Mesh
  if (width !== 4096 || height !== 4096) throw new Error('前髪のアトラスサイズが異なります')
  const x0 = TASSEL_SRC.x0 - 2,
    y0 = TASSEL_SRC.y0 - 2,
    w = TASSEL_SRC.x1 - TASSEL_SRC.x0 + 4 + TASSEL_STEP[0],
    h = TASSEL_SRC.y1 - TASSEL_SRC.y0 + 4 + TASSEL_STEP[1],
    texture = p.textures[info.texture] as WebGLTexture,
    framebuffer = gl.createFramebuffer(),
    previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    pixels = new Uint8Array(w * h * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('アトラスを読めません')
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous)
    gl.deleteFramebuffer(framebuffer)
  }
  const pasted = pasteOver(
    pixels,
    w,
    h,
    { x0: 2, y0: 2, x1: 2 + TASSEL_SRC.x1 - TASSEL_SRC.x0, y1: 2 + TASSEL_SRC.y1 - TASSEL_SRC.y0 },
    TASSEL_STEP,
  )
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return pasted
}

/**
 * 前髪の外周を写した房まで広げる（UV を変え、位置は毎フレーム stepTasselVertices で求める）。結び付けを返す。
 * patchHair（髪飾りの外周の UV 拡張）の後に呼ぶ。
 */
export function growTasselMesh(p: PartsPlayer, mesh: number = FRONT_HAIR): TasselRig {
  const gl = p.gl,
    [width, height] = atlasSize(p),
    info = p.meshes[mesh] as Mesh
  if (width !== 4096 || height !== 4096) throw new Error('前髪のアトラスサイズが異なります')
  const uvPx = new Float32Array(info.uvs.length)
  for (let i = 0; i < uvPx.length; i++) uvPx[i] = (info.uvs[i] as number) * (i % 2 ? height : width)
  const rig = growTassel(uvPx, info.indices),
    uvs = new Float32Array(info.uvs.length)
  for (let i = 0; i < uvs.length; i++) uvs[i] = (uvPx[i] as number) / (i % 2 ? height : width)
  const uvBuffer = gl.createBuffer() as WebGLBuffer
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  info.uvs = uvs
  info.uvBuffer = uvBuffer
  return rig
}
