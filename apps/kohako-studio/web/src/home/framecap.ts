// BOXP-738（試作候補のみ）: 静かな待機の間だけ、コハコ本体の描き直しを約 30 回/秒に抑える。
// 決まりは vault の Projects/kohako-home/idle-framecap-738.md。会話・ふれあいの判断や視線の計算は今まで通り毎フレーム。

/** 既定の上限（回/秒）。 */
export const IDLE_FPS = 30
/** マウス・指を動かしてから、この間は毎フレーム描く（視線がカーソルを追う途中をなめらかに）。 */
export const CAP_POINTER_QUIET_MS = 4000
/** 画面の更新時刻のゆらぎの余裕（ms）。予定時刻より少し早いフレームでも描く（平均の回数は上限を超えない）。 */
const JITTER_MS = 1

/** URL の ?idlefps。null は間引かない（off）。不正な値は既定の 30。 */
export function frameCapOption(search: string): number | null {
  const v = new URLSearchParams(search).get('idlefps')
  if (v === 'off') return null
  if (v !== null && /^\d+$/.test(v)) {
    const n = Number(v)
    if (n >= 10 && n <= 60) return n
  }
  return IDLE_FPS
}

export type CapInput = {
  /** 状態が待機で、送信中でもない。 */
  idle: boolean
  /** 家にいる（おでかけ・帰還の演出中ではない）。 */
  home: boolean
  /** なで・離して戻る途中・タップの反応・ふれあいや演技の身振りの最中。 */
  touching: boolean
  /** 録音・長押しの最中。 */
  recording: boolean
  /** マウス・指を最後に動かしてからの時間（ms）。 */
  sinceMoveMs: number
}

/** 間引いてよいか（すべての条件を満たす時だけ真）。 */
export const capWanted = (c: CapInput): boolean =>
  c.idle && c.home && !c.touching && !c.recording && c.sinceMoveMs > CAP_POINTER_QUIET_MS

/** このフレームで描くか。fps が null か、間引かない状況（capped が偽）なら毎回描く。間引き中は次に描く予定時刻 nextAt になったら描く。 */
export function drawDue(now: number, nextAt: number, fps: number | null, capped: boolean): boolean {
  if (fps === null || !capped) return true
  return now >= nextAt - JITTER_MS
}

/**
 * 描いた後の、次に描く予定時刻。間引き中は前の予定に 1000/fps を足す（画面の更新が予定より遅れても回数が上限を超えないように、
 * 描いた時刻ではなく予定を積み上げる）。予定を 1 間隔以上過ぎていた（重くて描けなかった・裏タブから戻った）時は今から数え直す。
 * 毎フレーム描いている間は、描いた時刻から数える（間引きへ移った最初の 1 枚が 1 間隔あく）。
 */
export function nextDrawAt(prevNext: number, now: number, fps: number | null, capped: boolean): number {
  if (fps === null) return now
  const interval = 1000 / fps
  if (!capped) return now + interval
  const n = prevNext + interval
  return n > now ? n : now + interval
}

type Loop = {
  start(): void
  stop(): void
  update(dt: number): void
  draw(): void
}

/**
 * プレイヤーの描画ループ（p2l.js の start）を、間引きつきのものへ差し替える。経過時間は前に描いた時刻からの差（最大 0.1 秒）。
 * stop() は p2l.js と同じ animation の番号を消すので、そのまま使える。
 */
export function capPlayerLoop(
  player: Loop,
  fps: number | null,
  capped: (now: number) => boolean,
  onDraw: (capped: boolean) => void = () => {},
) {
  const p = player as Loop & { animation?: number }
  p.start = () => {
    let last = performance.now(),
      nextAt = Number.NEGATIVE_INFINITY
    const frame = (now: number) => {
      const c = capped(now)
      if (drawDue(now, nextAt, fps, c)) {
        p.update(Math.min((now - last) / 1000, 0.1))
        last = now
        nextAt = nextDrawAt(nextAt, now, fps, c)
        p.draw()
        onDraw(c)
      }
      p.animation = requestAnimationFrame(frame)
    }
    p.animation = requestAnimationFrame(frame)
  }
}
