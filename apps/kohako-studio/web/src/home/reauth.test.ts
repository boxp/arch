import { describe, expect, it } from 'vitest'
import { classifyFailure, parseReauth, serializeReauth, recentlyReloaded } from './reauth'

describe('再認証の退避', () => {
  const now = 1_000_000, stash = { v: 1 as const, draft: '下書き', queue: ['待ち'], at: now, reloadAt: now }
  it('401 と 403 だけを認証切れとする', () => { expect([401, 403, 200, 0, 502].map(status => classifyFailure({ status }))).toEqual(['auth', 'auth', 'other', 'other', 'other']) })
  it('有効な退避を復元し直近の再読込を判定する', () => { expect(parseReauth(serializeReauth(stash), now)).toEqual(stash); expect(recentlyReloaded(stash, now + 120_000)).toBe(true); expect(recentlyReloaded(stash, now + 120_001)).toBe(false) })
  it('不正な形、上限超過、期限切れ、未来を拒否する', () => {
    for (const value of [null, {}, { ...stash, v: 2 }, { ...stash, extra: 1 }, { ...stash, draft: 'a'.repeat(4001) }, { ...stash, queue: Array(6).fill('a') }, { ...stash, queue: ['a'.repeat(501)] }, { ...stash, queue: [''] }, { ...stash, at: now + 1 }, { ...stash, reloadAt: now + 1 }, { ...stash, at: now - 900_001 }]) expect(parseReauth(JSON.stringify(value), now)).toBeNull()
    expect(parseReauth('{', now)).toBeNull()
  })
})
