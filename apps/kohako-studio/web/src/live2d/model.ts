// BOXP-441: Web 上で動く 2D リグ（PSD2Live の .p2lrt を WebAssembly runtime + WebGL で描画）の状態連動。
// 公式 Live2D Cubism Core は使わない。モデル固有の名前はここで解決し、無い名前は何もしない。

export type RigState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'failed'

export const rigStates: readonly RigState[] = ['idle', 'listening', 'thinking', 'speaking', 'approval', 'failed']

export const stateLabels: Record<RigState, string> = {
  idle: '待機中', listening: '聞いています', thinking: '考えています', speaking: '話しています', approval: '承認待ち', failed: '失敗',
}

/** 状態ごとに試す表情・クリップ名の候補（先に見つかったものを使う。大文字小文字は無視）と視線。 */
type Wish = { expression: string[]; clip: string[]; look: [number, number] }
const wishes: Record<RigState, Wish> = {
  idle: { expression: [], clip: ['idle'], look: [0, 0] },
  listening: { expression: ['smile'], clip: ['nod', 'idle'], look: [0, 0.1] },
  thinking: { expression: ['sleepy', 'gloom'], clip: ['idle'], look: [0.6, 0.5] },
  speaking: { expression: ['smile'], clip: ['idle'], look: [0, 0] },
  approval: { expression: ['surprised'], clip: ['idle'], look: [0, 0] },
  failed: { expression: ['sad'], clip: ['shake', 'idle'], look: [0, -0.3] },
}

export type Pose = { expression: string | null; clip: string | null; look: [number, number] }

function pick(candidates: string[], available: readonly string[]): string | null {
  for (const wish of candidates) {
    const found = available.find(id => id.toLowerCase() === wish.toLowerCase())
    if (found) return found
  }
  return null
}

/** [state] をモデルが持つ表情・クリップに解決する。 */
export function poseFor(state: RigState, expressions: readonly string[], clips: readonly string[]): Pose {
  const wish = wishes[state]
  return { expression: pick(wish.expression, expressions), clip: pick(wish.clip, clips), look: wish.look }
}

/** 発話中の口の開き 0..1。音声波形が取れない内蔵 TTS 用に、音節ごとの開閉を時間から作る。 */
export function speechMouth(seconds: number): number {
  const syllable = Math.abs(Math.sin(seconds * Math.PI * 6))
  const phrase = 0.75 + 0.25 * Math.sin(seconds * Math.PI * 0.9)
  return Math.min(1, Math.max(0, syllable * phrase))
}

/** マイク入力の RMS を口の開き 0..1 にする（無音域を切り、前回値で平滑化）。 */
export function micMouth(samples: Float32Array, previous: number): number {
  let sum = 0
  for (const s of samples) sum += s * s
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0
  const target = Math.min(1, Math.max(0, (rms - 0.015) * 12))
  const k = target > previous ? 0.6 : 0.25
  return previous + (target - previous) * k
}

/** 直近の描画間隔から FPS を数える。 */
export class FrameMeter {
  private times: number[] = []
  constructor(private readonly window = 2000) {}
  tick(now: number): void {
    this.times.push(now)
    while (this.times.length > 0 && now - (this.times[0] ?? now) > this.window) this.times.shift()
  }
  fps(): number {
    if (this.times.length < 2) return 0
    const span = (this.times[this.times.length - 1] ?? 0) - (this.times[0] ?? 0)
    return span > 0 ? ((this.times.length - 1) * 1000) / span : 0
  }
}

export type RigModelId = 'kohako' | 'kohako-v5' | 'kohako-v6' | 'sample'
export type RigModel = { id: RigModelId; label: string; name: string; rig: string; notice: string; credits: string; clipNames?: Readonly<Record<string, string>>; skipSmallMouth?: boolean }

