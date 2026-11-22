import { describe, expect, it } from 'vitest'
import {
  cancelDecision,
  classifyReply,
  preflight,
  queuedAttempted,
  type ServerReply,
  serverReplyFrom,
  unsureOutcome,
} from './noticeReply'

// BOXP-658 / BOXP-661 案B: 通知返信の「サーバー状態 × 事象」の表試験。
const n = { eventId: 'ev-1', replyId: 'mine-0001', kind: 'choice' as const, value: 'A' }

const states: Record<string, ServerReply> = {
  error: { state: 'error' },
  gone: { state: 'gone' },
  none: { state: 'none' },
  other: { state: 'other' },
  claimed: { state: 'mine', status: 'claimed', requestId: 'mine-0001' },
  submitted: { state: 'mine', status: 'submitted', requestId: 'mine-0001' },
  submittedNoId: { state: 'mine', status: 'submitted', requestId: '' },
  failed: { state: 'mine', status: 'submit_failed', requestId: 'mine-0001' },
}

describe('serverReplyFrom', () => {
  it.each([
    ['一覧が配列でない', null, 'error'],
    ['通知が無い', [{ eventId: 'ev-2' }], 'gone'],
    ['未返信', [{ eventId: 'ev-1' }], 'none'],
    ['別 replyId', [{ eventId: 'ev-1', reply: { replyId: 'x', status: 'submitted', requestId: 'x' } }], 'other'],
    ['同じ replyId', [{ eventId: 'ev-1', reply: { replyId: 'mine-0001', status: 'claimed', requestId: 'r' } }], 'mine'],
  ])('%s → %s', (_, items, want) => {
    expect(serverReplyFrom(items, n).state).toBe(want)
  })
})

describe('preflight（送る直前の状態 × 返信の種類）', () => {
  // 期待: [選択肢が現在も有効, 選択肢が無効（変更済み）, 自由文]
  const table: [string, string, string, string][] = [
    ['error', 'hold:failed', 'hold:failed', 'hold:failed'],
    ['gone', 'hold:notice_gone', 'hold:notice_gone', 'hold:notice_gone'],
    ['other', 'hold:notice_replied', 'hold:notice_replied', 'hold:notice_replied'],
    ['none', 'post', 'hold:notice_invalid', 'post'],
    // 同じ replyId のサーバー記録があれば、状態や選択肢の変化に関わらず同じ replyId で送る（BFF が冪等・追跡を作り直す）。
    ['claimed', 'post', 'post', 'post'],
    ['submitted', 'post', 'post', 'post'],
    ['submittedNoId', 'post', 'post', 'post'],
    ['failed', 'post', 'post', 'post'],
  ]
  const fmt = (p: ReturnType<typeof preflight>) => (p.kind === 'post' ? 'post' : `hold:${p.reason}`)
  it.each(table)('%s', (key, valid, invalid, text) => {
    const s = states[key] as ServerReply
    expect(fmt(preflight(s, n, ['A', 'B']))).toBe(valid)
    expect(fmt(preflight(s, n, ['B']))).toBe(invalid)
    expect(fmt(preflight(s, { kind: 'text', value: '了解' }, []))).toBe(text)
  })
  it('受理済み（submitted）でも送らずに済ませない: 追跡は返信 API の同じ replyId で作り直す', () => {
    expect(preflight(states.submitted as ServerReply, n, [])).toEqual({ kind: 'post' })
  })
})

