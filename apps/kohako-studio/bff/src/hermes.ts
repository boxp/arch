export type Approval = { requestId?: string; generation?: number; description: string; command: string; commandTruncated?: boolean; choices: ('once' | 'deny')[] }
type Result = { status: 'done'; text: string; model?: string } | { status: 'failed'; error: string } | { status: 'unknown'; error?: string }
export const APPROVAL_COMMAND_MAX = 2000
export type RunOptions = {
  idempotencyKey: string
  input: string
  sessionId: string
  instructions: string
  route?: { provider: string; model: string }
  pollMs?: number
  polls?: number
  onApproval?: (runId: string, approval: Approval | null) => void
  onRun?: (runId: string) => void
}
export type SessionInfo = { id: string; userId: string; endedAt: unknown; lastActive: number; messageCount: number }
export type SessionMessage = { role: string; content: string; toolCalls: boolean; at: number }
export type SessionToolRow = { role: string; content: string; tool_call_id: unknown; tool_calls: unknown; timestamp: number }
export function createHermes({
  url,
  key,
  fetch: fetcher,
  now = Date.now,
  allowedToolsets = [],
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  url: string
  key: string
  fetch: typeof fetch
  now?: () => number
  allowedToolsets?: string[]
  sleep?: (ms: number) => Promise<void>
}) {
  const auth = { Authorization: `Bearer ${key}` }
  async function request(path: string, init: RequestInit, maxBytes = 65536) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url + path, { ...init, signal: controller.signal, redirect: 'error' })
          if (response.status >= 400 && response.status < 500) return { code: String(response.status) }
          if (!response.ok || !response.body) throw Error('upstream')
          const reader = response.body.getReader(),
            chunks: Uint8Array[] = []
          let size = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) {
              await reader.cancel()
              throw Error('oversize')
            }
            chunks.push(value)
          }
          const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid')
          return { data: data as Record<string, unknown> }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(Error('timeout'))
          }, 10_000)
        }),
      ])
    } finally {
      clearTimeout(timer!)
    }
  }
  let toolsetsCheckedAt = -Infinity
  async function toolsetsAllowed() {
    if (now() - toolsetsCheckedAt < 600_000) return true
    const result = await request('/v1/toolsets', { headers: auth })
    const data = result.data?.data
    if (!Array.isArray(data) || !data.every(x => x && typeof x === 'object' && (x.enabled !== true || typeof x.name === 'string'))) return false
    const enabled = new Set<string>(data.filter(x => x.enabled === true).map(x => x.name))
    const allowed = new Set(allowedToolsets)
    const matches = enabled.size === allowed.size && [...enabled].every(x => allowed.has(x))
    if (matches) toolsetsCheckedAt = now()
    return matches
  }
  // 稼働中の Hermes（session authority あり）は pending_controls の prompt_id と execution_generation を
  // そのまま返す形だけを受け付ける（{request_id, execution_generation, choice} の 3 項目ちょうど）。
  async function approve(runId: string, choice: 'once' | 'deny', requestId?: string, generation?: number): Promise<'ok' | 'not_pending' | 'unknown'> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) return 'not_pending'
    try {
      const result = await request(`/v1/runs/${runId}/approval`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(requestId && generation !== undefined ? { request_id: requestId, execution_generation: generation, choice } : { choice, ...(requestId ? { request_id: requestId } : {}) }) })
      // 承認が既に無い（404/409）ことを Hermes が明示した時だけ not_pending。429/400 等は承認が残りうるので unknown。
      if (!result.code) return 'ok'
      return result.code === '404' || result.code === '409' ? 'not_pending' : 'unknown'
    } catch { return 'unknown' }
  }
  async function execute(options: RunOptions): Promise<Result> {
    try {
      if (!(await toolsetsAllowed())) return { status: 'failed', error: 'toolsets_open' }
    } catch { return { status: 'failed', error: 'hermes_unavailable' } }
    try {
      const post = await request('/v1/runs', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
        body: JSON.stringify({
          input: options.input,
          session_id: options.sessionId,
          instructions: options.instructions,
          ...(options.route
            ? { provider: options.route.provider, model: options.route.model, model_options: { reasoning_effort: 'low' } }
            : {}),
        }),
      })
      if (post.code) return { status: 'failed', error: post.code }
      const id = post.data?.run_id
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { status: 'unknown', error: 'hermes_schema' }
      options.onRun?.(id)
      return await poll(id, options)
    } catch {
      return { status: 'unknown', error: 'hermes_unreachable' }
    }
  }
  /** 既に受理済みの run を追跡し直す（BFF 再起動後に通知返信の会話を再開する用。新しい run は作らない）。 */
  async function poll(id: string, options: Pick<RunOptions, 'pollMs' | 'polls' | 'onApproval'>): Promise<Result> {
    try {
      let waiting = false,
        pollErrors = 0
      for (let i = 0; i < (options.polls ?? 300); i++) {
        const poll = await request(`/v1/runs/${id}`, { headers: auth }, 262144) // 図の HTML を含む返答（最大 24000 字）を受け取れる大きさ
        // 4xx（429 等）は上流 run の終了を意味しない。429 は待って再確認し、それ以外/上限超過は結果未確認(unknown)として
        // 呼出し側に上流停止と session 切替をさせる（failed で返すと同 session で次の run が並行実行される）。
        if (poll.code) {
          if (poll.code === '429' && ++pollErrors <= 5) { await sleep(options.pollMs ?? 2000); continue }
          return { status: 'unknown', error: `hermes_poll_${poll.code}` }
        }
        pollErrors = 0
        const status = poll.data?.status
        if (status === 'waiting_for_approval') {
          // 稼働版は pending_controls[{kind:'approval', prompt_id, execution_generation, ...}]、旧版は approval{request_id, ...}。
          const controls = Array.isArray(poll.data?.pending_controls) ? (poll.data.pending_controls as unknown[]) : []
          const control = controls.find((x): x is Record<string, unknown> => !!x && typeof x === 'object' && (x as Record<string, unknown>).kind === 'approval')
          const raw = control ?? (poll.data?.approval && typeof poll.data.approval === 'object' ? poll.data.approval as Record<string, unknown> : {})
          const strip = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim() : ''
          const clean = (value: unknown) => strip(value).slice(0, 160)
          // command は Owner が許可対象を確認する本体なので切り詰めず、収まらない場合は印を付けて拒否のみにする。
          // 改行等の制御文字は空白へ潰さず原文のまま渡す（複数コマンドを 1 行に見せないため。判定と表示は approvalSummary 側）。
          const command = typeof raw.command === 'string' ? raw.command.trim() : ''
          const rawId = control ? raw.prompt_id : raw.request_id
          const requestId = typeof rawId === 'string' && /^[\x21-\x7e]{1,256}$/.test(rawId) ? rawId : undefined
          const generation = control && Number.isSafeInteger(raw.execution_generation) ? (raw.execution_generation as number) : undefined
          const choices: Approval['choices'] = Array.isArray(raw.choices) && raw.choices.includes('once') && raw.choices.includes('deny') ? ['once', 'deny'] : ['deny']
          options.onApproval?.(id, { requestId, generation, description: clean(raw.description), command: command.slice(0, APPROVAL_COMMAND_MAX), commandTruncated: command.length > APPROVAL_COMMAND_MAX, choices })
          waiting = true
          await sleep(options.pollMs ?? 2000)
          continue
        }
        if (waiting) { options.onApproval?.(id, null); waiting = false }
        if (status === 'completed')
          return typeof poll.data?.output === 'string'
            ? {
                status: 'done',
                text: poll.data.output.trim().slice(0, 24000),
                ...(typeof poll.data.model === 'string' ? { model: poll.data.model.slice(0, 64) } : {}),
              }
            : { status: 'unknown', error: 'hermes_schema' }
        if (status === 'failed') return { status: 'failed', error: typeof poll.data?.error === 'string' && /^[a-z_]{1,40}$/.test(poll.data.error) ? poll.data.error : 'failed' }
        if (status === 'cancelled' || status === 'interrupted') return { status: 'failed', error: status }
        if (status !== 'queued' && status !== 'running' && status !== 'stopping') return { status: 'unknown', error: 'hermes_schema' }
        await sleep(options.pollMs ?? 2000)
      }
      return { status: 'unknown', error: 'hermes_timeout' }
    } catch {
      return { status: 'unknown', error: 'hermes_unreachable' }
    }
  }
  return {
    approve,
    async stop(runId: string): Promise<'ok' | 'not_pending' | 'unknown'> {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) return 'not_pending'
      try {
        const result = await request(`/v1/runs/${runId}/stop`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' })
        return result.code ? 'not_pending' : 'ok'
      } catch { return 'unknown' }
    },
    watch(runId: string, onApproval?: RunOptions['onApproval']): Promise<Result> {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) return Promise.resolve({ status: 'unknown', error: 'hermes_schema' })
      return poll(runId, { onApproval })
    },
    run(requestId: string, text: string, sessionId: string, instructions: string, onApproval?: RunOptions['onApproval'], attempt?: number, onRun?: RunOptions['onRun'], stableKey?: string): Promise<Result> {
      // stableKey は session を跨いで同じ返信を一度だけ受理させるための鍵（通知返信の再送用）。
      return execute({ idempotencyKey: stableKey ?? `kohako-web-${sessionId}-${requestId}${attempt && attempt > 0 ? `-retry${attempt}` : ''}`, input: text, sessionId, instructions, onApproval, onRun })
    },
    execute,
  }
}
