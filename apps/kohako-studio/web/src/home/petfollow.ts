// BOXP-505: 頭をなでている間だけ、手の側へ頭を寄せて傾け、手の動きに合わせて小さく揺らす。離すと元へ戻す。
// 角度は v11r の ParamAngleX/Y/Z（度）。PC の頭は画面上で幅 110px ほどなので、±4° では 1〜2px しか動かず
// 待機の揺れに埋もれて見えなかった（TD-01）。傾き（Z）は既存の「首かしげ」演技（13°）より小さい 9° を上限にする。
import type { Point, Rect } from './touch'
export type PetOffset = { headX: number; headY: number; headZ: number }
export const zeroPet = (): PetOffset => ({ headX: 0, headY: 0, headZ: 0 })
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x))
/** 押した位置からこれだけ動けば（縦・横どちらでも）なでている扱いにする。 */
export const PET_MOVE_PX = 6
const LEAN_Z = 9,
  LEAN_X = 4,
  DOWN_Y = -3,
  SWAY_Z = 2,
  SWAY_X = 2.5
export type PetTrack = { points: readonly Point[]; rect: Rect; now?: number }
export type PetOptions = { reduced: boolean; enabled: boolean; subtle: boolean }
/** 頭を押したまま動かしている（なでている）か。押しただけ・ホバーだけでは false。 */
export function isPetting(track: PetTrack | null, options: PetOptions): boolean {
  const points = track?.points ?? [],
    first = points[0]
  return (
    !!first &&
    options.enabled &&
    !options.reduced &&
    points.some((p) => Math.hypot(p.x - first.x, p.y - first.y) >= PET_MOVE_PX)
  )
}
// BOXP-525: 閉眼後は頭の周囲に余裕を持たせ、遠くへ離れるか解除すると開く。
export function petEyesWanted(track: PetTrack | null, options: PetOptions, previouslyClosed = false): boolean {
  const last = track?.points.at(-1)
  if (!track || !last || !isPetting(track, options)) return false
  const { x, y, w, h } = track.rect
  const margin = previouslyClosed ? 0.35 : 0
  return (
    last.x >= x - w * margin &&
    last.x <= x + w * (1 + margin) &&
    last.y >= y - h * margin &&
    last.y <= y + h * (1 + margin)
  )
}
/** 頭がまだ追従の位置にある（離した後に戻り切っていない）か。 */
export const petShown = (o: PetOffset) => Math.max(Math.abs(o.headX), Math.abs(o.headY), Math.abs(o.headZ)) > 0.3
export function petFollow(current: PetOffset, track: PetTrack | null, dt: number, options: PetOptions): PetOffset {
  const points = track?.points ?? [],
    first = points[0],
    last = points.at(-1)
  const active = isPetting(track, options)
  let x = 0,
    y = 0,
    z = 0
  if (active && track && last) {
    // 寄る側は直近 0.7 秒の手の平均位置で決める（往復のたびに向きが反転して打ち消し合わないように）。
    // BOXP-525: 点数で区切ると入力間隔で窓の長さが変わり、中央をまたぐ往復で平均が揺れて傾きが往復ごとに一瞬反転していた（ガクガク）。
    // 時間で区切り、いったん寄った側は反対側へはっきり寄る（|side| ≥ 0.45）まで保つ。
    const { rect } = track,
      recent = points.filter((p) => p.time >= last.time - 700)
    const side = clamp(
      (recent.reduce((s, p) => s + p.x, 0) / recent.length - (rect.x + rect.w / 2)) / (rect.w / 2),
      -1,
      1,
    )
    const held = current.headZ > 0.5 ? 1 : current.headZ < -0.5 ? -1 : 0
    const sign = held !== 0 ? (side * held <= -0.45 ? -held : held) : Math.abs(side) >= 0.12 ? Math.sign(side) : 1
    const lean = sign * Math.max(0.65, Math.min(1, Math.abs(side) * 1.6))
    // 揺れは直近の手の水平速度に合わせる（頭の幅の 3 倍/秒で最大）。止めて押さえているだけなら揺らさない。
    // BOXP-525: 直近 3 点の速度は入力間隔の揺れ（スマホは 8〜40ms）で暴れ、頭が小刻みに揺れていた。約 0.12 秒前の点との平均速度にし、
    // 手が止まったら急に 0 にせず 0.15〜0.35 秒かけて弱める。
    let before = first
    for (let i = points.length - 2; i >= 0; i--) {
      before = points[i]
      if (last.time - points[i].time >= 120) break
    }
    const idle = track.now == null ? 0 : Math.max(0, track.now - last.time)
    const fade = clamp(1 - (idle - 150) / 200, 0, 1)
    const sway =
      before && before !== last
        ? clamp((((last.x - before.x) / Math.max(16, last.time - before.time)) * 1000) / (rect.w * 3), -1, 1) * fade
        : 0
    const scale = options.subtle ? 0.6 : 1
    // v11r の ParamAngleZ は正で頭頂が画面の右へ傾き、ParamAngleX は正で顔が画面の右を向く（最終描画で確認）。手の側へ寄せる。
    z = clamp(lean * LEAN_Z + sway * SWAY_Z, -11, 11) * scale
    x = clamp(lean * LEAN_X + sway * SWAY_X, -7, 7) * scale
    y = DOWN_Y * scale
  }
  const step = (value: number, target: number) =>
    value + clamp((target - value) * (1 - Math.exp(-Math.max(0, dt) / (active ? 0.18 : 0.4))), -40 * dt, 40 * dt)
  return { headX: step(current.headX, x), headY: step(current.headY, y), headZ: step(current.headZ, z) }
}
/**
 * p2l の待機クリップは頭の角度を毎フレーム上書きし、setParameter で足した追従は描画に出ない（TD-01 で実測）。
 * なでている間だけクリップを止め、終わったら最後に指定されたクリップ（止めている間の指定も含む）を再開する。
 */
export function clipHold(basePlay: (id: string | null) => void) {
  let held = false,
    wanted: string | null = null
  return {
    play(id: string | null) {
      wanted = id
      if (!held) basePlay(id)
    },
    hold(on: boolean) {
      if (on === held) return
      held = on
      basePlay(on ? null : wanted)
    },
    get held() {
      return held
    },
  }
}
