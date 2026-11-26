// BOXP-716: Keshin2D でコハコを動かす試作の、座標の写し方と台本（仕様は vault の Projects/kohako-home/keshin2d-trial-716.md）。
// 座り姿の決まり（裾の板・脚の寄せ方・濃さ）は通常版の live2d/seat.ts をそのまま使い、ここでは座標を写すだけ。
import { skirtPoint, type Vec } from '../live2d/seat'

/** K1: v11r のモデル座標 → Keshin2D の座標（顔の中心 x 1500・あご先 y 1167・顔の半幅 403 の型）。 */
export const K2D = { S: 403 / 92, FCX: 570.74, CHIN: 392, X0: 1500, Y0: 1167 } as const
export const toK = (x: number, y: number): Vec => [K2D.X0 + (x - K2D.FCX) * K2D.S, K2D.Y0 + (y - K2D.CHIN) * K2D.S]
export const toModel = (x: number, y: number): Vec => [K2D.FCX + (x - K2D.X0) / K2D.S, K2D.CHIN + (y - K2D.Y0) / K2D.S]
/** K2.3: 裾の板（seat-spec S8.4）を Keshin2D の座標の点に掛ける。side は通常版と同じく画面の左右。 */
export function skirtK(side: 'left' | 'right', x: number, y: number, level: number): Vec {
  if (level <= 0) return [x, y]
  const [mx, my] = toModel(x, y)
  const [sx, sy] = skirtPoint(side, mx, my, level)
  return toK(sx, sy)
}

/** K3 A: 待機 → 送信（聞いている）→ 考えている → 話している。時刻は秒（台本の始まりから）。 */
export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking'
export function stateAt(t: number, sendAt: number, thinkAt: number, speakAt: number): TalkState {
  if (t >= speakAt) return 'speaking'
  if (t >= thinkAt) return 'thinking'
  if (t >= sendAt) return 'listening'
  return 'idle'
}
/** K3 B: 座り切って 2 秒後から、左 → 右 → 上 → まん中 を 2 秒ずつ見る（-1〜1 の画面の位置）。 */
export const LOOKS: readonly Vec[] = [
  [-0.9, 0],
  [0.9, 0],
  [0, -0.9],
]
export function lookAt(t: number, seatedAt: number): Vec {
  const i = Math.floor((t - seatedAt - 2) / 2)
  return i >= 0 && i < LOOKS.length ? LOOKS[i] : [0, 0]
}
