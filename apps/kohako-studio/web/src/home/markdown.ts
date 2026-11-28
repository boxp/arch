import { must } from '../must'
export type Inline = {
  type: 'text' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'image' | 'note'
  text: string
  url?: string
  path?: string
  // 太字・取り消し線・斜体の中にリンクや票 ID があるときだけ持つ（中身は 1 段だけ解釈する）。
  children?: Inline[]
}
export type Block = {
  type: 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'rule'
  text?: string
  level?: number
  ordered?: boolean
  items?: string[]
  indents?: number[]
  inline?: Inline[]
}
const safeUrl = (url: string) => {
  try {
    const u = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : undefined
  } catch {
    return undefined
  }
}
// BOXP-581: vault 内ノートを端末の Obsidian アプリで開くリンク。BOXP vault の open 操作だけを許し、
// vault 相対パスを検査して正規化し直す（任意スキームや他 vault・他操作は従来どおりリンクにしない）。
export const OBSIDIAN_VAULT = 'BOXP'
const encodePathParam = (path: string) =>
  encodeURIComponent(path).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
export function obsidianNoteUrl(path: string): string {
  return `obsidian://open?vault=${OBSIDIAN_VAULT}&file=${encodePathParam(path)}`
}
export function obsidianNotePath(raw: string): string | undefined {
  const m = /^obsidian:\/\/open\/?\?([^#]*)$/i.exec(raw)
  if (!m) return undefined
  try {
    const params = new Map<string, string>()
    for (const part of m[1].split('&')) {
      const eq = part.indexOf('=')
      if (eq < 1) return undefined
      const key = part.slice(0, eq),
        value = decodeURIComponent(part.slice(eq + 1))
      if (!['vault', 'file'].includes(key) || params.has(key)) return undefined
      params.set(key, value)
    }
    const path = params.get('file')
    if (
      params.get('vault') !== OBSIDIAN_VAULT ||
      !path ||
      path.length > 1500 ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: vault 相対パスにバックスラッシュと C0 制御文字を含むものを拒否する
      /[\\\x00-\x1f\x7f]/.test(path) ||
      path.split('/').some((p) => !p.trim() || p.startsWith('.'))
    )
      return undefined
    return path
  } catch {
    return undefined
  }
}
export function vaultImageUrl(raw: string): string | undefined {
  if (!raw.startsWith('kohako-vault:')) return undefined
  try {
    const path = decodeURIComponent(raw.slice(13))
    if (
      !path ||
      path.length > 1500 ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: vault 相対パスにバックスラッシュと C0 制御文字を含むものを拒否する
      /[\\\x00-\x1f]/.test(path) ||
      path.split('/').some((p) => !p || p.startsWith('.')) ||
      !/\.(png|jpe?g|gif|webp)$/i.test(path)
    )
      return undefined
    return `/kohako/api/v1/vault-image?path=${encodeURIComponent(path)}`
  } catch {
    return undefined
  }
}
const noteTitle = (path: string) => must(path.split('/').pop()).replace(/\.md$/i, '')
// 文字で書かれた vault 絶対パス（空白・括弧を含んでもよい）と、vault 直下の主要フォルダから始まる相対パス
// （コード表記を含む）もノートリンクにする。docs/ などリポジトリのパスと紛らわしいフォルダは対象外。
const VAULT_ROOT = '/home/boxp/Documents/obsidian-headless/BOXP/'
const VAULT_DIRS = /^(?:Tickets|Projects|Boards|Incidents|Infrastructure)\//
// BOXP-778: Obsidian の wiki リンク [[パス|別名]]・[[パス]]。拡張子が無ければ .md を補い、#見出し は外してノート本体を開く。
// スキームらしい書き出し（javascript: など）と vault 外の絶対パスはリンクにしない（obsidianNotePath の検査も通す）。
// 最後の部分が「. + 英字始まりの英数字 1〜8 文字」で終われば拡張子付きとしてそのまま開く（v1.2 や空白を含むものは .md を補う）。
const WIKI_EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}$/
function wikiNote(inner: string): Inline | undefined {
  const bar = inner.indexOf('|'),
    target = (bar < 0 ? inner : inner.slice(0, bar)).replace(/#.*$/s, '').trim(),
    alias = bar < 0 ? '' : inner.slice(bar + 1).trim()
  if (!target || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined
  let rel = target.startsWith(VAULT_ROOT)
    ? target.slice(VAULT_ROOT.length)
    : /^BOXP-\d{1,6}$/.test(target)
      ? `Tickets/${target}`
      : target
  if (!WIKI_EXT.test(rel)) rel += '.md'
  const note = obsidianNotePath(obsidianNoteUrl(rel))
  return note ? { type: 'note', text: alias || noteTitle(note), url: obsidianNoteUrl(note), path: note } : undefined
}
export function parseInline(src: string): Inline[] {
  const result: Inline[] = [],
    re =
      /(!?)\[([^\]]*)\]\(([^\s)]+)\)|obsidian:\/\/open\/?\?[A-Za-z0-9\-._~%&=/+!$'()*,;:@]*[A-Za-z0-9\-_~%=+]|https:\/\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]*[A-Za-z0-9\-_~/#=&%+]|\/home\/boxp\/Documents\/obsidian-headless\/BOXP\/[^\n`'"<>「」『』、。，［］[\]{}|\\;]+?\.[mM][dD](?![A-Za-z0-9_])|(?<![A-Za-z0-9_/.-])(?:Tickets|Projects|Boards|Incidents|Infrastructure)\/[^\s`'"<>()（）「」『』、。，．［］[\]{}|\\;]+\.md(?![A-Za-z0-9_])|(?<![A-Za-z0-9_/.-])BOXP-\d{1,6}(?![A-Za-z0-9_-])|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])|\[\[([^[\]\n]*)\]\]/g
  let pos = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > pos) result.push({ type: 'text', text: src.slice(pos, m.index) })
    if (m[9] !== undefined) result.push(wikiNote(m[9]) ?? { type: 'text', text: m[0] })
    else if (m[2] !== undefined) {
      const image = m[1] && vaultImageUrl(m[3]),
        label = m[1] ? `画像: ${m[2]}` : m[2],
        note = !m[1] ? obsidianNotePath(m[3]) : undefined,
        url = safeUrl(m[3])
      result.push(
        image
          ? { type: 'image', text: m[2], url: image }
          : note
            ? { type: 'note', text: m[2] || noteTitle(note), url: obsidianNoteUrl(note), path: note }
            : url
              ? { type: 'link', text: label, url }
              : { type: 'text', text: label },
      )
    } else if (m[0].startsWith('obsidian:')) {
      const note = obsidianNotePath(m[0])
      result.push(
        note
          ? { type: 'note', text: noteTitle(note), url: obsidianNoteUrl(note), path: note }
          : { type: 'text', text: m[0] },
      )
    } else if (m[0].startsWith('https://')) {
      const url = safeUrl(m[0])
      result.push(url ? { type: 'link', text: m[0], url } : { type: 'text', text: m[0] })
    } else if (m[4] !== undefined) {
      const content = m[4].trim(),
        rel = content.startsWith(VAULT_ROOT)
          ? content.slice(VAULT_ROOT.length)
          : VAULT_DIRS.test(content)
            ? content
            : /^BOXP-\d{1,6}$/.test(content)
              ? `Tickets/${content}.md`
              : undefined,
        note = rel && /\.md$/i.test(rel) ? obsidianNotePath(obsidianNoteUrl(rel)) : undefined
      result.push(
        note
          ? { type: 'note', text: noteTitle(note), url: obsidianNoteUrl(note), path: note }
          : { type: 'code', text: m[4] },
      )
    } else if (m[0].startsWith(VAULT_ROOT)) {
      const path = m[0].slice(VAULT_ROOT.length),
        note = obsidianNotePath(obsidianNoteUrl(path))
      result.push(
        note
          ? { type: 'note', text: noteTitle(note), url: obsidianNoteUrl(note), path: note }
          : { type: 'text', text: m[0] },
      )
    } else if (m[0].startsWith('BOXP-') || VAULT_DIRS.test(m[0])) {
      const path = m[0].startsWith('BOXP-') ? `Tickets/${m[0]}.md` : m[0],
        note = obsidianNotePath(obsidianNoteUrl(path))
      result.push(
        note
          ? { type: 'note', text: noteTitle(note), url: obsidianNoteUrl(note), path: note }
          : { type: 'text', text: m[0] },
      )
    } else {
      const text = m[5] ?? m[6] ?? m[7] ?? m[8],
        children = parseInline(text).map((c) =>
          c.type === 'link' || c.type === 'note' || c.type === 'text' ? c : { type: 'text' as const, text: c.text },
        )
      result.push({
        type: m[5] ? 'bold' : m[6] ? 'strike' : 'italic',
        ...(children.some((c) => c.type === 'link' || c.type === 'note')
          ? { text: children.map((c) => c.text).join(''), children }
          : { text }),
      })
    }
    pos = re.lastIndex
  }
  if (pos < src.length) result.push({ type: 'text', text: src.slice(pos) })
  return result
}
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n'),
    blocks: Block[] = []
  let i = 0
  const special = (s: string) => /^(?:\s*```|#{1,6}\s|\s*(?:[-*+]\s|\d+\.\s)|\s*>|\s*---\s*$)/.test(s)
  while (i < lines.length) {
    const s = lines[i]
    if (!s.trim()) {
      i++
      continue
    }
    if (/^\s*```/.test(s)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      if (i < lines.length) i++
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    if (/^\s*---\s*$/.test(s)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(s)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], inline: parseInline(heading[2]) })
      i++
      continue
    }
    const list = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(s)
    if (list) {
      const ordered = /\d/.test(list[1]),
        items: string[] = [],
        indents: number[] = []
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(lines[i])
        if (!m || /\d/.test(m[1]) !== ordered) break
        items.push(m[2])
        indents.push(must(/^\s*/.exec(lines[i]))[0].length)
        i++
      }
      blocks.push({ type: 'list', ordered, items, indents })
      continue
    }
    if (/^\s*>/.test(s)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      const text = q.join('\n')
      blocks.push({ type: 'quote', text, inline: parseInline(text) })
      continue
    }
    const p = [s]
    i++
    while (i < lines.length && lines[i].trim() && !special(lines[i])) p.push(lines[i++])
    const text = p.join('\n')
    blocks.push({ type: 'paragraph', text, inline: parseInline(text) })
  }
  return blocks
}
export function renderMarkdown(src: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment()
  const inline = (parent: HTMLElement, nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === 'image' && n.url) {
        const wrap = doc.createElement('span'),
          image = doc.createElement('img'),
          link = doc.createElement('a')
        wrap.className = 'vault-image'
        image.src = n.url
        image.alt = n.text
        image.loading = 'lazy'
        image.referrerPolicy = 'no-referrer'
        link.href = n.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.append(image)
        image.addEventListener(
          'error',
          () => {
            image.hidden = true
            const error = doc.createElement('span')
            error.textContent = `画像を表示できません（${n.text || '添付画像'}）。ファイルの移動・削除、対応形式、認証を確認してください。`
            wrap.append(error)
          },
          { once: true },
        )
        wrap.append(link)
        parent.append(wrap)
        continue
      }
      if (n.type === 'note' && n.url) {
        // 新規タブにすると端末によって空タブが残るため、同じタブのままアプリへ渡す（ページ遷移はしない）。
        const a = doc.createElement('a'),
          label = doc.createElement('span'),
          badge = doc.createElement('span')
        a.className = 'obsidian-note'
        a.href = n.url
        a.title = `Obsidianで開く: ${n.path}`
        a.referrerPolicy = 'no-referrer'
        label.textContent = n.text
        badge.className = 'obsidian-note-badge'
        badge.textContent = 'Obsidianで開く'
        a.append(label, badge)
        parent.append(a)
        continue
      }
      const tag =
          n.type === 'link'
            ? 'a'
            : n.type === 'code'
              ? 'code'
              : n.type === 'bold'
                ? 'strong'
                : n.type === 'italic'
                  ? 'em'
                  : n.type === 'strike'
                    ? 'del'
                    : 'span',
        node = doc.createElement(tag)
      if (n.type === 'link' && n.url) {
        const a = node as HTMLAnchorElement
        a.href = n.url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.referrerPolicy = 'no-referrer'
      }
      if (n.children) {
        inline(node, n.children)
        parent.append(node)
        continue
      }
      const parts = n.text.split('\n')
      parts.forEach((part, index) => {
        if (index) node.append(doc.createElement('br'))
        const text = doc.createElement('span')
        text.textContent = part
        node.append(text)
      })
      parent.append(node)
    }
  }
  for (const block of parseMarkdown(src)) {
    if (block.type === 'rule') {
      fragment.append(doc.createElement('hr'))
      continue
    }
    const tag =
        block.type === 'heading'
          ? `h${Math.min(6, (block.level ?? 1) + 2)}`
          : block.type === 'list'
            ? block.ordered
              ? 'ol'
              : 'ul'
            : block.type === 'quote'
              ? 'blockquote'
              : block.type === 'code'
                ? 'pre'
                : 'p',
      node = doc.createElement(tag)
    if (block.type === 'code') {
      const code = doc.createElement('code')
      code.textContent = block.text ?? ''
      node.append(code)
    } else if (block.type === 'list') {
      let last: HTMLLIElement | undefined, nested: HTMLOListElement | HTMLUListElement | undefined
      ;(block.items ?? []).forEach((item, index) => {
        const li = doc.createElement('li')
        inline(li, parseInline(item))
        if ((block.indents?.[index] ?? 0) > (block.indents?.[0] ?? 0) && last) {
          if (!nested) {
            nested = doc.createElement(block.ordered ? 'ol' : 'ul')
            last.append(nested)
          }
          nested.append(li)
        } else {
          node.append(li)
          last = li
          nested = undefined
        }
      })
    } else inline(node, block.inline ?? [])
    fragment.append(node)
  }
  return fragment
}
export function plainText(src: string): string {
  return parseMarkdown(src)
    .map((b) =>
      b.type === 'rule'
        ? ''
        : b.type === 'code'
          ? (b.text ?? '')
          : b.type === 'list'
            ? (b.items ?? [])
                .map((s) =>
                  parseInline(s)
                    .map((n) => n.text)
                    .join(''),
                )
                .join('\n')
            : (b.inline ?? []).map((n) => n.text).join(''),
    )
    .filter(Boolean)
    .join('\n')
}
