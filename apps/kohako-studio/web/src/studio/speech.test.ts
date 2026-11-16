import { describe, expect, it } from 'vitest'
import { silentSpeechSeconds } from './model'

describe('読み上げなしの口パク時間', () => {
  it('応答文の長さに比例し、1.5〜10 秒に収める', () => {
    expect(silentSpeechSeconds('')).toBe(1.5)
    expect(silentSpeechSeconds('こんにちは、ご主人さま。今日もよろしくお願いします。')).toBeCloseTo(26 / 8)
    expect(silentSpeechSeconds('あ'.repeat(500))).toBe(10)
    expect(silentSpeechSeconds('  あ  い  ')).toBe(1.5)
  })
})
