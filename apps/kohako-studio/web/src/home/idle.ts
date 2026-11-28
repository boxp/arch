// BOXP-605: 待機中のしぐさ。待機クリップ 1 本（頭を左右へ振り続ける）だけでは同じ動きの繰り返しに見えるため、
// 待機が続いて Owner の操作も無い間だけ、不規則な間をあけて小さなしぐさを 1 つずつ挟む（月を見上げる・小首をかしげる・目を閉じてひと息 など）。
// 新しい絵は使わず、既存の頭・体の角度、視線、表情、閉眼だけで作る。ここは「いつ・どれを・どの強さで」を決める純粋な係で、描画は gesture.ts の stage が行う。
// 顔と頭だけでなく、腕と体のしぐさも混ぜる（Owner 要望）。腕は肩・肘・手首を小さく回すだけのもの（arms / sway）と、
// 会話で使っている身振りのクリップをそのまま借りるもの（gesture: 小さく手を振る・口元に手を添える）がある。どちらも新しい絵は使わない。
// BOXP-694 TD-01（Owner 本人の判断「腕を大きく動かす動きは全部フェードアウト表現に」）: 腕を連続して動かすのは肩・肘 ARM_SWAY_MAX 未満の小さな揺れだけ。
// それ以上の姿勢（手そろえ・伸び）は腕を動かして運ばず、armSet として stage へ渡し、待機の腕と 0.25 秒のフェードで入れ替える（仕様: vault の Projects/kohako-home/arm-switch-spec.md の「共通の決まり」と D）。
// 表情（ほほえみ・目を細める・はにかみ）を多くのしぐさに添え、小首をかしげる時は体を逆へ少し傾ける（Owner 要望「もう少し女の子らしくかわいく」）。
// しぐさの間は待機クリップを止める（クリップ再生中は頭の角度を足しても描画に出ない。止めている間は揺れも小さく落ち着く）。
import type { Emotion, Gesture } from '../live2d/acting'
import type { BodyPose, IdleArm } from '../live2d/gesture'
import type { Daypart } from './room'

export type IdleAct =
  | 'moon'
  | 'tilt'
  | 'rest'
  | 'smile'
  | 'down'
  | 'aside'
  | 'still'
  | 'wave'
  | 'mouth'
  | 'stretch'
  | 'tidy'
  | 'shy'
  | 'giggle'
