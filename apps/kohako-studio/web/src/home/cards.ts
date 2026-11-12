// 返答文から結果カードを決まった手順で取り出す（BOXP-499 設計 3.4/4.3）。HTML として解釈せず、https だけをリンクにする。
export type Card = { kind: 'list'; items: string[] } | { kind: 'code'; text: string } | { kind: 'link'; url: string; host: string }
const MAX_CARDS = 6
export function cardsFromText(text: string): Card[] {
  const cards: Card[] = []
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) if (m[1].trim()) cards.push({ kind: 'code', text: m[1].replace(/\n$/, '') })
  const body = text.replace(/```[\s\S]*?```/g, '')
  let run: string[] = [], plain: string[] = []
  const flush = () => { if (run.length >= 2) cards.push({ kind: 'list', items: run }); run = [] }
  // 記号なしの列挙: 空行で区切られた 3 行以上の短い行（文末記号・URL なし）の塊も一覧とみなす。
  const flushPlain = () => { if (plain.length >= 3 && plain.every(l => [...l].length <= 60 && !/[。！？!?：:]$/.test(l) && !/https?:\/\//.test(l))) cards.push({ kind: 'list', items: plain }); plain = [] }
  for (const line of body.split('\n')) {
    const m = /^\s*(?:[-*+・•]|\d+[.)．])\s+(.+)$/.exec(line)
    if (m) { flushPlain(); run.push(m[1].trim()) } else if (line.trim()) { flush(); plain.push(line.trim()) } else { flush(); flushPlain() }
  }
  flush(); flushPlain()
  const seen = new Set<string>()
  for (const m of body.matchAll(/https:\/\/[^\s<>()（）「」『』、。"'`]+/g)) {
    try { const url = new URL(m[0].replace(/[.,!?！？]+$/, '')); if (url.protocol !== 'https:' || seen.has(url.href)) continue; seen.add(url.href); cards.push({ kind: 'link', url: url.href, host: url.hostname }) } catch { /* URL として読めないものは文字のまま */ }
  }
  return cards.slice(0, MAX_CARDS)
}
