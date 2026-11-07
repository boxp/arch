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

export type RigModelId = 'kohako' | 'kohako-v1' | 'kohako-v2' | 'kohako-v3' | 'kohako-v5' | 'kohako-v6' | 'kohako-v11' | 'kohako-v12' | 'kohako-v13' | 'kohako-v14' | 'kohako-v14b' | 'kohako-v15' | 'kohako-v15b' | 'kohako-v15c' | 'kohako-v15e' | 'kohako-v16' | 'kohako-v17' | 'kohako-v23' | 'kohako-v24' | 'kohako-v25' | 'kohako-v27' | 'kohako-v29' | 'kohako-v30' | 'sample'
export type RigModel = { id: RigModelId; label: string; name: string; rig: string; notice: string; credits: string; clipNames?: Readonly<Record<string, string>>; skipSmallMouth?: boolean; status: 'latest' | 'previous-latest' | 'old' | 'rejected'; evaluation: string; problems: string }

export const rigModels: readonly RigModel[] = [
  {
    id: 'kohako', status: 'old', evaluation: '旧版', problems: '髪固定、目の下の境目、開口の二重線。', label: 'コハコ（最小本人モデル）', name: 'コハコ 最小本人モデル v0', rig: '../kohako/kohako-min.p2lrt',
    notice: 'コハコ正本キャラシートの胸像 1 体から、切り抜き・透過・周囲の肌色での穴埋めと、正本の線色での閉じ目・閉じ口の描き足しだけで作った試作 v0 です（画像生成 AI は不使用）。動くもの: まばたき・口の開閉・顔まわりの角度変形・呼吸・視線・表情。固定のもの: 髪（前後の分離と揺れ）・腕と手・眉。目の下の境目と、口を開いたときの二重線が残っています。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生、公開許可済み）。',
    clipNames: {
      'modifier:m23:6d6f74696f6e': 'Idle', 'modifier:m24:6d6f74696f6e': 'Blink', 'modifier:m25:6d6f74696f6e': 'Nod',
      'modifier:m26:6d6f74696f6e': 'Shake', 'modifier:m27:6d6f74696f6e': 'Talk',
    },
  },
  {
    id: 'kohako-v5', status: 'old', evaluation: '旧版', problems: '閉眼でまつげが残り、口がやや下、上向きで髪下が赤い。', label: 'コハコ v5 試作（三つ編み下の衣装）', name: 'コハコ 本人モデル v5 試作', rig: '../kohako/kohako-v5.p2lrt',
    notice: 'v3 の構成のまま、三つ編みが揺れたときに見える胸の衣装（金紐・桜飾り・紫の着物）を、正本の欠損部だけを描き足した生成素材（Codex の ChatGPT 契約内の画像生成）で補完し、v3 のぼけた補完跡をなくした試作です。既定の見た目は v3 と同じです。既知の不具合: 後ろ髪の大半は体と同じ層で揺れません。桜の髪飾りの脇の白い縁と、前髪の隙間の細い肌色が一部残ります。Nod クリップと腕・手・眉は未対応です。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生と、正本を参照して生成した下地。公開許可済み）。',
    clipNames: {
      'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink',
      'modifier:m16:6d6f74696f6e': 'Talk',
    },
  },
  {
    id: 'kohako-v6', status: 'old', evaluation: '前回の最新配備版', problems: 'まつげ残り、閉眼の四角いパッチ、口が上すぎ、前髪下の赤み。口パク動作確認済み。', label: 'コハコ v6 試作（目・口・額）', name: 'コハコ 本人モデル v6 試作', rig: '../kohako/kohako-v6.p2lrt',
    skipSmallMouth: true,
    notice: 'v5 の目尻・閉眼時のまつげと額の下地を調整し、閉じた口の位置を上げた試作です。小さく開いた口（0.1〜0.3）では閉口線と開口が重なるため、口パクではこの帯を飛ばしています。後ろ髪の大半は体と同じ層で揺れません。Nod クリップと腕・手・眉は未対応です。',
    credits: 'コハコ: Owner のオリジナルキャラクター（正本シートからの派生と、正本を参照して生成した下地。公開許可済み）。',
    clipNames: {
      'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink',
      'modifier:m16:6d6f74696f6e': 'Talk',
    },
  },
  { id: 'kohako-v1', label: 'コハコ v1', name: 'コハコ v1', rig: '../kohako/kohako-v1.p2lrt', status: 'old', evaluation: '旧版・試作', problems: '前髪と横髪を層分離し髪物理を追加。首振り極値で額・頬、三つ編み極値で衣装に継ぎ目。', notice: '前髪と横髪を層分離し髪物理を追加。首振り極値で額・頬、三つ編み極値で衣装に継ぎ目。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m11:6d6f74696f6e': 'Shake', 'modifier:m12:6d6f74696f6e': 'Idle', 'modifier:m13:6d6f74696f6e': 'Blink', 'modifier:m14:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v2', label: 'コハコ v2', name: 'コハコ v2', rig: '../kohako/kohako-v2.p2lrt', status: 'old', evaluation: '旧版・試作', problems: '顔を分離し頬の継ぎ目を解消。頭頂の白縁、前髪隙間、三つ編み下の補完跡。', notice: '顔を分離し頬の継ぎ目を解消。頭頂の白縁、前髪隙間、三つ編み下の補完跡。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v3', label: 'コハコ v3', name: 'コハコ v3', rig: '../kohako/kohako-v3.p2lrt', status: 'old', evaluation: '旧版・試作', problems: '頭頂の白縁を軽減。桜飾り脇の白縁、前髪隙間の肌色、三つ編み下の補完跡。', notice: '頭頂の白縁を軽減。桜飾り脇の白縁、前髪隙間の肌色、三つ編み下の補完跡。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v11', label: 'コハコ v11', name: 'コハコ v11', rig: '../kohako/kohako-v11.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用', problems: '開眼の縁は解消。閉眼の白い補修面と太い二重まつげが v6 より悪化。口 0.5 の二重線、額の赤三角。', notice: '開眼の縁は解消。閉眼の白い補修面と太い二重まつげが v6 より悪化。口 0.5 の二重線、額の赤三角。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v12', label: 'コハコ v12', name: 'コハコ v12', rig: '../kohako/kohako-v12.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用', problems: '目・額は v6 と同じ。口 0.75/1 は原画にほぼ一致、閉口は高い位置のギザついた平坦線、0.25/0.5 は二重線。', notice: '目・額は v6 と同じ。口 0.75/1 は原画にほぼ一致、閉口は高い位置のギザついた平坦線、0.25/0.5 は二重線。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v13', label: 'コハコ v13', name: 'コハコ v13', rig: '../kohako/kohako-v13.p2lrt', status: 'old', evaluation: '前回の試作（首振りを抑制・髪の違和感と目口額は未達、本人確認用）', problems: '髪の大きなずれの主因は「考え中」の首振り（約40°）でした。全本人モデル共通で首振りを0.3倍（最大約21°）に抑えて軽減。v13 の後ろ髪レイヤー移動自体の効果は小さく、後ろ髪の大半は体と同じ層で揺れません。目・口・額は v6 の課題が残っています。', notice: '原画由来の後ろ髪の露出部分を体から後ろ髪レイヤーへ移した試作です。静止画の髪の輪郭は原画とおおむね一致しており、大きなずれは「考え中」の首振りで頭髪が体側の髪から外れて後ろ髪の下地が見えることが原因でした（首振りを抑えて軽減）。目・口・額は v6 と同じです。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v14', label: 'コハコ v14', name: 'コハコ v14', rig: '../kohako/kohako-v14.p2lrt', status: 'old', evaluation: '前回の試作・担当評価: 不採用・本人確認用', problems: '後ろ髪の下地を原画由来の髪に変更。体側に残る髪との継ぎ目と、目・口・額の既知の課題は残ります。動作時の美術上の違和感は本人確認が必要です。', notice: 'v13 の後ろ髪の生成下地を、原画の髪から採った色と線を拡張した下地に置き換えた試作です。元の髪の一部は体に残り、動く髪との段差を解消していません。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v14b', label: 'コハコ v14b', name: 'コハコ v14b', rig: '../kohako/kohako-v14b.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用・比較用', problems: '体側の髪をさらに後ろ髪に移す試作。既定ポーズにも差が生じ、髪揺れの輪郭や継ぎ目が残ります。', notice: 'v14 の下地に加えて、体側と後ろ髪側に重なっていた一部の髪を後ろ髪側にまとめた比較試作です。原画の髪の完全分離や衣装境界の補完には至っていません。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v15', label: 'コハコ v15', name: 'コハコ v15', rig: '../kohako/kohako-v15.p2lrt', status: 'old', evaluation: '旧版・試作・担当評価: 不採用', problems: '外側の髪を部分移動したが、完全分離と衣装下地の補完は未達。首振り時の継ぎ目が残ります。', notice: 'v14 の body 上の外側の髪を多角形と暗色で選び、頭角度と HairBack に追従する後ろ髪へ移した試作です。目・口・額は v14 と同じです。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v15b', label: 'コハコ v15b', name: 'コハコ v15b', rig: '../kohako/kohako-v15b.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用・比較用', problems: '手描きに近い選択範囲と補完は近似で、外側の輪郭と明るい筋が残ります。', notice: '原画の髪画素と肩付近の局所補完を使う比較試作です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v15c', label: 'コハコ v15c', name: 'コハコ v15c', rig: '../kohako/kohako-v15c.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用・比較用', problems: '三つ編み裏の体側補完を減らした試作。顔横に白い抜けが生じ、細い明線も残ります。', notice: 'v15b から、独立した三つ編みの裏に残る暗い体側補完を削り、髪の外周の半透明画素を補正した試作です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v15e', label: 'コハコ v15e', name: 'コハコ v15e', rig: '../kohako/kohako-v15e.p2lrt', status: 'rejected', evaluation: '担当評価: 不採用・閉眼素材の比較用', problems: '完全に閉じた状態は v13 より改善。半開きには肌色パッチと青い目が残り、閉眼への切り替えが不自然です。髪は v15 と同じ課題が残ります。', notice: 'v15 の閉眼だけ、事前生成された画像の目周辺を位置合わせして重ねた試作です。開眼素材は v15 と同じです。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v16', label: 'コハコ v16', name: 'コハコ v16', rig: '../kohako/kohako-v16.p2lrt', status: 'rejected', evaluation: '前回の試作・担当評価: 不採用', problems: '完全閉眼（まぶたの弧）と閉口（原画位置の穏やかな笑み）は v13 より改善。一方、閉眼は 0.3〜0.35 の切替が急で、目周辺に肌色境界が残ります。口 0.25〜0.5 に閉口線と開口の二重線が残り、口 1 の上唇に段差があります。髪は v13 と同じく体側に残る髪との継ぎ目が残ります。', notice: 'v13 に閉眼と閉口の生成素材を位置合わせして統合した試作です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' }, skipSmallMouth: true },
  { id: 'kohako-v17', label: 'コハコ v17', name: 'コハコ v17', rig: '../kohako/kohako-v17.p2lrt', status: 'old', evaluation: '前回の試作・担当評価: 不採用（髪ずれは v23 で修正）', problems: '口 0.4〜0.5 は v16 の二重線から単一の口形に改善。一方、口 0.25 では閉口線と半開き口の二重線が残り、0.4〜0.5 でも口端に線の断片が残ります。口 1 の上唇に段差があり、閉眼は切替が急で目周辺に肌色境界があります。髪は v13 と同じく体側に残る髪との継ぎ目が残ります。', notice: 'v16 に半開き口の生成素材を位置合わせして統合した試作です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v23', label: 'コハコ v23', name: 'コハコ v23', rig: '../kohako/kohako-v23.p2lrt', status: 'old', evaluation: '前回の試作・担当評価: 髪の首振りずれを改善（髪飾り形の下地と口・目は v24 で修正）', problems: '首振り（AngleX ±20〜30）でも肩から下の髪と三つ編みが体に留まり、v17 で起きていた髪全体の横ずれ・下地の露出・衣装への重なりは解消しました。残る点: 肩線（y 365〜425）で上下の髪がつながる位置に ±30° 時に数 px の段差。目・口は v17 と同じ（口 0.2〜0.3 の二重線、閉眼の急な切替）。', notice: 'v17 の髪（後ろ髪・左右の横髪/三つ編み）を肩線で「頭に追従する上部」と「体に留まる下部」の 2 層に分けた試作です。素材追加・画像生成なし。原因は素材不足ではなく、psd2live の髪テンプレートが胸まである髪全体を頭に追従させていたこと（TD-21 再評価）。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v24', label: 'コハコ v24', name: 'コハコ v24', rig: '../kohako/kohako-v24.p2lrt', status: 'old', evaluation: '前回の試作・担当評価: 髪飾り形の下地を除去し、口と目を連続変形に変更（採用候補・本人確認用）', problems: '残る点: 閉口（口 0）の線が細く薄い。まばたきの最後（目 0.15→0）で生成閉眼パッチへ切り替わるため、0.1 付近で一瞬まぶたが二重に見える。三つ編み脇に体側の淡い補完跡が少し残る。肩線（±30°）の数 px の段差は v23 と同じ。', notice: 'v23 の髪分割を維持したうえで 3 点を直した試作です（画像生成なし）。(1) 髪飾り: 桜の髪飾りを前髪層へ切り出したとき、その形のまま髪色で塗られた下地が体と後ろ髪に残っていて、首振りで髪飾りの左に黒い花形が出ていました。推定した頭の輪郭の外側だけ透明にしました。(2) 口: v6〜v22 で重ねていた閉口線・半開きの層を外し、原画の開口 1 枚を psd2live のメッシュ変形で閉じるようにしました（閉口層は生成器の切替規則で中開度まで表示され続け、不透明度キーが効いていなかったのが二重線の原因）。(3) 目: まぶたの変形で 1→0.15 まで閉じ、0.15 以下だけ生成閉眼パッチに切り替えます。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v25', label: 'コハコ v25', name: 'コハコ v25', rig: '../kohako/kohako-v25.p2lrt', status: 'old', evaluation: '前回の試作・担当評価: v24 の静止時の口(赤い点線)を修正。髪飾り混入解消・口目連続変形は v24 と同じ', problems: '口 0.04 では閉口線と開口形が薄く重なります。髪: 肩線で上下に分けた構造のため、首振り（X±20〜30、考え中の約 14〜21°）で外側の髪の輪郭に段差・折れ、三つ編みの折れ、離れた側で下の髪の縁が体の横にはみ出します（TD-23 の録画で確認。v24 と同じ。次は分割をやめて追従を勾配にする v26 を予定）。', notice: '静止時は顔に追従する閉口線を表示し、開口に切り替えます。画像生成なし。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v27', label: 'コハコ v27', name: 'コハコ v27', rig: '../kohako/kohako-v27.p2lrt', status: 'old', evaluation: '過去の試作・担当評価: 自然な首振りの範囲で肩の髪の段差を軽減（本人確認用）', problems: '髪の肩線での分割をやめ、肩より下の髪の頂点を頭の動きと逆向きに補正しました。実際の動き（考え中の首振り X 約 15°）の録画では v25 の右肩外側の段差が目立たなくなりましたが、左肩外側に細い白い筋が出る瞬間があり、大きな首振り（X±30 と上下の組合せ）では肩下に約 10px のずれが残ります。口・目・髪飾りは v25 と同じ処理です。', notice: 'v26（髪の分割なし）に肩下の頂点補正を加えた試作です。画像生成なし。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  { id: 'kohako-v29', label: 'コハコ v29', name: 'コハコ v29', rig: '../kohako/kohako-v29.p2lrt', status: 'previous-latest', evaluation: '前回の試作・担当評価: 長い髪を体から分離し肩の下地を補完（本人確認用）', problems: '肩に掛かる長い髪（外側の細い房を含む）を、髪の色だけで選んで体から切り離し、後ろ髪と一緒に動くようにしました。体側の隠れていた肩・衣装は生成済みの下地（髪枠 1/4）で埋め、衣装の外の白い背景は透明にしています。v27 と同じ動きの録画では、右肩外側の白い筋と左肩の房と肩当ての間の白い帯が消えました。一方、左肩当ての上端に小さな白い欠片と細い線が出る瞬間が残ります。髪は全長が頭に追従するので、大きな首振りでは髪の先も一緒に動きます。口・目・髪飾りは v25 と同じ処理です。', notice: 'v26 の部品（v17 配置＋髪飾り下地修正）から作り直した試作です。今回の画像生成は 0 回です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。肩の下地は Codex 組込み画像生成（ChatGPT 契約内、2026-11-07、髪枠 1/4）。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
{ id: 'kohako-v30', label: 'コハコ v30', name: 'コハコ v30', rig: '../kohako/kohako-v30.p2lrt', status: 'latest', evaluation: '最新の試作・担当評価: 左肩当て上端の白い欠片を解消（本人確認用）', problems: 'v29 で考え中の首振り（t≈6.0s）に左肩当ての上端に出ていた白い欠片は、体の層の肩の上端が水平に切れていて、髪が動くと背景が見えていたものでした（原画では三つ編みに隠れ、生成下地も背景だった所）。肩当ての上端から襟の脇までの自然な肩の線の下を、衣装の暗色で埋めました。同じ動きの録画では大きな白い欠片は消え、ごく小さな点と髪の中の細い線は残ります。大きな首振りでは v29 と同じく髪の先も一緒に動きます。口・目・髪飾り・髪は v29 と同じ処理です。', notice: 'v29 の体の層の左肩だけを直した試作です。今回の画像生成は 0 回です。', credits: 'コハコ: Owner のオリジナルキャラクターからの派生。肩の下地は Codex 組込み画像生成（ChatGPT 契約内、2026-11-07、髪枠 1/4）。', clipNames: { 'modifier:m13:6d6f74696f6e': 'Shake', 'modifier:m14:6d6f74696f6e': 'Idle', 'modifier:m15:6d6f74696f6e': 'Blink', 'modifier:m16:6d6f74696f6e': 'Talk' } },
  {
    id: 'sample', status: 'old', evaluation: '比較用サンプル', problems: '本人モデルではありません。', label: 'サンプル（tml）', name: 'tml（PSD2Live の CC0 サンプル）', rig: 'tml.p2lrt',
    notice: '比較用のサンプルです。コハコのモデルではありません。',
    credits: 'サンプル tml: CC0 1.0。',
  },
]