type Arms = { right?: IdleArm; left?: IdleArm }
type Def = {
  /** 保つ長さ（秒）の範囲。入り・戻りは別。 */
  seconds: readonly [number, number]
  pose: Partial<BodyPose>
  /** 左右どちらにも出す（毎回どちらかを選ぶ）。false は画面の向きが決まっているしぐさ（月は右上）。 */
  mirror: boolean
  emotion?: Emotion
  /** 保つ間の途中（at は保つ長さに対する割合）から表情を替える（はにかんでから、ほほえむ）。 */
  later?: { at: number; emotion: Emotion }
  /** 目を閉じる。 */
  eyes?: boolean
  /** 自分で視線を動かす（その間はカーソル追従を退かせる）。 */
  gaze?: boolean
  /** 見た目の変化がほとんど無い（揺れが落ち着くだけ）。次のしぐさまでの間を短くし、変化の無い時間が長く続かないようにする。 */
  quiet?: boolean
  /**
   * 腕（ラジアン。right は画面の右側の腕。角度は右腕の向きで書き、左腕は鏡映される: up 負=外へ開く、fo 正=肘から先を体へ寄せる）。
   * 肩か肘が ARM_SWAY_MAX 以上なら「姿勢」として扱い、入り・戻りで角度を補間せず、フェードで入れ替える（peak.arms も同じ）。
   */
  arms?: Arms
  /**
   * 左右へ小さく揺れる・弾む（くすっと笑う）。pose と swing（両腕を同じ向きへ振る角度）に sin を掛けて足す。period は 1 往復の秒。
   * hand は手首を同じ向きへ振る角度。lag は体に対する遅れ（1 往復に対する割合）: 体が先に動き、頭・腕・手先の順に遅れて付いてくる
   * （全部が同じ拍で動くと、棒の人形を左右へ倒しているように見える）。
   */
  sway?: {
    period: number
    pose: Partial<BodyPose>
    swing: number
    hand?: number
    lag?: { head?: number; arms?: number; hand?: number }
  }
  /** 入りの長さ（秒）。指定が無ければ IN_SECONDS。 */
  in?: number
  /**
   * 力を入れてから、ふっと抜く層（伸び）。in 秒かけて pose・arms へ入り、保つ長さの until（割合）の時点から out 秒で抜く。
   * 抜く時は overshoot（割合）だけ逆へ行き過ぎてから戻る（力が抜けて、少し沈んでから落ち着く）。腕の行き過ぎは ARM_OVERSHOOT 倍に抑える
   * （腕が待機の位置より外へ開くと、翼を広げたように見える）。eyes は力を入れている間だけ目を閉じる。
   */
  peak?: {
    pose: Partial<BodyPose>
    arms?: Arms
    eyes?: boolean
    in: number
    until: number
    out: number
    overshoot: number
  }
  /** 身振りのクリップを借りる（腕の絵の差し替えを含む）。seconds はクリップが終わるまでの長さにする。大きさは変えられないので「控えめ」では出さない。 */
  gesture?: Exclude<Gesture, 'none'>
  /** 出やすさ。時間帯で変える。 */
  weight: number
  dayparts?: Partial<Record<Daypart, number>>
}
// 角度は v11r の Param（度）。正は 頭X=画面右を向く / 頭Y=上を向く / 頭Z=頭頂が画面右へ傾く、視線は右・上が正（gesture.ts と同じ）。
// 待機クリップ（頭X ±13°）や首かしげの演技（13°）より小さくし、そばで過ごしている程度に留める。
/**
 * BOXP-764（試作候補だけ）: 手を前でそろえる形。体の前の低い位置で両手のひらを下へ向け、
 * 画面右の手（コハコの左手。右腕が手前に描かれる）を照れで使っている手の甲の絵（cover）に替えて、
 * 横へ寝かせたもう片方の手の甲へそっと載せる。下の手の指先は上の手の下へ隠れる（指先どうしが X 字に交差しない）。
 * 肘は 0.96 以上（V 字の切れ目が見える 0.3〜0.94 で止めない）・1.4 未満（差し戻した下腹の前の形にしない＝仕様 D2a）。
 * 仕様: vault の Projects/kohako-home/tidy-hands-764.md。
 */
