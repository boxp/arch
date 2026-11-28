/** BOXP-766: 作業中の AI モデルの人形（現行仕様 Projects/kohako-home/model-dolls-home-spec.md）。表示の決まりだけ。 */
export type DollGroup = {
  key: string
  name: string
  version: number
  model: string | null
  plainLabel: string | null
  tickets: { id: string; assignee: string; model: string | null }[]
}
export type TicketDetail = {
  id: string
  title: string | null
  assignee: string | null
  status: string | null
  ticketUpdatedAt: string | null
  latestNoteAt: string | null
  latestNoteSource: string | null
  progress: string | null
  blocker: string | null
  decision: string | null
  readError: string | null
}
export type TicketResult = { state: 'ok'; fetchedAt: string; item: TicketDetail }
type Tasks = { state: string; dolls?: DollGroup[] }
export type DollsState = 'loading' | 'working' | 'none' | 'stale' | 'unavailable'

/** 家に置いてある絵（本人が採用した 9 案）。ここに無い鍵は無地の絵を使う。 */
const art = new Set(['fable', 'opus', 'sonnet', 'terra', 'sol', 'luna', 'astra', 'neon', 'plain'])
export function dollImage(key: string, version: number): string {
  return art.has(key) && Number.isInteger(version) && version === 1
    ? `./kohako/dolls/${key}-v${version}.webp`
    : './kohako/dolls/plain-v1.webp'
}

/** 状態（3 章）と、いま並べる人形・「+N」の数（D5）。 */
export function dollsView(
  status: { tasks: Tasks } | null,
  failed: boolean,
  shape: string,
): { state: DollsState; shown: DollGroup[]; more: number } {
  const limit = shape === 'portrait' ? 3 : 5
  const dolls = status?.tasks.state === 'ok' ? (status.tasks.dolls ?? []) : null
  const state: DollsState = !status
    ? failed
      ? 'unavailable'
      : 'loading'
    : failed
      ? 'stale'
      : !dolls
        ? 'unavailable'
        : dolls.length
          ? 'working'
          : 'none'
  const all = state === 'working' || state === 'stale' ? (dolls ?? []) : []
  return { state, shown: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}

export function ago(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(t)) return '時刻不明'
  const m = Math.floor((now - t) / 60000)
  if (m < 1) return '1分以内'
  if (m < 60) return `${m}分前`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`
}

/** カードに出す文字（T4）。detail は null=取得中、'error'=失敗。値は呼び出し側で textContent にだけ入れる。 */
export function cardOf(
  doll: DollGroup,
  ticket: DollGroup['tickets'][number],
  detail: TicketResult | 'error' | null,
  now: number,
) {
  const item = detail && detail !== 'error' ? detail.item : null
  const model =
    doll.key === 'plain'
      ? `実行モデル ${doll.plainLabel ?? 'モデル未確認'}`
      : ticket.model
        ? `実行モデル（見込み） ${ticket.model}`
        : '実行モデル 未確認（票か CLI の既定で決まります）'
  const situation = [
    ...(item?.blocker ? [`止まり: ${item.blocker}`] : []),
    ...(item?.decision ? [`判断: ${item.decision}`] : []),
  ]
  return {
    name: doll.name,
    note: 'この家だけの非公式の人形',
    assignee: `担当 ${ticket.assignee}`,
    model,
    ticket: item?.title ? `${ticket.id} ${item.title}` : ticket.id,
    noteHead: !detail
      ? '記録を取得中'
      : detail === 'error'
        ? '記録を取得できません'
        : item?.latestNoteAt || item?.progress
          ? `最新の記録 ${ago(item.latestNoteAt, now)}${item.latestNoteSource ? `・${item.latestNoteSource}` : ''}`
          : '最新の記録はありません',
    noteBody: item?.progress ?? '',
    situation,
    fresh: detail && detail !== 'error' ? `取得 ${ago(detail.fetchedAt, now)}` : '',
  }
}
