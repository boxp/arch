// BOXP-525 r21: 絵のテクスチャをミップマップ付きの三線形補間で描く。
// v11r のアトラス (4096px) は画面で約 1.7〜2.3 倍縮小して描かれるが、p2l.js は線形補間だけでミップマップを作らない。
// 縮小時に画素が飛ばされ、頬の斜線・髪の輪郭・房飾りの紐などの細い線が段になって欠け、頭が動くとちらつく（頬のブレ）。
// p2l.js は候補セットと共有する固定の runtime なので変えず、読み込み後にここで WebGL の呼び出しを包む。

/** ミップマップを作るテクスチャか: 2 のべき乗で、縦横とも min 以上（描画先の小さな作業用テクスチャは除く）。 */
export function mippable(width: number, height: number, min = 256): boolean {
  const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0
  return width >= min && height >= min && pow2(width) && pow2(height)
}

type MipPlayer = {
  gl: WebGLRenderingContext
  textures: (WebGLTexture | undefined)[]
  draw(): void
}

/**
 * 読み込み済みの絵のテクスチャ（textures の各要素、大きさ sizes）をミップマップ付きにし、以後:
 * - 線形補間を指定された 2 のべき乗のテクスチャ（読み込み時の補正で作る切り出し）も三線形補間にする
 * - texSubImage2D で書き換えたテクスチャは、次の描画の前にミップマップを作り直す
 * 対象にしたテクスチャ数を返す。
 */
export function installMipmaps(p: MipPlayer, sizes: readonly (readonly [number, number])[]): number {
  const gl = p.gl,
    tracked = new WeakMap<WebGLTexture, { width: number; height: number; mip: boolean }>(),
    dirty = new Set<WebGLTexture>(),
    bound = () => gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
  const previous = bound()
  let count = 0
  p.textures.forEach((texture, i) => {
    const [width, height] = sizes[i] ?? [0, 0]
    if (!texture || !mippable(width, height)) return
    tracked.set(texture, { width, height, mip: true })
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.generateMipmap(gl.TEXTURE_2D)
    count++
  })
  gl.bindTexture(gl.TEXTURE_2D, previous)
  const texImage2D = gl.texImage2D.bind(gl) as (...args: unknown[]) => void,
    texSubImage2D = gl.texSubImage2D.bind(gl) as (...args: unknown[]) => void,
    texParameteri = gl.texParameteri.bind(gl)
  ;(gl as unknown as { texImage2D: (...args: unknown[]) => void }).texImage2D = (...args: unknown[]) => {
    const texture = bound()
    if (texture && args[0] === gl.TEXTURE_2D && args[1] === 0) {
      const source = args[5] as { width?: number; height?: number } | null | undefined,
        width = args.length >= 9 ? (args[3] as number) : (source?.width ?? 0),
        height = args.length >= 9 ? (args[4] as number) : (source?.height ?? 0),
        before = tracked.get(texture),
        mip = before?.mip === true && mippable(width, height)
      tracked.set(texture, { width, height, mip })
      if (mip) dirty.add(texture)
    }
    texImage2D(...args)
  }
  ;(gl as unknown as { texSubImage2D: (...args: unknown[]) => void }).texSubImage2D = (...args: unknown[]) => {
    const texture = bound()
    if (texture && args[1] === 0 && tracked.get(texture)?.mip) dirty.add(texture)
    texSubImage2D(...args)
  }
  gl.texParameteri = (target: number, name: number, value: number) => {
    const texture = bound(),
      entry = texture && target === gl.TEXTURE_2D ? tracked.get(texture) : undefined
    if (texture && entry && name === gl.TEXTURE_MIN_FILTER) {
      entry.mip = value === gl.LINEAR && mippable(entry.width, entry.height)
      if (entry.mip) {
        dirty.add(texture)
        texParameteri(target, name, gl.LINEAR_MIPMAP_LINEAR)
        return
      }
      dirty.delete(texture)
    }
    texParameteri(target, name, value)
  }
  const draw = p.draw.bind(p)
  p.draw = () => {
    if (dirty.size) {
      const keep = bound()
      for (const texture of dirty) {
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.generateMipmap(gl.TEXTURE_2D)
      }
      dirty.clear()
      gl.bindTexture(gl.TEXTURE_2D, keep)
    }
    draw()
  }
  return count
}

type PngRuntime = {
  memory: WebAssembly.Memory
  p2l_alloc(n: number): number
  p2l_dealloc(p: number, n: number): void
  p2l_texture_png(rig: number, i: number, a: number, b: number, c: number): number
}
/** runtime が持つ各テクスチャの PNG の縦横（IHDR）。 */
export function textureSizes(rt: PngRuntime, rig: number, count: number): [number, number][] {
  const out = rt.p2l_alloc(16),
    sizes: [number, number][] = []
  try {
    for (let i = 0; i < count; i++) {
      const pointer = rt.p2l_texture_png(rig, i, out, out + 8, out + 12),
        header = new DataView(rt.memory.buffer, pointer + 16, 8)
      sizes.push([header.getUint32(0), header.getUint32(4)])
    }
  } finally {
    rt.p2l_dealloc(out, 16)
  }
  return sizes
}