export const TIDY_ARMS = {
  right: { up: 0.05, fo: 1.1, ha: 0.1, haS: 0.85, art: 'cover' },
  left: { up: 0.05, fo: 0.98, ha: 1.2, haS: 0.8 },
} as const satisfies Arms
/** 通常版（仕様 D1）の手そろえの形。候補の版で ?tidy=old を付けると、並べて比べるためにこちらを出す。 */
export const TIDY_OLD_ARMS = {
  right: { up: 0.08, fo: 1.05, ha: -0.15 },
  left: { up: 0.07, fo: 0.98, ha: -0.25 },
} as const satisfies Arms
/** 候補の版の比べる指定。?tidy=old は通常版の形、?idle=tidy は待機しぐさを手そろえだけにする。それ以外の値は指定なし。 */
export function tidyOption(search: string): { old: boolean; only: boolean } {
  const q = new URLSearchParams(search)
  return { old: q.get('tidy') === 'old', only: q.get('idle') === 'tidy' }
}
/** 手そろえの形を入れ替える（?tidy=old。起動時に 1 回だけ呼ぶ）。 */
export function useTidyArms(old: boolean) {
  idleActs.tidy.arms = old ? TIDY_OLD_ARMS : TIDY_ARMS
}
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
  // 小首をかしげて、ほほえむ。体は頭と逆へ少しだけ傾け、首から肩の線をやわらかく見せる（Owner 要望「もう少し女の子らしくかわいく」）。
  // ほほえみの表情は頭を 3° 傾けるので、左右どちらへ出ても傾きが読める大きさにする（10° / 4°）。
  tilt: {
    seconds: [2, 3.2],
    pose: { headZ: 7, headX: 3, bodyZ: -2 },
    mirror: true,
    emotion: 'smile',
    weight: 1.2,
  },
  // 目を閉じてひと息つく。
  rest: {
    seconds: [2.4, 4],
    pose: { headY: -4, lean: 1.5 },
    mirror: false,
    eyes: true,
    weight: 0.8,
    dayparts: { night: 1.6 },
  },
  // 目を細めて、にこっと笑う（少しあごを引いて、こちらへ寄る）。目を閉じたままが長いと眠って見えるので短くする。
  smile: {
    seconds: [1.5, 2.3],
    pose: { headZ: 3, headY: -2.5, lean: 2 },
    mirror: false,
    emotion: 'smileClosed',
    weight: 1,
    dayparts: { morning: 1.4 },
  },
  // 手元へ目を落とす。
  down: {
    seconds: [2.6, 4.2],
    pose: { headY: -7, headX: -3, eyeY: -0.45, eyeX: -0.15 },
    mirror: true,
    gaze: true,
    weight: 0.7,
  },
  // 横へ目をやる。
  aside: { seconds: [1.8, 3], pose: { headX: 5, eyeX: 0.55 }, mirror: true, gaze: true, weight: 0.8 },
  // じっと落ち着く（待機クリップを止めて小さな揺れだけにする）。
  still: { seconds: [4, 7], pose: {}, mirror: false, quiet: true, weight: 0.5 },
  // 小さく手を振る（挨拶の身振り 2.6 秒）。
  wave: {
    seconds: [1.9, 1.9],
    pose: {},
    mirror: false,
    emotion: 'smile',
    gesture: 'greet',
    weight: 0.6,
    dayparts: { morning: 1.3 },
  },
  // 口元に手を添えて、目を細めて笑う（照れの身振り 3.9 秒。夜はあくびをかみ殺すようにも見える）。
  mouth: {
    seconds: [3.2, 3.2],
    pose: { headZ: 2, headY: -2 },
    mirror: false,
    emotion: 'smileClosed',
    gesture: 'shyHand',
    weight: 0.5,
    dayparts: { night: 1.4 },
  },
  // 軽く伸びをする。両手を体の前へ下ろし、目を閉じてあごを上げ（んーっ）、ふっと力を抜いて、ほほえむ。
  // 伸びらしさは「ゆっくり力む → ふっと抜けて少し行き過ぎる → ほほえむ」の頭と体の時間の流れで出す（腕を外へ開く形は、どの角度でも翼を広げたように見えた）。
  // BOXP-694 TD-01: 腕は動かして運ばず、力んでいる間（目を閉じている間）だけ、この姿勢をフェードで出す（仕様 D2・D3）。動かして運ぶ形へ戻さないこと。
  // 姿勢の形は #15607 より前の形と位置（肘 0.72）そのまま。#15607 で「両手を下腹の前で重ねる形」（肩 -0.12・肘 1.46）へ替えたが、
  // 本人が「手が不自然な形になっており逆効果。戻してください」と差し戻した。肘 0.72 は肘に V 字の切れ目が見える範囲だが、本人が選んだ形なので直す対象ではない。
  // 下腹の前で重ねる形や、別の新しい手重ねの形を、本人の新しい判断なしに入れ直さないこと（仕様 D2a）。
  stretch: {
    seconds: [3.2, 4],
    pose: { headZ: 2.5, lean: 0.5 },
    peak: {
      pose: { headY: 7, headZ: 1.5, lean: -3.5, bodyZ: 1.5 },
      arms: { right: { up: 0.2, fo: 0.72, ha: -0.1 }, left: { up: 0.2, fo: 0.72, ha: -0.1 } },
      eyes: true,
      in: 1.3,
      until: 0.5,
      out: 1.2,
      overshoot: 0.22,
    },
    mirror: true,
    later: { at: 0.56, emotion: 'smile' },
    weight: 0.6,
  },
  // 両手を体の前で重ねてそろえ、小首をかしげてほほえむ。左右を少し変えて、片手をもう片方へ添える形にする。
  // BOXP-694 TD-01: 腕は動かして運ばず（1.2 秒かけて寄せていく動きを本人が「不自然」と評価した）、ほほえんでいる間だけフェードで出す（仕様 D1・D3）。
  // 姿勢の形は #15607 より前の形と位置（肘 1.05 / 0.98）そのまま。#15607 で入れた「両手を下腹の前で重ねる形」（肘 1.5 / 1.42）は
  // 本人が「手が不自然な形になっており逆効果」と差し戻したので、入れ直さないこと（仕様 D2a）。
  // BOXP-764（試作候補）: 形は TIDY_ARMS（画面右の手を手の甲の絵にして、もう片方の甲へそっと載せる）。?tidy=old で上の形へ戻す。
  tidy: {
    seconds: [3, 4.4],
    in: 1.2,
    pose: { headZ: 5, headY: -2, bodyZ: -1.5, lean: 1 },
    arms: TIDY_ARMS,
    mirror: false,
    emotion: 'smile',
    weight: 0.9,
  },
  // 「体を左右へゆっくり揺らす」（sway。体Z ±5° を 3.2 秒で 1 往復）は BOXP-698 TD-03 で廃止した。
  // 本人が「上半身をゆらゆら動かすアニメーションは不自然」と評価した（腕の振りを小さくし、頭・腕・手先を遅らせる作り直しの後でも）。
  // 腰から下が動かないまま上半身だけが左右へ倒れる動きなので、同じ種類の揺れを本人の新しい判断なしに足し直さないこと。
  // ふと目が合って、はにかむ。頬を染めて目をそらし、両手を体の前へ寄せ、少しして、こちらへ向き直ってほほえむ。
  // 照れの表情は頭と視線を大きくそらす（頭X -10° / 頭Y -7°）ので、待機では頭を少し戻して控えめにする。
  shy: {
    seconds: [3.4, 4.4],
    pose: { headX: 4, headY: 3, lean: 1 },
    arms: { right: { up: 0.03, fo: 0.2 }, left: { up: 0.03, fo: 0.2 } },
    mirror: false,
    emotion: 'shy',
    later: { at: 0.6, emotion: 'smile' },
    gaze: true,
    weight: 0.5,
  },
  // くすっと笑う。目を細めてあごを引き、肩を小さく弾ませる（速い揺れは描画側でなまるので、見た目は書いた角度の半分ほど）。
  giggle: {
    seconds: [1.5, 2],
    pose: { headZ: 2, headY: -3, lean: 1.5 },
    sway: { period: 0.55, pose: { headY: 3, bodyZ: 2, headZ: 1.5 }, swing: -0.015 },
    mirror: true,
    emotion: 'smileClosed',
    weight: 0.7,
  },
}
export const idleActNames = Object.keys(idleActs) as IdleAct[]
/**
 * 最初のしぐさまで・しぐさの間（秒）。控えめでは間を 1.5 倍にする。
 * 間は前のしぐさが戻り切ってから次が始まるまで。実際に始まるのは頭が正面近くへ来るのを待つぶん（0〜SETTLE_WAIT 秒）遅れる。
 * 当初は 9〜18 / 12〜32 秒で、目立たない「じっと落ち着く」を挟むと目に見える変化の間が 1 分前後あき、
 * マウスや指を動かすたびに最初の間から数え直していたので、Owner には「1 分おき」に見えた。変化が目に入る間隔へ詰める。
 * QUIET_GAP は見た目の変化が無いしぐさ（quiet）の後、RESUME_GAP は操作・会話などで中断した後に落ち着いてからの最短の間。
 */
