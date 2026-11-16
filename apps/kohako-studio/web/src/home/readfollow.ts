export type Span = { start: number; end: number }

/** 空白を除いて順に照合し、照合できない部分は前後の範囲に文字数で割り当てる。 */
export function mapChunks(chunks: string[], text: string): Span[] {
  const chars: string[] = [],
    offsets: number[] = []
  for (let i = 0; i < text.length; i++)
    if (!/\s/.test(text[i])) {
      chars.push(text[i])
      offsets.push(i)
    }
  const normalized = chars.join('')
  const spans: (Span | null)[] = []
  let cursor = 0
  for (const chunk of chunks) {
    const needle = chunk.replace(/\s/g, '')
    const found = needle ? normalized.indexOf(needle, cursor) : -1
    if (found < 0) spans.push(null)
    else {
      spans.push({ start: offsets[found], end: offsets[found + needle.length - 1] + 1 })
      cursor = found + needle.length
    }
  }
  for (let i = 0; i < spans.length; ) {
    if (spans[i]) {
      i++
      continue
    }
    const first = i
    while (i < spans.length && !spans[i]) i++
    const start = first ? (spans[first - 1]?.end ?? 0) : 0,
      end = i < spans.length ? (spans[i]?.start ?? text.length) : text.length
    const total = chunks.slice(first, i).reduce((n, s) => n + Math.max(1, s.length), 0)
    let used = 0
    for (let j = first; j < i; j++) {
      const from = used
      used += Math.max(1, chunks[j].length)
      spans[j] = {
        start: Math.round(start + ((end - start) * from) / total),
        end: Math.round(start + ((end - start) * used) / total),
      }
    }
  }
  return spans as Span[]
}

export function estimatePosition(span: Span, start: number, duration: number, now: number, boundary?: number): number {
  const length = Math.max(0, span.end - span.start)
  const fraction = duration > 0 ? (now - start) / (duration * 1000) : (now - start) / (Math.max(1, length) * 150)
  return Math.max(
    span.start,
    Math.min(span.end, span.start + (boundary === undefined ? Math.floor(length * fraction) : boundary)),
  )
}

export function createReadFollowState() {
  let following = true
  return {
    following: () => following,
    pause: () => {
      following = false
    },
    reset: () => {
      following = true
    },
    resume: () => {
      following = true
    },
  }
}

export function textRange(root: HTMLElement, span: Span): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  if (!nodes.length) return null
  const locate = (offset: number): [Text, number] => {
    let remaining = Math.max(0, offset)
    for (const node of nodes) {
      if (remaining <= node.length) return [node, remaining]
      remaining -= node.length
    }
    const last = nodes[nodes.length - 1]
    return [last, last.length]
  }
  const range = document.createRange(),
    [start, a] = locate(span.start),
    [end, b] = locate(Math.max(span.start, span.end))
  range.setStart(start, a)
  range.setEnd(end, b)
  return range
}

export function highlight(range: Range | null) {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return
  if (range) CSS.highlights.set('kohako-reading', new Highlight(range))
  else CSS.highlights.delete('kohako-reading')
}

export function scrollReading(scroller: HTMLElement, range: Range, force = false) {
  const rect = range.getClientRects()[0],
    box = scroller.getBoundingClientRect()
  if (!rect || !scroller.clientHeight) return
  const top = box.top + scroller.clientTop,
    height = scroller.clientHeight
  if (force || rect.top < top + height * 0.15 || rect.top > top + height * 0.7)
    scroller.scrollTop += rect.top - (top + height / 3)
}
