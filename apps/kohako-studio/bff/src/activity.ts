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
    // URL はパス・クエリ・利用者情報に秘密値（再設定トークン等）が入り得て見分けられないため、接続先のホスト名までだけを残す。
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#]*)([/?#][^\s]*)?/gi, (_m, scheme: string, authority: string, rest?: string) => /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(authority) && !/^[a-z0-9_-]{24,}$/i.test(authority) ? scheme + authority + (rest && rest !== '/' ? '/…' : rest ?? '') : '<secret>')
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
// ツールの引数・出力は任意の文字列で、秘密値を伏字規則で見分け切れない（例: mysql -pabc123、echo 値 | …）。
// そのため伏字に頼らず、公開してよい形だけを通す: コマンドは先頭のプログラム名のみ、ファイル/URL は空白や引用符のない 1 語のみ、検索語は伏字化した文。それ以外の道具の引数と、全ての道具の出力は載せない。
const SINGLE_TOKEN_TOOLS = new Set(['read_file', 'write_file', 'patch', 'skill_view']), URL_TOOLS = new Set(['web_extract', 'browser_navigate']), QUERY_TOOLS = new Set(['web_search', 'search_files', 'session_search'])
export function publicDetail(tool: string, preview: string): string {
  if (tool === 'terminal') { const first = preview.trim().split(/\s+/)[0] ?? '', name = first.slice(first.lastIndexOf('/') + 1); return /^[A-Za-z][A-Za-z0-9_.+-]{0,31}$/.test(name) ? (preview.trim() === first ? name : `${name} …`) : '' }
  if (SINGLE_TOKEN_TOOLS.has(tool)) { const value = clean(preview, 160); return /^[^\s"'`{}[\]=,;<>]+$/.test(value) ? value : '' }
  // URL を受ける道具は接続先のホスト名だけを載せる（scheme 省略の example.com/reset/… もパスを出さない）。
  if (URL_TOOLS.has(tool)) { const m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}|localhost)(?::\d{1,5})?(?:[/?#]\S*)?$/i.exec(preview.trim()); return m && m[1].length <= 100 ? m[1].toLowerCase() : '' }
  return QUERY_TOOLS.has(tool) ? clean(preview, 160) : ''
}
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
        const id = `t${++serial}`, tool = toolName(e.tool), detail = typeof e.preview === 'string' ? publicDetail(tool, e.preview) : ''
        if (call) ids.set(call, id)
        add({ id, kind: 'tool', tool, status: 'running', startedAt: now(), ...(detail ? { detail } : {}) })
      } else if (e.event === 'tool.completed') {
        const call = callId(e.tool_call_id), tool = toolName(e.tool), id = call && ids.get(call)
        // 再接続の再生などで、既に完了を反映した呼び出しの完了がもう一度届いても別の手順を作らない。
        if (id && !steps.some(s => s.kind === 'tool' && s.id === id && s.status === 'running')) return
        let step = steps.find((s): s is Extract<ActivityStep, {kind:'tool'}> => s.kind === 'tool' && s.id === id && s.status === 'running') ?? steps.find((s): s is Extract<ActivityStep, {kind:'tool'}> => s.kind === 'tool' && s.tool === tool && s.status === 'running')
        if (!step) { step = { id: `t${++serial}`, kind: 'tool', tool, status: 'running', startedAt: now() }; add(step); if (call) ids.set(call, step.id) }
        step.status = e.error === true ? 'failed' : 'done'
        if (typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration >= 0 && e.duration * 1000 <= 86400000) step.durationMs = Math.round(e.duration * 1000)
      }
    },
    // completed: run 自体は正常終了したが完了通知を受け取れなかった手順は、中断でも成功でもなく「結果未確認」とする。
    finish(completed = false) { for (const step of steps) if (step.kind === 'tool' && step.status === 'running') step.status = completed ? 'unconfirmed' : 'interrupted'; writing = false; buffer = '' },
    snapshot(): Activity | undefined { return steps.length || writing ? { steps: steps.map(s => ({ ...s })), writing, dropped } : undefined },
  }
}
