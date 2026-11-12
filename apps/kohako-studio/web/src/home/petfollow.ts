// BOXP-505: 頭をなでている間だけ、手の側へ頭を寄せて傾け、手の動きに合わせて小さく揺らす。離すと元へ戻す。
// 角度は v11r の ParamAngleX/Y/Z（度）。PC の頭は画面上で幅 110px ほどなので、±4° では 1〜2px しか動かず
// 待機の揺れに埋もれて見えなかった（TD-01）。傾き（Z）は既存の「首かしげ」演技（13°）より小さい 9° を上限にする。
import type { Point, Rect } from './touch'
export type PetOffset = { headX: number; headY: number; headZ: number }
export const zeroPet = (): PetOffset => ({ headX: 0, headY: 0, headZ: 0 })
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
/** 押した位置からこれだけ動けば（縦・横どちらでも）なでている扱いにする。 */
export const PET_MOVE_PX = 6
const LEAN_Z = 9, LEAN_X = 4, DOWN_Y = -3, SWAY_Z = 2, SWAY_X = 2.5
export type PetTrack = { points: readonly Point[]; rect: Rect; now?: number }
export type PetOptions = { reduced: boolean; enabled: boolean; subtle: boolean }
/** 頭を押したまま動かしている（なでている）か。押しただけ・ホバーだけでは false。 */
export function isPetting(track: PetTrack | null, options: PetOptions): boolean {
  const points = track?.points ?? [], first = points[0]
  return !!first && options.enabled && !options.reduced && points.some(p => Math.hypot(p.x - first.x, p.y - first.y) >= PET_MOVE_PX)
}
// BOXP-525: 手が頭の外へ出たら押したままでも目を開く。
export function petEyesWanted(track: PetTrack | null, options: PetOptions): boolean {
  const last = track?.points.at(-1)
  if (!track || !last || !isPetting(track, options)) return false
  const { x, y, w, h } = track.rect
  return last.x >= x && last.x <= x + w && last.y >= y && last.y <= y + h
}
/** 頭がまだ追従の位置にある（離した後に戻り切っていない）か。 */
export const petShown = (o: PetOffset) => Math.max(Math.abs(o.headX), Math.abs(o.headY), Math.abs(o.headZ)) > 0.3
export function petFollow(current: PetOffset, track: PetTrack | null, dt: number, options: PetOptions): PetOffset {
  const points = track?.points ?? [], first = points[0], last = points.at(-1)
  const active = isPetting(track, options)
  let x = 0, y = 0, z = 0
  if (active && track && last) {
    const { rect } = track, recent = points.slice(-40)
    // 寄る側は直近の手の平均位置で決める（往復のたびに向きが反転して打ち消し合わないように）。中央付近なら今の傾きの側を保つ。
    const side = clamp((recent.reduce((s, p) => s + p.x, 0) / recent.length - (rect.x + rect.w / 2)) / (rect.w / 2), -1, 1)
    const sign = Math.abs(side) >= 0.12 ? Math.sign(side) : current.headZ > 0.5 ? 1 : current.headZ < -0.5 ? -1 : 1
    const lean = sign * Math.max(0.65, Math.min(1, Math.abs(side) * 1.6))
    // 揺れは直近の手の水平速度に合わせる（頭の幅の 3 倍/秒で最大）。止めて押さえているだけなら揺らさない。
    const before = points.at(-4) ?? first
    const fresh = track.now == null || track.now - last.time < 150
    const sway = fresh && before ? clamp((last.x - before.x) / Math.max(16, last.time - before.time) * 1000 / (rect.w * 3), -1, 1) : 0
    const scale = options.subtle ? 0.6 : 1
    // v11r の ParamAngleZ は正で頭頂が画面の右へ傾き、ParamAngleX は正で顔が画面の右を向く（最終描画で確認）。手の側へ寄せる。
    z = clamp(lean * LEAN_Z + sway * SWAY_Z, -11, 11) * scale
    x = clamp(lean * LEAN_X + sway * SWAY_X, -7, 7) * scale
    y = DOWN_Y * scale
  }
  const step = (value: number, target: number) => value + clamp((target - value) * (1 - Math.exp(-Math.max(0, dt) / (active ? 0.18 : 0.4))), -40 * dt, 40 * dt)
  return { headX: step(current.headX, x), headY: step(current.headY, y), headZ: step(current.headZ, z) }
}
/**
 * p2l の待機クリップは頭の角度を毎フレーム上書きし、setParameter で足した追従は描画に出ない（TD-01 で実測）。
 * なでている間だけクリップを止め、終わったら最後に指定されたクリップ（止めている間の指定も含む）を再開する。
 */
export function clipHold(basePlay: (id: string | null) => void) {
  let held = false, wanted: string | null = null
  return {
    play(id: string | null) { wanted = id; if (!held) basePlay(id) },
    hold(on: boolean) { if (on === held) return; held = on; basePlay(on ? null : wanted) },
    get held() { return held },
  }
}
