import { describe, expect, it } from 'vitest'
import { TouchBubble } from './touch-bubble'

describe('ふれあいの一時表示', () => {
  it('本文と保持状態を復元し、連続表示でも最初の状態を使う', () => {
    const restore = new TouchBubble()
    restore.begin('元の返答', true)
    restore.begin('一時表示', false)
    expect(restore.take()).toEqual({ text: '元の返答', retained: true })
    expect(restore.take()).toBeUndefined()
    restore.begin('読み上げ返答', false)
    expect(restore.take()).toEqual({ text: '読み上げ返答', retained: false })
  })

  it('新しい本文に切り替えたら古い復元予約を破棄する', () => {
    const restore = new TouchBubble()
    restore.begin('古い返答', true)
    restore.clear()
    expect(restore.take()).toBeUndefined()
    restore.begin('新しい通知', false)
    expect(restore.take()).toEqual({ text: '新しい通知', retained: false })
  })
})
