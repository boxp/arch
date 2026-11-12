import { describe, expect, it, vi } from 'vitest'
import { ActingDirector, cueForSentence, splitSentences } from './acting'

describe('文と演技', () => {
  it('区切りと長文分割で非空白文字を保つ', () => {
    const text = `  URL https://example.com と 1.25。！？\n${'あ'.repeat(80)}、${'い'.repeat(150)}…\n終わり  `
    const parts = splitSentences(text)
    expect(parts.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
    expect(parts.every(s => Array.from(s).length <= 120)).toBe(true)
    expect(parts[0]).toContain('1.25。！？')
  })
  it.each([
    ['危険です、すみません', 'serious', 'halt'], ['失敗しました、嬉しい', 'troubled', 'tilt'],
    ['えへ、ありがとうございます', 'shy', 'shyHand'], ['褒めてくれた', 'shy', 'shyHand'], ['ありがとうございます', 'smile', 'nod'],
    ['えっ、成功', 'surprised', 'none'], ['成功しました', 'smileClosed', 'joy'], ['こんにちは', 'smile', 'greet'],
    ['こちらをご覧ください', 'smile', 'guide'], ['いいですか？', 'neutral', 'tilt'], ['普通です。', 'neutral', 'none'],
  ] as const)('%s', (text, emotion, gesture) => expect(cueForSentence(text)).toEqual({ emotion, gesture }))
  it('呼称は判定を変えない', () => { expect(cueForSentence('お客様、成功しました')).toEqual(cueForSentence('成功しました')); expect(cueForSentence('お客様、こんにちは')).toEqual(cueForSentence('こんにちは')) })
  it('状態と動作の制限、中断を適用する', () => {
    const stage = { reset: vi.fn(), setEmotion: vi.fn(), playGesture: vi.fn() }, director = new ActingDirector(stage)
    director.sentence({ emotion: 'smile', gesture: 'joy' }); expect(stage.setEmotion).not.toHaveBeenCalled()
    director.setOperational('speaking'); director.setOperational('speaking'); expect(stage.reset).not.toHaveBeenCalled()
    director.beginReply()
    director.sentence({ emotion: 'smile', gesture: 'joy' })
    director.sentence({ emotion: 'smile', gesture: 'guide' })
    director.sentence({ emotion: 'neutral', gesture: 'nod' })
    expect(stage.playGesture.mock.calls).toEqual([['joy'], ['nod']])
    expect(director.snapshot.bigGesturesUsed).toBe(1)
    director.interrupt(); expect(stage.reset).toHaveBeenCalledTimes(1); expect(director.snapshot.replySentences).toBe(0)
    director.setOperational('approval'); director.setOperational('approval')
    expect(stage.reset).toHaveBeenCalledTimes(2); expect(stage.setEmotion).toHaveBeenLastCalledWith('serious')
  })
  it('stage の例外を保持して続行する', () => {
    const director = new ActingDirector({ reset() { throw new Error('reset') }, setEmotion() {}, playGesture() {} })
    director.setOperational('thinking'); expect(director.snapshot.lastError).toBe('reset')
  })
})
