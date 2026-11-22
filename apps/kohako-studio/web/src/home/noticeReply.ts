// BOXP-658（停滞レビュー BOXP-661 案B）: 送信待ちの通知返信について「送るか・保留するか・取り消せるか」の判定をここへ集約する。
// main.ts は通信と表示だけを行い、判定はこの純関数の結果に従う。状態×事象の表試験は noticeReply.test.ts。
//
// 原則（fail-closed）:
// - 同じ replyId の返信がサーバーに記録されていれば、状態（claimed/submitted/submit_failed）に関わらず同じ replyId で返信 API へ送る。
//   BFF は同じ replyId を冪等に扱い、追跡中ならその受付番号を返し、再起動などで追跡を失っていれば追跡を作り直す。
//   画面側で「受理済みだから送らない」「未送信だから取り消す」と推定しない。
// - 一度返信 API へ送った返信（attempted）は、サーバーが実行しないと確定させた場合（別の replyId が先に返信済み・
//   通知が BFF に無い）だけ取り消せる。同じ replyId が submit_failed の記録は BFF が同じ replyId の再送を受け付けるため
//   「取り消した」とは扱わず、送信待ちから外して受信箱の送信失敗の記録へ委ねる（release）。それ以外は保留して同じ replyId の再開を案内する。
import type { HoldReason, NoticeReply } from './queue'

/** 通知の最新状態から見た、登録時の replyId の返信の状態。 */
export type ServerReply =
  | { state: 'none' }
  | { state: 'error' }
  | { state: 'other' }
  | { state: 'gone' }
  | { state: 'mine'; status: string; requestId: string }

type ListedItem = { eventId: string; reply?: { replyId: string; status: string; requestId: string } }

/** 通知一覧（GET notifications の items）から、この返信の状態を求める。一覧が読めなければ error。 */
export function serverReplyFrom(items: unknown, n: Pick<NoticeReply, 'eventId' | 'replyId'>): ServerReply {
  if (!Array.isArray(items)) return { state: 'error' }
  const cur = (items as ListedItem[]).find((x) => x?.eventId === n.eventId)
  // 通知そのものが BFF に無い: 返信 API は not_found を返すため、この返信は後から受理されない。
  if (!cur) return { state: 'gone' }
  if (cur.reply?.replyId === n.replyId)
    return { state: 'mine', status: String(cur.reply.status ?? ''), requestId: String(cur.reply.requestId ?? '') }
  if (cur.reply) return { state: 'other' }
  return { state: 'none' }
}

/** 返信 API へ送る直前の判定。 */
export type Preflight = { kind: 'post' } | { kind: 'hold'; reason: HoldReason }
/**
 * choices は通知の現在の選択肢（BFF の choicesOf と同じ判定の値）。
 * 同じ replyId の返信がサーバーにあれば選択肢の変化に関わらず送る（BFF も既存返信には選択肢検証をしない）。
 */
export function preflight(found: ServerReply, n: Pick<NoticeReply, 'kind' | 'value'>, choices: string[]): Preflight {
  switch (found.state) {
    case 'error':
      return { kind: 'hold', reason: 'failed' }
    case 'gone':
      return { kind: 'hold', reason: 'notice_gone' }
    case 'other':
      return { kind: 'hold', reason: 'notice_replied' }
    case 'mine':
      return { kind: 'post' }
    case 'none':
      return n.kind === 'choice' && !choices.includes(n.value)
        ? { kind: 'hold', reason: 'notice_invalid' }
        : { kind: 'post' }
  }
}

/**
 * 返信 API の応答の分類。
 * attempted: keep = 印をそのまま（以前に送っていればそれを保つ）、revert = この送信で claim は保存されていないので、
 * 以前に送っていなければ印を外す、set = 既存の claim があるので印を必ず残す。
 * unsure は通知の最新状態で受理を確かめてから判断する（unsureOutcome）。
 */
export type ReplyOutcome =
  | { kind: 'accepted'; requestId: string }
  | { kind: 'expired'; requestId: string }
  | { kind: 'auth'; attempted: 'revert' }
  | { kind: 'hold'; reason: HoldReason; attempted: 'keep' | 'revert' | 'set'; sync?: true }
  | { kind: 'unsure' }
