import { describe, expect, it } from 'vitest'
import { classifyFailure, parseReauth, serializeReauth, recentlyReloaded, restoredNotice } from './reauth'

describe('再認証の退避', () => {
  const now = 1_000_000,
    stash = { v: 1 as const, draft: '下書き', queue: ['待ち'], at: now, reloadAt: now }
  it('401 と 403 だけを認証切れとする', () => {
    expect([401, 403, 200, 0, 502].map((status) => classifyFailure({ status }))).toEqual([
      'auth',
      'auth',
      'other',
      'other',
      'other',
    ])
  })
  it('有効な退避を復元し直近の再読込を判定する', () => {
    expect(parseReauth(serializeReauth(stash), now)).toEqual(stash)
    expect(recentlyReloaded(stash, now + 120_000)).toBe(true)
    expect(recentlyReloaded(stash, now + 120_001)).toBe(false)
  })
  it('不正な形、上限超過、期限切れ、未来を拒否する', () => {
    for (const value of [
      null,
      {},
      { ...stash, v: 2 },
      { ...stash, extra: 1 },
      { ...stash, draft: 'a'.repeat(4001) },
      { ...stash, queue: Array(6).fill('a') },
      { ...stash, queue: ['a'.repeat(501)] },
      { ...stash, queue: [''] },
      { ...stash, at: now + 1 },
      { ...stash, reloadAt: now + 1 },
      { ...stash, at: now - 900_001 },
    ])
      expect(parseReauth(JSON.stringify(value), now)).toBeNull()
    expect(parseReauth('{', now)).toBeNull()
  })
})

describe('再認証後の復元案内', () => {
  it('草稿と送信待ちの復元先を区別する', () => {
    expect(restoredNotice(true, false, 0)).toBe('再認証前の入力を戻しました（まだ送信されていません）。')
    expect(restoredNotice(false, false, 2)).toBe('再認証前の送信待ち 2 件を戻しました（まだ送信されていません）。')
    expect(restoredNotice(true, false, 2)).toContain('入力と送信待ち 2 件')
    expect(restoredNotice(true, true, 2)).toContain('先頭に戻しました。送信待ち 2 件も戻しました')
  })
})

describe('通知返信の退避（BOXP-658）', () => {
  const now = 1_000_000,
    notice = {
      eventId: 'event-123456',
      ticketId: 'BOXP-1',
      source: 'task-board-report',
      title: '題',
      kind: 'choice' as const,
      value: 'A',
      replyId: 'reply-123456',
    }
  it('返信先の文脈ごと退避・復元し、通常の発言との順序を保つ', () => {
    const stash = { v: 1 as const, draft: '', queue: ['先', notice, '後'], at: now, reloadAt: now }
    expect(parseReauth(serializeReauth(stash), now)?.queue).toEqual(['先', notice, '後'])
  })
  it('不正な通知返信は退避全体を拒否する（通常の発言へ変えない）', () => {
    for (const bad of [
      { ...notice, extra: 1 },
      { ...notice, eventId: 'short' },
      { ...notice, kind: 'other' },
      { ...notice, value: '' },
      { ...notice, value: 'a'.repeat(501) },
      { ...notice, replyId: '!bad-reply' },
      { ...notice, ticketId: 'boxp-1' },
    ])
      expect(parseReauth(JSON.stringify({ v: 1, draft: '', queue: [bad], at: now, reloadAt: now }), now)).toBeNull()
  })
})
