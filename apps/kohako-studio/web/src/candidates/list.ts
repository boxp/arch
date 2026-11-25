// 試作候補の一覧（/kohako/candidates/index.json）を描画する。値はすべて textContent で入れる。
export type Candidate = {
  id: string
  commit: string
  title: string
  status: string
  statusNote?: string
  date?: string
  created?: string
  pr?: string
  actions?: string[]
  problems?: string[]
  /** 見る画面。home は家の画面（待機中の動きなど、家でしか出ない試作）。指定なしは動作ボタン・会話連動の 2 つ。 */
  page?: string
  /** 実時間の録画（動く画面を開けない端末でも動きを見られるように）。file は ./kohako/candidate-videos/<id>/ の中の mp4。 */
  videos?: { file: string; title: string; note?: string }[]
  built: boolean
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const COMMIT = /^[0-9a-f]{40}$/

/** 形の崩れた項目は捨てる（壊れた一覧で別の候補へ誘導しないため）。 */
export function parseIndex(data: unknown): Candidate[] {
  const list = (data as { candidates?: unknown })?.candidates
  if (!Array.isArray(list)) return []
  return list.filter(
    (c): c is Candidate =>
      !!c &&
      typeof c === 'object' &&
      ID.test((c as Candidate).id) &&
      COMMIT.test((c as Candidate).commit) &&
      typeof (c as Candidate).title === 'string' &&
      typeof (c as Candidate).status === 'string',
  )
}

/** 候補の固定リンク。版ごとに別パスなので JS と素材は候補間で混ざらない。live2d は動作ボタン、studio は会話連動。 */
export const candidateURL = (c: Candidate, page: 'live2d' | 'studio' = 'live2d') =>
  `./candidates/${c.id}/${page}.html?acting=1`
/** 家の画面で見る候補（page: home）の固定リンク。query は候補が読む確認用の指定（例: ?seat=now）。 */
export const candidateHomeURL = (c: Candidate, query = '') => `./candidates/${c.id}/home.html${query}`
/** 候補のカードに出すリンク（文言と行き先）。 */
export const candidateLinks = (c: Candidate): { text: string; href: string }[] =>
  c.page === 'home'
    ? [
        { text: '家の画面で見る', href: candidateHomeURL(c) },
        { text: 'すぐ座るところから見る', href: candidateHomeURL(c, '?seat=now') },
      ]
    : [
        { text: '動作ボタンで操作する', href: candidateURL(c) },
        { text: '会話と連動して見る', href: candidateURL(c, 'studio') },
      ]

const VIDEO = /^[a-z0-9][a-z0-9-]{0,59}\.mp4$/
/** 候補の録画（題・補足・固定パス）。形の崩れたものは捨てる（別のパスや別の種類のファイルへ誘導しない）。 */
export function candidateVideos(c: Candidate): { src: string; title: string; note: string }[] {
  const list: unknown = c.videos
  if (!Array.isArray(list)) return []
  return list
    .filter(
      (v): v is { file: string; title: string; note?: string } =>
        !!v &&
        typeof v === 'object' &&
        typeof v.file === 'string' &&
        VIDEO.test(v.file) &&
        typeof v.title === 'string' &&
        v.title !== '',
    )
    .map((v) => ({
      src: `./kohako/candidate-videos/${c.id}/${v.file}`,
      title: v.title,
      note: typeof v.note === 'string' ? v.note : '',
    }))
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (cls) e.className = cls
  return e
}
// 状態の表示色。本人採用は動作単位（例: 本人採用（制止））なので前方一致で判定する。
export const statusClass = (s: string) =>
  s.startsWith('本人採用')
    ? 'adopted'
    : s.startsWith('独立判定合格')
      ? 'pass'
      : s === '不合格'
        ? 'ng'
        : s === '試作'
          ? 'trial'
          : 'unknown'

/** 新しい試作を先頭に。created（試作 commit の UTC 時刻）の降順、無いものは末尾で元の順を保つ。 */
export const sortNewestFirst = (cs: Candidate[]) =>
  cs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.created ?? '').localeCompare(a.c.created ?? '') || a.i - b.i)
    .map((x) => x.c)

export function renderCandidates(root: HTMLElement, candidates: Candidate[]) {
  root.replaceChildren()
  if (candidates.length === 0) {
    root.append(el('p', '候補がありません'))
    return
  }
  for (const c of sortNewestFirst(candidates)) {
    const card = el('article', undefined, 'card')
    card.id = `candidate-${c.id}`
    card.dataset.candidate = c.id
    const head = el('h2')
    head.append(el('span', c.status, `status status-${statusClass(c.status)}`), document.createTextNode(` ${c.title}`))
    card.append(head, el('p', `ID ${c.id} ／ 版 ${c.commit.slice(0, 8)}${c.date ? ` ／ ${c.date}` : ''}`, 'meta'))
    if (c.statusNote) card.append(el('p', c.statusNote))
    if (c.actions?.length) card.append(el('p', `試した動作: ${c.actions.join('・')}`))
    if (c.problems?.length) {
      const ul = el('ul')
      for (const p of c.problems) ul.append(el('li', p))
      card.append(el('p', '問題点:'), ul)
    }
    const links = el('p', undefined, 'links')
    if (c.built) {
      candidateLinks(c).forEach((link, i) => {
        const a = el('a', link.text, 'card-link')
        a.href = link.href
        links.append(...(i ? [document.createTextNode(' ')] : []), a)
      })
    } else links.append(el('span', 'この配備にはビルドされていません', 'missing'))
    if (c.pr?.startsWith('https://github.com/boxp/arch/pull/')) {
      const a = el('a', 'PR')
      a.href = c.pr
      a.rel = 'noopener'
      links.append(document.createTextNode(' '), a)
    }
    card.append(links)
    // 録画は押すまで本体を読まない（一覧を開いただけで全部の動画を落とさない）。音は無い。
    for (const v of candidateVideos(c)) {
      const fig = el('figure', undefined, 'video'),
        video = el('video')
      video.controls = true
      video.preload = 'metadata'
      video.playsInline = true
      video.muted = true
      video.src = v.src
      fig.append(el('figcaption', `録画: ${v.title}`), video)
      if (v.note) fig.append(el('p', v.note, 'meta'))
      card.append(fig)
    }
    root.append(card)
  }
}
