// BOXP-756: 読み上げの文の組み立て（仕様: vault の Projects/kohako-home/notice-read-aloud-spec.md）。
// 表示はそのままにし、読み上げる文でだけ URL を「何へのリンクか」の呼び方へ言い換える。
import type { Item } from './inbox'
import { type Inline, parseInline, parseMarkdown } from './markdown'

const SITES: [RegExp, string][] = [
  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
]
const URL_RE = /\bhttps?:\/\/[^\s<>"'`「」『』（）()、。]+/g

/** URL 1 つの読み方。既知のサイトは「GitHub のリンク」、それ以外は「リンク」。 */
export function urlName(url: string): string {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {}
  const site = SITES.find(([re]) => re.test(host))?.[1]
  return site ? `${site} のリンク` : 'リンク'
}
const isUrl = (text: string) => /^(?:https?|mailto):/i.test(text.trim())
const replaceUrls = (text: string) => text.replace(URL_RE, (url) => urlName(url))

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.children) return inlineText(n.children)
      if (n.type === 'link') return isUrl(n.text) ? urlName(n.url ?? n.text) : replaceUrls(n.text)
      return replaceUrls(n.text)
    })
    .join('')
}

/** 返答・通知の本文（Markdown）から読み上げる文を作る。markdown.ts の plainText と同じ形で、URL だけ言い換える。 */
export function spokenText(src: string): string {
  return parseMarkdown(src)
    .map((b) =>
      b.type === 'rule'
        ? ''
        : b.type === 'code'
          ? replaceUrls(b.text ?? '')
          : b.type === 'list'
            ? (b.items ?? []).map((s) => inlineText(parseInline(s))).join('\n')
            : inlineText(b.inline ?? []),
    )
    .filter(Boolean)
    .join('\n')
}

/** 家の画面に新着の通知を出すときの案内文（吹き出し・履歴・読み上げで同じ文を使う）。 */
export function announcementText(item: Pick<Item, 'title' | 'body'>, more: number): string {
  const body = item.body.length > 300 ? `${item.body.slice(0, 300)}…（続きは受信箱でご覧いただけます）` : item.body
  return `ご主人さま、お知らせが届いています。\n${item.title}\n${body}${more ? `\nほかにも ${more} 件、受信箱に届いています。` : ''}`
}

/**
 * 読み上げるか。読み上げ ON で、選んだ声が使えるときだけ（端末の声は端末が音声合成に対応しているときだけ）。
 * resumePending: 止めた・失敗した返答の「続きから読む」が出ている間は、新着通知を読まない（続きの位置を守る）。
 */
export function canSpeak(s: { on: boolean; voice: string; deviceVoice: boolean; resumePending?: boolean }): boolean {
  return s.on && !s.resumePending && (s.voice !== 'browser' || s.deviceVoice)
}
