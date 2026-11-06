export type Approval = { requestId?: string; generation?: number; description: string; command: string; choices: ('once' | 'deny')[] }
type Result = { status: 'done'; text: string; model?: string } | { status: 'failed'; error: string } | { status: 'unknown'; error?: string }
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
      return result.code ? 'not_pending' : 'ok'
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
      let waiting = false
      for (let i = 0; i < (options.polls ?? 300); i++) {
        const poll = await request(`/v1/runs/${id}`, { headers: auth })
        if (poll.code) return { status: 'failed', error: poll.code }
        const status = poll.data?.status
        if (status === 'waiting_for_approval') {
          // 稼働版は pending_controls[{kind:'approval', prompt_id, execution_generation, ...}]、旧版は approval{request_id, ...}。
          const controls = Array.isArray(poll.data?.pending_controls) ? (poll.data.pending_controls as unknown[]) : []
          const control = controls.find((x): x is Record<string, unknown> => !!x && typeof x === 'object' && (x as Record<string, unknown>).kind === 'approval')
          const raw = control ?? (poll.data?.approval && typeof poll.data.approval === 'object' ? poll.data.approval as Record<string, unknown> : {})
          const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, 160) : ''
          const rawId = control ? raw.prompt_id : raw.request_id
          const requestId = typeof rawId === 'string' && /^[\x21-\x7e]{1,256}$/.test(rawId) ? rawId : undefined
          const generation = control && Number.isSafeInteger(raw.execution_generation) ? (raw.execution_generation as number) : undefined
          const choices: Approval['choices'] = Array.isArray(raw.choices) && raw.choices.includes('once') && raw.choices.includes('deny') ? ['once', 'deny'] : ['deny']
          options.onApproval?.(id, { requestId, generation, description: clean(raw.description), command: clean(raw.command), choices })
          waiting = true
          await sleep(options.pollMs ?? 2000)
          continue
        }
        if (waiting) { options.onApproval?.(id, null); waiting = false }
        if (status === 'completed')
          return typeof poll.data?.output === 'string'
            ? {
                status: 'done',
                text: poll.data.output.trim().slice(0, 1000),
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
    run(requestId: string, text: string, sessionId: string, instructions: string, onApproval?: RunOptions['onApproval'], attempt?: number, onRun?: RunOptions['onRun']): Promise<Result> {
      return execute({ idempotencyKey: `kohako-web-${sessionId}-${requestId}${attempt && attempt > 0 ? `-retry${attempt}` : ''}`, input: text, sessionId, instructions, onApproval, onRun })
    },
    execute,
  }
}
