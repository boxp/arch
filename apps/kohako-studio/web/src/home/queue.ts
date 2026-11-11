// BOXP-508: 応答待ち中に書いた次の発言を送信待ちに積み、現在の依頼が正常に終わってから FIFO で 1 件ずつ同じ会話へ送る。
// 本文はこの画面のメモリだけに持つ（localStorage / sessionStorage には保存しない）。再読み込みやタブを閉じると消える。
// 送り出した先頭は既存の「受理未確認の控え」（受付番号付き）へ移り、二重実行防止はその規則に従う。

export const QUEUE_MAX_ITEMS = 5
export const QUEUE_MAX_CHARS = 500

export type QueueItem = { id: number; text: string; addedAt: number }
/** 自動送信を止めた理由。止まっている間は先頭を送らず、明示的な「再開」か「取消」を待つ。 */
export type HoldReason = 'failed' | 'stopped' | 'auth' | 'unknown' | 'offline' | 'timeout'
export type AddResult = { ok: true; item: QueueItem } | { ok: false; error: 'empty' | 'too_long' | 'full' }

export const holdLabel: Record<HoldReason, string> = {
  failed: '前の依頼が失敗したため',
  stopped: '前の依頼を停止したため',
  auth: '認証が切れたため',
  unknown: '前の送信が受理されたか確認できないため',
  offline: '接続できないため',
  timeout: '前の依頼の確認がタイムアウトしたため',
}

export class MessageQueue {
  private items: QueueItem[] = []
  private seq = 0
  held: HoldReason | null = null

  get size(): number { return this.items.length }
  list(): readonly QueueItem[] { return this.items }
  peek(): QueueItem | null { return this.items[0] ?? null }

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

  /** 待機中の 1 件を取り消す。送り出し済み（キューから外れたもの）は対象外。 */
  remove(id: number): boolean {
    const i = this.items.findIndex(x => x.id === id)
    if (i < 0) return false
    this.items.splice(i, 1)
    if (!this.items.length) this.held = null
    return true
  }

  clear(): void { this.items = []; this.held = null }

  /** 先頭を送り出すために取り出す。保留中・空なら null（同じ項目を 2 回取り出すことはない）。 */
  take(): QueueItem | null {
    if (this.held) return null
    return this.items.shift() ?? null
  }

  /** 受理されなかったことが確定した項目を先頭へ戻す（順序を保つ）。 */
  putBack(item: QueueItem): void {
    if (this.items.some(x => x.id === item.id)) return
    this.items.unshift(item)
  }

  /** 待機中の項目があるときだけ保留にする（空のキューは保留にしない）。 */
  hold(reason: HoldReason): boolean {
    if (!this.items.length) return false
    this.held = reason
    return true
  }

  resume(): void { this.held = null }
}

export const addErrorText: Record<'empty' | 'too_long' | 'full', string> = {
  empty: '',
  too_long: `送信待ちに積めるのは ${QUEUE_MAX_CHARS} 文字までです。`,
  full: `送信待ちは ${QUEUE_MAX_ITEMS} 件までです。送られるか取り消すまでお待ちください（入力した本文はそのまま残しています）。`,
}
