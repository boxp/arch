import { expect, it } from 'vitest'
import { obsidianNoteUrl, parseInline, plainText, renderMarkdown } from './markdown'
import { spokenText } from './noticeSpeech'
// BOXP-778: Obsidian の wiki リンク [[パス|別名]] を BOXP vault のノートリンクにする（Projects/kohako-home/note-link-spec.md）。
const note = (text: string, path: string) => ({ type: 'note', text, path, url: obsidianNoteUrl(path) })
const owner = 'Projects/kohako-vrchat-companion/owner-entry.md',
  design = 'Projects/kohako-vrchat-companion/design.md'
// 配信済み通知 BOXP-768-20261128T142926Z-08c82934-f926-443a-bcf1-15d675e643fe-done の本文末尾（そのまま）
const delivered =
  '[[Projects/kohako-vrchat-companion/owner-entry|ご主人さま向けの概要]] · [[Projects/kohako-vrchat-companion/design|設計ノートと問い合わせ文案]]'

it('links both notes of the delivered BOXP-768 notification with their aliases', () => {
  expect(parseInline(delivered)).toEqual([
    note('ご主人さま向けの概要', owner),
    { type: 'text', text: ' · ' },
    note('設計ノートと問い合わせ文案', design),
  ])
  expect(obsidianNoteUrl(owner)).toBe(
    'obsidian://open?vault=BOXP&file=Projects%2Fkohako-vrchat-companion%2Fowner-entry.md',
  )
  expect(plainText(delivered)).toBe('ご主人さま向けの概要 · 設計ノートと問い合わせ文案')
  expect(spokenText(delivered)).toBe('ご主人さま向けの概要 · 設計ノートと問い合わせ文案')
})

it('follows the spec examples for names, extensions, headings, tickets and absolute vault paths', () => {
  expect(parseInline('[[Projects/kohako-vrchat-companion/design]]')).toEqual([note('design', design)])
  expect(parseInline('[[Projects/a/b.md#3. 案|案]]')).toEqual([note('案', 'Projects/a/b.md')])
  expect(parseInline('[[Projects/a/b#^block]]')).toEqual([note('b', 'Projects/a/b.md')])
  expect(parseInline('[[BOXP-768]]')).toEqual([note('BOXP-768', 'Tickets/BOXP-768.md')])
  expect(parseInline('[[ Projects/a/b | 別名 ]]')).toEqual([note('別名', 'Projects/a/b.md')])
  expect(parseInline('[[Projects/a/b|]]')).toEqual([note('b', 'Projects/a/b.md')])
  expect(parseInline('[[Projects/a/b.canvas]]')).toEqual([note('b.canvas', 'Projects/a/b.canvas')])
  expect(parseInline('[[Projects/a/file.txt]]')).toEqual([note('file.txt', 'Projects/a/file.txt')])
  expect(parseInline('[[Projects/a/data.json|データ]]')).toEqual([note('データ', 'Projects/a/data.json')])
  expect(parseInline('[[Projects/a/v1.2]]')).toEqual([note('v1.2', 'Projects/a/v1.2.md')])
  expect(parseInline('[[Projects/a/b. c]]')).toEqual([note('b. c', 'Projects/a/b. c.md')])
  expect(parseInline('[[/home/boxp/Documents/obsidian-headless/BOXP/Projects/調査 (案)|調査]]')).toEqual([
    note('調査', 'Projects/調査 (案).md'),
  ])
  expect(parseInline('見て [[Tickets/BOXP-1|票]] と BOXP-2。')).toEqual([
    { type: 'text', text: '見て ' },
    note('票', 'Tickets/BOXP-1.md'),
    { type: 'text', text: ' と ' },
    note('BOXP-2', 'Tickets/BOXP-2.md'),
    { type: 'text', text: '。' },
  ])
  expect(parseInline('**[[Projects/a/b|太字]]**')).toEqual([
    { type: 'bold', text: '太字', children: [note('太字', 'Projects/a/b.md')] },
  ])
})

it('keeps unsafe or malformed wiki links as plain text', () => {
  for (const input of [
    '[[/etc/passwd|x]]',
    '[[../secret|x]]',
    '[[Projects/../secret]]',
    '[[.obsidian/workspace.json]]',
    '[[Projects/a\\b]]',
    '[[javascript:alert(1)|x]]',
    '[[obsidian://new?vault=BOXP&file=a.md|x]]',
    '[[file:///etc/passwd]]',
    '[[]]',
    '[[|x]]',
    '[[#見出しだけ]]',
  ])
    expect(parseInline(input)).toEqual([{ type: 'text', text: input }])
  expect(parseInline('[[Projects/a\nb]]').some((n) => n.type === 'note')).toBe(false)
  expect(parseInline(`[[${'a'.repeat(1500)}]]`)).toEqual([{ type: 'text', text: `[[${'a'.repeat(1500)}]]` }])
})

it('renders wiki links as Obsidian note anchors without a new tab', () => {
  type El = {
    tag: string
    children: El[]
    className: string
    href: string
    title: string
    textContent: string
    append: (...c: El[]) => void
  }
  const make = (tag: string): El => ({
    tag,
    children: [],
    className: '',
    href: '',
    title: '',
    textContent: '',
    append(...c) {
      this.children.push(...c)
    },
  })
  const doc = { createDocumentFragment: () => make('fragment'), createElement: make } as unknown as Document
  const p = (renderMarkdown(`BOXP-768 の報告\n\n${delivered}`, doc) as unknown as El).children[1]
  const [a, , b] = p.children
  expect(a).toMatchObject({ tag: 'a', className: 'obsidian-note', href: obsidianNoteUrl(owner) })
  expect(a).not.toHaveProperty('target')
  expect(a.children.map((c) => c.textContent)).toEqual(['ご主人さま向けの概要', 'Obsidianで開く'])
  expect(a.title).toBe(`Obsidianで開く: ${owner}`)
  expect(b).toMatchObject({ tag: 'a', href: obsidianNoteUrl(design) })
})