/**
 * クエリ無しの URL で表示する「最新の配備済み本人モデル」（現在は v30）。新しい版を配備したらここを更新する。
 * 本人の美術受入とは別で、検証版として表示する（受入済みの意味ではない）。
 */
export const LATEST_MODEL_ID: RigModelId = 'kohako-v30'

/**
 * 本人モデルの視線（= 首振り）の倍率。BOXP-441 TD-18: 「考え中」の視線 (0.6, 0.5) と待機モーションが重なると
 * AngleX が約 40° まで回り、頭髪の塊が体側の長い髪から外れて後ろ髪の下地が露出した（実ブラウザで再現）。
 * 本人モデルは髪が体と同じ層に残っているため、首振りを継ぎ目が目立たない範囲に抑える。サンプルは原寸のまま。
 */
export const KOHAKO_LOOK_SCALE = 0.3

/** モデルに合わせて視線を縮める。 */
export function lookFor(model: RigModel, x: number, y: number): [number, number] {
  const s = model.id === 'sample' ? 1 : KOHAKO_LOOK_SCALE
  return [x * s, y * s]
}

/** `?model=` の値をモデル ID に直す（`kohako-v0` は v0 の別名）。 */
export function normalizeModelId(id: string | null): string | null {
  return id === 'kohako-v0' ? 'kohako' : id
}

