// BOXP-756: 期待値は vault の Projects/kohako-home/notice-read-aloud-spec.md の表から取る（実装から写さない）。
import { expect, it } from 'vitest'
import { announcementText, canSpeak, spokenText } from './noticeSpeech'
import { announcementCandidates, type Item } from './inbox'

it('reads a bare URL as the name of what it links to, not the URL itself', () => {
  expect(spokenText('詳しくは https://github.com/boxp/arch/pull/1 を見てください')).toBe(
    '詳しくは GitHub のリンク を見てください',
  )
  expect(spokenText('https://youtu.be/abc')).toBe('YouTube のリンク')
  expect(spokenText('https://www.youtube.com/watch?v=x')).toBe('YouTube のリンク')
  expect(spokenText('https://example.com/a?b=c')).toBe('リンク')
  expect(spokenText('古い http://example.com/a の案内')).toBe('古い リンク の案内')
})

it('reads the label of a markdown link, and リンク when the label itself is a URL', () => {
  expect(spokenText('[設計メモ](https://example.com/x)')).toBe('設計メモ')
  expect(spokenText('[https://example.com](https://example.com)')).toBe('リンク')
})

it('reads vault note links by their title as the screen shows them', () => {
  expect(spokenText('Projects/kohako-home/notice-read-aloud-spec.md を見て')).toBe('notice-read-aloud-spec を見て')
  expect(spokenText('obsidian://open?vault=BOXP&file=Tickets%2FBOXP-756')).not.toContain('obsidian://')
})

it('keeps ordinary text unchanged', () => {
  expect(spokenText('おはようございます。今日は晴れです。')).toBe('おはようございます。今日は晴れです。')
})

const item = (over: Partial<Item> = {}): Item => ({
  eventId: 'evt-00000001',
  source: 'hermes-cron',
  title: '定期通知: 明日の予定',
  body: '10時に打合せがあります。',
  receivedAt: '2026-11-28T09:00:00Z',
  ...over,
})

it('builds the announcement from the heading and the body, the same text as the bubble', () => {
  expect(announcementText(item(), 0)).toBe(
    'ご主人さま、お知らせが届いています。\n定期通知: 明日の予定\n10時に打合せがあります。',
  )
  expect(announcementText(item(), 3)).toBe(
    'ご主人さま、お知らせが届いています。\n定期通知: 明日の予定\n10時に打合せがあります。\nほかにも 3 件、受信箱に届いています。',
  )
})

it('cuts a long body at 300 characters as the bubble does', () => {
  const text = announcementText(item({ body: 'あ'.repeat(301) }), 0)
  expect(text).toContain(`${'あ'.repeat(300)}…（続きは受信箱でご覧いただけます）`)
  expect(text).not.toContain('あ'.repeat(301))
})

it('speaks only when 読み上げ is ON and the chosen voice can play', () => {
  expect(canSpeak({ on: true, voice: 'kohaku', deviceVoice: false })).toBe(true)
  expect(canSpeak({ on: true, voice: 'drama3', deviceVoice: false })).toBe(true)
  expect(canSpeak({ on: false, voice: 'kohaku', deviceVoice: true })).toBe(false)
  expect(canSpeak({ on: true, voice: 'browser', deviceVoice: false })).toBe(false)
  expect(canSpeak({ on: true, voice: 'browser', deviceVoice: true })).toBe(true)
})

it('does not offer an already announced notice again after a reload or a re-delivery', () => {
  const now = Date.parse('2026-11-28T09:05:00Z')
  expect(announcementCandidates([item({ announcedAt: '2026-11-28T09:01:00Z' })], now)).toEqual([])
  expect(announcementCandidates([item()], now).map((i) => i.eventId)).toEqual(['evt-00000001'])
})

it('does not read a new notice while a stopped or failed reply still offers 続きから読む', () => {
  expect(canSpeak({ on: true, voice: 'kohaku', deviceVoice: false, resumePending: true })).toBe(false)
  expect(canSpeak({ on: true, voice: 'kohaku', deviceVoice: false, resumePending: false })).toBe(true)
})
