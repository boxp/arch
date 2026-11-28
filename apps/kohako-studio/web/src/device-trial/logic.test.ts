// 期待値は trial-spec.md（決まり 9: 開くのは maps/search の https だけ）から取る。
import { describe, expect, it } from 'vitest'
import { errorText, isMapUrl, pushText, remaining, requestParam } from './logic'

describe('isMapUrl', () => {
  it('Google マップの検索 URL だけを開く', () => {
    expect(isMapUrl('https://www.google.com/maps/search/?api=1&query=%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%BA%81')).toBe(true)
    for (const bad of [
      'http://www.google.com/maps/search/?api=1&query=x',
      'https://www.google.com.evil.example/maps/search/?query=x',
      'https://evil.example/maps/search/',
      'https://www.google.com/url?q=https://evil.example',
      'https://user@www.google.com/maps/search/',
      'https://www.google.com:8443/maps/search/',
      'intent://maps#Intent;end',
      'javascript:alert(1)',
      '',
      undefined,
      42,
    ])
      expect(isMapUrl(bad)).toBe(false)
  })
})
it('requestParam は形の合う依頼番号だけを取る', () => {
  expect(requestParam('?request=req-0001-0000')).toBe('req-0001-0000')
  expect(requestParam('?request=../x')).toBeNull()
  expect(requestParam('')).toBeNull()
})
it('理由の文面: 期限切れ・開封済み・取消・停止を区別する', () => {
  expect(errorText('expired')).toContain('期限切れ')
  expect(errorText('already_opened')).toContain('開封済み')
  expect(errorText('cancelled')).toContain('取り消')
  expect(errorText('stopped')).toContain('止めて')
  expect(errorText('???')).toContain('うまくいきません')
})
it('通知の結果の文面', () => {
  expect(pushText({ sent: 2, errors: 0 })).toBe('2台の端末に通知を送りました。')
  expect(pushText({ sent: 0, errors: 0, skipped: 'no-subscriptions' })).toContain('通知をONにする')
  expect(pushText({ sent: 0, errors: 2, skipped: 'error' })).toContain('送れませんでした')
})
it('残り時間は切り上げで、過ぎたら 0', () => {
  const at = Date.parse('2026-11-28T10:02:00Z')
  expect(remaining('2026-11-28T10:02:00Z', at - 1500)).toBe(2)
  expect(remaining('2026-11-28T10:02:00Z', at + 10)).toBe(0)
})
