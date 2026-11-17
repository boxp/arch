import { expect, it } from 'vitest'
import { must } from '../must'
import { obsidianNotePath, obsidianNoteUrl, parseInline, plainText, renderMarkdown } from './markdown'
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

it('keeps unencoded "+" and sub-delimiters in bare obsidian://open URLs as part of the note path', () => {
  for (const [raw, path] of [
    ['obsidian://open?vault=BOXP&file=a+b.md', 'a+b.md'],
    ['obsidian://open?vault=BOXP&file=Notes/c++', 'Notes/c++'],
    ["obsidian://open?vault=BOXP&file=memo(1),x;y:z@w!$'*.md", "memo(1),x;y:z@w!$'*.md"],
  ]) {
    const nodes = parseInline(`見て ${raw} 。`)
    expect(nodes[1]).toMatchObject({ type: 'note', path })
    expect(nodes[2]).toEqual({ type: 'text', text: ' 。' })
  }
  expect(parseInline('(obsidian://open?vault=BOXP&file=a+b.md)')).toMatchObject([
    { type: 'text', text: '(' },
    { type: 'note', path: 'a+b.md' },
    { type: 'text', text: ')' },
  ])
})

it('links plain ticket references and absolute vault paths', () => {
  const ticket = (id: string) => ({
    type: 'note',
    text: id,
    path: `Tickets/${id}.md`,
    url: obsidianNoteUrl(`Tickets/${id}.md`),
  })
  expect(parseInline('【Task Board 通知】BOXP-590：archのRenovate滞留整理')).toEqual([
    { type: 'text', text: '【Task Board 通知】' },
    ticket('BOXP-590'),
    { type: 'text', text: '：archのRenovate滞留整理' },
  ])
  expect(parseInline('BOXP-592（コハコの家）')).toEqual([ticket('BOXP-592'), { type: 'text', text: '（コハコの家）' }])
  expect(parseInline('Tickets/BOXP-590.md')).toEqual([ticket('BOXP-590')])
  const path = 'Projects/コハコ計画.md'
  expect(parseInline(`/home/boxp/Documents/obsidian-headless/BOXP/${path}`)).toEqual([
    { type: 'note', text: 'コハコ計画', path, url: obsidianNoteUrl(path) },
  ])
  expect(plainText('BOXP-590 です')).toBe('BOXP-590 です')
})

it('links only complete note references in code spans', () => {
  for (const input of [
    'BOXP-590',
    'Tickets/BOXP-590.md',
    '/home/boxp/Documents/obsidian-headless/BOXP/Tickets/BOXP-590.md',
  ]) {
    expect(parseInline(`\` ${input} \``)).toEqual([
      { type: 'note', text: 'BOXP-590', path: 'Tickets/BOXP-590.md', url: obsidianNoteUrl('Tickets/BOXP-590.md') },
    ])
  }
  for (const input of ['docs/plan.md', 'BOXP-581-links', 'obsidian://open?vault=BOXP&file=a.md'])
    expect(parseInline(`\`${input}\``)).toEqual([{ type: 'code', text: input }])
})

it('links absolute vault paths containing spaces and parentheses', () => {
  for (const path of ['Projects/調査 (案).md', 'Projects/調査（案）.md', 'Projects/a b/c (1).md']) {
    const note = { type: 'note', text: must(path.split('/').pop()).slice(0, -3), path, url: obsidianNoteUrl(path) }
    expect(parseInline(`/home/boxp/Documents/obsidian-headless/BOXP/${path}`)).toEqual([note])
    expect(parseInline(`ノート /home/boxp/Documents/obsidian-headless/BOXP/${path} を見て`)).toEqual([
      { type: 'text', text: 'ノート ' },
      note,
      { type: 'text', text: ' を見て' },
    ])
    expect(parseInline(`\`/home/boxp/Documents/obsidian-headless/BOXP/${path}\``)).toEqual([note])
  }
  // 2 つ並んだパスは別々のリンクになる
  expect(
    parseInline(
      '/home/boxp/Documents/obsidian-headless/BOXP/Tickets/BOXP-1.md と /home/boxp/Documents/obsidian-headless/BOXP/Tickets/BOXP-2.md',
    ).map((n) => n.path ?? n.text),
  ).toEqual(['Tickets/BOXP-1.md', ' と ', 'Tickets/BOXP-2.md'])
})

it('links vault-relative note paths written as code or plain text (BOXP-592 notification entry)', () => {
  const path = 'Projects/kohako-home/netnavi-origin-592-owner-entry.md',
    note = { type: 'note', text: 'netnavi-origin-592-owner-entry', path, url: obsidianNoteUrl(path) }
  expect(parseInline(`入口ノート: \`${path}\``)).toEqual([{ type: 'text', text: '入口ノート: ' }, note])
  expect(parseInline(`入口ノート: ${path}。`)).toEqual([
    { type: 'text', text: '入口ノート: ' },
    note,
    { type: 'text', text: '。' },
  ])
  for (const dir of ['Tickets', 'Boards', 'Incidents', 'Infrastructure'])
    expect(parseInline(`\`${dir}/x.md\``)[0]).toMatchObject({ type: 'note', path: `${dir}/x.md` })
  for (const input of [
    'README.md',
    'docs/project_docs/BOXP-581/plan.md',
    'Projects/x.ts',
    'Projects/../x.md',
    'Projects/.obsidian/x.md',
  ])
    expect(parseInline(`\`${input}\``)).toEqual([{ type: 'code', text: input }])
  expect(parseInline('apps/Projects/x.md').every((n) => n.type === 'text')).toBe(true)
})