export const rigModels: readonly RigModel[] = [
  {
    id: 'kohako', label: 'コハコ（最小本人モデル）', name: 'コハコ 最小本人モデル v0', rig: '../kohako/kohako-min.p2lrt',
    notice: 'コハコ正本キャラシートの胸像 1 体から、切り抜き・透過・周囲の肌色での穴埋めと、正本の線色での閉じ目・閉じ口の描き足しだけで作った試作 v0 です（画像生成 AI は不使用）。動くもの: まばたき・口の開閉・顔まわりの角度変形・呼吸・視線・表情。固定のもの: 髪（前後の分離と揺れ）・腕と手・眉。目の下の境目と、口を開いたときの二重線が残っています。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生、公開許可済み）。',
    clipNames: {
      'modifier:m23:6d6f74696f6e': 'Idle', 'modifier:m24:6d6f74696f6e': 'Blink', 'modifier:m25:6d6f74696f6e': 'Nod',
      'modifier:m26:6d6f74696f6e': 'Shake', 'modifier:m27:6d6f74696f6e': 'Talk',
    },
  },
  {
    id: 'kohako-v5', label: 'コハコ v5 試作（三つ編み下の衣装）', name: 'コハコ 本人モデル v5 試作', rig: '../kohako/kohako-v5.p2lrt',
    notice: 'v3 の構成のまま、三つ編みが揺れたときに見える胸の衣装（金紐・桜飾り・紫の着物）を、正本の欠損部だけを描き足した生成素材（Codex の ChatGPT 契約内の画像生成）で補完し、v3 のぼけた補完跡をなくした試作です。既定の見た目は v3 と同じです。既知の不具合: 後ろ髪の大半は体と同じ層で揺れません。桜の髪飾りの脇の白い縁と、前髪の隙間の細い肌色が一部残ります。Nod クリップと腕・手・眉は未対応です。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生と、正本を参照して生成した下地。公開許可済み）。',
    clipNames: {
      'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink',
      'modifier:m16:6d6f74696f6e': 'Talk',
    },
  },
  {
    id: 'kohako-v6', label: 'コハコ v6 試作（目・口・額）', name: 'コハコ 本人モデル v6 試作', rig: '../kohako/kohako-v6.p2lrt',
    skipSmallMouth: true,
    notice: 'v5 の目尻・閉眼時のまつげと額の下地を調整し、閉じた口の位置を上げた試作です。小さく開いた口（0.1〜0.3）では閉口線と開口が重なるため、口パクではこの帯を飛ばしています。後ろ髪の大半は体と同じ層で揺れません。Nod クリップと腕・手・眉は未対応です。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生と、正本を参照して生成した下地。公開許可済み）。',
    clipNames: {
      'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink',
      'modifier:m16:6d6f74696f6e': 'Talk',
    },
  },
  {
    id: 'sample', label: 'サンプル（tml）', name: 'tml（PSD2Live の CC0 サンプル）', rig: 'tml.p2lrt',
    notice: '比較用のサンプルです。コハコのモデルではありません。',
    credits: 'サンプル tml: CC0 1.0。',
  },
]

/** URL の `?model=` からモデルを選ぶ。無い・不明な値なら先頭（コハコ）。 */
export function modelFor(search: string): RigModel {
  const id = new URLSearchParams(search).get('model')
  return rigModels.find(m => m.id === id) ?? (rigModels[0] as RigModel)
}

/** モデルのクリップ ID を表示名に直す（名前が無い ID はそのまま）。 */
export function clipName(model: RigModel, id: string): string {
  return model.clipNames?.[id] ?? id
}

/** 表示名からクリップ ID に戻す。 */
export function clipIdFor(model: RigModel, ids: readonly string[], name: string | null): string | null {
  if (name == null) return null
  return ids.find(id => clipName(model, id) === name) ?? null
}

/** 口パク出力の写像。skipSmallMouth のモデル（v6: 閉口線と開口が重なる小開度で二重線になる）だけ、0.12 未満を閉口、それ以上を 0.35 以上の開口にする。他のモデルは 0..1 にそのまま収める。 */
export function mouthLevel(model: Pick<RigModel, 'skipSmallMouth'>, level: number): number {
  if (!(level > 0)) return 0
  if (!model.skipSmallMouth) return Math.min(1, level)
  if (!(level >= 0.12)) return 0
  return Math.min(1, 0.35 + 0.65 * level)
}