/** URL の `?model=` からモデルを選ぶ。無い・不明な値なら最新の配備済み本人モデル。 */
export function modelFor(search: string): RigModel {
  const id = normalizeModelId(new URLSearchParams(search).get('model'))
  return rigModels.find(m => m.id === id) ?? (rigModels.find(m => m.id === LATEST_MODEL_ID) as RigModel)
}

/** 表示中のモデルが「クエリ無しで出る最新配備版」か、明示指定された比較用の版かの説明。 */
export function modelStatus(model: RigModel): string { return model.evaluation }

/** モデルのクリップ ID を表示名に直す（名前が無い ID はそのまま）。 */
export function clipName(model: RigModel, id: string): string {
  return model.clipNames?.[id] ?? id
}

/** 表示名からクリップ ID に戻す。 */
export function clipIdFor(model: RigModel, ids: readonly string[], name: string | null): string | null {
  if (name == null) return null
  return ids.find(id => clipName(model, id) === name) ?? null
}

/** 口パク出力の写像。skipSmallMouth のモデル（v6、v11、v12: 小開度で二重線が残る）だけ、0.12 未満を閉口、それ以上を 0.35 以上の開口にする。他のモデルは 0..1 にそのまま収める。 */
export function mouthLevel(model: Pick<RigModel, 'skipSmallMouth'>, level: number): number {
  if (!(level > 0)) return 0
  if (!model.skipSmallMouth) return Math.min(1, level)
  if (!(level >= 0.12)) return 0
  return Math.min(1, 0.35 + 0.65 * level)
}

