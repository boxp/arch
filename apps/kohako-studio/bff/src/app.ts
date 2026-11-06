import type { IncomingMessage, ServerResponse } from 'node:http'
import { createConversation, type Input } from './conversation.js'
import { createHermes } from './hermes.js'
import { pcmToWav, STT_FINAL_FIELDS } from './stt.js'
export const instructions = 'あなたの返答は Web UI の吹き出しに表示され、必要に応じて音声で読み上げられます。'
type Principal = 'owner' | 'verifier'
export function createApp(opts: { authenticate: (headers: IncomingMessage['headers']) => Promise<Principal | null>; hermes?: ReturnType<typeof createHermes>; sttUrl?: string; now?: () => number; fetch?: typeof fetch }) {
  const now = opts.now ?? Date.now, fetcher = opts.fetch ?? fetch
  const conversations = opts.hermes ? { owner: createConversation({ now, hermes: opts.hermes, prefix: 'kohako-web' }), verifier: createConversation({ now, hermes: opts.hermes, prefix: 'kohako-verify' }) } : undefined
  const awaitingApproval = (e: NonNullable<ReturnType<NonNullable<typeof conversations>['owner']['get']>>) => e.status === 'pending' && !!e.approval?.active && !e.approval.consumed
  const view = (e: NonNullable<ReturnType<NonNullable<typeof conversations>['owner']['get']>>) => ({ requestId: e.requestId, status: awaitingApproval(e) ? 'approval' : e.status, ...(e.reply ? { reply: e.reply } : {}), ...(e.error ? { error: e.error } : {}), ...(awaitingApproval(e) && e.approval ? { approval: { approvalId: e.approval.approvalId, summary: e.approval.summary, expiresAt: e.approval.expiresAt } } : {}) })
  return async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname, method = req.method
      if (path === '/healthz' && method === 'GET') return json(200, { ok: true })
      const principal = await opts.authenticate(req.headers); if (!principal) return json(401, { error: 'unauthenticated' })
      const conv = conversations?.[principal], base = '/kohako/api/v1/'
      if (!path.startsWith(base)) return json(404, { error: 'not_found' })
      const route = path.slice(base.length)
      if (method === 'GET' && route === 'me') return json(200, { authenticated: true })
      if (method === 'GET' && route === 'conversation') return json(200, { enabled: !!conv, stt: opts.sttUrl ? 'whisper' : null, sessionStartedAt: conv?.sessionStartedAt })
      const match = /^requests\/([A-Za-z0-9-]{8,64})(\/cancel)?$/.exec(route)
      if (match && conv && ((method === 'GET' && !match[2]) || (method === 'POST' && match[2]))) {
        const entry = conv.get(match[1]); if (!entry) return json(404, { error: 'unknown_request' })
        if (!match[2]) return json(200, view(entry))
        const result = await conv.cancel(match[1]); return result === 'not_pending' ? json(409, { error: 'not_pending' }) : json(202, { status: result === 'unknown' ? 'cancel-unknown' : 'cancelling' })
      }
      if (method !== 'POST' || !['messages', 'approvals', 'transcriptions', 'stt'].includes(route)) return json(404, { error: 'not_found' })
      if (!conv) return json(503, { error: 'conversation_disabled' })
      const limit = route === 'transcriptions' || route === 'stt' ? 960000 : 8192, chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > limit) return json(413, { error: 'too_large' }); chunks.push(b) }
      const body = Buffer.concat(chunks)
      if (route === 'transcriptions' || route === 'stt') {
        if (principal === 'verifier') return json(403, { error: 'forbidden' })
        if (!opts.sttUrl) return json(503, { error: 'stt_disabled' })
        if (body.length < 16000 || body.length % 2 || !/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type'] ?? '')) return json(400, { error: 'invalid' })
        const start = now(), form = new FormData(); form.append('file', new Blob([new Uint8Array(pcmToWav(body))], { type: 'audio/wav' }), 'audio.wav'); for (const [k,v] of Object.entries(STT_FINAL_FIELDS)) form.append(k,v)
        try { const response = await fetcher(`${opts.sttUrl}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(40000), redirect: 'error' }); if (!response.ok) throw Error(); const data = await response.json() as { text?: unknown }; if (typeof data.text !== 'string') throw Error(); return json(200, { text: data.text.trim(), audioMs: body.length / 32, ms: now() - start }) } catch { return json(502, { error: 'stt_failed' }) }
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return json(415, { error: 'content_type' })
      let x: any; try { x = JSON.parse(body.toString()) } catch { return json(400, { error: 'invalid' }) }
      if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.requestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(x.requestId)) return json(400, { error: 'invalid' })
      if (route === 'approvals') {
        if (!conv.get(x.requestId)) return json(404, { error: 'unknown_request' })
        if (principal === 'verifier' && x.choice !== 'deny') return json(403, { error: 'forbidden' })
        if (!['once', 'deny'].includes(x.choice) || typeof x.approvalId !== 'string' || !/^[a-f0-9]{16}$/.test(x.approvalId)) return json(400, { error: 'invalid' })
        const result = await conv.approve(x.requestId, x.approvalId, x.choice); return result === 'ok' ? json(200, { status: 'pending' }) : result === 'unknown' ? json(202, { status: 'approval-unknown' }) : json(result === 'approval_expired' ? 410 : 409, { error: result })
      }
      if (x.kind !== 'text' || typeof x.text !== 'string' || !x.text.trim() || x.text.length > 500 || typeof x.expiresAt !== 'number' || !Number.isFinite(x.expiresAt) || x.expiresAt > now() + 600000) return json(400, { error: 'invalid' })
      if (x.expiresAt <= now()) return json(410, { error: 'expired' })
      const input: Input = { kind: 'text', requestId: x.requestId, text: x.text, expiresAt: x.expiresAt }; const entry = conv.submit(input, instructions)
      return 'payloadHash' in entry ? json(202, view(entry)) : json(entry.error === 'busy' ? 429 : 409, entry)
    } catch { if (!res.headersSent) json(500, { error: 'internal_error' }); else res.end() }
  }
}
