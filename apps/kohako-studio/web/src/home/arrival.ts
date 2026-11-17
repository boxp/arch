// BOXP-599 TD-01: コハコが家へ戻る演出。既存のドット絵と CSS だけで描き、実際の処理状態（リグの読み込み・現場の実行）に合わせて切り替える。
// 演出のために待たせない（入力・送信は止めない）。着地は短い一回きりで、明滅はしない。
export type Arrival = 'arriving' | 'away' | 'landing' | 'home'
export const LANDING_MS = 900
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
  arriving: '家へ戻っています…',
  away: '現場に出ています',
  landing: 'ただいま戻りました',
  home: '',
}