export const FIRST_GAP: readonly [number, number] = [5, 10],
  GAP: readonly [number, number] = [7, 16],
  QUIET_GAP: readonly [number, number] = [2, 5],
  RESUME_GAP: readonly [number, number] = [3, 6],
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
  /** 連続して動かす腕の角度（小さな揺れだけ。肩・肘は ARM_SWAY_MAX 未満。動かさない間は null）。 */
  arms: { right: IdleArm; left: IdleArm } | null
  /** フェードで出す腕の姿勢（出ている間は同じ形のまま。出さない間は null）。stage が待機の腕と 0.25 秒で入れ替える。 */
  armSet: { right: IdleArm; left: IdleArm } | null
  /** 再生しておく身振りのクリップ（null になったら、まだ続いていれば止める）。 */
  gesture: Exclude<Gesture, 'none'> | null
}
const NONE: IdleFrame = {
  act: null,
  pose: ZERO,
  eyes: false,
  emotion: null,
  hold: false,
  gaze: false,
  arms: null,
  armSet: null,
  gesture: null,
}
const ARM_KEYS = ['up', 'fo', 'ha'] as const
/** 連続して動かしてよい腕の上限（ラジアン。肩・肘）。これ以上は姿勢としてフェードで入れ替える（肘の切れ目が見え始める 0.3 より手前だけを動かす）。 */
export const ARM_SWAY_MAX = 0.3
const isPosture = (a: Arms | undefined) =>
  [a?.right, a?.left].some((x) => Math.abs(x?.up ?? 0) >= ARM_SWAY_MAX || Math.abs(x?.fo ?? 0) >= ARM_SWAY_MAX)
