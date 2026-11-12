export type Emotion = 'neutral' | 'smile' | 'smileClosed' | 'shy' | 'troubled' | 'surprised' | 'serious'
export type Gesture = 'none' | 'nod' | 'tilt' | 'joy' | 'greet' | 'guide' | 'shyHand' | 'halt'
export const emotions: readonly Emotion[] = ['neutral', 'smile', 'smileClosed', 'shy', 'troubled', 'surprised', 'serious']
export const gestures: readonly Gesture[] = ['none', 'nod', 'tilt', 'joy', 'greet', 'guide', 'shyHand', 'halt']
export type Cue = { emotion: Emotion; gesture: Gesture }
export interface ActingStage { setEmotion(e: Emotion): void; playGesture(g: Gesture): void; reset(): void; setViseme?(v: { open: number; width: number } | null): void; setPetEyes?(on: boolean): void; setPetOffset?(v: { headX: number; headY: number; headZ: number }): void }
export type OperationalState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'failed'

export function splitSentences(text: string): string[] {
  const result: string[] = []
  const pieces = text.trim().match(/[^。！？!?…\n]+[。！？!?…\n]*|[。！？!?…\n]+/g) ?? []
  for (const piece of pieces) {
    let chars = Array.from(piece)
    while (chars.length > 120) {
      const comma = chars.slice(0, 120).lastIndexOf('、')
      const length = comma >= 0 ? comma + 1 : 120
      const part = chars.slice(0, length).join('')
      if (part.trim()) result.push(part)
      chars = chars.slice(length)
    }
    const rest = chars.join('')
    if (rest.trim()) result.push(rest)
  }
  return result
}

export function cueForSentence(s: string): Cue {
  if (/危険|やめて|止めて|待ってください|実行する前に|確認させてください|取り返しがつか/.test(s)) return { emotion: 'serious', gesture: 'halt' }
  if (/すみません|申し訳|ごめんなさい|困り|できませんでした|失敗|わかりません/.test(s)) return { emotion: 'troubled', gesture: 'tilt' }
  if (/照れ|恥ずかし|褒めすぎ|褒め/.test(s) || (/ありがとうございます/.test(s) && /えへ|そんな|でも/.test(s))) return { emotion: 'shy', gesture: 'shyHand' }
  if (/ありがとうございます/.test(s)) return { emotion: 'smile', gesture: 'nod' }
  if (/えっ|わっ|驚|びっくり|まさか/.test(s)) return { emotion: 'surprised', gesture: 'none' }
  if (/よかった|嬉しい|うれしい|おめでとう|やった|できました|成功/.test(s)) return { emotion: 'smileClosed', gesture: 'joy' }
  if (/^(こんにちは|おはよう|こんばんは|ようこそ|お疲れさま|おつかれさま|はじめまして)/.test(s.trimStart().replace(/^[^、,\s]{1,20}(?:さま|様)[、,\s]+/, ''))) return { emotion: 'smile', gesture: 'greet' }
  if (/こちら|ご案内|確認できます|開きますね|表示します|お見せします|メール|ノート|予定/.test(s)) return { emotion: 'smile', gesture: 'guide' }
  if (/[？?]$|(?:ですか|ますか)[。！？!?…]*$/.test(s.trim())) return { emotion: 'neutral', gesture: 'tilt' }
  return { emotion: 'neutral', gesture: 'none' }
}

export class ActingDirector {
  private data: { operational: OperationalState; emotion: Emotion; gesture: Gesture; epoch: number; replySentences: number; bigGesturesUsed: number; lastError?: string } = { operational: 'idle', emotion: 'neutral', gesture: 'none', epoch: 0, replySentences: 0, bigGesturesUsed: 0 }
  constructor(private stage: ActingStage) {}
  get snapshot() { return { ...this.data } }
  private call(fn: () => void) { try { fn() } catch (e) { this.data.lastError = e instanceof Error ? e.message : String(e) } }
  setOperational(state: OperationalState) {
    if (state === this.data.operational) return
    this.data.operational = state; this.data.epoch++
    if (state === 'speaking') return
    this.call(() => this.stage.reset()); this.data.emotion = 'neutral'; this.data.gesture = 'none'
    if (state === 'approval' || state === 'failed') {
      const emotion = state === 'approval' ? 'serious' : 'troubled'
      this.data.emotion = emotion; this.call(() => this.stage.setEmotion(emotion))
    }
  }
  beginReply() { this.data.replySentences = 0; this.data.bigGesturesUsed = 0 }
  sentence(cue: Cue) {
    if (this.data.operational !== 'speaking') return
    const previous = this.data.gesture
    let gesture = cue.gesture
    const big = (g: Gesture) => ['joy', 'greet', 'guide', 'shyHand', 'halt'].includes(g)
    if ((big(gesture) && this.data.bigGesturesUsed >= 1) || (gesture !== 'none' && gesture === previous)) gesture = previous === 'nod' ? 'none' : 'nod'
    if (big(gesture)) this.data.bigGesturesUsed++
    this.data.replySentences++; this.data.emotion = cue.emotion; this.data.gesture = gesture
    this.call(() => this.stage.setEmotion(cue.emotion))
    if (gesture !== 'none') this.call(() => this.stage.playGesture(gesture))
  }
  interrupt() { this.data.epoch++; this.data.emotion = 'neutral'; this.data.gesture = 'none'; this.beginReply(); this.call(() => this.stage.reset()) }
}
