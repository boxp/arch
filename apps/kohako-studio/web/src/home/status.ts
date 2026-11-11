export type Window = { name: string; label: string; state: string; usedPercent: number | null; resetsAt: string | null; observedAt: string | null; status: string | null }
export type Pool = { id: string; label: string; windows: Window[]; state?: string; note?: string }
export type Tasks = { state: string; inProgress: { total: number | null; complete: boolean; byAgent: { agent: string; count: number }[]; conflicts: string[] } }
export type Status = { schema: string; generatedAt: string; quota: { state: string; pools: Pool[] }; tasks: Tasks }
const states: Record<string, string> = { ok: '正常', near_limit: '上限間近', exhausted: '上限到達', stale: '古い情報', freshness_unknown: '観測時刻不明', expired: 'リセット後未観測', not_provided: '未提供', unobserved: '不明', not_applicable: '対象外', unavailable: '取得できません' }
const time = (s: string) => new Date(s).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
export function relativeTime(s: string, now = Date.now()) { const ms = new Date(s).getTime() - now; if (ms <= 0) return '経過'; const hours = Math.ceil(ms / 3600000); return hours >= 24 ? `あと${Math.ceil(hours / 24)}日` : `あと${hours}時間` }
export function formatPool(pool: Pool, now = Date.now()): string {
  const windows = pool.windows.map(w => `${w.label} ${w.usedPercent === null ? '—' : `${w.usedPercent}%`}（${states[w.state] ?? '不明'}）${w.resetsAt ? `・リセット ${new Date(w.resetsAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}（${relativeTime(w.resetsAt, now)}）` : ''}${w.observedAt ? `・観測 ${time(w.observedAt)}` : ''}`)
  return [pool.label, ...windows, ...(pool.state ? [states[pool.state] ?? '不明'] : []), ...(pool.note ? [pool.note] : [])].join(' ')
}
export function formatTasks(tasks: Tasks): string {
  if (tasks.state !== 'ok') return '進行中 取得できません'
  const t = tasks.inProgress, detail = t.byAgent.map(x => `${x.agent} ${x.count}`).join('・')
  return `進行中 ${t.total}件${t.complete ? '' : '以上（全件は不明）'}${detail ? `（${detail}）` : ''}${t.conflicts.length ? '・整合不明あり' : ''}`
}
export function summaryLine(status: Status): string {
  const percent = (id: string) => { const p = status.quota.pools.find(x => x.id === id); const ws = p?.windows.filter(w => w.usedPercent !== null && !['unavailable', 'unobserved', 'not_provided'].includes(w.state)) ?? []; if (!ws.length) return '不明'; const top = ws.reduce((a, b) => (b.usedPercent as number) > (a.usedPercent as number) ? b : a); return `${top.usedPercent}%${['stale', 'expired'].includes(top.state) ? '（古い）' : top.state === 'freshness_unknown' ? '（時刻不明）' : ''}` }
  return `Claude ${percent('claude_shared')}・Codex ${percent('codex_shared')}・${status.tasks.state === 'ok' ? `進行中 ${status.tasks.inProgress.total}件${status.tasks.inProgress.complete ? '' : '以上'}` : '進行中 不明'}`
}
