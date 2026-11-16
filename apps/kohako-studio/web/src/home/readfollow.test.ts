import { describe, expect, it } from 'vitest'
import { createReadFollowState, estimatePosition, mapChunks } from './readfollow'

describe('読み上げ位置の対応', () => {
  it('表示の空白や改行を無視し、リストの記号を飛ばして順に照合する', () => {
    const text = 'あ い\n\n• うえ\n• おか'
    expect(mapChunks(['あい', 'うえ', 'おか'], text)).toEqual([
      { start: 0, end: 3 },
      { start: 7, end: 9 },
      { start: 12, end: 14 },
    ])
  })
  it('照合できない片を前後の間に比例配分する', () => {
    expect(mapChunks(['前', '不明', '不明部分', '後'], '前123456後')).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 7 },
      { start: 7, end: 8 },
    ])
    expect(mapChunks(['不明'], '')).toEqual([{ start: 0, end: 0 }])
  })
  it('時間と長さから位置を推定し範囲内に収める', () => {
    const span = { start: 10, end: 30 }
    expect(estimatePosition(span, 1000, 4, 3000)).toBe(20)
    expect(estimatePosition(span, 1000, 4, 9000)).toBe(30)
    expect(estimatePosition(span, 1000, 0, 2500)).toBe(20)
    expect(estimatePosition(span, 1000, 4, 0)).toBe(10)
  })
  it('境界イベントがあれば時刻より優先する', () => {
    expect(estimatePosition({ start: 10, end: 30 }, 0, 4, 3000, 3)).toBe(13)
    expect(estimatePosition({ start: 10, end: 30 }, 0, 4, 3000, 100)).toBe(30)
  })
  it('操作で停止し、再開または新しい読み上げで追従する', () => {
    const state = createReadFollowState()
    expect(state.following()).toBe(true)
    state.pause()
    expect(state.following()).toBe(false)
    state.resume()
    expect(state.following()).toBe(true)
    state.pause()
    state.reset()
    expect(state.following()).toBe(true)
  })
})
