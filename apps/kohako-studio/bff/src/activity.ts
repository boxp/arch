export type ActivityStep = { id: string; kind: 'tool'; tool: string; detail?: string; status: 'running' | 'done' | 'failed' | 'interrupted'; startedAt: number; durationMs?: number; result?: string } | { id: string; kind: 'note'; text: string; at: number }
export type Activity = { steps: ActivityStep[]; writing: boolean; dropped: number }
export function redactPublic(text: string): string {
  return text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*/gi, '<secret>')
    .replace(/\b(?:authorization|cookie|x-api-key)\s*:[^\r\n]*/gi, '<secret>')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1<secret>@')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?…')
    .replace(/--(?:password|token|api-key|secret)(?:=|\s+)\S+/gi, '<secret>')
    .replace(/\b(?=[A-Za-z_][A-Za-z0-9_]*=)(?=[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?))[A-Za-z_][A-Za-z0-9_]*=\S+/gi, '<secret>')
    .replace(/\b(?:sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_-]+/g, '<secret>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<secret>')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\b(?:token|key|secret|password|bearer)\b\s*[:=]?\s*\S+/gi, '<secret>')
    .split(/(\s+)/).map(word => (/^[A-Za-z0-9_\-+=]{32,}$/.test(word) || (/^[A-Za-z0-9_\-+/=]{40,}$/.test(word) && !/^\.{0,2}\//.test(word) && !word.includes('//')) ? '<secret>' : word)).join('').trim()
}
const clean = (s: string, limit: number) => { const x = redactPublic(s).replace(/\s+/g, ' ').trim(); return x.length > limit ? x.slice(0, limit) + '…' : x }
export function createActivity(now: () => number) {
  const steps: ActivityStep[] = [], ids = new Map<string, string>(); let writing = false, dropped = 0, buffer = '', serial = 0
  const add = (step: ActivityStep) => { steps.push(step); if (steps.length > 40) { let i = steps.findIndex(s => s.kind !== 'tool' || s.status !== 'running'); if (i < 0) i = 0; steps.splice(i, 1); dropped++ } }
  const note = (text: string) => { const value = clean(text.replace(/```[\s\S]*?(?:```|$)/g, ''), 400); const last = steps[steps.length - 1]; if (value && !(last?.kind === 'note' && last.text === value)) add({ id: `n${++serial}`, kind: 'note', text: value, at: now() }) }
  const toolName = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : 'tool'
  const callId = (value: unknown) => typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value) ? value : undefined
  return {
    apply(event: unknown) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return
      const e = event as Record<string, unknown>; if (typeof e.event !== 'string') return
      if (e.event === 'message.delta' && typeof e.delta === 'string') { buffer = (buffer + e.delta).slice(-4000); writing = true }
      else if (e.event === 'message.interim' && typeof e.text === 'string') note(e.text)
      else if (e.event === 'tool.started') {
        note(buffer); buffer = ''; writing = false
        const call = callId(e.tool_call_id); if (call && ids.has(call)) return
        const id = `t${++serial}`, detail = typeof e.preview === 'string' ? clean(e.preview, 160) : ''
        if (call) ids.set(call, id)
        add({ id, kind: 'tool', tool: toolName(e.tool), status: 'running', startedAt: now(), ...(detail ? { detail } : {}) })
      } else if (e.event === 'tool.completed') {
        const call = callId(e.tool_call_id), tool = toolName(e.tool), id = call && ids.get(call)
        // 再接続の再生などで、既に完了を反映した呼び出しの完了がもう一度届いても別の手順を作らない。
        if (id && !steps.some(s => s.kind === 'tool' && s.id === id && s.status === 'running')) return
        let step = steps.find((s): s is Extract<ActivityStep, {kind:'tool'}> => s.kind === 'tool' && s.id === id && s.status === 'running') ?? steps.find((s): s is Extract<ActivityStep, {kind:'tool'}> => s.kind === 'tool' && s.tool === tool && s.status === 'running')
        if (!step) { step = { id: `t${++serial}`, kind: 'tool', tool, status: 'running', startedAt: now() }; add(step); if (call) ids.set(call, step.id) }
        step.status = e.error === true ? 'failed' : 'done'
        if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration >= 0 && e.duration * 1000 <= 86400000) step.durationMs = Math.round(e.duration * 1000)
        const result = typeof e.preview === 'string' ? clean(e.preview, 200) : ''; if (result) step.result = result
      }
    },
    finish() { for (const step of steps) if (step.kind === 'tool' && step.status === 'running') step.status = 'interrupted'; writing = false; buffer = '' },
    snapshot(): Activity | undefined { return steps.length || writing ? { steps: steps.map(s => ({ ...s })), writing, dropped } : undefined },
  }
}
