// BOXP-626: 場面・画面の形が変わる時のコハコの移り方。
// 以前は .character の幅・高さ・位置を 0.3 秒かけて CSS で動かしていたため、その間 WebGL の canvas（DPR 2 以上・上半身枠では
// 3479×2883 px など）が毎フレーム作り直され、さらに全身/上半身の枠（data-frame）だけが即時に切り替わって一瞬だけ大きく/小さく
// 描かれていた（発言後や作業中への切替で「壊れたように」見える。実機 GPU では大きな再確保が重なると背景のタイルまで描き直しになる）。
// いまは箱を一度で新しい配置へ移し（canvas の作り直しは 1 回）、直前の絵を 2D の写しとして元の位置に残して短く溶かし、
// 新しい絵を同時に浮かび上がらせる。動きを減らす設定・OS の reduced-motion・出入りの演出中は写しを作らず即時に切り替える。
export type Rect = { left: number; top: number; width: number; height: number }

/** この差を超えて canvas の位置・大きさが変わった時だけ写しで移す（ウィンドウを少しずつ広げる操作では写しを作らず追従させる）。 */
export const MORPH_JUMP = 0.04
export const MORPH_MS = 240

/** 写しで移すべき変化か。枠（全身/上半身）が替わった時と、canvas がひと息に大きく動いた・伸び縮みした時。 */
export function morphWanted(before: Rect, after: Rect, frameChanged: boolean): boolean {
  if (!(before.width > 0 && before.height > 0 && after.width > 0 && after.height > 0)) return false
  if (frameChanged) return true
  const scale = Math.max(before.width, before.height),
    jump = Math.max(
      Math.abs(after.left - before.left),
      Math.abs(after.top - before.top),
      Math.abs(after.width - before.width),
      Math.abs(after.height - before.height),
    )
  return jump > scale * MORPH_JUMP
}

export type MorphDeps = {
  character: HTMLElement
  canvas: HTMLCanvasElement
  /** 写しの直前に最新の姿勢で描き直す（WebGL の描画バッファは表示後に消えるため、同じタスクの中で描いてから写す）。 */
  draw: () => void
  /** 写しで移してよいか（リグ表示中・動きを減らしていない・出入りの演出中でない）。 */
  enabled: () => boolean
  /** 枠（全身/上半身）が替わった時に、次の描画を待たず拡大率を合わせる。 */
  frameChanged?: () => void
  ms?: number
}

export type CharacterMorph = {
  /** [change] で配置を変える。変化が大きければ直前の絵を写しで溶かし、新しい絵を浮かび上がらせる。 */
  around(change: () => void): void
  /** 進行中の写しの数（検証用）。 */
  readonly active: number
  /** 写しで移した回数（検証用）。 */
  readonly count: number
}

export function createCharacterMorph(deps: MorphDeps): CharacterMorph {
  const ms = deps.ms ?? MORPH_MS
  let ghost: HTMLCanvasElement | null = null,
    timer: ReturnType<typeof setTimeout> | null = null,
    count = 0
  const finish = () => {
    if (timer) clearTimeout(timer)
    timer = null
    ghost?.remove()
    ghost = null
    deps.character.classList.remove('morph-in')
  }
  const snapshot = (): { copy: HTMLCanvasElement; rect: Rect; clip: string } | null => {
    const { canvas, character } = deps,
      r = canvas.getBoundingClientRect(),
      c = character.getBoundingClientRect(),
      // .character は canvas の上下を切る（小窓では左右も）。写しも同じ範囲だけ見せる。
      side = character.classList.contains('mini'),
      clip = `inset(${Math.max(0, c.top - r.top)}px ${side ? Math.max(0, r.right - c.right) : 0}px ${Math.max(0, r.bottom - c.bottom)}px ${side ? Math.max(0, c.left - r.left) : 0}px)`
    if (!(r.width > 0 && r.height > 0 && canvas.width > 0 && canvas.height > 0)) return null
    deps.draw()
    const copy = canvas.ownerDocument.createElement('canvas'),
      // 写しは画面の解像度までに抑える（元の canvas は DPR 2 以上に固定されていて大きい）。
      k = Math.min(1, ((globalThis.devicePixelRatio || 1) * r.width) / canvas.width)
    copy.width = Math.max(1, Math.round(canvas.width * k))
    copy.height = Math.max(1, Math.round(canvas.height * k))
    const g = copy.getContext('2d')
    if (!g) return null
    g.drawImage(canvas, 0, 0, copy.width, copy.height)
    return { copy, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, clip }
  }
  return {
    get active() {
      return ghost ? 1 : 0
    },
    get count() {
      return count
    },
    around(change) {
      if (!deps.enabled()) {
        finish()
        change()
        return
      }
      const frameBefore = deps.character.dataset.frame
      // 移っている途中にまた替わった時（キーボードの出入りで高さが何度も変わる等）は、浮かび上がりを最初からやり直すと
      // 点滅になるため、写しはそのまま溶かし続け、配置だけを替える。
      if (ghost) {
        change()
        if (deps.character.dataset.frame !== frameBefore) deps.frameChanged?.()
        return
      }
      const shot = snapshot()
      change()
      if (!shot) return
      const after = deps.canvas.getBoundingClientRect(),
        frameChanged = deps.character.dataset.frame !== frameBefore
      if (frameChanged) deps.frameChanged?.()
      if (!morphWanted(shot.rect, after, frameChanged)) return
      const host = deps.character.parentElement
      if (!host) return
      const h = host.getBoundingClientRect(),
        { copy, rect, clip } = shot
      copy.className = 'morph-ghost'
      copy.setAttribute('aria-hidden', 'true')
      Object.assign(copy.style, {
        left: `${rect.left - h.left}px`,
        top: `${rect.top - h.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        clipPath: clip,
        animationDuration: `${ms}ms`,
      })
      deps.character.style.setProperty('--morph-ms', `${ms}ms`)
      host.insertBefore(copy, deps.character)
      ghost = copy
      count++
      // 新しい絵の浮かび上がりを最初から始める。
      deps.character.classList.remove('morph-in')
      void deps.character.offsetWidth
      deps.character.classList.add('morph-in')
      timer = setTimeout(finish, ms + 80)
    },
  }
}

export type LayoutInput = {
  scene: string
  shape: string
  kbd: boolean
  upper: boolean
  mini: boolean
  viewer: boolean
  vh: number
}
/** コハコの配置を決める値の組。これが変わった時だけ写しを取る（毎秒の場面更新では描き直さない）。 */
export const layoutKey = (x: LayoutInput): string =>
  [
    x.scene,
    x.shape,
    x.kbd ? 'kbd' : '',
    x.upper ? 'upper' : 'full',
    x.mini ? 'mini' : '',
    x.viewer ? 'viewer' : '',
    x.vh,
  ].join('|')
