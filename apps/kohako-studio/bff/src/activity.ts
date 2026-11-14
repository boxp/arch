export type ActivityStep = { id: string; kind: 'tool'; tool: string; detail?: string; status: 'running' | 'done' | 'failed' | 'interrupted' | 'unconfirmed'; startedAt: number; durationMs?: number; runningMs?: number; startMissing?: true }
export type Activity = { steps: ActivityStep[]; writing: boolean; dropped: number }
// コハコの途中発言・ツールの引数・ツールの出力は任意の文字列で、秘密値を伏字規則では見分け切れない（例: mysql -pabc123、URL のパス、引用符内の値）。
// そのため Hermes 由来の自由な文字列は一切公開しない。公開するのは、道具の名前・状態・所要時間と、下の固定一覧に一致したプログラム名だけ（一覧に無いものは何も載せない）。
const PROGRAMS = new Set(['awk', 'bash', 'bb', 'bun', 'cargo', 'cat', 'cd', 'chmod', 'cp', 'curl', 'cut', 'date', 'df', 'diff', 'docker', 'du', 'echo', 'find', 'gh', 'git', 'go', 'grep', 'head', 'helm', 'jq', 'kubectl', 'ln', 'ls', 'make', 'mkdir', 'mv', 'mysql', 'node', 'npm', 'npx', 'pip', 'pnpm', 'ps', 'psql', 'pwd', 'python', 'python3', 'rg', 'rm', 'rsync', 'scp', 'sed', 'sh', 'sort', 'ssh', 'tail', 'tar', 'terraform', 'touch', 'tree', 'uniq', 'unzip', 'uv', 'wc', 'wget', 'which', 'xargs', 'yarn', 'zip', 'hermes', 'argocd', 'systemctl', 'journalctl', 'ping', 'dig', 'nslookup', 'ffmpeg', 'tmux', 'gwq', 'ghq', 'codex', 'claude', 'obsidian'])
const SUBCOMMANDS: Record<string, string[]> = { git: 'status log diff show add commit push pull fetch clone checkout switch branch merge rebase stash tag remote grep blame worktree rev-parse ls-files'.split(' '), kubectl: 'get describe logs apply delete exec rollout top auth config port-forward'.split(' '), gh: 'pr issue run api repo workflow release auth search'.split(' '), docker: 'ps build run exec logs images pull push compose'.split(' '), npm: 'install ci run test build'.split(' '), pnpm: 'install ci run test build'.split(' '), yarn: 'install ci run test build'.split(' '), cargo: 'build test run check'.split(' '), go: 'build test run mod vet'.split(' '), terraform: 'init plan apply validate fmt'.split(' '), helm: 'list install upgrade template status'.split(' '), uv: 'run sync pip'.split(' '), pip: 'install list show'.split(' ') }
const EXTENSIONS = new Set('md txt json jsonl yaml yml toml edn ts tsx js mjs cjs py sh bb clj cljs go rs html css tf sql csv log lock png jpg jpeg gif svg webp pdf ini conf xml'.split(' '))
export function publicDetail(tool: string, preview: string): string {
  if (tool === 'terminal') {
    const words = preview.trim().split(/\s+/); let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['sudo', 'env', 'time', 'nohup'].includes(words[i]))) i++
    const word = words[i] ?? '', name = word.slice(word.lastIndexOf('/') + 1); if (!PROGRAMS.has(name)) return ''
    return SUBCOMMANDS[name]?.includes(words[i + 1]) ? `${name} ${words[i + 1]}` : name
  }
  if (['read_file', 'write_file', 'patch'].includes(tool)) { const match = preview.replace(/ (?:\[)?L\d+(?:-\d+)?\]?$/, '').match(/\.([A-Za-z0-9]+)$/), ext = match?.[1].toLowerCase(); return ext && EXTENSIONS.has(ext) ? `.${ext} ファイル` : '' }
  // tool_call の表示名は引数ではなく道具名から生成される。
  if (tool === 'tool_call' && /^[A-Z][A-Za-z]{1,19}( [A-Z][A-Za-z]{1,19}){0,2} · [a-z]{1,16}( [a-z]{1,16}){0,5}( \+\d{1,2})?$/.test(preview)) return preview
  return ''
}
export function createActivity(now: () => number) {
  const steps: (ActivityStep & { hermesAt?: number; call?: string })[] = [], ids = new Map<string, string>(); let writing = false, dropped = 0, serial = 0
  const add = (step: ActivityStep & { hermesAt?: number; call?: string }) => { steps.push(step); if (steps.length > 40) { let i = steps.findIndex(s => s.status !== 'running'); if (i < 0) i = 0; steps.splice(i, 1); dropped++ } }
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
        const timestamp = typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) && e.timestamp > 0 ? e.timestamp : undefined
        add({ id, kind: 'tool', tool, status: 'running', startedAt: timestamp === undefined ? now() : timestamp * 1000, ...(timestamp === undefined ? {} : { hermesAt: timestamp }), ...(call ? { call } : {}), ...(detail ? { detail } : {}) })
      } else if (e.event === 'tool.completed') {
        const call = callId(e.tool_call_id), tool = toolName(e.tool), id = call && ids.get(call)
        // 再接続の再生などで、既に完了を反映した呼び出しの完了がもう一度届いても別の手順を作らない。
        if (id && !steps.some(s => s.id === id && s.status === 'running')) return
        const candidates = call ? [] : steps.filter(s => s.tool === tool && s.status === 'running' && !s.call)
        let step = id ? steps.find(s => s.id === id && s.status === 'running') : candidates.length === 1 ? candidates[0] : undefined
        if (!step) { step = { id: `t${++serial}`, kind: 'tool', tool, status: 'running', startedAt: now(), startMissing: true, ...(call ? { call } : {}) }; add(step); if (call) ids.set(call, step.id) }
        step.status = e.error === true ? 'failed' : 'done'
        if (!step.startMissing) {
          const diff = typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) && step.hermesAt !== undefined ? e.timestamp - step.hermesAt : -1
          if (diff >= 0 && diff <= 86400) step.durationMs = Math.round(diff * 1000)
          else if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration > 0 && e.duration <= 86400) step.durationMs = Math.round(e.duration * 1000)
        }
      }
    },
    // completed: run 自体は正常終了したが完了通知を受け取れなかった手順は、中断でも成功でもなく「結果未確認」とする。
    finish(completed = false) { for (const step of steps) if (step.status === 'running') step.status = completed ? 'unconfirmed' : 'interrupted'; writing = false },
    snapshot(): Activity | undefined { return steps.length || writing ? { steps: steps.map(({ hermesAt, call, ...s }) => ({ ...s, ...(s.status === 'running' ? { runningMs: Math.max(0, now() - s.startedAt) } : {}) })), writing, dropped } : undefined },
  }
}
