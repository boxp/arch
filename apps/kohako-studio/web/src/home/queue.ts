// BOXP-508: 応答待ち中に書いた次の発言を送信待ちに積み、現在の依頼が正常に終わってから FIFO で 1 件ずつ同じ会話へ送る。
// 本文は通常この画面のメモリだけに持つ。認証切れの手動再読み込み時のみ sessionStorage に一時退避する。
// 送り出した先頭は既存の「受理未確認の控え」（受付番号付き）へ移り、二重実行防止はその規則に従う。
// BOXP-658: 受信箱・吹き出しからの通知返信も同じ FIFO に積む。通知返信は notice（通知 ID・票・出どころ・登録時に固定した replyId）を持ち、
// 通常の発言としては送らず、必ずその通知の返信 API へ送る（別通知・進行中の承認へ結び付けない）。

export const QUEUE_MAX_ITEMS = 5
export const QUEUE_MAX_CHARS = 500

/** 通知への返信の文脈。value は BFF へ送る値そのもの（選択肢は記号、自由文は本文）。 */
export type NoticeReply = {
  eventId: string
  ticketId?: string
  source: string
  title: string
  kind: 'choice' | 'text'
  value: string
  replyId: string
}
export type QueueItem = {
  id: number
  text: string
  addedAt: number
  notice?: NoticeReply
}
/** 自動送信を止めた理由。止まっている間は先頭を送らず、明示的な「再開」か「取消」を待つ。 */
export type HoldReason =
  | 'failed'
  | 'stopped'
  | 'auth'
  | 'unknown'
  | 'offline'
  | 'timeout'
  | 'speech'
  | 'busy'
  | 'notice_replied'
  | 'notice_gone'
  | 'notice_invalid'
export type AddError = 'empty' | 'too_long' | 'full' | 'duplicate' | 'sending'
export type AddResult = { ok: true; item: QueueItem } | { ok: false; error: AddError }

export const holdLabel: Record<HoldReason, string> = {
  failed: '前の依頼が失敗したため',
  stopped: '前の依頼を停止したため',
  auth: '認証が切れたため',
  unknown: '前の送信が受理されたか確認できないため',
  offline: '接続できないため',
  timeout: '前の依頼の確認がタイムアウトしたため',
  speech: '読み上げが途中のため',
  busy: 'ほかの依頼がまだ進行中のため',
  notice_replied: '先頭の通知には別の返信が先に届いていたため',
  notice_gone: '先頭の通知が見つからなくなったため',
  notice_invalid: '先頭の通知の選択肢が変わり、その選択を送れないため',
}
/** 通知返信の保留理由（送り直しても同じ結果になるので、取消を案内する）。 */
export const noticeHold = (r: HoldReason | null): boolean =>
  r === 'notice_replied' || r === 'notice_gone' || r === 'notice_invalid'

/** 送信待ち一覧・履歴に出す通知返信の表示（返信先つき）。 */
export const noticeText = (n: Pick<NoticeReply, 'title' | 'ticketId' | 'kind' | 'value'>) =>
  `通知「${n.title}」${n.ticketId ? `（${n.ticketId}）` : ''}への${n.kind === 'choice' ? '選択' : '返信'}: ${n.value}`

export class MessageQueue {
  private items: QueueItem[] = []
  private seq = 0
  /** 取り出して送信中の項目（結果が出るまで同じ通知への別の返信を積ませない）。 */
  private inflight: QueueItem | null = null
  held: HoldReason | null = null

  get size(): number {
    return this.items.length
  }
  list(): readonly QueueItem[] {
    return this.items
  }
  peek(): QueueItem | null {
    return this.items[0] ?? null
  }
  /** その通知への返信が送信待ちにあれば返す（同じ通知へは 1 件まで）。 */
  noticeFor(eventId: string): QueueItem | null {
    return this.items.find((x) => x.notice?.eventId === eventId) ?? null
  }

