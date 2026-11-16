import { describe, expect, it } from 'vitest'
import { nextFollow } from './scroll'

describe('nextFollow', () => {
  it('末尾では追従する', () => expect(nextFollow(false, 0, 100, 100, 200)).toBe(true))
  it('上へ動いたら追従を止める', () => expect(nextFollow(true, 100, 50, 100, 300)).toBe(false))
  it('追従中に内容が伸びても追従する', () => expect(nextFollow(true, 100, 100, 100, 300)).toBe(true))
  it('追従停止中に内容が伸びても停止したまま', () => expect(nextFollow(false, 50, 50, 100, 300)).toBe(false))
  it('末尾に戻ると追従を再開する', () => expect(nextFollow(false, 50, 200, 100, 300)).toBe(true))
})
