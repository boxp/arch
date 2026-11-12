// BOXP-441: PSD2Live の .p2lrt を WebAssembly runtime + WebGL で描画する共通ローダー（公式 Cubism Core 不使用）。
import { clipIdFor, clipName, lookFor, poseFor, type Pose, type RigModel, type RigState } from './model'

// p2l.js（PSD2Live web player, MIT）が公開する API のうち、この画面群で使うもの。
export interface Player {
  clips: string[]; expressions: string[]; parameters: string[]; meshes: unknown[]; gl: WebGLRenderingContext
  parameterRanges(): { id: string; min: number; max: number; default: number }[]
  parameterValues(): number[]
  play(id: string | null): void; expression(id: string | null): void; lookAt(x: number, y: number): void
  lipSync(level: number): void; setParameter(id: string, value: number): void
  view: { zoom: number; x: number; y: number }; width: number; height: number
  start(): void; draw(): void
}
interface PlayerModule { P2LPlayer: { fromBytes(canvas: HTMLCanvasElement, runtime: WebAssembly.Exports, bytes: Uint8Array): Promise<Player> } }

export type RigLoad = { player: Player; fetchMs: number; instantiateMs: number; modelMs: number; totalMs: number; wasmBytes: number; rigBytes: number }

export function frameFor(model: RigModel, search: string): 'full' | 'upper' {
  return model.id.startsWith('kohako-full-') && new URLSearchParams(search).get('frame') === 'upper' ? 'upper' : 'full'
}

/**
 * BOXP-510 TD-02: 家の canvas は腕・袖がモデル枠（1143 幅）の外へ振れても切れないよう左右へ余白（data-bleed）を持つ。
 * 余白なしの時と同じ画面上の大きさ・位置で描くため、余白なしの幅 [base] で求めた拡大率に合わせて zoom を補正する。
 * fit は余白なしの時の当てはめ倍率（上半身の縦位置の計算に使う）。
 */
export function bleedZoom(baseZoom: number, base: number, width: number, height: number, modelW: number, modelH: number): { zoom: number; fit: number } {
  const fitOf = (w: number) => Math.min(w / modelW, height / modelH), fit0 = fitOf(base), fit1 = fitOf(width)
  if (!(fit0 > 0) || !(fit1 > 0)) return { zoom: baseZoom, fit: fit1 > 0 ? fit1 : 0 }
  return { zoom: baseZoom * fit0 / fit1, fit: fit0 }
}

/** 余白なしの canvas 幅: 全身は親（.character）の幅、上半身（?frame=upper か、横向き等で CSS が上半身枠にした時）はモデルの縦横比の幅。 */
export function bleedBaseWidth(upper: boolean, rect: { width: number; height: number }, parentWidth: number | undefined, model: { width: number; height: number }): number {
  if (upper) return rect.height * model.width / model.height
  return parentWidth && parentWidth > 0 ? Math.min(parentWidth, rect.width) : rect.width
}

/** runtime（p2l.js / p2l_runtime.wasm）は [runtimeDir] から、モデルは model.rig（runtimeDir 相対）から読む。 */
export async function loadRig(canvas: HTMLCanvasElement, model: RigModel, runtimeDir: string): Promise<RigLoad> {
  canvas.dataset.fullModel = String(model.id.startsWith('kohako-full-'))
  const t0 = performance.now()
  const base = new URL(runtimeDir, location.href)
  const [mod, wasm, rig] = await Promise.all([
    import(/* @vite-ignore */ new URL('p2l.js', base).href) as Promise<PlayerModule>,
    fetch(new URL('p2l_runtime.wasm', base), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(`runtime の取得に失敗 (${r.status})`); return r.arrayBuffer() }),
    fetch(new URL(model.rig, base), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(`モデルの取得に失敗 (${r.status})`); return r.arrayBuffer() }),
  ])
  const t1 = performance.now()
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const t2 = performance.now()
  const player = await mod.P2LPlayer.fromBytes(canvas, instance.exports, new Uint8Array(rig))
  if (model.id.startsWith('kohako-full-')) {
    const updateFrame = () => {
      const upper = frameFor(model, location.search) === 'upper'
      const rect = canvas.getBoundingClientRect()
      const base = 'bleed' in canvas.dataset ? bleedBaseWidth(upper || canvas.parentElement?.dataset.frame === 'upper', rect, canvas.parentElement?.getBoundingClientRect().width, player) : rect.width
      const { zoom, fit } = bleedZoom(upper ? 1.8 : 1, base, rect.width, rect.height, player.width, player.height)
      player.view.zoom = zoom
      player.view.x = 0
      player.view.y = upper ? fit * player.height * 0.37 : 0
      player.draw()
    }
    window.addEventListener('kohako-frame-change', updateFrame)
    new ResizeObserver(updateFrame).observe(canvas)
    updateFrame()
  }
  const t3 = performance.now()
  return { player, fetchMs: t1 - t0, instantiateMs: t2 - t1, modelMs: t3 - t2, totalMs: t3 - t0, wasmBytes: wasm.byteLength, rigBytes: rig.byteLength }
}

/** [state] に応じた表情・クリップ・視線をプレイヤーへ反映し、使った組合せを返す。 */
export function applyPose(player: Player, model: RigModel, state: RigState): Pose {
  const ids = player.clips
  const pose = poseFor(state, player.expressions, ids.map(id => clipName(model, id)))
  player.expression(model.noExpressions ? null : pose.expression); player.play(clipIdFor(model, ids, pose.clip)); player.lookAt(...lookFor(model, ...pose.look))
  return pose
}