  /** 本文を末尾へ積む。空・長すぎ・上限超過では積まない（呼び出し側は入力欄の本文を消さない）。 */
  add(raw: string, now: number): AddResult {
    const text = raw.trim()
    if (!text) return { ok: false, error: 'empty' }
    if (text.length > QUEUE_MAX_CHARS) return { ok: false, error: 'too_long' }
    if (this.items.length >= QUEUE_MAX_ITEMS) return { ok: false, error: 'full' }
    const item = { id: ++this.seq, text, addedAt: now }
    this.items.push(item)
    return { ok: true, item }
  }

  /** 通知への返信を末尾へ積む。上限・文字数は通常の発言と共通。同じ通知への返信がすでに待機中なら積まない（連打・重複防止）。 */
  addNotice(raw: NoticeReply, now: number): AddResult {
    const value = raw.kind === 'text' ? raw.value.trim() : raw.value
    if (!value.trim()) return { ok: false, error: 'empty' }
    if (value.length > QUEUE_MAX_CHARS) return { ok: false, error: 'too_long' }
    if (this.noticeFor(raw.eventId)) return { ok: false, error: 'duplicate' }
    // 送信中の同じ通知への返信は、登録時の replyId で送られている最中。別の内容を積むと同じ replyId の既存返信として扱われ失われるため拒否する。
    if (this.inflight?.notice?.eventId === raw.eventId) return { ok: false, error: 'sending' }
    if (this.items.length >= QUEUE_MAX_ITEMS) return { ok: false, error: 'full' }
    const notice = { ...raw, value }
    const item = {
      id: ++this.seq,
      text: noticeText(notice),
      addedAt: now,
      notice,
    }
    this.items.push(item)
    return { ok: true, item }
  }

  /** 待機中の 1 件を取り消す。送り出し済み（キューから外れたもの）は対象外。 */
  remove(id: number): boolean {
    const i = this.items.findIndex((x) => x.id === id)
    if (i < 0) return false
    this.items.splice(i, 1)
    // 先頭の通知返信に固有の保留（先に返信済み・通知消失・選択肢変更）は、その項目を取り消したら解く。
    if (!this.items.length || (i === 0 && noticeHold(this.held))) this.held = null
    return true
  }

  /** 待機中の項目をすべて取り消す。送信中（take 済み）の項目は取り消せないため、結果が出るまで inflight を保つ。 */
  clear(): void {
    this.items = []
    this.held = null
  }

  /** 先頭を送り出すために取り出す。保留中・空なら null（同じ項目を 2 回取り出すことはない）。 */
  take(): QueueItem | null {
    if (this.held) return null
    const item = this.items.shift() ?? null
    if (item) this.inflight = item
    return item
  }

  /** 受理されなかったことが確定した項目を先頭へ戻す（順序を保つ）。 */
  putBack(item: QueueItem): void {
    if (this.inflight?.id === item.id) this.inflight = null
    if (this.items.some((x) => x.id === item.id)) return
    this.items.unshift(item)
  }

  /** 待機中の項目があるときだけ保留にする（空のキューは保留にしない）。 */
  hold(reason: HoldReason): boolean {
    if (!this.items.length) return false
    this.held = reason
    return true
  }

  /** 取り出した項目の送信が終わった（受理・確定失敗とも）。putBack 済みなら何もしない。 */
  settle(id: number): void {
    if (this.inflight?.id === id) this.inflight = null
  }

  resume(): void {
    this.held = null
  }
}

export const addErrorText: Record<AddError, string> = {
  empty: '',
  too_long: `送信待ちに入れられるのは${QUEUE_MAX_CHARS}文字までです。`,
  full: `送信待ちは${QUEUE_MAX_ITEMS}件までです。送信が終わるか取り消してからお試しください（入力中の文章は残っています）。`,
  duplicate: 'この通知への返信はすでに送信待ちにあります。変えるときは送信待ちから取り消してください。',
  sending: 'この通知への返信を送信中です。結果が出るまでお待ちください（入力中の文章は残っています）。',
}
