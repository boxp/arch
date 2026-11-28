// 期待値は trial-spec.md（決まり 9: 開くのは maps/search の https だけ）から取る。
import { describe, expect, it } from 'vitest'
import { errorText, historyRow, isMapUrl, pushText, readiness, remaining, requestParam } from './logic'

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

describe('historyRow（決まり 10: 結果の時刻を残す）', () => {
  const t = (iso: string) => iso.slice(11, 19)
  it('開いた依頼は結果の時刻・経路・秒を出す', () => {
    expect(
      historyRow(
        {
          name: '東京都庁',
          state: 'opened',
          createdAt: '2026-11-28T07:00:00.000Z',
          endedAt: '2026-11-28T07:00:12.000Z',
          via: 'notification',
          seconds: 12,
        },
        t,
      ),
    ).toEqual(['07:00:00', '東京都庁', '開いた', '07:00:12', '通知', '12'])
  })
  it('期限切れは期限の時刻を結果の時刻に出し、待ちは空', () => {
    expect(
      historyRow(
        {
          name: '東京駅',
          state: 'expired',
          createdAt: '2026-11-28T07:00:00.000Z',
          endedAt: '2026-11-28T07:02:00.000Z',
        },
        t,
      ),
    ).toEqual(['07:00:00', '東京駅', '期限切れ', '07:02:00', '', ''])
    expect(historyRow({ name: '東京駅', state: 'pending', createdAt: '2026-11-28T07:00:00.000Z' }, t)[3]).toBe('')
  })
})

// trial-spec.md 決まり 13・例 17〜19: この端末の準備。
describe('readiness', () => {
  const base = { supported: true, permission: 'granted' as const, subscribed: true, version: 'device-trial-v1' }
  it('新しい版・許可あり・購読あり なら受け取れる', () => {
    expect(readiness(base)).toEqual({ ok: true, text: 'この端末は試験の通知を受け取れます。' })
  })
  it('許可がない端末（例 18）', () => {
    expect(readiness({ ...base, permission: 'denied' })).toEqual({ ok: false, text: '通知が許可されていません。' })
    expect(readiness({ ...base, permission: 'default' }).ok).toBe(false)
  })
  it('購読がない端末（例 19）', () => {
    expect(readiness({ ...base, subscribed: false })).toEqual({
      ok: false,
      text: '通知が ON になっていません。家の受信箱で通知を ON にしてください。',
    })
  })
  it('古い版（例 17 で切り替わらなかった時）', () => {
    for (const version of [null, 'old', 'device-trial-v0'])
      expect(readiness({ ...base, version })).toEqual({
        ok: false,
        text: '通知を受ける仕組みが古い版です。ページを再読み込みしてください。',
      })
  })
  it('Service Worker や Push が使えない', () => {
    expect(readiness({ ...base, supported: false })).toEqual({
      ok: false,
      text: 'この端末では確かめられません（通知の仕組みが使えません）。',
    })
  })
})
