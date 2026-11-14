export type Window = { name: string; label: string; state: string; usedPercent: number | null; resetsAt: string | null; observedAt: string | null; status: string | null }
export type Pool = { id: string; label: string; windows: Window[]; state?: string; note?: string }
export type Tasks = { state: string; inProgress: { total: number | null; complete: boolean; byAgent: { agent: string; count: number }[]; conflicts: string[] } }
export type Status = { schema: string; generatedAt: string; quota: { state: string; pools: Pool[] }; tasks: Tasks }
export const states: Record<string, string> = { ok: '正常', near_limit: '上限間近', exhausted: '上限到達', stale: '古い情報', freshness_unknown: '観測時刻不明', expired: 'リセット後未観測', not_provided: '未提供', unobserved: '不明', not_applicable: '対象外', unavailable: '取得できません' }
const time = (s: string) => new Date(s).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
/** 使用率（0〜100 の百分率）を表示用に小数1桁へ丸める。exporter の 0.07*100=7.000000000000001 のような浮動小数誤差を出さない。欠測は 0% にせず — を返す。 */
export function formatPercent(v: number | null | undefined): string { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const r = Math.round(v * 10) / 10; return `${Object.is(r, -0) ? 0 : r}%` }
export function relativeTime(s: string, now = Date.now()) { const ms = new Date(s).getTime() - now; if (ms <= 0) return '経過'; const hours = Math.ceil(ms / 3600000); return hours >= 24 ? `あと${Math.ceil(hours / 24)}日` : `あと${hours}時間` }
export function formatPool(pool: Pool, now = Date.now()): string {
  const windows = pool.windows.map(w => `${w.label} ${formatPercent(w.usedPercent)}（${states[w.state] ?? '不明'}）${w.resetsAt ? `・リセット ${new Date(w.resetsAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}（${relativeTime(w.resetsAt, now)}）` : ''}${w.observedAt ? `・観測 ${time(w.observedAt)}` : ''}`)
  return [pool.label, ...windows, ...(pool.state ? [states[pool.state] ?? '不明'] : []), ...(pool.note ? [pool.note] : [])].join(' ')
}
export function formatTasks(tasks: Tasks): string {
  if (tasks.state !== 'ok') return '進行中 取得できません'
  const t = tasks.inProgress, detail = t.byAgent.map(x => `${x.agent} ${x.count}`).join('・')
  return `進行中 ${t.total}件${t.complete ? '' : '以上（全件は不明）'}${detail ? `（${detail}）` : ''}${t.conflicts.length ? '・整合不明あり' : ''}`
}
export function summaryLine(status: Status): string {
  const percent = (id: string) => { const p = status.quota.pools.find(x => x.id === id); const ws = p?.windows.filter(w => w.usedPercent !== null && !['unavailable', 'unobserved', 'not_provided'].includes(w.state)) ?? []; if (!ws.length) return '不明'; const top = ws.reduce((a, b) => (b.usedPercent as number) > (a.usedPercent as number) ? b : a); return `${formatPercent(top.usedPercent)}${['stale', 'expired'].includes(top.state) ? '（古い）' : top.state === 'freshness_unknown' ? '（時刻不明）' : ''}` }
  return `Claude ${percent('claude_shared')}・Codex ${percent('codex_shared')}・${status.tasks.state === 'ok' ? `進行中 ${status.tasks.inProgress.total}件${status.tasks.inProgress.complete ? '' : '以上'}` : '進行中 不明'}`
}
/** BFF は上流の取得失敗も HTTP 200 の unavailable で返すため、どちらかが取れていなければ再取得を間引く対象にする。 */
export function upstreamUnavailable(status: Status): boolean { return status.quota.state === 'unavailable' || status.tasks.state === 'unavailable' }

// 表示できる窓のうち、最も使用率の高いものを選ぶ。
export function gaugeOf(pool?: Pool) {
  const ws = pool?.windows.filter(w => w.usedPercent !== null && Number.isFinite(w.usedPercent) && !['unavailable', 'unobserved', 'not_provided'].includes(w.state)) ?? []
  if (!ws.length) return { percent: null, label: '', stateText: pool?.state === 'unavailable' || pool?.windows.some(w => w.state === 'unavailable') ? '取得できません' : '不明', cls: 'unknown' }
  const w = ws.reduce((a, b) => b.usedPercent! > a.usedPercent! ? b : a), cls = ['stale', 'expired'].includes(w.state) ? 'stale' : ['near_limit', 'exhausted', 'freshness_unknown'].includes(w.state) ? w.state : 'ok'
  return { percent: w.usedPercent, label: w.label, stateText: ({ stale: '古い', near_limit: '上限間近', exhausted: '上限到達', freshness_unknown: '時刻不明', ok: '正常' } as Record<string, string>)[cls], cls }
}
export function taskBadgeOf(tasks?: Tasks) {
  if (!tasks || tasks.state !== 'ok' || tasks.inProgress.total === null) return { total: null, suffix: '', stateText: '取得できません', agents: [] as Tasks['inProgress']['byAgent'] }
  const t = tasks.inProgress; return { total: t.total, suffix: t.complete ? '' : '以上', stateText: t.conflicts.length ? '整合不明' : '', agents: t.byAgent }
}
