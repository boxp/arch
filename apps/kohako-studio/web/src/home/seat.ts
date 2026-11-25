// BOXP-698: 待機中、気分で宙に浮く椅子へ腰かける。ここは「いつ座り・いつ立ち・いまどれだけ座っているか」を決める純粋な係で、
// 描画（脚の変形と椅子）は live2d/gesture.ts の stage.setSeat、体の上下は main が行う。仕様は vault の Projects/kohako-home/seat-spec.md。
// 待機のしぐさ（idle.ts）とは別の層: 座っている間も、しぐさ・視線追従・なでる・タップの反応は従来どおり上半身に出る。
// 話しかけられても立たない（Owner 要望 2026-11-25「座りたい時は座ったまま会話してよい」）。急いで立つのは、家を出る・小さい表示・設定の変更の時だけ。
// この係は入力を読むだけで、会話や操作の進行には関わらない。

export type SeatPhase = 'standing' | 'sitting' | 'seated' | 'rising'
export type SeatInput = {
  /** 座り始めてよい（待機のしぐさを始めてよい条件と同じ）。 */
  calm: boolean
  /** 座ったままでよい（家にいる・小さい表示でない・動きを減らす設定でない）。会話中も真。偽になったら急いで立つ。 */
  keep: boolean
  /** 静かな待機（keep に加えて、待機中・全身が見える枠・送信中や録音中でない）。座り始める・自分から立つのは、この時だけ。 */
  quiet: boolean
  /** 待機のしぐさが出ていない（座る・立つの動きは、しぐさの切れ目で始める）。 */
  free: boolean
  /** 反応を控えめにする。 */
  subtle: boolean
}
export type SeatFrame = {
  phase: SeatPhase
  /** 座り具合（0 立ち姿〜1 座り切り）。 */
  level: number
  /** 椅子の現れ具合（0〜1）。level 以上を必ず保つ（椅子が無いのに座った形にならない）。 */
  chair: number
  /** 左右の足のぶらぶら（-1〜1）。 */
  swingRight: number
  swingLeft: number
  /** 体と椅子を一緒に下げる長さ（モデル座標。腰を下ろすぶん・着いた時の小さな沈み・浮遊の上下）。 */
  offset: number
  /** 座る・立つの途中（待機のしぐさを始めない）。 */
  moving: boolean
}
/** 秒。椅子が現れる長さ、脚が動き出すまでの遅れ、腰を下ろす長さ、着いた後に小さく沈んで戻る長さ。 */
export const CHAIR_IN = 0.6,
  LEG_DELAY = 0.35,
  SIT_SECONDS = 0.9,
  SETTLE_SECONDS = 0.55
/** 秒。自分から立つ長さと、その後に椅子が消える長さ。 */
export const STAND_SECONDS = 0.8,
  CHAIR_OUT = 0.5
/** 秒。急いで立つ長さ（会話などが始まった時）と、椅子が消え切るまでの上限。 */
export const URGENT_SECONDS = 0.4,
  URGENT_CHAIR = 0.6
/** 秒の範囲。最初に座るまで・座っている長さ・立ってから次に座るまで・急いで立った後に落ち着いてから座るまでの最短。 */
export const FIRST_SIT: readonly [number, number] = [20, 40],
  SEATED: readonly [number, number] = [45, 110],
  NEXT_SIT: readonly [number, number] = [90, 240],
  RESUME_SIT: readonly [number, number] = [8, 15]
/** モデル座標の長さ。腰を下ろすぶん、着いた時の沈み、浮遊の上下（PERIOD 秒で 1 往復）。 */
export const DROP = 40,
  SETTLE = 7,
  BOB = 4,
  BOB_PERIOD = 4.4
/** 足のぶらぶら: SWING_EVERY 秒ごとに SWING_FOR 秒だけ、SWING_PERIOD 秒で 1 往復（左右は逆の拍）。 */
export const SWING_EVERY = 13,
  SWING_FOR = 5,
  SWING_PERIOD = 1.7

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
/** d 秒かけて 0→1。時刻の丸め誤差で終わりの 1 コマが残らないよう、終わりは少し手前で 1 にする。 */
const ramp = (t: number, d: number) => (t >= d - 1e-9 ? 1 : clamp01(t / d))
const between = ([a, b]: readonly [number, number], r: number) => a + (b - a) * r
const STANDING: SeatFrame = {
  phase: 'standing',
  level: 0,
  chair: 0,
  swingRight: 0,
  swingLeft: 0,
  offset: 0,
  moving: false,
}

