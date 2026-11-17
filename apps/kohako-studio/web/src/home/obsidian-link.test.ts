import { expect, it } from 'vitest'
import { obsidianNotePath, obsidianNoteUrl, parseInline, plainText } from './markdown'
// BOXP-581: vault 内ノートを Obsidian アプリで開くリンク。
const path = 'Projects/kohako-home/調査 (案) メモ&1+2.md',
  url = obsidianNoteUrl(path)
it('encodes Japanese, spaces, parentheses and query delimiters in the vault-relative path', () => {
  expect(url).toBe(
    'obsidian://open?vault=BOXP&file=Projects%2Fkohako-home%2F%E8%AA%BF%E6%9F%BB%20%28%E6%A1%88%29%20%E3%83%A1%E3%83%A2%261%2B2.md',
  )
  expect(obsidianNotePath(url)).toBe(path)
})
it('turns Markdown links and bare obsidian://open URLs into note links', () => {
  expect(parseInline(`見て: [調査メモ](${url}) です`)).toEqual([
    { type: 'text', text: '見て: ' },
    { type: 'note', text: '調査メモ', url, path },
    { type: 'text', text: ' です' },
  ])
  expect(parseInline(`開く ${url}`)).toEqual([
    { type: 'text', text: '開く ' },
    { type: 'note', text: '調査 (案) メモ&1+2', url, path },
  ])
  // 文末の句読点はリンクに含めない（存在しない `…md.` を開かない）
  expect(parseInline('ノート: obsidian://open?vault=BOXP&file=Tickets%2FBOXP-581.md.')).toEqual([
    { type: 'text', text: 'ノート: ' },
    {
      type: 'note',
      text: 'BOXP-581',
      url: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-581.md',
      path: 'Tickets/BOXP-581.md',
    },
    { type: 'text', text: '.' },
  ])
  // file/vault の順序違いも同じ正規形にする
  expect(parseInline('[x](obsidian://open?file=Tickets%2FBOXP-581.md&vault=BOXP)')[0]).toEqual({
    type: 'note',
    text: 'x',
    url: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-581.md',
    path: 'Tickets/BOXP-581.md',
  })
  expect(plainText(`[調査メモ](${url})`)).toBe('調査メモ')
})
it('rejects other vaults, actions, schemes and unsafe paths', () => {
  for (const raw of [
    'obsidian://open?vault=Other&file=a.md',
    'obsidian://open?vault=BOXP',
    'obsidian://open?vault=BOXP&file=a.md&path=%2Fetc%2Fpasswd',
    'obsidian://open?path=%2Fetc%2Fpasswd',
    'obsidian://new?vault=BOXP&file=a.md&content=x',
    'obsidian://advanced-uri?vault=BOXP&file=a.md',
    'obsidian://open?vault=BOXP&file=..%2Fsecret.md',
    'obsidian://open?vault=BOXP&file=%2Fetc%2Fpasswd',
    'obsidian://open?vault=BOXP&file=.obsidian%2Fworkspace.json',
    'obsidian://open?vault=BOXP&file=a%5Cb.md',
    'obsidian://open?vault=BOXP&file=a%00.md',
    'obsidian://open?vault=BOXP&file=%ZZ',
    'obsidian://open?vault=BOXP&vault=BOXP&file=a.md',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'intent://open#Intent;scheme=obsidian;end',
  ]) {
    expect(obsidianNotePath(raw)).toBeUndefined()
    expect(parseInline(`[x](${raw})`).some((n) => n.type === 'note' || n.type === 'link')).toBe(false)
  }
  expect(parseInline('obsidian://new?vault=BOXP&file=a.md').every((n) => n.type === 'text')).toBe(true)
  expect(parseInline('![x](obsidian://open?vault=BOXP&file=a.png)').every((n) => n.type === 'text')).toBe(true)
})

it('keeps unencoded slashes in bare obsidian://open URLs as part of the note path', () => {
  expect(parseInline('見て obsidian://open?vault=BOXP&file=Tickets/BOXP-581.md 。')).toEqual([
    { type: 'text', text: '見て ' },
    {
      type: 'note',
      text: 'BOXP-581',
      url: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-581.md',
      path: 'Tickets/BOXP-581.md',
    },
    { type: 'text', text: ' 。' },
  ])
  for (const raw of ['obsidian://open?vault=BOXP&file=/etc/passwd', 'obsidian://open?vault=BOXP&file=../secret.md'])
    expect(parseInline(raw).every((n) => n.type === 'text')).toBe(true)
})
