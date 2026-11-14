export type ActivityStep = { id: string; kind: 'tool'; tool: string; detail?: string; status: 'running' | 'done' | 'failed' | 'interrupted' | 'unconfirmed'; startedAt: number; durationMs?: number }
export type Activity = { steps: ActivityStep[]; writing: boolean; dropped: number }
// コハコの途中発言・ツールの引数・ツールの出力は任意の文字列で、秘密値を伏字規則では見分け切れない（例: mysql -pabc123、URL のパス、引用符内の値）。
// そのため Hermes 由来の自由な文字列は一切公開しない。公開するのは、道具の名前・状態・所要時間と、下の固定一覧に一致したプログラム名だけ（一覧に無いものは何も載せない）。
const PROGRAMS = new Set(['awk', 'bash', 'bb', 'bun', 'cargo', 'cat', 'cd', 'chmod', 'cp', 'curl', 'cut', 'date', 'df', 'diff', 'docker', 'du', 'echo', 'find', 'gh', 'git', 'go', 'grep', 'head', 'helm', 'jq', 'kubectl', 'ln', 'ls', 'make', 'mkdir', 'mv', 'mysql', 'node', 'npm', 'npx', 'pip', 'pnpm', 'ps', 'psql', 'pwd', 'python', 'python3', 'rg', 'rm', 'rsync', 'scp', 'sed', 'sh', 'sort', 'ssh', 'tail', 'tar', 'terraform', 'touch', 'tree', 'uniq', 'unzip', 'uv', 'wc', 'wget', 'which', 'xargs', 'yarn', 'zip'])
export function publicDetail(tool: string, preview: string): string {
  if (tool !== 'terminal') return ''
  const text = preview.trim(), first = text.split(/\s+/)[0] ?? '', name = first.slice(first.lastIndexOf('/') + 1)
  return PROGRAMS.has(name) ? (text === first ? name : `${name} …`) : ''
}
export function createActivity(now: () => number) {
  const steps: ActivityStep[] = [], ids = new Map<string, string>(); let writing = false, dropped = 0, serial = 0
  const add = (step: ActivityStep) => { steps.push(step); if (steps.length > 40) { let i = steps.findIndex(s => s.status !== 'running'); if (i < 0) i = 0; steps.splice(i, 1); dropped++ } }
  const toolName = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : 'tool'
  const callId = (value: unknown) => typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value) ? value : undefined
  return {
    apply(event: unknown) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return
      const e = event as Record<string, unknown>; if (typeof e.event !== 'string') return
      // 途中発言(message.delta / message.interim)の本文は保持も公開もせず、「返答を書いている」ことだけを伝える。
      if (e.event === 'message.delta' && typeof e.delta === 'string') writing = true
      else if (e.event === 'tool.started') {
        writing = false
        const call = callId(e.tool_call_id); if (call && ids.has(call)) return
        const id = `t${++serial}`, tool = toolName(e.tool), detail = typeof e.preview === 'string' ? publicDetail(tool, e.preview) : ''
        if (call) ids.set(call, id)
        add({ id, kind: 'tool', tool, status: 'running', startedAt: now(), ...(detail ? { detail } : {}) })
      } else if (e.event === 'tool.completed') {
        const call = callId(e.tool_call_id), tool = toolName(e.tool), id = call && ids.get(call)
        // 再接続の再生などで、既に完了を反映した呼び出しの完了がもう一度届いても別の手順を作らない。
        if (id && !steps.some(s => s.id === id && s.status === 'running')) return
        let step = steps.find(s => s.id === id && s.status === 'running') ?? steps.find(s => s.tool === tool && s.status === 'running')
        if (!step) { step = { id: `t${++serial}`, kind: 'tool', tool, status: 'running', startedAt: now() }; add(step); if (call) ids.set(call, step.id) }
        step.status = e.error === true ? 'failed' : 'done'
        if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration >= 0 && e.duration * 1000 <= 86400000) step.durationMs = Math.round(e.duration * 1000)
      }
    },
    // completed: run 自体は正常終了したが完了通知を受け取れなかった手順は、中断でも成功でもなく「結果未確認」とする。
    finish(completed = false) { for (const step of steps) if (step.status === 'running') step.status = completed ? 'unconfirmed' : 'interrupted'; writing = false },
    snapshot(): Activity | undefined { return steps.length || writing ? { steps: steps.map(s => ({ ...s })), writing, dropped } : undefined },
  }
}
