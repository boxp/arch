/**
 * BOXP-766: 作業中の AI モデルを表す人形（現行仕様 Projects/kohako-home/model-dolls-home-spec.md）。
 * 担当名 → 実行モデル（見込み）→ 系列 → 人形の鍵。絵が採用されていない系列・分からないモデルは無地（plain）。
 */

/** 本人が採用した絵がある系列（BOXP-760 の初稿 9 案）。表示の順もこの順。新しい絵は採用後にここへ足す。 */
export const designs: Record<string, { name: string; version: number }> = {
  fable: { name: '語り部の人形', version: 1 },
  opus: { name: '楽長の人形', version: 1 },
  sonnet: { name: '歌詠みの人形', version: 1 },
  terra: { name: '庭師の人形', version: 1 },
  sol: { name: '灯守りの人形', version: 1 },
  luna: { name: '月見の人形', version: 1 },
  astra: { name: '星見の人形', version: 1 },
  neon: { name: '灯り細工の人形', version: 1 },
}
export const plain = { name: '無地の人形', version: 1 }
export const order = [...Object.keys(designs), 'plain']

/**
 * 担当名 → 実行モデル（見込み）。docker/codex-workspace/model-catalog.edn の roles と
 * task_board_runner.bb の codex 表を写したもの（verify/home/check-dolls.sh が食い違いを検査する）。
 * model が null の担当は、実行モデルが票や CLI の既定で決まり、担当名からは決められないもの。
 */
export const roles: Record<string, { model: string | null; family?: string }> = {
  'claude-fable': { model: 'claude-fable-5-2' },
  fable: { model: 'claude-fable-5-2' },
  'claude-opus': { model: 'claude-opus-5-5' },
  'claude-sonnet': { model: 'claude-sonnet-5-5' },
  codex: { model: 'gpt-6.1-terra' },
  'codex-terra': { model: 'gpt-6.1-terra' },
  'codex-sol': { model: 'gpt-6.1-sol' },
  'codex-full': { model: 'gpt-6.1-sol' },
  'codex-mini': { model: 'gpt-5.6-luna' },
  'codex-astra': { model: 'gpt-6-astra' },
  // 実行モデルは票の指定か CLI の既定（agy-default）で決まる。ほとんどが Gemini 4 Neon なので絵は neon を使う。
  antigravity: { model: null, family: 'neon' },
  localllm: { model: null },
}
/** 人形にしない担当（本人・未割り当て）。 */
const humans = new Set(['boxp', 'unknown', ''])
const effort = /-(?:minimal|low|medium|high|xhigh|max)$/

/** 実行モデル名から系列を取る。版上げ（claude-fable-5-3）や推論段の違い（gemini-4-neon-xhigh）は同じ系列。 */
export function familyOf(model: string): string | null {
  const m =
    /^claude-([a-z]+)-\d/.exec(model) ??
    /^gpt-[\d.]+-([a-z]+)$/.exec(model) ??
    /^gemini-[\d.]+-([a-z]+)(?:-|$)/.exec(model)
  return m ? m[1] : null
}

export type Doll = {
  key: string
  name: string
  version: number
  /** 実行モデル（見込み）。分からない時は null。 */
  model: string | null
  /** 無地の札に出す名前（実名、分からなければ「モデル未確認」）。絵のある人形では null。 */
  plainLabel: string | null
}

/** 担当名 1 つの人形。人形にしない担当は null。 */
export function dollOf(assignee: string): Doll | null {
  const raw = assignee.trim()
  if (humans.has(raw)) return null
  const base = roles[raw] ? raw : raw.replace(effort, '')
  const role = roles[base]
  const model = role ? role.model : null
  const family = role?.family ?? (model ? familyOf(model) : (/^claude-([a-z]+)$/.exec(base)?.[1] ?? null))
  if (family && designs[family]) return { key: family, ...designs[family], model, plainLabel: null }
  const label = model ?? (/^claude-[a-z]+$/.test(base) ? `${base} 系` : role ? base : 'モデル未確認')
  return { key: 'plain', ...plain, model, plainLabel: label }
}

export type DollGroup = Doll & { tickets: { id: string; assignee: string; model: string | null }[] }

/**
 * In Progress の票（番号と担当名）を人形ごとにまとめる。無地は札（実名）ごとに分ける。
 * 並びは件数の多い順、同数は designs の順、無地どうしは札の順。
 */
export function groupDolls(tickets: { id: string; assignee: string }[]): DollGroup[] {
  const groups = new Map<string, DollGroup>()
  for (const t of [...tickets].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    const doll = dollOf(t.assignee)
    if (!doll) continue
    const id = doll.key === 'plain' ? `plain:${doll.plainLabel}` : doll.key
    const g = groups.get(id) ?? { ...doll, tickets: [] }
    g.tickets.push({ id: t.id, assignee: t.assignee, model: doll.model })
    groups.set(id, g)
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.tickets.length - a.tickets.length ||
      order.indexOf(a.key) - order.indexOf(b.key) ||
      String(a.plainLabel).localeCompare(String(b.plainLabel)),
  )
}
