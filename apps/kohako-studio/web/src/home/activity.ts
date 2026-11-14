type Tool = { id: string; kind: 'tool'; tool: string; detail?: string; status: 'running' | 'done' | 'failed' | 'interrupted' | 'unconfirmed'; startedAt: number; durationMs?: number; result?: string }
type Note = { id: string; kind: 'note'; text: string; at: number }
export type Activity = { steps: (Tool | Note)[]; writing: boolean; dropped: number }
export function validateActivity(value: unknown): Activity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const a = value as Record<string, unknown>; if (!Array.isArray(a.steps) || a.steps.length > 40 || typeof a.writing !== 'boolean' || !Number.isSafeInteger(a.dropped) || (a.dropped as number) < 0) return null
  const steps: Activity['steps'] = []
  for (const v of a.steps) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const s = v as Record<string, unknown>; if (typeof s.id !== 'string' || !/^[tn]\d{1,16}$/.test(s.id)) continue
    if (s.kind === 'note' && typeof s.text === 'string' && s.text.length <= 401 && typeof s.at === 'number' && Number.isFinite(s.at)) steps.push({ id: s.id, kind: 'note', text: s.text, at: s.at })
    else if (s.kind === 'tool' && typeof s.tool === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(s.tool) && ['running','done','failed','interrupted','unconfirmed'].includes(String(s.status)) && typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) && (s.detail === undefined || typeof s.detail === 'string' && s.detail.length <= 161) && (s.result === undefined || typeof s.result === 'string' && s.result.length <= 201) && (s.durationMs === undefined || typeof s.durationMs === 'number' && Number.isInteger(s.durationMs) && s.durationMs >= 0 && s.durationMs <= 86400000)) steps.push({ id: s.id, kind: 'tool', tool: s.tool, status: s.status as Tool['status'], startedAt: s.startedAt, ...(typeof s.detail === 'string' ? { detail: s.detail } : {}), ...(typeof s.result === 'string' ? { result: s.result } : {}), ...(typeof s.durationMs === 'number' ? { durationMs: s.durationMs } : {}) })
  }
  return { steps, writing: a.writing, dropped: a.dropped as number }
}
export function toolLabel(tool: string): { noun: string; doing: string; name: string } {
  const labels: Record<string, [string,string]> = { terminal:['コマンド','コマンドを実行'], execute_code:['コマンド','コマンドを実行'], process:['コマンド','コマンドを実行'], read_file:['ファイル','ファイルを読んで'], write_file:['ファイル','ファイルを書き換えて'], patch:['ファイル','ファイルを書き換えて'], search_files:['ファイル','ファイルを探して'], web_search:['Web','Web を検索'], web_extract:['Web','Web ページを見て'], vision_analyze:['画像','画像を見て'], image_generate:['画像','画像を作って'], memory:['記憶','記憶を確認'], session_search:['会話','過去の会話を探して'], skill_view:['手順書','手順書を確認'], skills_list:['手順書','手順書を確認'], skill_manage:['手順書','手順書を確認'], delegate_task:['担当','別の担当に任せて'], todo_list:['やること','やることを整理'], todo:['やること','やることを整理'], cronjob_manage:['予定','予定を確認'], cronjob:['予定','予定を確認'], text_to_speech:['音声','音声を作って'], clarify:['確認事項','確認事項をまとめて'] }
  const [noun, name] = labels[tool] ?? (tool.startsWith('browser_') ? ['Web', 'Web ページを見て'] : tool.startsWith('mcp_') ? ['外部ツール', '外部ツールを使って'] : [`ツール（${tool}）`, `ツール（${tool}）を使って`])
  return { noun, name: name.replace(/読んで$/, '読む').replace(/書き換えて$/, '書き換え').replace(/探して$/, '探す').replace(/見て$/, '見る').replace(/作って$/, '作る').replace(/任せて$/, '任せる').replace(/まとめて$/, 'まとめる').replace(/使って$/, '使用'), doing: name.endsWith('て') ? `${name}います` : `${name}しています` }
}
export function activityHeadline(a: Activity, opts: { live: boolean; nowMs: number; receivedAtMs: number }): string {
  const tools = a.steps.filter((s): s is Tool => s.kind === 'tool')
  if (opts.live) { const running = tools.filter(s => s.status === 'running').at(-1); return running ? toolLabel(running.tool).doing : a.writing ? '返答を書いています' : '次の手順を待っています' }
  if (!tools.length) return `途中のひとこと ${a.steps.length} 件`
  const failed = tools.filter(s => s.status === 'failed').length, interrupted = tools.filter(s => s.status === 'interrupted').length, unconfirmed = tools.filter(s => s.status === 'unconfirmed').length
  return `ツールを ${tools.length} 回使いました${failed ? `（うち失敗 ${failed}）` : ''}${interrupted ? `（中断 ${interrupted}）` : ''}${unconfirmed ? `（結果未確認 ${unconfirmed}）` : ''}`
}
export function formatDuration(ms: number): string { const seconds = Math.max(0, ms) / 1000; if (seconds < 10) return `${seconds.toFixed(1)}秒`; if (seconds < 60) return `${Math.floor(seconds)}秒`; return `${Math.floor(seconds / 60)}分${String(Math.floor(seconds % 60)).padStart(2, '0')}秒` }
let rootNode: HTMLElement | undefined, last = '', expanded = false; const seen = new Map<string, number>()
export function tickActivity() { if (!rootNode) return; rootNode.querySelectorAll<HTMLElement>('[data-running-id]').forEach(el => { const at = seen.get(el.dataset.runningId!); if (at !== undefined) el.textContent = formatDuration(Date.now() - at) }) }
export function renderActivity(root: HTMLElement, activity: Activity | null, opts: { live: boolean }) {
  rootNode = root
  if (!activity) { root.hidden = true; root.replaceChildren(); last = ''; expanded = false; seen.clear(); return }
  const key = JSON.stringify([activity, opts.live]); if (key === last) return; last = key
  const oldList = root.querySelector<HTMLOListElement>('.activity-steps'), follow = !!oldList && oldList.scrollTop + oldList.clientHeight >= oldList.scrollHeight - 4
  // 作り直しても、開閉ボタンの焦点と一覧のスクロール位置は保つ（キーボード操作・読み返しを邪魔しない）。
  const hadFocus = root.contains(document.activeElement) && document.activeElement?.classList.contains('activity-head'), oldTop = oldList?.scrollTop ?? 0
  root.hidden = false; root.dataset.live = opts.live ? '1' : '0'; root.replaceChildren()
  const make = (tag: string, cls: string, text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el }
  const head = document.createElement('button'); head.type = 'button'; head.className = 'activity-head'; head.setAttribute('aria-controls','activity-steps'); head.setAttribute('aria-expanded', String(expanded))
  const title = activityHeadline(activity, { live: opts.live, nowMs: Date.now(), receivedAtMs: Date.now() }); head.setAttribute('aria-label', `${title}、${activity.steps.length} 手順`)
  const spin = make('span','activity-spin'); spin.setAttribute('aria-hidden','true'); head.append(spin, make('span','activity-title',title))
  const running = activity.steps.filter((s): s is Tool => s.kind === 'tool' && s.status === 'running').at(-1); head.append(make('span','activity-target', running?.detail ? `「${running.detail}」` : ''), make('span','activity-count',`${activity.steps.length} 手順`))
  const list = document.createElement('ol'); list.id = 'activity-steps'; list.className = 'activity-steps'; list.hidden = !expanded
  head.onclick = () => { expanded = !expanded; head.setAttribute('aria-expanded', String(expanded)); list.hidden = !expanded }
  if (activity.dropped) list.append(make('li','activity-dropped',`古い手順 ${activity.dropped} 件は省略しました`))
  for (const s of activity.steps) { const li = document.createElement('li'); li.dataset.kind = s.kind
    if (s.kind === 'note') li.textContent = s.text
    else { li.dataset.status = s.status; const mark = make('span','activity-mark'); mark.setAttribute('aria-hidden','true'); li.append(mark, make('span','activity-name',toolLabel(s.tool).name)); const time = make('span','activity-time',s.durationMs === undefined ? '' : formatDuration(s.durationMs)); if (s.status === 'running') { if (!seen.has(s.id)) seen.set(s.id,Date.now()); time.dataset.runningId = s.id } li.append(time); if (s.detail) li.append(make('span','activity-detail',s.detail)); if (s.result) li.append(make('span','activity-result',s.result)); li.append(make('span','sr-only',({running:'実行中',done:'完了',failed:'失敗',interrupted:'中断',unconfirmed:'結果未確認'})[s.status])) }
    list.append(li)
  }
  root.append(head,list); list.scrollTop = follow ? list.scrollHeight : oldTop; if (hadFocus) head.focus({ preventScroll: true }); tickActivity()
}