describe('classifyReply（返信 API の応答）', () => {
  const table: [string, number, Record<string, unknown> | null, boolean, string][] = [
    ['受理 202', 202, { status: 'submitted', requestId: 'r1' }, false, 'accepted:r1'],
    ['既存返信 200', 200, { status: 'submitted', requestId: 'r1' }, false, 'accepted:r1'],
    ['受付番号なし 200', 200, { status: 'submitted' }, false, 'unsure'],
    [
      '既存返信・追跡を作り直せず',
      200,
      { status: 'submitted', requestId: 'r1', tracking: 'unavailable' },
      false,
      'hold:busy:set',
    ],
    ['既存返信・追跡期限切れ', 200, { status: 'submitted', requestId: 'r1', tracking: 'expired' }, false, 'expired:r1'],
    [
      '未確認 claim・確認期限切れ（受付成功にも成否不明の再送にもしない）',
      200,
      { status: 'claimed', requestId: 'r1', tracking: 'expired' },
      false,
      'expired:r1',
    ],
    ['認証切れ', 401, { error: 'unauthorized' }, true, 'auth:revert'],
    ['busy（claim なし）', 429, { error: 'busy' }, false, 'hold:busy:revert'],
    ['busy_claimed（既存 claim）', 429, { error: 'busy_claimed' }, false, 'hold:busy:set'],
    ['別 replyId 先行', 409, { error: 'already_replied' }, false, 'hold:notice_replied:revert'],
    ['通知消失', 404, { error: 'not_found' }, false, 'hold:notice_gone:revert'],
    ['選択肢無効', 400, { error: 'invalid' }, false, 'hold:notice_invalid:revert'],
    ['会話へ渡せず', 502, { status: 'submit_failed', requestId: 'r1' }, false, 'hold:failed:keep'],
    ['5xx', 500, null, false, 'unsure'],
    ['未知の 429', 429, { error: 'rate' }, false, 'unsure'],
  ]
  it.each(table)('%s', (_, status, data, auth, want) => {
    const o = classifyReply(status, data, auth)
    const got =
      o.kind === 'accepted'
        ? `accepted:${o.requestId}`
        : o.kind === 'expired'
          ? `expired:${o.requestId}`
          : o.kind === 'auth'
            ? `auth:${o.attempted}`
            : o.kind === 'hold'
              ? `hold:${o.reason}:${o.attempted}`
              : 'unsure'
    expect(got).toBe(want)
  })
})

describe('unsureOutcome / cancelDecision（応答喪失後・取消時の状態）', () => {
  // [状態, 成否不明後の判断, 取消の判断]
  const table: [string, string, string][] = [
    ['error', 'hold:unknown', 'keep:error'],
    ['gone', 'hold:notice_gone', 'drop'],
    ['none', 'hold:unknown', 'keep'],
    ['other', 'hold:notice_replied', 'drop'],
    ['claimed', 'hold:unknown', 'keep'],
    ['submitted', 'accepted:mine-0001', 'accepted:mine-0001'],
    ['submittedNoId', 'hold:unknown', 'keep'],
    ['failed', 'hold:failed', 'release'],
  ]
  it.each(table)('%s', (key, unsure, cancel) => {
    const s = states[key] as ServerReply
    const u = unsureOutcome(s)
    expect(u.kind === 'accepted' ? `accepted:${u.requestId}` : `hold:${u.reason}`).toBe(unsure)
    const c = cancelDecision(s)
    expect(
      c.kind === 'accepted'
        ? `accepted:${c.requestId}`
        : c.kind === 'keep'
          ? c.error
            ? 'keep:error'
            : 'keep'
          : c.kind,
    ).toBe(cancel)
  })
  it('同じ replyId の送信失敗記録は再送で実行されうるため取消済み（drop）にしない', () => {
    expect(cancelDecision(states.failed as ServerReply).kind).toBe('release')
  })
  it('受理済みの可能性がある状態（none・claimed・確認不能）は取り消さない', () => {
    for (const key of ['none', 'claimed', 'error', 'submittedNoId'])
      expect(cancelDecision(states[key] as ServerReply).kind).toBe('keep')
  })
})

describe('queuedAttempted（送信待ちへ積むときの記録 × replyId）', () => {
  const table: [string, { replyId: string } | null | undefined, boolean][] = [
    ['記録なし（新しい返信）', undefined, false],
    ['記録なし（null）', null, false],
    ['同じ replyId の記録（claimed・submit_failed の再送）', { replyId: 'mine-0001' }, true],
    ['別の replyId の記録', { replyId: 'other-0002' }, false],
  ]
  it.each(table)('%s', (_label, reply, expected) => {
    expect(queuedAttempted(reply, 'mine-0001')).toBe(expected)
  })
})
