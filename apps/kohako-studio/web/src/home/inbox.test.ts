import { describe, expect, it } from 'vitest'
import { formatReceived, notificationParam, stateLabel } from './inbox'
describe('受信箱の表示', () => {
  it('状態と経過時間を表示する', () => { expect(stateLabel({})).toBe('未読'); expect(stateLabel({ readAt: 'x' })).toBe('既読'); expect(stateLabel({ handledAt: 'x' })).toBe('処理済み'); expect(formatReceived('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:05:00Z'))).toContain('5分前') })
  it('通知 ID を検証する', () => { expect(notificationParam('?notification=event-123456')).toBe('event-123456'); expect(notificationParam('?notification=../bad')).toBeNull() })
})
