// BOXP-599 TD-01: 帰還の演出（転送ゲート）。出ている間・戻る途中は小さなドット絵（通信中の姿）がゲートの上に浮かび、
// 戻った瞬間に走査線とともに本来の姿が現れる。段階は実際の処理状態（リグの読み込み・現場の実行）だけで決める。
// 演出のために待たせない（入力・送信は止めない）。現れるのは短い一回きりで、明滅はしない。見た目は style.css の .gate。
export type Arrival = 'arriving' | 'away' | 'landing' | 'home'
export const LANDING_MS = 1000
export type ArrivalInput = {
  /** リグ（動く姿）を読み込み中。読み込みが終わる・失敗する・静止表情指定ならば false。 */
  rigLoading: boolean
  /** 現場の実行中。 */
  visit: boolean
  /** 直近に戻った時刻（読み込み完了・現場からの帰還）。無ければ null。 */
  returnedAt: number | null
  now: number
}
export function arrivalPhase(x: ArrivalInput): Arrival {
  if (x.visit) return 'away'
  if (x.rigLoading) return 'arriving'
  if (x.returnedAt !== null && x.now - x.returnedAt >= 0 && x.now - x.returnedAt < LANDING_MS) return 'landing'
  return 'home'
}
export const arrivalNote: Record<Arrival, string> = {
  arriving: '戻っています',
  away: '現場へ出ています',
  landing: '戻りました',
  home: '',
}
