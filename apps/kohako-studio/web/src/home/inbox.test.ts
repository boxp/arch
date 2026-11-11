import { describe, expect, it } from 'vitest'
import { formatReceived, notificationParam, replyText, stateLabel } from './inbox'
describe('受信箱の表示', () => {
  it('状態と経過時間を表示する', () => { expect(stateLabel({})).toBe('未読'); expect(stateLabel({ readAt: 'x' })).toBe('既読'); expect(stateLabel({ handledAt: 'x' })).toBe('処理済み'); expect(formatReceived('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:05:00Z'))).toContain('5分前') })
  it('通知 ID を検証する', () => { expect(notificationParam('?notification=event-123456')).toBe('event-123456'); expect(notificationParam('?notification=../bad')).toBeNull() })
  it('返信を会話履歴用の文にする', () => { expect(replyText({ title: '完了', ticketId: 'BOXP-1' }, 'choice', 'A')).toBe('通知「完了」（BOXP-1）への選択: A'); expect(replyText({ title: '完了' }, 'text', 'ok')).toBe('通知「完了」への返信: ok') })
})
