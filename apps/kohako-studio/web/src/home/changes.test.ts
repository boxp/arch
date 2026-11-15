import { describe, expect, it } from 'vitest'
import { shouldSubmit } from './keys'
import { sortAscending, type Item } from './inbox'
import { messageShown } from './scene'
import { atBottom } from './scroll'
import { parseInline, parseMarkdown, plainText } from './markdown'
describe('ホーム表示', () => {
  it('Shift+Enter のみ送信し IME を除く', () => {
    const e = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }
    expect(shouldSubmit(e)).toBe(false)
    expect(shouldSubmit({ ...e, shiftKey: true })).toBe(true)
    expect(shouldSubmit({ ...e, shiftKey: true, isComposing: true })).toBe(false)
    expect(shouldSubmit({ ...e, shiftKey: true, keyCode: 229 })).toBe(false)
  })
  it('通知を重複排除して古い順にする', () => {
    const item = (eventId: string, receivedAt: string) => ({ eventId, receivedAt }) as Item
    const items = [
      item('z', 'bad'),
      item('b', '2026-01-01'),
      item('a', '2026-01-01'),
      item('a', '2020-01-01'),
      item('c', '2025-01-01'),
    ]
    expect(sortAscending(items).map((i) => i.eventId)).toEqual(['c', 'a', 'b', 'z'])
  })
  it('本文表示とスクロール位置を判定', () => {
    expect(messageShown({ scene: 'relax', touch: false, notice: false })).toBe(false)
    for (const scene of ['speaking', 'show', 'work'])
      expect(messageShown({ scene, touch: false, notice: false })).toBe(true)
    expect(messageShown({ scene: 'relax', touch: true, notice: false })).toBe(true)
    expect(messageShown({ scene: 'relax', touch: false, notice: true })).toBe(true)
    expect(atBottom(92, 100, 200)).toBe(true)
    expect(atBottom(91, 100, 200)).toBe(false)
  })
  it('Markdown を安全に解析し読み上げ用の記号を除く', () => {
    const blocks = parseMarkdown('# 題\n\n- 一\n- 二\n\n```js\n<script>\n```\n\n[安全](https://example.com)')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'code', 'paragraph'])
    expect(blocks[2].text).toBe('<script>')
    expect(blocks[3].inline?.[0].type).toBe('link')
    expect(parseMarkdown('<script>alert(1)</script>')[0].text).toBe('<script>alert(1)</script>')
    expect(
      parseInline('[x](javascript:alert) [y](data:text) ![猫](https://example.com/a.png)').map((n) => n.type),
    ).toEqual(['text', 'text', 'text', 'text', 'link'])
    expect(plainText('# 題\n- **太字** [リンク](https://example.com)\n\n```\ncode\n```')).toBe('題\n太字 リンク\ncode')
  })
})
describe('Markdown の境界', () => {
  it('URL の直後の日本語や句読点をリンクに含めず、snake_case を斜体にしない', () => {
    const a = parseInline('https://example.com/a_b?x=1を開いて。')
    expect(a[0]).toMatchObject({ type: 'link', url: 'https://example.com/a_b?x=1' })
    expect(a[1].text).toBe('を開いて。')
    expect(parseInline('see https://example.com/x.').map((n) => n.text)).toEqual(['see ', 'https://example.com/x', '.'])
    expect(parseInline('foo_bar_baz と 2 * 3 * 4').every((n) => n.type === 'text')).toBe(true)
    expect(parseInline('_強調_ と *斜体*').map((n) => n.type)).toEqual(['italic', 'text', 'italic'])
  })
})
