// 人形の絵の一覧・個別・小さい表示を描く。値はすべて textContent で入れ、通信はしない（絵の読み込みだけ）。
import { cardLines, checkDolls, type Doll, imageURL, latest, newestFirst, tagOf } from './data'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (cls) e.className = cls
  return e
}
const picture = (d: Doll, tag: string, cls: string, lazy = true) => {
  const img = el('img', undefined, cls)
  img.src = imageURL(tag)
  img.alt = `${d.name}（${tag}）`
  if (lazy) img.loading = 'lazy'
  img.decoding = 'async'
  return img
}
const row = (dl: HTMLElement, k: string, v: string) => dl.append(el('dt', k), el('dd', v))

/** 一覧: 9 体の最新の版。札を押すと個別の欄へ。 */
export function renderGrid(root: HTMLElement, dolls: Doll[]) {
  root.replaceChildren()
  for (const d of dolls) {
    const lines = cardLines(d)
    const a = el('a', undefined, 'doll-card')
    a.href = `#${tagOf(d, latest(d))}`
    a.append(
      picture(d, tagOf(d, latest(d)), 'doll-thumb'),
      el('strong', lines.name),
      el('span', lines.who, 'who'),
      el('span', lines.tag, 'tag'),
    )
    root.append(a)
  }
}

/** 個別: 人形ごとに全部の版を新しい順に。版の札がそのまま目印（#fable-v1）。 */
export function renderDetails(root: HTMLElement, dolls: Doll[]) {
  root.replaceChildren()
  for (const d of dolls) {
    const sec = el('section', undefined, 'doll')
    sec.append(el('h3', d.name))
    const dl = el('dl')
    row(dl, '担当名', d.assignee)
    row(dl, '実行モデル', d.model)
    row(dl, '由来', d.origin)
    row(dl, '持ち物・形', d.item)
    row(dl, '主色', d.colors)
    sec.append(dl)
    const top = latest(d)
    for (const v of newestFirst(d)) {
      const tag = tagOf(d, v)
      const fig = el('figure', undefined, 'version')
      fig.id = tag
      const open = el('a')
      open.href = imageURL(tag)
      open.append(picture(d, tag, 'doll-large'))
      const cap = el('figcaption')
      cap.append(
        el('span', tag, 'tag'),
        document.createTextNode(
          ` ${v.stage}${v === top && d.versions.length > 1 ? '・最新' : ''}（絵を押すと原寸で開きます）`,
        ),
      )
      fig.append(cap, open)
      if (v.notes?.length) {
        const ul = el('ul')
        for (const n of v.notes) ul.append(el('li', n))
        fig.append(el('p', '担当が絵を見て気づいた点（採否ではありません）:', 'meta'), ul)
      }
      sec.append(fig)
    }
    root.append(sec)
  }
}

/** 小さい表示: 家に置く時の大きさ（幅 56px・高さ 88px の枠）。色ありと白黒の 2 段。 */
export function renderSmall(root: HTMLElement, dolls: Doll[]) {
  root.replaceChildren()
  for (const [title, cls] of [
    ['色あり', 'strip'],
    ['白黒（色を消したもの）', 'strip gray'],
  ] as const) {
    const strip = el('div', undefined, cls)
    for (const d of dolls) {
      const cell = el('span', undefined, 'small-cell')
      cell.append(picture(d, tagOf(d, latest(d)), 'doll-small', false), el('span', d.key, 'small-key'))
      strip.append(cell)
    }
    root.append(el('p', title, 'meta'), strip)
  }
}

export function render(grid: HTMLElement, details: HTMLElement, small: HTMLElement, dolls: Doll[]) {
  const problems = checkDolls(dolls)
  if (problems.length) {
    grid.replaceChildren(el('p', `データが崩れています: ${problems.join(' ／ ')}`, 'missing'))
    return
  }
  renderGrid(grid, dolls)
  renderDetails(details, dolls)
  renderSmall(small, dolls)
}
