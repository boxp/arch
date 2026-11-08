// BOXP-441: PSD2Live の .p2lrt を WebAssembly runtime + WebGL で描画する共通ローダー（公式 Cubism Core 不使用）。
import { clipIdFor, clipName, lookFor, poseFor, type Pose, type RigModel, type RigState } from './model'

// p2l.js（PSD2Live web player, MIT）が公開する API のうち、この画面群で使うもの。
export interface Player {
  clips: string[]; expressions: string[]; parameters: string[]; meshes: unknown[]; gl: WebGLRenderingContext
  parameterRanges(): { id: string; min: number; max: number; default: number }[]
  parameterValues(): number[]
  play(id: string | null): void; expression(id: string | null): void; lookAt(x: number, y: number): void
  lipSync(level: number): void; setParameter(id: string, value: number): void
  start(): void; draw(): void
}
interface PlayerModule { P2LPlayer: { fromBytes(canvas: HTMLCanvasElement, runtime: WebAssembly.Exports, bytes: Uint8Array): Promise<Player> } }

export type RigLoad = { player: Player; fetchMs: number; instantiateMs: number; modelMs: number; totalMs: number; wasmBytes: number; rigBytes: number }

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
  const t3 = performance.now()
  return { player, fetchMs: t1 - t0, instantiateMs: t2 - t1, modelMs: t3 - t2, totalMs: t3 - t0, wasmBytes: wasm.byteLength, rigBytes: rig.byteLength }
}

/** [state] に応じた表情・クリップ・視線をプレイヤーへ反映し、使った組合せを返す。 */
export function applyPose(player: Player, model: RigModel, state: RigState): Pose {
  const ids = player.clips
  const pose = poseFor(state, player.expressions, ids.map(id => clipName(model, id)))
  player.expression(pose.expression); player.play(clipIdFor(model, ids, pose.clip)); player.lookAt(...lookFor(model, ...pose.look))
  return pose
}
