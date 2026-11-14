// BOXP-516: Studio（live2d.html）のマウス追従と同じく、カーソルの方向へ p2l の視線（lookAt: 目と頭の向き）を向ける。
// ここは座標の換算と補間だけの純関数。±1 を lookAt の FOLLOW_MAX へ換算する。
// Studio の倍率（lookFor = 0.3）のままでは家の v11r で瞳が ±2px しか動かず待機の揺れに埋もれた（実測）。±0.5 で約 ±5.5px と見て分かり、
// 髪や輪郭の破綻もない（±1 では髪が伸びる）ので、左右 0.5・上下 0.45 を上限にする。
export type Look = { x: number; y: number }
export type Bounds = { left: number; top: number; width: number; height: number }
/** 顔から画面端までの距離のこの割合（最低 MIN_REACH px）で向ききる。顔の近くでも向きが分かり、端へ寄せても伸びすぎない。 */
export const REACH = 0.6,
  MIN_REACH = 160,
  DEADZONE = 0.04,
  FOLLOW_SECONDS = 0.22
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v))
/** 顔の中心を原点に、右・上を正とする [-1, 1] の向き。角では斜めの合成が 1 を超えないよう円に収め、顔の真上付近の小さな揺れは不感帯で消す。 */
export function mapLook(p: Look, face: Look, viewport: Bounds): Look {
  const dx = p.x - face.x,
    dy = p.y - face.y
  const reach = (edge: number) => Math.max(MIN_REACH, edge * REACH)
  let x = clamp(dx / reach(dx < 0 ? face.x - viewport.left : viewport.left + viewport.width - face.x))
  let y = clamp(-dy / reach(dy < 0 ? face.y - viewport.top : viewport.top + viewport.height - face.y))
  const len = Math.hypot(x, y)
  if (len > 1) {
    x /= len
    y /= len
  }
  const dead = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - DEADZONE)) / (1 - DEADZONE))
  return { x: dead(x), y: dead(y) }
}
/** 追従しないとき（カーソルが画面外・無効・なで中など）は中立 {0,0}。控えめでは 6 割にする。 */
export function lookTarget(
  pointer: Look | null,
  face: Look,
  viewport: Bounds,
  enabled: boolean,
  blocked: boolean,
  subtle: boolean,
): Look {
  if (!pointer || !enabled || blocked) return { x: 0, y: 0 }
  const v = mapLook(pointer, face, viewport),
    scale = subtle ? 0.6 : 1
  return { x: v.x * scale, y: v.y * scale }
}
/** 指数補間でフレームレートによらず滑らかに追従する（急な首振りをしない）。 */
export function smoothLook(current: Look, target: Look, dt: number, seconds = FOLLOW_SECONDS): Look {
  const k = 1 - Math.exp(-Math.max(0, dt) / seconds)
  return { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k }
}
/**
 * 状態の視線（考え中は右上など）とカーソル追従の混ぜ合わせ。weight は追従の効き（0..1）。
 * 状態が独自の視線を持つときは追従を弱め（POSE_LOOK_WEIGHT）、考え中の目線が消えないようにする。
 */
export const POSE_LOOK_WEIGHT = 0.35,
  FOLLOW_MAX = { x: 0.5, y: 0.45 } as const
/** [pose] は lookFor 済み（lookAt の単位）の状態の視線、[follow] は ±1 の追従。lookAt へ渡す値を返す。 */
export function blendLook(pose: readonly [number, number], follow: Look, weight: number): [number, number] {
  return [
    pose[0] * (1 - weight) + follow.x * FOLLOW_MAX.x * weight,
    pose[1] * (1 - weight) + follow.y * FOLLOW_MAX.y * weight,
  ]
}
export const followWeightFor = (pose: readonly [number, number]) =>
  pose[0] !== 0 || pose[1] !== 0 ? POSE_LOOK_WEIGHT : 1
