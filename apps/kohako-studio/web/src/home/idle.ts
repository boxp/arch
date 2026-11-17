// BOXP-605: 待機中のしぐさ。待機クリップ 1 本（頭を左右へ振り続ける）だけでは同じ動きの繰り返しに見えるため、
// 待機が続いて Owner の操作も無い間だけ、不規則な間をあけて小さなしぐさを 1 つずつ挟む（月を見上げる・小首をかしげる・目を閉じてひと息 など）。
// 新しい絵は使わず、既存の頭・体の角度、視線、表情、閉眼だけで作る。ここは「いつ・どれを・どの強さで」を決める純粋な係で、描画は gesture.ts の stage が行う。
// しぐさの間は待機クリップを止める（クリップ再生中は頭の角度を足しても描画に出ない。止めている間は揺れも小さく落ち着く）。
import type { Emotion } from '../live2d/acting'
import type { BodyPose } from '../live2d/gesture'
import type { Daypart } from './room'

export type IdleAct = 'moon' | 'tilt' | 'rest' | 'smile' | 'down' | 'aside' | 'still'
type Def = {
  /** 保つ長さ（秒）の範囲。入り・戻りは別。 */
  seconds: readonly [number, number]
  pose: Partial<BodyPose>
  /** 左右どちらにも出す（毎回どちらかを選ぶ）。false は画面の向きが決まっているしぐさ（月は右上）。 */
  mirror: boolean
  emotion?: Emotion
  /** 目を閉じる。 */
  eyes?: boolean
  /** 自分で視線を動かす（その間はカーソル追従を退かせる）。 */
  gaze?: boolean
  /** 出やすさ。時間帯で変える。 */
  weight: number
  dayparts?: Partial<Record<Daypart, number>>
}
// 角度は v11r の Param（度）。正は 頭X=画面右を向く / 頭Y=上を向く / 頭Z=頭頂が画面右へ傾く、視線は右・上が正（gesture.ts と同じ）。
// 待機クリップ（頭X ±13°）や首かしげの演技（13°）より小さくし、そばで過ごしている程度に留める。
export const idleActs: Record<IdleAct, Def> = {
  // 窓の月を見上げる（月は画面の右上）。
  moon: {
    seconds: [3.6, 6],
    pose: { headX: 8, headY: 5, headZ: 2, bodyZ: 1, eyeX: 0.45, eyeY: 0.3 },
    mirror: false,
    gaze: true,
    weight: 1,
    dayparts: { evening: 1.4, night: 1.6 },
  },
  // 小首をかしげる。
  tilt: { seconds: [1.8, 3], pose: { headZ: 7, headX: 3, bodyZ: 1.5 }, mirror: true, weight: 1 },
  // 目を閉じてひと息つく。
  rest: {
    seconds: [2.4, 4],
    pose: { headY: -4, lean: 1.5 },
    mirror: false,
    eyes: true,
    weight: 0.8,
    dayparts: { night: 1.6 },
  },
  // こちらへほほえむ。
  smile: {
    seconds: [2.6, 4.2],
    pose: { headZ: 3, headY: -1.5 },
    mirror: true,
    emotion: 'smile',
    weight: 0.9,
    dayparts: { morning: 1.4 },
  },
  // 手元へ目を落とす。
  down: {
    seconds: [2.6, 4.2],
    pose: { headY: -7, headX: -3, eyeY: -0.45, eyeX: -0.15 },
    mirror: true,
    gaze: true,
    weight: 0.9,
  },
  // 横へ目をやる。
  aside: { seconds: [1.8, 3], pose: { headX: 5, eyeX: 0.55 }, mirror: true, gaze: true, weight: 0.9 },
  // じっと落ち着く（待機クリップを止めて小さな揺れだけにする）。
  still: { seconds: [7, 12], pose: {}, mirror: false, weight: 1.1 },
}
export const idleActNames = Object.keys(idleActs) as IdleAct[]
/** 最初のしぐさまで・しぐさの間（秒）。控えめでは間を 1.5 倍にする。 */
export const FIRST_GAP: readonly [number, number] = [9, 18],
  GAP: readonly [number, number] = [12, 32],
  SUBTLE_GAP = 1.5,
  SUBTLE_SCALE = 0.6
/** 入り・戻り・中断時の戻り（秒）と、戻り切ってからクリップを再開するまでの余裕。 */
export const IN_SECONDS = 0.9,
  OUT_SECONDS = 1.1,
  CANCEL_SECONDS = 0.45,
  HOLD_MARGIN = 0.35
/** 頭が正面近くに来るのを待つ上限（秒）。過ぎたらそのまま始める。 */
export const SETTLE_WAIT = 5
const ZERO: BodyPose = { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyZ: 0, lean: 0, eyeX: 0, eyeY: 0 }
const MIRRORED: readonly (keyof BodyPose)[] = ['headX', 'headZ', 'bodyX', 'bodyZ', 'eyeX']
const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}
const between = ([a, b]: readonly [number, number], r: number) => a + (b - a) * r

