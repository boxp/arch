import { it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { createAuth } from './auth.js'
import { createApp, instructions } from './app.js'
import type { createHermes } from './hermes.js'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwt = () => { const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url'), p = Buffer.from(JSON.stringify({ iss: 'https://access.example.test', aud: 'abc', email: 'owner@example.test', exp: Date.now() / 1000 + 60 })).toString('base64url'); return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}` }
const review = (username = 'sa', audiences = ['kohako-bff-verifier']) => async () => ({ status: { authenticated: true, user: { username }, audiences } })
const auth = (enabled = true, reviewer = review()) => createAuth({ jwks: { getKey: async () => publicKey.export({ format: 'jwk' }) }, issuer: 'https://access.example.test', audience: 'abc', ownerEmails: ['owner@example.test'], verifierEnabled: enabled, verifierUsername: 'sa', now: Date.now, review: reviewer })
it('verifies Owner JWT and rejects bad assertion', async () => { expect(await auth()({ 'cf-access-jwt-assertion': jwt() })).toBe('owner'); expect(await auth()({ 'cf-access-jwt-assertion': 'bad' })).toBeNull() })
it('verifies and caches verifier', async () => { let calls = 0; const a = auth(true, async () => { calls++; return review()() }); expect(await a({ authorization: 'Bearer test' })).toBe('verifier'); expect(await a({ authorization: 'Bearer test' })).toBe('verifier'); expect(calls).toBe(1) })
it('rejects wrong user, audience, and disabled verifier', async () => { for (const a of [auth(true, review('other')), auth(true, review('sa', ['other'])), auth(false)]) expect(await a({ authorization: 'Bearer test' })).toBeNull() })
it('isolates sessions and requests and restricts verifier approval', async () => {
  const sessions: string[] = []
  const hermes = { run: (_id: string, _text: string, session: string, _instructions: string, cb: any) => { sessions.push(session); cb('run', { description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: async () => 'ok', stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async h => h.authorization === 'owner' ? 'owner' : h.authorization === 'verifier' ? 'verifier' : null, hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}/kohako/api/v1/`
    const call = (who: string, path: string, body?: object) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: who, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const msg = (requestId: string) => ({ requestId, kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 })
    expect((await call('owner', 'messages', msg('owner-123'))).status).toBe(202); expect((await call('verifier', 'messages', msg('verifier-123'))).status).toBe(202)
    expect(sessions[0]).toMatch(/^kohako-web-/); expect(sessions[1]).toMatch(/^kohako-verify-/)
    expect((await call('verifier', 'requests/owner-123')).status).toBe(404); expect((await call('verifier', 'requests/owner-123/cancel', {})).status).toBe(404)
    expect((await call('verifier', 'approvals', { requestId: 'owner-123', approvalId: '0000000000000000', choice: 'deny' })).status).toBe(404)
    const item = await (await call('verifier', 'requests/verifier-123')).json() as any; expect(item.status).toBe('approval')
    expect((await call('verifier', 'approvals', { requestId: 'verifier-123', approvalId: item.approval.approvalId, choice: 'once' })).status).toBe(403)
    expect((await call('verifier', 'approvals', { requestId: 'verifier-123', approvalId: item.approval.approvalId, choice: 'deny' })).status).toBe(200)
    expect(instructions).not.toMatch(/G2|グラス|眼鏡|メガネ/)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('clears pending approval when the run ends with a polling failure', async () => {
  let settle: (r: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _instructions: string, cb: any) => { cb('run', { description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    expect((await fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'owner-456', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }) })).status).toBe(202)
    expect((await (await fetch(base + 'requests/owner-456')).json() as any).status).toBe('approval')
    settle({ status: 'failed', error: 'poll_timeout' }); await new Promise(r => setTimeout(r, 10))
    const item = await (await fetch(base + 'requests/owner-456')).json() as any
    expect(item.status).toBe('failed'); expect(item.approval).toBeUndefined()
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('stops the upstream run and rotates the session when the run outcome is unknown', async () => {
  const sessions: string[] = [], stopped: string[] = []
  let settle: (r: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, session: string, _i: string, _cb: any, _a: any, onRun: any) => { sessions.push(session); onRun(`run${sessions.length}`); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async (id: string) => { stopped.push(id); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const send = (requestId: string) => fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }) })
    expect((await send('owner-701')).status).toBe(202)
    settle({ status: 'unknown', error: 'hermes_unreachable' }); await new Promise(r => setTimeout(r, 10))
    expect(stopped).toEqual(['run1'])
    expect((await send('owner-702')).status).toBe(202)
    expect(sessions[1]).not.toBe(sessions[0])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('shows the full command in approvals and only allows deny when it cannot be shown in full', async () => {
  const { approvalSummary } = await import('./conversation.js')
  const shown = approvalSummary({ description: 'ファイルを削除', command: 'rm -rf /home/user/projects/very-long-directory-name-for-testing/build https://example.test/some/long/path/segment' })
  expect(shown.fullyShown).toBe(true)
  expect(shown.summary).toContain('ファイルを削除')
  expect(shown.summary).toContain('rm -rf /home/user/projects/very-long-directory-name-for-testing/build')
  expect(shown.summary).toContain('https://example.test/some/long/path/segment')
  expect(approvalSummary({ description: '', command: 'curl -H "Authorization: Bearer abc"' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: 'echo a', commandTruncated: true }).fullyShown).toBe(false)
})
it('does not allow once when the approval command contains newlines or other control characters', async () => {
  const { approvalSummary } = await import('./conversation.js')
  const multi = approvalSummary({ description: 'x', command: 'echo safe\nrm -rf /tmp/target' })
  expect(multi.fullyShown).toBe(false)
  expect(multi.summary).toContain('echo safe\\nrm -rf /tmp/target')
  expect(multi.summary).toContain('拒否のみ')
  expect(approvalSummary({ description: 'x', command: 'echo a\rrm b' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: 'echo a\tb' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: 'echo \x1b[2Ka' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: 'echo a b' }).fullyShown).toBe(true)
})
it('does not allow once when the approval command is missing or empty', async () => {
  const { approvalSummary } = await import('./conversation.js')
  expect(approvalSummary({ description: 'x', command: '' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: '   ' }).fullyShown).toBe(false)
  expect(approvalSummary({ description: 'x', command: '' }).summary).toContain('拒否のみ')
})
it('treats 4xx polling errors as unconfirmed outcome instead of failed, retrying 429', async () => {
  const { createHermes } = await import('./hermes.js')
  const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const make = (pollStatuses: number[]) => {
    let polls = 0
    const fetcher = (async (url: string) => {
      if (url.endsWith('/v1/toolsets')) return json(200, { data: [] })
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run1' })
      const status = pollStatuses[Math.min(polls++, pollStatuses.length - 1)]
      return status === 200 ? json(200, { status: 'completed', output: 'ok' }) : json(status, {})
    }) as unknown as typeof fetch
    return createHermes({ url: 'http://h', key: 'k', fetch: fetcher, sleep: async () => {} })
  }
  const opts = { idempotencyKey: 'i', input: 'x', sessionId: 's', instructions: '', polls: 20 }
  expect(await make([429, 429, 200]).execute(opts)).toEqual({ status: 'done', text: 'ok' })
  expect(await make([429]).execute(opts)).toEqual({ status: 'unknown', error: 'hermes_poll_429' })
  expect(await make([404]).execute(opts)).toEqual({ status: 'unknown', error: 'hermes_poll_404' })
})
