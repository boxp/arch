// BOXP-694: 1 枚腕（制止・挨拶・照れ・案内の、腕 1 本を 1 枚に描いた絵）への差し替えの段取り。
// 以前は待機の腕（垂らした位置）と 1 枚腕（上げた位置）を 0.25 秒のフェードで入れ替えていたので、その間、離れた 2 か所に
// 半透明の腕が同時に見えた（二重腕）。いまは次の順に進める。
//   lead: 変形の腕（肩・肘・手首を回して動かす待機の腕）を、1 枚腕の肘・手首の位置まで動かす。1 枚腕はまだ出さない。
//   in:   重なった状態で、1 枚腕を上に短くフェードインする。下の変形の腕は不透明のまま（背景は透けない）。
//   hold: 1 枚腕だけを描く。変形の腕は 1 枚腕の位置を追い続ける（見えない）。
//   out:  変形の腕を下に出し、1 枚腕を短くフェードアウトする。終わったら呼び出し側が変形の腕を待機（または次の動作）へ動かす。
// ここは「いつ何を描くか」だけを決める係で、腕の位置合わせ（matchArm）と描画は gesture.ts が行う。
// 仕様: Obsidian の Projects/kohako-home/arm-switch-spec.md

/** 1 枚腕のフェードの長さ（秒）。重なった腕どうしの入れ替えなので短くてよい。 */
export const SWITCH_SECONDS = 0.12
export type SwitchPhase = 'off' | 'lead' | 'in' | 'hold' | 'out'
const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

export class ArmSwitch {
  phase: SwitchPhase = 'off'
  /** いまの段に入ってからの秒と、その段の長さ。 */
  t = 0
  seconds = 0
  /** 1 枚腕の不透明度。 */
  alpha = 0
  /** 1 枚腕の動作の途中か（lead から out の終わりまで）。 */
  get on(): boolean {
    return this.phase !== 'off'
  }
  /** lead の進み（0〜1、滑らかに）。lead 以外では 1。 */
  get lead(): number {
    return this.phase === 'lead' ? ease(this.t / this.seconds) : 1
  }
  /** 1 枚腕の動作を始める。seconds は lead の長さ。 */
  enter(seconds: number): void {
    this.phase = 'lead'
    this.t = 0
    this.seconds = Math.max(1e-3, seconds)
    this.alpha = 0
  }
  /**
   * 時間を進める。ready は 1 枚腕の絵が読めているか（読めていなければ変形の腕のまま動かし、1 枚腕は出さない。
   * 保持の途中で読めたら、そこから 0.12 秒でフェードインする）。
   * out が終わったら true（呼び出し側が変形の腕を待機へ戻し始める）。
   */
  tick(dt: number, ready: boolean): boolean {
    if (this.phase === 'off') return false
    if (this.phase === 'hold') {
      // 絵が読める前に hold へ入っていたら（不透明度 0 のまま）、読めた時点からフェードインする。いきなり出さない。
      if (ready && this.alpha < 1) this.start('in', 0)
      return false
    }
    this.t += dt
    const done = this.t >= this.seconds
    if (this.phase === 'lead') {
      if (!done) return false
      if (ready) this.start('in', 0)
      else this.rest('hold', 0)
      return false
    }
    const x = ease(this.t / this.seconds)
    this.alpha = this.phase === 'in' ? x : 1 - x
    if (!done) return false
    if (this.phase === 'in') {
      this.rest('hold')
      return false
    }
    this.rest('off')
    return true
  }
  /**
   * 1 枚腕を終える要求。1 枚腕がまだ出ていない（lead の途中・絵が読めていない）ときは、その場で終わって true。
   * 出ているときは out へ入り（フェードインの途中なら、いまの不透明度から続けて消す）、false。out の途中の再要求は何もしない。
   */
  leave(ready: boolean): boolean {
    if (this.phase === 'off') return true
    if (this.phase === 'out') return false
    if (!this.pieceShown(ready)) {
      this.rest('off')
      return true
    }
    this.start('out', this.phase === 'in' ? SWITCH_SECONDS - this.t : 0)
    return false
  }
  /** 1 枚腕を描くか。 */
  pieceShown(ready: boolean): boolean {
    return ready && this.on && this.alpha > 0.001
  }
  /** 変形の腕（小手・手）を描くか。1 枚腕が出切っている（hold で不透明度 1 の）間だけ描かない。 */
  rigShown(ready: boolean): boolean {
    return !(ready && this.phase === 'hold' && this.alpha >= 1)
  }
  private start(phase: 'in' | 'out', t: number): void {
    this.phase = phase
    this.t = Math.min(SWITCH_SECONDS, Math.max(0, t))
    this.seconds = SWITCH_SECONDS
    const x = ease(this.t / this.seconds)
    this.alpha = phase === 'in' ? x : 1 - x
  }
  private rest(phase: 'hold' | 'off', alpha = phase === 'hold' ? 1 : 0): void {
    this.phase = phase
    this.t = 0
    this.seconds = 0
    this.alpha = alpha
  }
}