export type IdleInput = {
  /** しぐさを出してよい（待機中で、会話・ふれあい・演出・操作が無く、動きを減らす設定でもない）。false になったら出ているしぐさは短く戻す。 */
  calm: boolean
  /** 頭が正面近くにある（始めるときの跳びを小さくする）。始める時刻が来た時だけ呼ぶ。 */
  settled: () => boolean
  daypart: Daypart
  subtle: boolean
}
export type IdleFrame = {
  act: IdleAct | null
  pose: BodyPose
  eyes: boolean
  emotion: Emotion | null
  /** 待機クリップを止める。 */
  hold: boolean
  /** カーソル追従を退かせる。 */
  gaze: boolean
}
const NONE: IdleFrame = { act: null, pose: ZERO, eyes: false, emotion: null, hold: false, gaze: false }
type Running = { act: IdleAct; side: 1 | -1; start: number; end: number; out: number; scale: number }

/** 時刻は秒（単調増加）。rng は [0, 1)。 */
export class IdleDirector {
  private running: Running | null = null
  private nextAt: number | null = null
  private last: IdleAct | null = null
  private forced: IdleAct | null = null
  constructor(private rng: () => number = Math.random) {}
  /** 予定と出ているしぐさを捨てる（非表示になった時など）。 */
  reset() {
    this.running = null
    this.nextAt = null
    this.forced = null
  }
  /** 次の機会にこのしぐさを出す（検証用。出してよい条件は変えない）。 */
  force(act: IdleAct) {
    this.forced = act
    this.nextAt = 0
  }
  /** 直前と同じものは選ばない。重みは時間帯で変える。 */
  pick(daypart: Daypart): IdleAct {
    const pool = idleActNames.filter((a) => a !== this.last),
      weights = pool.map((a) => idleActs[a].weight * (idleActs[a].dayparts?.[daypart] ?? 1))
    let r = this.rng() * weights.reduce((s, w) => s + w, 0)
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r < 0) return pool[i]
    }
    return pool[pool.length - 1]
  }
  step(now: number, input: IdleInput): IdleFrame {
    const gap = (range: readonly [number, number]) => between(range, this.rng()) * (input.subtle ? SUBTLE_GAP : 1)
    let run = this.running
    if (run && now >= run.end + run.out + HOLD_MARGIN) {
      this.running = run = null
      this.nextAt = input.calm ? now + gap(GAP) : null
    }
    if (!input.calm) {
      // 中断: いまの強さから短く戻す。予定は捨て、落ち着いてから数え直す。
      // 入り・保ちの途中だけでなく、通常の戻りの途中でも短い戻りへ切り替える（一度切り替えたら繰り返さない）。
      if (run && run.out !== CANCEL_SECONDS && now < run.end + run.out) {
        const level = ease((now - run.start) / IN_SECONDS) * (1 - ease((now - run.end) / run.out))
        run.scale *= level
        run.start = now - IN_SECONDS
        run.end = now
        run.out = CANCEL_SECONDS
      }
      if (!run) this.nextAt = null
      this.forced = null
    } else if (!run) {
      if (this.nextAt === null) this.nextAt = now + gap(FIRST_GAP)
      if (now >= this.nextAt && (now >= this.nextAt + SETTLE_WAIT || input.settled())) {
        const act = this.forced ?? this.pick(input.daypart),
          def = idleActs[act]
        this.forced = null
        this.last = act
        this.running = run = {
          act,
          side: def.mirror && this.rng() < 0.5 ? -1 : 1,
          start: now,
          end: now + IN_SECONDS + between(def.seconds, this.rng()),
          out: OUT_SECONDS,
          scale: input.subtle ? SUBTLE_SCALE : 1,
        }
      }
    }
    if (!run) return NONE
    const def = idleActs[run.act],
      level = ease((now - run.start) / IN_SECONDS) * (1 - ease((now - run.end) / run.out)) * run.scale,
      pose = { ...ZERO }
    for (const key of Object.keys(def.pose) as (keyof BodyPose)[])
      pose[key] = (def.pose[key] ?? 0) * level * (MIRRORED.includes(key) ? run.side : 1)
    // 目と表情は頭が動き出してから変え、頭が戻り始める時に戻す。
    const inner = now >= run.start + IN_SECONDS * 0.45 && now < run.end
    return {
      act: run.act,
      pose,
      eyes: !!def.eyes && inner,
      emotion: def.emotion && inner ? def.emotion : null,
      hold: true,
      gaze: !!def.gaze && now < run.end + run.out,
    }
  }
}
/** 待機クリップの頭がこの角度（度）以内なら「正面近く」。 */
export const settledHead = (yaw: number, roll: number) => Math.abs(yaw) < 4 && Math.abs(roll) < 3