/** t0 は揺れの位相の起点。中断で start を書き換えても動かさない（位相が跳ぶと体の角度が跳ぶ）。 */
type Running = {
  act: IdleAct
  side: 1 | -1
  t0: number
  start: number
  end: number
  out: number
  scale: number
  /** 入りの長さ（秒）。 */
  in: number
  /** 力を抜き始める時刻（peak のあるしぐさ）。 */
  release: number
  /** 中断した時点の peak の強さ（体・腕。中断後はここから短く戻す）。 */
  frozen: readonly [number, number] | null
}
/** peak を抜く時の、腕の行き過ぎの割合（体の行き過ぎに対して）。 */
export const ARM_OVERSHOOT = 0.3
const HEAD_KEYS: readonly (keyof BodyPose)[] = ['headX', 'headY', 'headZ']
/** 力を抜く曲線（x は抜き始めからの割合）。1 から 0 へ下り、途中で overshoot だけ逆へ行き過ぎてから 0 へ戻る。始めと終わりは滑らか。 */
export const releaseCurve = (x: number, overshoot: number) => {
  if (x <= 0) return 1
  if (x >= 1) return 0
  const s = Math.sin(Math.PI * Math.max(0, (x - 0.4) / 0.6))
  return 1 - ease(x / 0.75) - overshoot * s * s
}

