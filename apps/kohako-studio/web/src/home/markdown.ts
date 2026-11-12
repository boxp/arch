export type Inline = { type: 'text' | 'code' | 'bold' | 'italic' | 'strike' | 'link'; text: string; url?: string }
export type Block = { type: 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'rule'; text?: string; level?: number; ordered?: boolean; items?: string[]; indents?: number[]; inline?: Inline[] }
const safeUrl = (url: string) => { try { const u = new URL(url); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : undefined } catch { return undefined } }
export function parseInline(src: string): Inline[] {
  const result: Inline[] = [], re = /(!?)\[([^\]]*)\]\(([^\s)]+)\)|https:\/\/[^\s<>]+|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_/g
  let pos = 0, m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > pos) result.push({ type: 'text', text: src.slice(pos, m.index) })
    if (m[2] !== undefined) { const label = m[1] ? `画像: ${m[2]}` : m[2], url = safeUrl(m[3]); result.push(url ? { type: 'link', text: label, url } : { type: 'text', text: label }) }
    else if (m[0].startsWith('https://')) { const url = safeUrl(m[0]); result.push(url ? { type: 'link', text: m[0], url } : { type: 'text', text: m[0] }) }
    else result.push({ type: m[4] ? 'code' : m[5] ? 'bold' : m[6] ? 'strike' : 'italic', text: m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] })
    pos = re.lastIndex
  }
  if (pos < src.length) result.push({ type: 'text', text: src.slice(pos) })
  return result
}
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n'), blocks: Block[] = []; let i = 0
  const special = (s: string) => /^(?:\s*```|#{1,6}\s|\s*(?:[-*+]\s|\d+\.\s)|\s*>|\s*---\s*$)/.test(s)
  while (i < lines.length) {
    const s = lines[i]; if (!s.trim()) { i++; continue }
    if (/^\s*```/.test(s)) { const code: string[] = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); if (i < lines.length) i++; blocks.push({ type: 'code', text: code.join('\n') }); continue }
    if (/^\s*---\s*$/.test(s)) { blocks.push({ type: 'rule' }); i++; continue }
    const heading = /^(#{1,6})\s+(.+)$/.exec(s); if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], inline: parseInline(heading[2]) }); i++; continue }
    const list = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(s); if (list) { const ordered = /\d/.test(list[1]), items: string[] = [], indents: number[] = []; while (i < lines.length) { const m = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(lines[i]); if (!m || /\d/.test(m[1]) !== ordered) break; items.push(m[2]); indents.push(/^\s*/.exec(lines[i])![0].length); i++ }; blocks.push({ type: 'list', ordered, items, indents }); continue }
    if (/^\s*>/.test(s)) { const q: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); const text = q.join('\n'); blocks.push({ type: 'quote', text, inline: parseInline(text) }); continue }
    const p = [s]; i++; while (i < lines.length && lines[i].trim() && !special(lines[i])) p.push(lines[i++]); const text = p.join('\n'); blocks.push({ type: 'paragraph', text, inline: parseInline(text) })
  }
  return blocks
}
export function renderMarkdown(src: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment()
  const inline = (parent: HTMLElement, nodes: Inline[]) => { for (const n of nodes) { const tag = n.type === 'link' ? 'a' : n.type === 'code' ? 'code' : n.type === 'bold' ? 'strong' : n.type === 'italic' ? 'em' : n.type === 'strike' ? 'del' : 'span', node = doc.createElement(tag); if (n.type === 'link' && n.url) { const a = node as HTMLAnchorElement; a.href = n.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer' }; const parts = n.text.split('\n'); parts.forEach((part, index) => { if (index) node.append(doc.createElement('br')); const text = doc.createElement('span'); text.textContent = part; node.append(text) }); parent.append(node) } }
  for (const block of parseMarkdown(src)) {
    if (block.type === 'rule') { fragment.append(doc.createElement('hr')); continue }
    const tag = block.type === 'heading' ? `h${Math.min(6, (block.level ?? 1) + 2)}` : block.type === 'list' ? block.ordered ? 'ol' : 'ul' : block.type === 'quote' ? 'blockquote' : block.type === 'code' ? 'pre' : 'p', node = doc.createElement(tag)
    if (block.type === 'code') { const code = doc.createElement('code'); code.textContent = block.text ?? ''; node.append(code) }
    else if (block.type === 'list') { let last: HTMLLIElement | undefined, nested: HTMLOListElement | HTMLUListElement | undefined; (block.items ?? []).forEach((item, index) => { const li = doc.createElement('li'); inline(li, parseInline(item)); if ((block.indents?.[index] ?? 0) > (block.indents?.[0] ?? 0) && last) { if (!nested) { nested = doc.createElement(block.ordered ? 'ol' : 'ul'); last.append(nested) }; nested.append(li) } else { node.append(li); last = li; nested = undefined } }) }
    else inline(node, block.inline ?? [])
    fragment.append(node)
  }
  return fragment
}
export function plainText(src: string): string { return parseMarkdown(src).map(b => b.type === 'rule' ? '' : b.type === 'code' ? b.text ?? '' : b.type === 'list' ? (b.items ?? []).map(s => parseInline(s).map(n => n.text).join('')).join('\n') : (b.inline ?? []).map(n => n.text).join('')).filter(Boolean).join('\n') }
