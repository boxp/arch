export type ActivityStep = { id: string; kind: 'tool'; tool: string; detail?: string; status: 'running' | 'done' | 'failed' | 'interrupted' | 'unconfirmed'; startedAt: number; durationMs?: number; result?: string } | { id: string; kind: 'note'; text: string; at: number }
export type Activity = { steps: ActivityStep[]; writing: boolean; dropped: number }
// 資格情報の値: 引用符つき（エスケープ済み含む・閉じ忘れは末尾まで）は中の空白ごと 1 つの値として扱う。
const QUOTED = String.raw`\\+["'][\s\S]*?(?:\\+["']|$)|"(?:[^"\\]|\\[\s\S])*(?:"|$)|'(?:[^'\\]|\\[\s\S])*(?:'|$)`
const VALUE = `(?:${QUOTED}|\\[[^\\]]*(?:\\]|$)|\\{[^}]*(?:\\}|$)|[^\\s,;}\\]]+)`
const LOOSE_VALUE = `(?:${QUOTED}|\\S+)`
export function redactPublic(text: string): string {
  return text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*/gi, '<secret>')
    .replace(/\b(?:authorization|cookie|x-api-key)\s*:[^\r\n]*/gi, '<secret>')
    // 値の書き方（引用符・空白・シェルの $'…'・バッククォート等）を列挙し切れないため、資格情報らしい語が出たらそれ以降を末尾まで丸ごと伏せる（値が次の行へ続く場合も含めた安全側）。
    .replace(/[A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|passphrase|credential|authorization|cookie|bearer|api[_-]?key|sshpass)[\s\S]*/gi, '<secret>')
    .replace(/[A-Za-z0-9_.-]*key[A-Za-z0-9_.-]*(?:["'\\]*\s*[:=]|(?:\s|\\[nrt])*(?:\$?["'`]|\\+["']))[\s\S]*/gi, '<secret>')
    .replace(/(?<![A-Za-z0-9-])-p\s*(?:\$?["'`]|\\+["'])[\s\S]*/g, '<secret>')
    // 名前に資格情報らしい語を含む項目は、JSON・引用符つき・エスケープ済みの形でも値ごと伏せる（例: {"api_key":"…"}）。
    .replace(new RegExp(String.raw`(?:\\*["'])?[A-Za-z0-9_.-]*(?:token|key|secret|passw(?:or)?d|passphrase|credential|authorization|cookie)[A-Za-z0-9_.-]*(?:\\*["'])?\s*[:=]\s*` + VALUE, 'gi'), '<secret>')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1<secret>@')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?…')
    // コマンドの引数は、値が引用符で囲まれ空白を含んでも（例: --password ' abc'）閉じ引用符まで値ごと伏せる。
    .replace(new RegExp(String.raw`--?[A-Za-z0-9-]*(?:passw(?:or)?d|passphrase|token|key|secret|credential|auth)[A-Za-z0-9-]*(?:=|\s+)` + LOOSE_VALUE, 'gi'), '<secret>')
    .replace(new RegExp(String.raw`(?<![A-Za-z0-9-])(?:-u|--user)(?:=|\s+)` + `(?:${QUOTED}|\\S+:\\S+)`, 'g'), '<secret>')
    .replace(/\b(?=[A-Za-z_][A-Za-z0-9_]*=)(?=[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?))[A-Za-z_][A-Za-z0-9_]*=\S+/gi, '<secret>')
    .replace(/\b(?:sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_-]+/g, '<secret>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<secret>')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(new RegExp(String.raw`\b(?:token|key|secret|passw(?:or)?d|passphrase|bearer)\b(?!>)\s*[:=]?\s*` + LOOSE_VALUE, 'gi'), '<secret>')
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
    // completed: run 自体は正常終了したが完了通知を受け取れなかった手順は、中断でも成功でもなく「結果未確認」とする。
    finish(completed = false) { for (const step of steps) if (step.kind === 'tool' && step.status === 'running') step.status = completed ? 'unconfirmed' : 'interrupted'; writing = false; buffer = '' },
    snapshot(): Activity | undefined { return steps.length || writing ? { steps: steps.map(s => ({ ...s })), writing, dropped } : undefined },
  }
}