export function classifyReply(status: number, data: Record<string, unknown> | null, isAuth: boolean): ReplyOutcome {
  const requestId = typeof data?.requestId === 'string' ? data.requestId : ''
  // 既存返信の確認期限（23h）切れ（tracking: expired）: BFF は二重実行を避けるため再送も追跡の作り直しもしない。
  // 受付番号を返しても追える応答は無く、同じ replyId で送り直しても結果は変わらない。受付成功として扱わず、
  // 「受け付けられた可能性があるが確認できない」終端として送信待ちから外し、後続は保留する（main 側）。
  if ((status === 200 || status === 202) && data?.tracking === 'expired') return { kind: 'expired', requestId }
  // 受理済みだが BFF が追跡を作り直せなかった（tracking: unavailable = 再起動で追跡を失い、別の run の進行中などで再開できない）。
  // 受付番号はあっても応答を追えないので受付成功として外さず、印を残して保留し、現 run の後に同じ replyId で追跡を作り直す。
  if ((status === 200 || status === 202) && data?.status === 'submitted' && data?.tracking === 'unavailable')
    return { kind: 'hold', reason: 'busy', attempted: 'set', sync: true }
  if ((status === 200 || status === 202) && data?.status === 'submitted' && requestId)
    return { kind: 'accepted', requestId }
  if (isAuth) return { kind: 'auth', attempted: 'revert' }
  // 既存の claim（受理済みの可能性あり）への busy は未送信の確定ではない。印を残し、取消前に受理確認を必須にする。
  if (status === 429 && data?.error === 'busy_claimed')
    return { kind: 'hold', reason: 'busy', attempted: 'set', sync: true }
  if (status === 429 && data?.error === 'busy') return { kind: 'hold', reason: 'busy', attempted: 'revert', sync: true }
  if (status === 409) return { kind: 'hold', reason: 'notice_replied', attempted: 'revert' }
  if (status === 404) return { kind: 'hold', reason: 'notice_gone', attempted: 'revert' }
  if (status === 400) return { kind: 'hold', reason: 'notice_invalid', attempted: 'revert' }
  // submit_failed（BFF は受け付けたが会話へ渡せなかった）は失敗。同じ replyId でのみ再送する。
  if (data?.status === 'submit_failed') return { kind: 'hold', reason: 'failed', attempted: 'keep' }
  // 5xx・不明な応答・受付番号のない成功は成否不明。
  return { kind: 'unsure' }
}

/**
 * 応答が失われた・成否不明のときの判断（通知の最新状態から）。受理済みでも追跡は同じ replyId の「再開」で作り直せるが、
 * ここでは受付番号が分かれば追う（追えなければ main 側で同じ replyId の再送を案内する）。
 */
export type UnsureOutcome = { kind: 'accepted'; requestId: string } | { kind: 'hold'; reason: HoldReason }
export function unsureOutcome(found: ServerReply): UnsureOutcome {
  if (found.state === 'mine' && found.status === 'submitted' && found.requestId)
    return { kind: 'accepted', requestId: found.requestId }
  if (found.state === 'mine' && found.status === 'submit_failed') return { kind: 'hold', reason: 'failed' }
  if (found.state === 'other') return { kind: 'hold', reason: 'notice_replied' }
  if (found.state === 'gone') return { kind: 'hold', reason: 'notice_gone' }
  return { kind: 'hold', reason: 'unknown' }
}

/**
 * 一度送った通知返信（attempted）の取消可否。
 * accepted = 受理済みなので取り消せない（送信待ちから外し、同じ replyId で追跡を作り直して応答を追う）、
 * drop = サーバーが実行しないと確定させたので取り消してよい、
 * release = 同じ replyId の送信失敗記録（submit_failed）がサーバーに残り、同じ replyId の再送で後から実行されうる。
 *   取消済みとは表示せず、送信待ちから外して受信箱の「同じ受付番号で再送できる」記録として残す（自動では再送しない）、
 * keep = 後から受理されうる・確認できないので取り消さない。
 */
export type CancelDecision =
  | { kind: 'accepted'; requestId: string }
  | { kind: 'drop' }
  | { kind: 'release' }
  | { kind: 'keep'; error: boolean }
export function cancelDecision(found: ServerReply): CancelDecision {
  if (found.state === 'mine' && found.status === 'submitted' && found.requestId)
    return { kind: 'accepted', requestId: found.requestId }
  if (found.state === 'mine' && found.status === 'submit_failed') return { kind: 'release' }
  if (found.state === 'other' || found.state === 'gone') return { kind: 'drop' }
  return { kind: 'keep', error: found.state === 'error' }
}

/**
 * 送信待ちへ積むときに attempted 印を付けるか。受信箱に同じ replyId の返信記録（claimed・submit_failed など）が
 * 見えている返信の「同じ返信を再送」は、すでに返信 API へ送られサーバーに claim がある（後から受理されうる）ため、
 * 未送信の新しい返信として積まず、取消前に受理確認を必須にする。
 */
export function queuedAttempted(serverReply: { replyId: string } | null | undefined, replyId: string): boolean {
  return !!serverReply && serverReply.replyId === replyId
}
