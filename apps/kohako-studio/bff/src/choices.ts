/**
 * BOXP-646: 本文に書かれた選択肢（A／B…、1／2…、B1／B2…）を取り出す。会話の返答・家の通知で同じ規則を使い、
 * 「ボタンになる／ならない」の揺れをなくす。web/src/home/choices.ts と bff/src/choices.ts は同じ内容に保つ（テストで照合）。
 *
 * 対象: 行頭（箇条書き記号・太字可）の「A：」「A）」「A.」「A「…」」「A（推奨）…」「1. 」「B1（おすすめ）」と、
 * 1 行に並べた「A：…／B：…」。A から（数字は 1 から）連番で 2〜6 個そろったものだけ。
 * 対象外: 連番でないもの・1 個だけ・7 個以上。数字・「B1」型は、本文に選択を求める言葉（どれ／どちら／どの／選んで など）も
 * 「推奨／おすすめ」付きの項目もなければ対象外（手順や確認項目の番号付き箇条書きをボタンにしない）。
 * 取り出すだけで、選んだことにはしない（送信は必ず本人のボタン操作から）。
 */
export type Choice = { value: string; label: string }

// 数字・「B1」型は手順や確認項目の番号と区別しにくいので、選択を求める言葉か「推奨／おすすめ」付きの項目があるときだけ選択肢とみなす。
const CUE = /どれ(?!く|だけ|ほど)|どちら|(?<!な)どの|選ん|お選び|選択|選べ/
const TOKEN = String.raw`(?:([A-Z])([1-9]\d?)?|(\d{1,2}))`
const LINE = new RegExp(
  String.raw`^\s*(?:[-*・]\s*)?${TOKEN}(?:\*\*)?\s*(?:[)）:：]|[.．](?!\d)|(?=[「『（(【]))\s*(\S.*)$`,
)
const PART = new RegExp(String.raw`^\s*${TOKEN}(?:\*\*)?\s*(?:[)）:：]|[.．](?!\d)|(?=[「『（(【]))\s*(\S.*)$`)
const MAX = 6

type Token = { value: string; family: string; index: number }

function token(m: RegExpMatchArray): Token {
  if (m[3]) return { value: String(Number(m[3])), family: '#', index: Number(m[3]) }
  if (m[2]) return { value: `${m[1]}${Number(m[2])}`, family: m[1], index: Number(m[2]) }
  return { value: m[1], family: '@', index: m[1].charCodeAt(0) - 64 }
}

function clean(label: string): string {
  return label
    .replace(/\*\*/g, '')
    .replace(/^[\s:：、,]+/, '')
    .replace(/^（([^）]{1,10})）\s*[:：]\s*/, '（$1）')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 1 グループ（同じ種類の連番）。 */
type Group = { family: string; items: Choice[]; broken: boolean }

function valid(g: Group | null): g is Group {
  return !!g && !g.broken && g.items.length >= 2 && g.items.length <= MAX
}

function inline(line: string): { family: string; items: Choice[] } | null {
  const parts = line.replace(/\*\*/g, '').split(/\s*[／｜]\s*/)
  if (parts.length < 2) return null
  const out: Choice[] = []
  let family = ''
  for (const [i, part] of parts.entries()) {
    const m = part.replace(/^\s*(?:[-*・]\s*)?/, '').match(PART)
    if (!m) return null
    const t = token(m)
    if (i === 0) family = t.family
    if (t.family !== family || t.index !== i + 1) return null
    out.push({ value: t.value, label: clean(m[4]) })
  }
  return out.length <= MAX ? { family, items: out } : null
}

export function extractChoices(text: string): Choice[] | null {
  if (!text) return null
  const accept = (family: string, items: Choice[]) =>
    family === '@' || CUE.test(text) || items.some((x) => /推奨|おすすめ/.test(x.label))
  let best: Choice[] | null = null
  let group: Group | null = null
  const close = () => {
    if (valid(group) && accept(group.family, group.items)) best = group.items
    group = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^(\s*(?:[-*・]\s*)?)\*\*/, '$1')
    const row = inline(line)
    if (row && accept(row.family, row.items)) {
      close()
      best = row.items
      continue
    }
    const m = line.match(LINE)
    if (!m) continue
    const t = token(m)
    const choice = { value: t.value, label: clean(m[4]) }
    if (!choice.label) continue
    const current = group as Group | null
    if (current && current.family === t.family) {
      if (t.index === current.items.length + 1) {
        current.items.push(choice)
        continue
      }
      // 同じ記号の再掲（「A）もう一度」など）は無視し、連番が飛んだら（G や 7 など）その組は使わない。
      // ただし 2 個以上そろった組のあとに先頭（A／1）が再び来たら、後続の新しい選択肢の組として読み直す（最後の組を使う）。
      if (current.items.some((x) => x.value === t.value) && !(t.index === 1 && current.items.length >= 2)) continue
      if (t.index !== 1) {
        current.broken = true
        continue
      }
    }
    if (t.index !== 1) continue
    close()
    group = { family: t.family, items: [choice], broken: false }
  }
  close()
  return best
}

/** ボタン表示用の短い文言（記号＋説明の先頭）。 */
export function choiceButtonText(c: Choice, max = 24): string {
  const label = Array.from(c.label)
  return label.length ? `${c.value}：${label.length > max ? `${label.slice(0, max).join('')}…` : c.label}` : c.value
}

/** 会話の選択肢ボタンを押したときに送る発言（記号＋説明。どの案かを返答側が取り違えないよう説明も添える）。 */
export function choiceMessage(c: Choice, max = 200): string {
  const label = Array.from(c.label)
  return label.length ? `${c.value}：${label.length > max ? `${label.slice(0, max).join('')}…` : c.label}` : c.value
}
