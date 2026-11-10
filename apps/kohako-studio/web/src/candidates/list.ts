// 試作候補の一覧（/kohako/candidates/index.json）を描画する。値はすべて textContent で入れる。
export type Candidate = { id: string, commit: string, title: string, status: string, statusNote?: string, date?: string, pr?: string, actions?: string[], problems?: string[], built: boolean }

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const COMMIT = /^[0-9a-f]{40}$/

/** 形の崩れた項目は捨てる（壊れた一覧で別の候補へ誘導しないため）。 */
export function parseIndex(data: unknown): Candidate[] {
  const list = (data as { candidates?: unknown })?.candidates
  if (!Array.isArray(list)) return []
  return list.filter((c): c is Candidate => !!c && typeof c === 'object' && ID.test((c as Candidate).id) && COMMIT.test((c as Candidate).commit) && typeof (c as Candidate).title === 'string' && typeof (c as Candidate).status === 'string')
}

/** 候補の固定リンク。版ごとに別パスなので JS と素材は候補間で混ざらない。live2d は動作ボタン、studio は会話連動。 */
export const candidateURL = (c: Candidate, page: 'live2d' | 'studio' = 'live2d') => `./candidates/${c.id}/${page}.html?acting=1`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e }
// 状態の表示色。本人採用は動作単位（例: 本人採用（制止））なので前方一致で判定する。
export const statusClass = (s: string) => s.startsWith('本人採用') ? 'adopted' : s === '不合格' ? 'ng' : s === '試作' ? 'trial' : 'unknown'

export function renderCandidates(root: HTMLElement, candidates: Candidate[]) {
  root.replaceChildren()
  if (candidates.length === 0) { root.append(el('p', '候補がありません')); return }
  // 新しい試作を上に。同じ日付は一覧の後ろ（後から追加した方）を上にする。
  for (const c of [...candidates].reverse()) {
    const card = el('article', undefined, 'card'); card.id = `candidate-${c.id}`; card.dataset.candidate = c.id
    const head = el('h2'); head.append(el('span', c.status, `status status-${statusClass(c.status)}`), document.createTextNode(` ${c.title}`))
    card.append(head, el('p', `ID ${c.id} ／ 版 ${c.commit.slice(0, 8)}${c.date ? ` ／ ${c.date}` : ''}`, 'meta'))
    if (c.statusNote) card.append(el('p', c.statusNote))
    if (c.actions?.length) card.append(el('p', `試した動作: ${c.actions.join('・')}`))
    if (c.problems?.length) { const ul = el('ul'); for (const p of c.problems) ul.append(el('li', p)); card.append(el('p', '問題点:'), ul) }
    const links = el('p', undefined, 'links')
    if (c.built) { const a = el('a', '動作ボタンで操作する', 'card-link'); a.href = candidateURL(c); const b = el('a', '会話と連動して見る', 'card-link'); b.href = candidateURL(c, 'studio'); links.append(a, document.createTextNode(' '), b) }
    else links.append(el('span', 'この配備にはビルドされていません', 'missing'))
    if (c.pr?.startsWith('https://github.com/boxp/arch/pull/')) { const a = el('a', 'PR'); a.href = c.pr; a.rel = 'noopener'; links.append(document.createTextNode(' '), a) }
    card.append(links)
    root.append(card)
  }
}
