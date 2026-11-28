/** BOXP-766: 人形の列と、押した時のカード（現行仕様 Projects/kohako-home/model-dolls-home-spec.md）。 */
import './dolls.css'
import { cardOf, dollImage, dollsKey, dollsView, type DollGroup, type TicketResult } from './dolls'
type Call = (path: string) => Promise<{ status: number; data: Record<string, unknown> | null }>
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
const shortName = (d: DollGroup) => (d.key === 'plain' ? (d.plainLabel ?? '無地') : d.name.replace(/の人形$/, ''))

export function createDolls(opts: { host: HTMLElement; card: HTMLElement; call: Call }) {
  const { host, card } = opts
  let last: { tasks: { state: string; dolls?: DollGroup[] } } | null = null,
    failed = false,
    open: { doll: DollGroup; index: number } | 'list' | null = null,
    detail: TicketResult | 'error' | null = null,
    seq = 0,
    shownKey = ''

  function render() {
    const v = dollsView(last, failed, document.body.dataset.shape ?? 'pc')
    // 同じ中身なら作り直さない（60 秒ごとの取得で絵を読み直したり、押している最中に消したりしない）。
    const key = dollsKey(v)
    if (key === shownKey) return
    shownKey = key
    // 開いているカードの人形も新しい中身へ差し替える（無くなった票・人形のカードは閉じる）。
    if (open && open !== 'list') {
      const cur = open
      const fresh = (last?.tasks.dolls ?? []).find(
        (d) => d.key === cur.doll.key && d.plainLabel === cur.doll.plainLabel,
      )
      const i = fresh ? fresh.tickets.findIndex((t) => t.id === cur.doll.tickets[cur.index]?.id) : -1
      if (fresh && i >= 0) {
        open = { doll: fresh, index: i }
        renderCard()
      } else hide()
    }
    host.replaceChildren()
    host.dataset.state = v.state
    if (v.state === 'unavailable') host.append(make('span', 'doll-tag', '人形：確認できません'))
    if (v.state === 'stale' && v.shown.length) host.append(make('span', 'doll-tag', '古い情報'))
    for (const d of v.shown) {
      const b = make('button', 'doll')
      b.type = 'button'
      b.dataset.doll = d.key
      b.setAttribute('aria-label', `${d.name}（${shortName(d)}・${d.tickets.length}件）の記録を見る`)
      const img = make('img', 'doll-img')
      img.src = dollImage(d.key, d.version)
      img.alt = ''
      img.width = 56
      img.height = 75
      img.decoding = 'async'
      img.draggable = false
      b.append(img, make('span', 'doll-name', shortName(d)))
      if (d.tickets.length > 1) b.append(make('span', 'doll-count', String(d.tickets.length)))
      b.addEventListener('click', () => void show(d, 0))
      host.append(b)
    }
    if (v.more) {
      const b = make('button', 'doll doll-more', `+${v.more}`)
      b.type = 'button'
      b.setAttribute('aria-label', `ほかの人形 ${v.more} 体を一覧で見る`)
      b.addEventListener('click', () => {
        open = 'list'
        renderCard()
      })
      host.append(b)
    }
  }

  async function show(doll: DollGroup, index: number) {
    open = { doll, index }
    detail = null
    const mine = ++seq
    renderCard()
    let result: TicketResult | 'error' = 'error'
    try {
      const r = await opts.call(`status/tickets/${encodeURIComponent(doll.tickets[index].id)}`)
      if (r.status === 200 && r.data?.state === 'ok') result = r.data as unknown as TicketResult
    } catch {
      /* 失敗はカードに書くだけで繰り返さない（T6） */
    }
    if (mine !== seq) return
    detail = result
    renderCard()
  }

  function renderCard() {
    if (!open) {
      card.hidden = true
      card.replaceChildren()
      return
    }
    const body = make('div', 'doll-card-body'),
      close = make('button', 'doll-close ghost', '×')
    close.type = 'button'
    close.setAttribute('aria-label', '閉じる')
    close.addEventListener('click', hide)
    if (open === 'list') {
      body.append(make('strong', 'doll-card-name', '作業中の人形'))
      const list = make('div', 'doll-list')
      for (const d of (last?.tasks.dolls ?? []) as DollGroup[]) {
        const b = make(
          'button',
          'secondary',
          `${d.name}${d.key === 'plain' ? `（${d.plainLabel}）` : ''}・${d.tickets.length}件`,
        )
        b.type = 'button'
        b.addEventListener('click', () => void show(d, 0))
        list.append(b)
      }
      body.append(list)
    } else {
      const { doll, index } = open,
        c = cardOf(doll, doll.tickets[index], detail, Date.now())
      const head = make('div', 'doll-card-head'),
        img = make('img', 'doll-card-img')
      img.src = dollImage(doll.key, doll.version)
      img.alt = ''
      const names = make('div', 'doll-card-names')
      names.append(make('strong', 'doll-card-name', c.name))
      head.append(img, names)
      body.append(head)
      if (doll.tickets.length > 1) {
        const tabs = make('div', 'doll-tabs')
        doll.tickets.forEach((t, i) => {
          const b = make('button', i === index ? 'doll-tab is-current' : 'doll-tab', t.id)
          b.type = 'button'
          b.setAttribute('aria-pressed', String(i === index))
          b.addEventListener('click', () => void show(doll, i))
          tabs.append(b)
        })
        body.append(tabs)
      }
      body.append(
        make('p', 'doll-line', c.assignee),
        make('p', 'doll-line', c.model),
        make('p', 'doll-ticket', c.ticket),
        make('p', 'doll-note-head muted', c.noteHead),
      )
      if (c.noteBody) body.append(make('p', 'doll-note', c.noteBody))
      for (const s of c.situation) body.append(make('p', 'doll-situation', s))
      if (c.fresh) body.append(make('p', 'doll-fresh muted', c.fresh))
    }
    card.replaceChildren(close, body)
    card.hidden = false
  }

  function hide() {
    if (!open) return
    open = null
    seq++
    renderCard()
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide()
  })
  // 外側を押したら閉じる（人形の列を押した時は、その人形のカードへ切り替える）。
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node | null
    if (open && t && !card.contains(t) && !host.contains(t)) hide()
  })
  // 画面の形（PC・スマホ縦・横）が変わったら、並べる数（5 体・3 体）を引き直す。
  new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['data-shape'] })
  return {
    update(status: { tasks: { state: string; dolls?: DollGroup[] } } | null, isFailed: boolean) {
      last = status
      failed = isFailed
      render()
    },
    hide,
  }
}