/** 時刻は秒（単調増加）。rng は [0, 1)。 */
export class IdleDirector {
  private running: Running | null = null
  private nextAt: number | null = null
  private last: IdleAct | null = null
  private forced: IdleAct | null = null
  /** 直前の step で出してよい状況だったか（中断から落ち着いた瞬間を知る）。 */
  private wasCalm = true
  /** only: このしぐさだけを出す（BOXP-764 の候補の ?idle=tidy。比べる用）。間の決め方は変えない。 */
  constructor(
    private rng: () => number = Math.random,
    private only: IdleAct | null = null,
  ) {}
  /** 予定と出ているしぐさを捨てる（非表示になった時など）。 */
  reset() {
    this.running = null
    this.nextAt = null
    this.forced = null
    this.wasCalm = true
  }
  /** 次の機会にこのしぐさを出す（検証用。出してよい条件は変えない）。 */
  force(act: IdleAct) {
    this.forced = act
    this.nextAt = 0
  }
  /** 直前と同じものは選ばない。重みは時間帯で変える。控えめでは身振りのクリップを借りるしぐさを出さない。 */
  pick(daypart: Daypart, subtle = false): IdleAct {
    if (this.only) return this.only
    const pool = idleActNames.filter((a) => a !== this.last && !(subtle && idleActs[a].gesture)),
      weights = pool.map((a) => idleActs[a].weight * (idleActs[a].dayparts?.[daypart] ?? 1))
    let r = this.rng() * weights.reduce((s, w) => s + w, 0)
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r < 0) return pool[i]
    }
    return pool[pool.length - 1]
  }
  /** peak の層の強さ（part: 0=体、1=腕）。中断後は、中断した時点の強さから短く戻す。 */
  private peak(run: Running, now: number, part: 0 | 1): number {
    const p = idleActs[run.act].peak
    if (!p) return 0
    if (run.frozen !== null) return run.frozen[part] * (1 - ease((now - run.end) / run.out))
    const overshoot = p.overshoot * (part ? ARM_OVERSHOOT : 1)
    return ease((now - run.t0) / p.in) * releaseCurve((now - run.release) / p.out, overshoot) * run.scale
  }
  step(now: number, input: IdleInput): IdleFrame {
    const gap = (range: readonly [number, number]) => between(range, this.rng()) * (input.subtle ? SUBTLE_GAP : 1)
    let run = this.running
    if (run && now >= run.end + run.out + HOLD_MARGIN) {
      // 中断で終わった時も次の予定は持っておく（落ち着いた後、中断のたびに最初から数え直さない）。
      // 検証用の指定が残っていれば、間をあけずに出す。
      this.nextAt = this.forced ? 0 : now + gap(idleActs[run.act].quiet ? QUIET_GAP : GAP)
      this.running = run = null
    }
    if (!input.calm) {
      // 中断: いまの強さから短く戻す。予定は残し、落ち着いた後に短い間（RESUME_GAP）だけは必ずあける。
      // 入り・保ちの途中だけでなく、通常の戻りの途中でも短い戻りへ切り替える（一度切り替えたら繰り返さない）。
      if (run && run.out !== CANCEL_SECONDS && now < run.end + run.out) {
        const level = ease((now - run.start) / run.in) * (1 - ease((now - run.end) / run.out))
        run.frozen = [this.peak(run, now, 0), this.peak(run, now, 1)]
        run.scale *= level
        run.start = now - run.in
        run.end = now
        run.out = CANCEL_SECONDS
      }
      this.forced = null
      this.wasCalm = false
    } else {
      // 中断から落ち着いた: 残っている予定がすぐ・過去なら、短い間をあけてからにする（操作や会話の直後に飛び出さない）。
      if (!this.wasCalm && this.nextAt !== null) this.nextAt = Math.max(this.nextAt, now + gap(RESUME_GAP))
      this.wasCalm = true
    }
    if (input.calm && !run) {
      if (this.nextAt === null) this.nextAt = now + gap(FIRST_GAP)
      if (now >= this.nextAt && (now >= this.nextAt + SETTLE_WAIT || input.settled())) {
        const act = this.forced ?? this.pick(input.daypart, input.subtle),
          def = idleActs[act]
        this.forced = null
        this.last = act
        this.running = run = {
          act,
          side: def.mirror && this.rng() < 0.5 ? -1 : 1,
          t0: now,
          start: now,
          end: 0,
          out: OUT_SECONDS,
          scale: input.subtle ? SUBTLE_SCALE : 1,
          in: def.in ?? IN_SECONDS,
          release: 0,
          frozen: null,
        }
        const seconds = between(def.seconds, this.rng())
        run.end = now + run.in + seconds
        run.release = now + run.in + seconds * (def.peak?.until ?? 1)
      }
    }
    if (!run) return NONE
    const def = idleActs[run.act],
      level = ease((now - run.start) / run.in) * (1 - ease((now - run.end) / run.out)) * run.scale,
      peak = this.peak(run, now, 0),
      peakArm = this.peak(run, now, 1),
      pose = { ...ZERO }
    for (const key of Object.keys(def.pose) as (keyof BodyPose)[])
      pose[key] = (def.pose[key] ?? 0) * level * (MIRRORED.includes(key) ? run.side : 1)
    if (def.peak)
      for (const key of Object.keys(def.peak.pose) as (keyof BodyPose)[])
        pose[key] += (def.peak.pose[key] ?? 0) * peak * (MIRRORED.includes(key) ? run.side : 1)
    // 揺れは入り・戻りの強さをそのまま掛ける（始めと終わりで跳ばない）。位相は中断しても続ける。
    // lag のぶんだけ遅らせた拍を、頭・腕・手先に使う（体が先に動き、遅れて付いてくる）。
    const beat = (lag = 0) =>
        def.sway ? Math.sin(2 * Math.PI * ((now - run.t0) / def.sway.period - lag)) * level * run.side : 0,
      swing = beat(def.sway?.lag?.arms),
      handSwing = beat(def.sway?.lag?.hand)
    if (def.sway)
      for (const key of Object.keys(def.sway.pose) as (keyof BodyPose)[])
        pose[key] += (def.sway.pose[key] ?? 0) * beat(HEAD_KEYS.includes(key) ? def.sway.lag?.head : 0)
    // 腕。左右のあるしぐさは腕ごと入れ替える（角度は鏡映の書き方なので値はそのまま）。揺れは両腕を画面の同じ向きへ振る。
    // 大きな姿勢（isPosture）はここで補間しない。下の armSet で、形を変えずに出す。
    const sided = (a: Arms | undefined) => (run.side === 1 ? a : { right: a?.left, left: a?.right }),
      swayArms = isPosture(def.arms) ? undefined : def.arms,
      swayPeak = isPosture(def.peak?.arms) ? undefined : def.peak?.arms
    let arms: IdleFrame['arms'] = null
    if (swayArms || def.sway || swayPeak) {
      const from = sided(swayArms),
        tense = sided(swayPeak),
        arm = (a: IdleArm | undefined, b: IdleArm | undefined, sign: number): IdleArm => ({
          up: (a?.up ?? 0) * level + (b?.up ?? 0) * peakArm + sign * (def.sway?.swing ?? 0) * swing,
          fo: (a?.fo ?? 0) * level + (b?.fo ?? 0) * peakArm,
          ha: (a?.ha ?? 0) * level + (b?.ha ?? 0) * peakArm + sign * (def.sway?.hand ?? 0) * handSwing,
        })
      arms = { right: arm(from?.right, tense?.right, 1), left: arm(from?.left, tense?.left, -1) }
      if (![arms.right, arms.left].some((a) => ARM_KEYS.some((k) => Math.abs(a[k] ?? 0) > 1e-4))) arms = null
    }
    // 目と表情は頭が動き出してから変え、頭が戻り始める時に戻す。
    // later の切り替えは保つ間の割合で決める（中断では run.end が今になるので inner が偽になり、ここは効かない）。
    const inner = now >= run.start + run.in * 0.45 && now < run.end,
      held = run.t0 + run.in,
      tensed = !!def.peak?.eyes && run.frozen === null && now >= run.t0 + def.peak.in * 0.45 && now < run.release,
      emotion = def.later && now >= held + (run.end - held) * def.later.at ? def.later.emotion : (def.emotion ?? null)
    // 姿勢は表情・閉じた目と同じ時刻に替える: 保つ姿勢は表情の間、力む姿勢は力んでいる間（中断すればその場で手放す）。控えめでも形は縮めない。
    const posture = isPosture(def.peak?.arms)
        ? run.frozen === null && def.peak && now >= run.t0 + def.peak.in * 0.45 && now < run.release
          ? sided(def.peak.arms)
          : undefined
        : isPosture(def.arms) && inner
          ? sided(def.arms)
          : undefined,
      armSet = posture ? { right: { ...posture.right }, left: { ...posture.left } } : null
    return {
      act: run.act,
      pose,
      eyes: (!!def.eyes && inner) || tensed,
      emotion: inner ? emotion : null,
      hold: true,
      gaze: !!def.gaze && now < run.end + run.out,
      arms,
      armSet,
      // 中断で短く戻している間は出さない（main がクリップを止める）。
      gesture: def.gesture && now < run.end && run.out !== CANCEL_SECONDS ? def.gesture : null,
    }
  }
}
/** 待機クリップの頭がこの角度（度）以内なら「正面近く」。 */
export const settledHead = (yaw: number, roll: number) => Math.abs(yaw) < 4 && Math.abs(roll) < 3