export type LostPrototype = { id: string; evaluation: string; problems: string; images: string[]; note?: string }
export const lostPrototypes: readonly LostPrototype[] = [
  { id: 'kohako-v34', evaluation: '不採用・比較画像', problems: '透明部分の色を隣の髪色で埋めても、左肩上の点線は録画で残りました（描画は premultiplied で、白のにじみが原因ではないと判断）。', images: ['./kohako/live2d/compare/kohako-v34-left.jpg', './kohako/live2d/compare/kohako-v34-right.jpg'], note: 'v34 は不採用のため比較画像のみ掲載し、v30 を引き続き表示します。各画像は上が v30、下が v34 です。' },
  { id: 'kohako-v33', evaluation: '不採用・比較画像', problems: '後ろ髪・三つ編みの縁に残った白いにじみ（約900画素）を髪色に置き換えました。層単体では外側の白い点列が消えますが、左肩上の点線は録画で残りました。', images: ['./kohako/live2d/compare/kohako-v33-left.jpg', './kohako/live2d/compare/kohako-v33-layer.jpg'], note: 'v33 は不採用のため比較画像のみ掲載し、v30 を引き続き表示します。録画の画像は上が v30、下が v33、層の画像は左が v30、右が v33 です。' },
  { id: 'kohako-v32', evaluation: '不採用・比較画像', problems: '後ろ髪の明るい画素を局所補正しましたが、左肩上の点線は録画で残りました。', images: ['./kohako/live2d/compare/kohako-v32-left.jpg', './kohako/live2d/compare/kohako-v32-right.jpg', './kohako/live2d/compare/kohako-v32-det.jpg'], note: 'v32 は不採用のため比較画像のみ掲載し、v30 を引き続き表示します。各画像は上が v30、下が v32 です。' },
  { id: 'kohako-v31', evaluation: '不採用・比較画像', problems: '髪の中の点線が録画で残ったため、低 alpha の孤立画素の除去だけでは解消できませんでした。', images: ['./kohako/live2d/compare/kohako-v31-left.jpg', './kohako/live2d/compare/kohako-v31-right.jpg', './kohako/live2d/compare/kohako-v31-det.jpg'], note: 'v31 は不採用のため比較画像のみ掲載し、v30 を引き続き表示します。各画像は上が v30、下が v31 です。' },
  { id: 'kohako-v28', evaluation: '予備候補は不採用・検証未完', problems: '長髪マスクに衣装の暗色部分が混入し、肩に白い縁と衣装の欠けが生じます。補正あり・中間案は未検証です。', images: ['./kohako/live2d/compare/kohako-v28-probe-rest.jpg', './kohako/live2d/compare/kohako-v28-probe-layer.jpg', './kohako/live2d/compare/kohako-v28-probe-det.jpg', './kohako/live2d/compare/kohako-v28-probe-nat.jpg'], note: 'v28 の補正なし予備候補は不採用です。完成版ではありません。v27 を引き続き表示します。' },
  { id: 'kohako-v26', evaluation: '不採用・本人確認用', problems: '肩線分割を廃止し追従の勾配を試したが、肩以下の残差が大きく、録画でも改善を確認できませんでした。', images: ['./kohako/live2d/compare/kohako-v26-full.jpg', './kohako/live2d/compare/kohako-v26-shoulder.jpg', './kohako/live2d/compare/kohako-v26-ornament.jpg', './kohako/live2d/compare/kohako-v26-sheet.jpg', './kohako/live2d/compare/kohako-v26-extra.jpg'], note: 'v26 は不採用のためモデルを配布せず、比較資料のみ掲載しています。' },
  { id: 'kohako-v4', evaluation: '消失・担当不採用', problems: '生成した衣装下地の桜飾り・金縁が正本と合わず、揺れで縦筋。', images: ['./kohako/live2d/compare/kohako-v4-compare-v3.png'] },
  { id: 'kohako-v7', evaluation: '消失・担当不採用', problems: '閉眼パッチは消えたが目周りがぼけ、開眼の目尻に白縁。口 0.5/1 に二重線。', images: ['./kohako/live2d/compare/kohako-v7-compare-eyes.png', './kohako/live2d/compare/kohako-v7-compare-mouth.png', './kohako/live2d/compare/kohako-v7-compare-forehead.png'] },
  { id: 'kohako-v8', evaluation: '消失・担当不採用', problems: '閉眼が平坦線と肌ブロック、開眼の目頭に明るい三角、口 0.1〜0.5 に二重線。', images: ['./kohako/live2d/compare/kohako-v8-compare-eyes.png', './kohako/live2d/compare/kohako-v8-compare-mouth.png'] },
  { id: 'kohako-v9', evaluation: '消失・担当不採用', problems: '閉眼に縦筋とまつ毛の垂れ、口 1.0 で上唇段差、額 Y−30 の縦筋が悪化。', images: ['./kohako/live2d/compare/kohako-v9-compare-eyes.png'] },
  { id: 'kohako-v10', evaluation: '消失・担当不採用', problems: '開眼の縁は解消。閉眼の上まぶたが平坦な淡色で二重線の断片が残る。', images: ['./kohako/live2d/compare/kohako-v10-compare-eyes.png'] },
  { id: 'kohako-v18', evaluation: '担当不採用(画像生成なしの調整案)', problems: '案a: 閉口/半開きの交差を 0.08〜0.12 に狭めると口 0.1〜0.2 から二重線が出て悪化。閉眼を EyeOpen 0〜0.35 で線形交差すると 0.1〜0.2 で青い目とまつ毛の二重弧。案b: 半開きパッチを広げ縁をぼかすと頬・首元に黒/青の断片。口 1 の上唇は ±1px ずらしでも元位置が最良。いずれも v17 より悪いため v17 のまま。', images: ['./kohako/live2d/compare/kohako-v18a-compare-mouth.jpg', './kohako/live2d/compare/kohako-v18a-compare-eyes.jpg', './kohako/live2d/compare/kohako-v18b-compare-mouth.jpg'], note: 'v18 の調整案は v17 より悪化したため p2lrt は配備していません(最終結果は v17 と同一)。試した案の比較画像を表示します(各画像は 原画 / v17 / 調整案 の順)。' },
  { id: 'kohako-v19', evaluation: '担当評価: 不採用（メッシュ変形試行）', problems: '半開き層を閉口側で上に移動したが、口 0.2〜0.25 の二重線と口端の断片が残り、強い変形では断片が目立つため v17 に戻しました。口 1 の上唇の段差、目の中間開度の急な切替と肌色境界、v13 と同じ体側に残る髪との継ぎ目が残ります。', images: ['./kohako/live2d/compare/kohako-v19-compare-mouth.jpg', './kohako/live2d/compare/kohako-v19-compare-full.jpg', './kohako/live2d/compare/kohako-v19-trial1-mouth.jpg', './kohako/live2d/compare/kohako-v19-trial2-mouth.jpg', './kohako/live2d/compare/kohako-v19-trial3-mouth.jpg'], note: '最終 v19 は v17 と同一のため比較画像のみ掲載します。前の2枚は原画 / v17 / 最終 v19、後の3枚は原画 / v17 / 各変形案です。' },
  { id: 'kohako-v20', evaluation: '担当評価: rejected（半開き素材を不採用）', problems: '生成素材の上唇は閉口線と曲率・口角が一致せず、白い歯状部分もあるため統合を見送りました。v17 の口 0.2〜0.3 の二重線、0.4〜0.5 の口端の断片、口 1 の上唇の段差と目の切替・肌色境界が残ります。髪は v13 と同じく体側に残る髪との継ぎ目が残ります。', images: ['./kohako/live2d/compare/kohako-v20-compare-mouth.jpg', './kohako/live2d/compare/kohako-v20-compare-full.jpg', './kohako/live2d/compare/kohako-v20-material.jpg'], note: '素材は不採用のため最終 v20 は v17 と同一です。比較画像の3列目は v17 と同じ最終状態です。' },
  { id: 'kohako-v21', evaluation: '担当評価: rejected（閉口素材を不採用）', problems: '新閉口線の曲率と口角が v17 の半開き上唇に一致せず、統合を見送りました。v17 の口 0.2〜0.3 の二重線、0.4〜0.5 の口端の断片、口 1 の上唇の段差と目の切替・肌色境界が残ります。髪は v13 と同じく体側に残る髪との継ぎ目が残ります。', images: ['./kohako/live2d/compare/kohako-v21-compare-mouth.jpg', './kohako/live2d/compare/kohako-v21-compare-full.jpg', './kohako/live2d/compare/kohako-v21-material.jpg'], note: '素材は不採用のため最終 v21 は v17 と同一です。比較画像の3列目は v17 と同じ最終状態です。' },
  { id: 'kohako-v22', evaluation: '担当評価: rejected（上唇画素の流用を不採用）', problems: '抽出した閉口線が途切れ口角に赤い断片が残り、口 0.2〜0.3 の二重線も解消しません。角度付きの閉口も不自然です。v17 の口端の断片、開口時の上唇の段差、目と肌色の境界、髪の継ぎ目も残ります。', images: ['./kohako/live2d/compare/kohako-v22-compare-mouth.jpg', './kohako/live2d/compare/kohako-v22-compare-full.jpg'], note: '比較画像の3列目は不採用の試作です。最終 v22 は採用されていません。' },
]