it('does not link unrelated text, invalid paths or parts of links', () => {
  for (const input of [
    'codex-task-board/BOXP-581-2026',
    'BOXP-581-links',
    'xBOXP-1',
    'BOXP-12a',
    'boxp-1',
    'PROJ-1',
    'Tickets/BOXP-1.mdx',
    '/home/boxp/Documents/obsidian-headless/BOXP/../secret.md',
    '/home/boxp/Documents/obsidian-headless/BOXP/.obsidian/secret.md',
  ])
    expect(parseInline(input).every((node) => node.type === 'text')).toBe(true)
  expect(parseInline('[BOXP-590](https://example.com/BOXP-590)')).toEqual([
    { type: 'link', text: 'BOXP-590', url: 'https://example.com/BOXP-590' },
  ])
  expect(parseInline('https://example.com/BOXP-590')).toEqual([
    { type: 'link', text: 'https://example.com/BOXP-590', url: 'https://example.com/BOXP-590' },
  ])
})

it('renders ticket links without opening a new tab', () => {
  type Element = {
    tag: string
    children: Element[]
    className: string
    href: string
    textContent: string
    append: (...children: Element[]) => void
  }
  const make = (tag: string): Element => ({
    tag,
    children: [],
    className: '',
    href: '',
    textContent: '',
    append(...children) {
      this.children.push(...children)
    },
  })
  const doc = { createDocumentFragment: () => make('fragment'), createElement: make } as unknown as Document
  const fragment = renderMarkdown('BOXP-590', doc) as unknown as Element
  const link = fragment.children[0].children[0]
  expect(link).toMatchObject({
    tag: 'a',
    className: 'obsidian-note',
    href: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-590.md',
  })
  expect(link).not.toHaveProperty('target')
  expect(link.children[1].textContent).toBe('Obsidianで開く')
})

it('links inside bold text as Task Board notifications write them', () => {
  const pr = 'https://github.com/boxp/arch/pull/13440'
  expect(parseInline(`残る **[PR #13440](${pr})** は停止`)).toEqual([
    { type: 'text', text: '残る ' },
    { type: 'bold', text: 'PR #13440', children: [{ type: 'link', text: 'PR #13440', url: pr }] },
    { type: 'text', text: ' は停止' },
  ])
  expect(parseInline('**BOXP-571：CIの隔離apply試験導入**')).toEqual([
    {
      type: 'bold',
      text: 'BOXP-571：CIの隔離apply試験導入',
      children: [
        { type: 'note', text: 'BOXP-571', path: 'Tickets/BOXP-571.md', url: obsidianNoteUrl('Tickets/BOXP-571.md') },
        { type: 'text', text: '：CIの隔離apply試験導入' },
      ],
    },
  ])
  expect(parseInline('**残り1件**')).toEqual([{ type: 'bold', text: '残り1件' }])
  expect(plainText(`**[PR #13440](${pr})** と **BOXP-571**`)).toBe('PR #13440 と BOXP-571')
})

it('accepts only supported external link schemes', () => {
  for (const url of ['http://example.com/', 'https://example.com/', 'mailto:user@example.com'])
    expect(parseInline(`[link](${url})`)).toEqual([{ type: 'link', text: 'link', url }])
  for (const url of ['ftp://example.com/file', 'javascript:alert', 'data:text/plain,hello'])
    expect(parseInline(`[link](${url})`)).toEqual([{ type: 'text', text: 'link' }])
})

it('requires the entire Obsidian URL and limits decoded path length', () => {
  const valid = obsidianNoteUrl('a.md')
  expect(obsidianNotePath(`prefix${valid}`)).toBeUndefined()
  expect(obsidianNotePath(`${valid}#fragment`)).toBeUndefined()
  expect(obsidianNotePath(obsidianNoteUrl('a'.repeat(1500)))).toBe('a'.repeat(1500))
  expect(obsidianNotePath(obsidianNoteUrl('a'.repeat(1501)))).toBeUndefined()
  expect(obsidianNotePath(obsidianNoteUrl('a/   /b.md'))).toBeUndefined()
})

it('requires complete allowed paths and ticket IDs in code spans', () => {
  for (const input of ['other/Projects/x.md', 'xBOXP-123', 'Projects/x.md.bak'])
    expect(parseInline(`\`${input}\``)).toEqual([{ type: 'code', text: input }])
  expect(parseInline('`Projects/a.md.backup.md`')[0]).toMatchObject({ type: 'note', text: 'a.md.backup' })
})