/** 時刻は秒（単調増加）。rng は [0, 1)。 */
export class SeatDirector {
  private phase: SeatPhase = 'standing'
  /** いまの段階を始めた時刻と、その時点の座り具合・椅子。 */
  private t0 = 0
  private from = { level: 0, chair: 0 }
  private urgent = false
  private nextAt: number | null = null
  private until = 0
  private wasQuiet = true
  constructor(
    private rng: () => number = Math.random,
    private first: readonly [number, number] = FIRST_SIT,
  ) {}
  /** 立ち姿へすぐ戻し、予定も捨てる（非表示になった時など）。 */
  reset() {
    this.phase = 'standing'
    this.from = { level: 0, chair: 0 }
    this.urgent = false
    this.nextAt = null
    this.wasQuiet = true
  }
  /** 検証用: 次の機会に座る／立つ（座ってよい・立ってよい条件は変えない）。 */
  force(what: 'sit' | 'stand') {
    if (what === 'sit') this.nextAt = 0
    else this.until = 0
  }
  private at(now: number): { level: number; chair: number; done: boolean } {
    const t = now - this.t0
    if (this.phase === 'sitting') {
      const level = ease(ramp(t - LEG_DELAY, SIT_SECONDS))
      return {
        level,
        chair: Math.max(level, clamp01(this.from.chair + ramp(t, CHAIR_IN))),
        done: t >= LEG_DELAY + SIT_SECONDS - 1e-9,
      }
    }
    if (this.phase === 'rising') {
      if (this.urgent) {
        const level = this.from.level * (1 - ease(ramp(t, URGENT_SECONDS)))
        return {
          level,
          chair: Math.max(level, this.from.chair * (1 - ramp(t, URGENT_CHAIR))),
          done: t >= URGENT_CHAIR - 1e-9,
        }
      }
      const level = this.from.level * (1 - ease(ramp(t, STAND_SECONDS)))
      return {
        level,
        chair: Math.max(level, this.from.chair * (1 - ramp(t - STAND_SECONDS, CHAIR_OUT))),
        done: t >= STAND_SECONDS + CHAIR_OUT - 1e-9,
      }
    }
    return this.phase === 'seated' ? { level: 1, chair: 1, done: false } : { level: 0, chair: 0, done: false }
  }
  private enter(phase: SeatPhase, now: number, from = { level: 0, chair: 0 }, urgent = false) {
    this.phase = phase
    this.t0 = now
    this.from = from
    this.urgent = urgent
  }
  step(now: number, input: SeatInput): SeatFrame {
    const gap = (range: readonly [number, number]) => between(range, this.rng())
    // 最初の予定は、開いた時（または非表示から戻った時）から数える。
    if (this.nextAt === null) this.nextAt = now + gap(this.first)
    let cur = this.at(now)
    if (cur.done) {
      if (this.phase === 'sitting') {
        this.enter('seated', now, { level: 1, chair: 1 })
        this.until = now + gap(SEATED)
      } else {
        this.enter('standing', now)
        this.nextAt = now + gap(NEXT_SIT)
      }
      cur = this.at(now)
    }
    const quiet = input.keep && input.quiet
    if (!input.keep) {
      // 急いで立つ: いまの座り具合・椅子の濃さから、短く戻す（自分から立っている途中でも短い戻りへ切り替える）。
      if (this.phase === 'sitting' || this.phase === 'seated' || (this.phase === 'rising' && !this.urgent))
        this.enter('rising', now, { level: cur.level, chair: cur.chair }, true)
    }
    if (!quiet) {
      // 会話中・上半身だけの枠など: 座っていれば座ったまま（座る途中は座り切り、立つ途中は立ち切る）。新しく座り始めず、自分から立ち始めもしない。
      this.wasQuiet = false
    } else {
      // 会話などが済んで落ち着いた直後には座らない（短い間をあける）。
      if (!this.wasQuiet) this.nextAt = Math.max(this.nextAt, now + gap(RESUME_SIT))
      this.wasQuiet = true
      if (this.phase === 'standing') {
        if (input.calm && input.free && now >= this.nextAt) this.enter('sitting', now)
      } else if (this.phase === 'seated' && input.free && now >= this.until) {
        this.enter('rising', now, { level: 1, chair: 1 })
      }
    }
    cur = this.at(now)
    if (this.phase === 'standing') return STANDING
    const t = now - this.t0,
      seated = this.phase === 'seated',
      scale = input.subtle ? 0.5 : 1,
      // 着いた直後に小さく沈んで戻る（ちょこん）。
      settle =
        seated && t < SETTLE_SECONDS ? SETTLE * Math.sin((Math.PI * t) / SETTLE_SECONDS) * (1 - t / SETTLE_SECONDS) : 0,
      bob = seated ? BOB * scale * Math.sin((2 * Math.PI * t) / BOB_PERIOD) * ease(t / 1.5) : 0,
      // ぶらぶらは、座って少ししてから、ときどき。控えめでは出さない。
      beat = seated && !input.subtle ? (t % SWING_EVERY) - (SWING_EVERY - SWING_FOR) : -1,
      envelope = beat > 0 ? Math.sin((Math.PI * beat) / SWING_FOR) ** 2 : 0,
      swing = envelope * Math.sin((2 * Math.PI * Math.max(0, beat)) / SWING_PERIOD)
    return {
      phase: this.phase,
      level: cur.level,
      chair: cur.chair,
      swingRight: swing,
      swingLeft: -swing,
      offset: DROP * cur.level + settle + bob,
      moving: !seated,
    }
  }
}

/** 画面の ?seat= 指定。now は開いてすぐ（数秒後）に座る確認用、off は座らない。指定なしは通常の間。 */
export function seatOption(search: string): { enabled: boolean; first: readonly [number, number] } {
  const v = new URLSearchParams(search).get('seat')
  return { enabled: v !== 'off', first: v === 'now' ? [4, 6] : FIRST_SIT }
}
/** 体と椅子を下げる長さ（モデル座標）を、描画の view.y（CSS px）へ直す。 */
export const seatOffsetPx = (offset: number, canvasHeight: number, modelHeight: number, zoom: number) =>
  modelHeight > 0 ? (offset * canvasHeight * zoom) / modelHeight : 0
