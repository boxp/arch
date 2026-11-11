type WindowState = 'ok' | 'near_limit' | 'exhausted' | 'stale' | 'freshness_unknown' | 'expired' | 'not_provided' | 'unobserved' | 'unavailable'
type Window = { name: string; label: string; state: WindowState; usedPercent: number | null; resetsAt: string | null; observedAt: string | null; status: string | null }
type Pool = { id: string; label: string; agents: string[]; windows: Window[]; state?: 'not_provided' | 'not_applicable'; note?: string }
const definitions = [
  { id: 'claude_shared', label: 'Claude共有（Opus/Fable）', agents: ['claude-opus', 'claude-fable', 'fable'], windows: [['shared_5h', '5時間'], ['shared_7d', '7日']] },
  { id: 'claude_fable', label: 'Fable専用上限', agents: ['claude-fable', 'fable'], windows: [['fable_7d', '7日']], note: '共有枠にも同時に掛かります' },
  { id: 'claude_opus', label: 'Opus専用', agents: ['claude-opus'], windows: [], state: 'not_provided' as const, note: '窓ごとの利用率は提供されていません' },
  { id: 'codex_shared', label: 'Codex共有（codex/sol/astra）', agents: ['codex', 'codex-sol', 'codex-sol-xhigh', 'codex-astra'], windows: [['primary', '7日']] },
  { id: 'localllm', label: 'ローカルLLM', agents: ['localllm'], windows: [], state: 'not_applicable' as const }
]
const pools = (state: WindowState): Pool[] => definitions.map(p => ({ ...p, windows: p.windows.map(([name, label]) => ({ name, label, state, usedPercent: null, resetsAt: null, observedAt: null, status: null })) }))
const iso = (n: number | undefined) => n !== undefined && Number.isFinite(n) && Math.abs(n) <= 8640000000000 / 1000 ? new Date(n * 1000).toISOString() : null
const labelsAllowed: Record<string, string[]> = { provider: ['claude', 'codex'], limit: ['five_hour', 'seven_day', 'seven_day_overage_included', 'primary'], name: ['shared_5h', 'shared_7d', 'fable_7d', 'primary'], window: ['5h', '7d'], status: ['allowed', 'allowed_warning', 'rejected'] }
type Sample = { metric: string; labels: Record<string, string>; value: number }
function parseMetrics(text: string): Sample[] {
  const samples: Sample[] = []; let found = false
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim(); if (!s || s.startsWith('#') || !s.startsWith('ai_subscription_')) continue
    const m = /^(ai_subscription_[a-zA-Z0-9_]+)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/.exec(s); if (!m) throw Error('invalid metrics')
    found = true; const labels: Record<string, string> = {}; let valid = true
    if (m[2]) for (const part of m[2].split(',')) { const pair = /^\s*([a-z_]+)="([^"\\]*)"\s*$/.exec(part); if (!pair || !labelsAllowed[pair[1]]?.includes(pair[2]) || pair[1] in labels) { valid = false; break } labels[pair[1]] = pair[2] }
    const value = Number(m[3]); if (valid && Number.isFinite(value)) samples.push({ metric: m[1], labels, value })
  }
  if (!found) throw Error('no subscription metrics')
  return samples
}
export function parseQuota(text: string, now: number) {
  const samples = parseMetrics(text), get = (metric: string, match: Record<string, string> = {}) => samples.find(s => s.metric === `ai_subscription_${metric}` && Object.entries(match).every(([k, v]) => s.labels[k] === v))?.value
  if (get('metrics_file_present') === 0) throw Error('subscription metrics file missing')
  const result = pools('unobserved')
  const keys: Record<string, [string, string]> = { shared_5h: ['claude', 'five_hour'], shared_7d: ['claude', 'seven_day'], fable_7d: ['claude', 'seven_day_overage_included'], primary: ['codex', 'primary'] }
  for (const pool of result) for (const w of pool.windows) {
    const [provider, limit] = keys[w.name], match = { provider, limit, name: w.name }, present = get('window_present', match)
    const series = samples.filter(s => s.metric.startsWith('ai_subscription_window_') && Object.entries(match).every(([k, v]) => s.labels[k] === v))
    const value = get('window_used_percent', match), reset = get('window_resets_at_seconds', match), observed = get('window_observed_timestamp_seconds', match), expired = get('window_expired', match)
    const status = series.find(s => s.metric === 'ai_subscription_window_status' && s.value === 1)?.labels.status ?? null
    w.usedPercent = value ?? null; w.resetsAt = iso(reset); w.observedAt = iso(observed); w.status = status
    w.state = present === 0 ? 'not_provided' : !series.length ? 'unobserved' : expired === 1 || (reset !== undefined && reset * 1000 <= now) ? 'expired' : status === 'rejected' ? 'exhausted' : observed === undefined || !Number.isFinite(observed) ? (value !== undefined || status !== null ? 'freshness_unknown' : 'unobserved') : observed * 1000 < now - 86400000 ? 'stale' : status === 'allowed_warning' || (value !== undefined && value >= 90) ? 'near_limit' : value !== undefined ? 'ok' : 'unobserved'
  }
  const up = (provider: string) => { const n = get('source_up', { provider }); return n === undefined ? null : n === 1 }
  return { state: 'ok' as const, fetchedAt: new Date(now).toISOString(), generatedAt: iso(get('generated_timestamp_seconds')), fileAgeSeconds: get('metrics_file_age_seconds') ?? null, sourceUp: { claude: up('claude'), codex: up('codex') }, pools: result }
}
export function parseBoard(data: unknown, now: number) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid board')
  const x = data as Record<string, unknown>
  if (x.schema !== 'kohako-board/v1' || typeof x.generatedAt !== 'string' || !Number.isFinite(Date.parse(x.generatedAt)) || typeof x.boardUpdatedAt !== 'string' || !Number.isFinite(Date.parse(x.boardUpdatedAt)) || !Number.isInteger(x.total) || !Number.isInteger(x.limit) || typeof x.truncated !== 'boolean' || !Array.isArray(x.items) || x.items.some(i => !i || typeof i !== 'object' || Array.isArray(i) || typeof i.lane !== 'string')) throw Error('invalid board')
  const unique = new Map<string, { assignee: string; conflict: boolean; mismatch: boolean }>()
  for (const item of x.items) {
    if (item.lane !== 'In Progress' || typeof item.id !== 'string' || !/^BOXP-\d+$/.test(item.id)) continue
    const assignee = typeof item.assignee === 'string' && item.assignee.trim() ? item.assignee.trim() : 'unknown', old = unique.get(item.id)
    if (old) { old.conflict ||= old.assignee !== assignee; old.mismatch ||= item.laneStatusMismatch === true } else unique.set(item.id, { assignee, conflict: false, mismatch: item.laneStatusMismatch === true })
  }
  const counts = new Map<string, number>(), conflicts: string[] = []; let mismatch = 0
  for (const [id, item] of unique) { const agent = item.conflict ? 'unknown' : item.assignee; counts.set(agent, (counts.get(agent) ?? 0) + 1); if (item.conflict) conflicts.push(id); if (item.mismatch) mismatch++ }
  return { state: 'ok' as const, fetchedAt: new Date(now).toISOString(), boardUpdatedAt: x.boardUpdatedAt, inProgress: { total: unique.size, complete: !(x.truncated && x.items.every(i => i.lane === 'In Progress')), byAgent: [...counts].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)), conflicts: conflicts.sort(), laneStatusMismatch: mismatch }, ids: [...unique.keys()].sort() }
}
const unavailableQuota = (now: number) => ({ state: 'unavailable' as const, fetchedAt: new Date(now).toISOString(), generatedAt: null, fileAgeSeconds: null, sourceUp: { claude: null, codex: null }, pools: pools('unavailable') })
const unavailableBoard = (now: number) => ({ state: 'unavailable' as const, fetchedAt: new Date(now).toISOString(), boardUpdatedAt: null, inProgress: { total: null, complete: false, byAgent: [], conflicts: [], laneStatusMismatch: null }, ids: [] })
export type StatusPayload = { schema: 'kohako-home-status/v1'; generatedAt: string; quota: ReturnType<typeof parseQuota> | ReturnType<typeof unavailableQuota>; tasks: ReturnType<typeof parseBoard> | ReturnType<typeof unavailableBoard> }
export function createStatus(opts: { fetch: typeof fetch; now: () => number; quotaUrl: string; boardUrl: string }) {
  async function read(url: string) {
    if (!url) throw Error('disabled')
    const response = await opts.fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' }); if (!response.ok || !response.body) throw Error('fetch failed')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) { await reader.cancel(); throw Error('too large') } chunks.push(value) } } finally { reader.releaseLock() }
    return Buffer.concat(chunks).toString('utf8')
  }
  function cache<T extends { state: string }>(load: () => Promise<T>, fallback: () => T) {
    let value: T | undefined, until = 0, pending: Promise<T> | undefined
    return () => { if (value && opts.now() < until) return Promise.resolve(value); if (pending) return pending
      pending = load().catch(fallback).then(v => { value = v; until = opts.now() + (v.state === 'ok' ? 60000 : 15000); return v }).finally(() => { pending = undefined }); return pending }
  }
  const quota = cache<StatusPayload['quota']>(async () => parseQuota(await read(opts.quotaUrl), opts.now()), () => unavailableQuota(opts.now()))
  const board = cache<StatusPayload['tasks']>(async () => parseBoard(JSON.parse(await read(opts.boardUrl)), opts.now()), () => unavailableBoard(opts.now()))
  return { get: async (): Promise<StatusPayload> => { const [q, tasks] = await Promise.all([quota(), board()]); return { schema: 'kohako-home-status/v1', generatedAt: new Date(opts.now()).toISOString(), quota: q, tasks } } }
}
