import { describe, expect, it } from 'vitest'
import { daypartOf, roomOptions } from './room'
describe('BOXP-512 背景', () => {
  it('時刻から空の時間帯を選ぶ', () => {
    expect([0, 4, 5, 9, 10, 15, 16, 18, 19, 23].map(daypartOf)).toEqual(['night', 'night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night', 'night'])
  })
  it('URL の指定は既知の値だけ受け付ける', () => {
    expect(roomOptions('')).toEqual({ daypart: null, version: 'v2' })
    expect(roomOptions('?daypart=night&bg=v1')).toEqual({ daypart: 'night', version: 'v1' })
    expect(roomOptions('?daypart=noon&bg=v3')).toEqual({ daypart: null, version: 'v2' })
  })
})
