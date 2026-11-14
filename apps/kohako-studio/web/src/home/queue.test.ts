import { must } from '../must'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MessageQueue, QUEUE_MAX_CHARS, QUEUE_MAX_ITEMS } from './queue'

describe('送信待ち（BOXP-508）', () => {
  it('FIFO で 1 件ずつ取り出し、同じ項目を 2 回取り出さない', () => {
    const q = new MessageQueue()
    q.add('一つ目', 1)
    q.add('  二つ目  ', 2)
    q.add('A', 3)
    expect(q.list().map((x) => x.text)).toEqual(['一つ目', '二つ目', 'A'])
    expect(q.take()?.text).toBe('一つ目')
    expect(q.take()?.text).toBe('二つ目')
    expect(q.take()?.text).toBe('A')
    expect(q.take()).toBeNull()
  })
  it('空・長すぎ・上限超過は積まない（本文は呼び出し側に残る）', () => {
    const q = new MessageQueue()
    expect(q.add('   ', 0)).toEqual({ ok: false, error: 'empty' })
    expect(q.add('あ'.repeat(QUEUE_MAX_CHARS + 1), 0)).toEqual({ ok: false, error: 'too_long' })
    for (let i = 0; i < QUEUE_MAX_ITEMS; i++) expect(q.add(`m${i}`, i).ok).toBe(true)
    expect(q.add('溢れ', 9)).toEqual({ ok: false, error: 'full' })
    expect(q.size).toBe(QUEUE_MAX_ITEMS)
  })
  it('取消は待機中の項目だけを消し、順序を保つ', () => {
    const q = new MessageQueue()
    const a = q.add('a', 0),
      b = q.add('b', 0),
      c = q.add('c', 0)
    if (!a.ok || !b.ok || !c.ok) throw new Error('add')
    expect(q.remove(b.item.id)).toBe(true)
    expect(q.remove(b.item.id)).toBe(false)
    expect(q.list().map((x) => x.text)).toEqual(['a', 'c'])
    const taken = must(q.take())
    expect(q.remove(taken.id)).toBe(false) // 送り出し済みは取り消せない
  })
  it('保留中は取り出さず、再開で先頭から続ける。受理されなかった項目は先頭へ戻る', () => {
    const q = new MessageQueue()
    q.add('a', 0)
    q.add('b', 0)
    const a = must(q.take())
    q.putBack(a)
    q.putBack(a)
    expect(q.list().map((x) => x.text)).toEqual(['a', 'b'])
    expect(q.hold('failed')).toBe(true)
    expect(q.take()).toBeNull()
    q.resume()
    expect(q.take()?.text).toBe('a')
  })
  it('空のキューは保留にせず、全部取り消すと保留も解ける', () => {
    const q = new MessageQueue()
    expect(q.hold('stopped')).toBe(false)
    q.add('x', 0)
    q.hold('auth')
    q.clear()
    expect(q.held).toBeNull()
  })
  it('送信待ちの本文を storage に保存しない', () => {
    const src =
      readFileSync(new URL('./queue.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/(local|tab)\.set\([^)]*queue/i)
    expect(readFileSync(new URL('./queue.ts', import.meta.url), 'utf8')).not.toMatch(
      /(localStorage|sessionStorage)\.|console\./,
    )
  })
})
