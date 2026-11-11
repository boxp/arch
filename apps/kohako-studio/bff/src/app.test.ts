import { it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { createAuth } from './auth.js'
import { createApp, instructions, studioInstructions } from './app.js'
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
it('rotates the session even without a run id when the create request outcome is unknown', async () => {
  const sessions: string[] = [], stopped: string[] = []
  let settle: (r: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, session: string) => { sessions.push(session); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async (id: string) => { stopped.push(id); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const send = (requestId: string) => fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }) })
    expect((await send('owner-801')).status).toBe(202)
    settle({ status: 'unknown', error: 'hermes_unreachable' }); await new Promise(r => setTimeout(r, 10))
    expect(stopped).toEqual([])
    expect((await send('owner-802')).status).toBe(202)
    expect(sessions[1]).not.toBe(sessions[0])
    settle({ status: 'failed', error: 'failed' }); await new Promise(r => setTimeout(r, 10))
    expect((await send('owner-803')).status).toBe(202)
    expect(sessions[2]).toBe(sessions[1])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('shows a new approval and sends the new generation when the same prompt id gets a new execution generation', async () => {
  let cb: any = () => {}
  const approvals: any[] = []
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any) => { cb = onApproval; onApproval('run', { requestId: 'p1', generation: 1, description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: async (...args: any[]) => { approvals.push(args); return 'ok' }, stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    expect((await fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'owner-901', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }) })).status).toBe(202)
    const first = await (await fetch(base + 'requests/owner-901')).json() as any
    cb('run', { requestId: 'p1', generation: 2, description: 'test', command: 'echo hi', choices: ['once', 'deny'] })
    const second = await (await fetch(base + 'requests/owner-901')).json() as any
    expect(second.status).toBe('approval'); expect(second.approval.approvalId).not.toBe(first.approval.approvalId)
    expect((await fetch(base + 'approvals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'owner-901', approvalId: second.approval.approvalId, choice: 'once' }) })).status).toBe(200)
    expect(approvals).toEqual([['run', 'once', 'p1', 2]])
    cb('run', { requestId: 'p1', generation: 2, description: 'test', command: 'echo hi', choices: ['once', 'deny'] })
    expect(((await (await fetch(base + 'requests/owner-901')).json()) as any).approval?.approvalId ?? second.approval.approvalId).toBe(second.approval.approvalId)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('validates and deduplicates touch, rejects concurrent work and automatically denies approval', async () => {
  const calls: any[] = [], approvals: any[] = []; let settle: (v: any) => void = () => {}
  const hermes = { run: (...args: any[]) => { calls.push(args); args[4]('run', { requestId: 'p', generation: 1, description: 'x', command: 'echo x', choices: ['once', 'deny'] }); return new Promise(r => { settle = r }) }, approve: async (...args: any[]) => { approvals.push(args); return 'ok' }, stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'verifier', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const body = { requestId: 'touch-123', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 3 }, expiresAt: Date.now() + 60000 }
    for (const touch of [{ ...body.touch, count: 0 }, { ...body.touch, count: 21 }, { ...body.touch, count: 1.5 }, { ...body.touch, action: 'other' }, { ...body.touch, zone: 'body' }, { ...body.touch, text: 'injection' }]) expect((await post('messages', { ...body, touch })).status).toBe(400)
    expect((await post('messages', { ...body, text: 'injection' })).status).toBe(400)
    expect((await post('messages', body)).status).toBe(202)
    expect((await post('messages', body)).status).toBe(202)
    expect((await post('messages', { ...body, touch: { ...body.touch, count: 2 } })).status).toBe(409)
    expect((await post('messages', { ...body, requestId: 'touch-456' })).status).toBe(429)
    expect(calls).toHaveLength(1); expect(calls[0][1]).toContain('頭を3回なでました'); expect(approvals).toEqual([['run', 'deny', 'p', 1]])
    expect((await post('approvals', { requestId: body.requestId, approvalId: '0000000000000000', choice: 'once' })).status).not.toBe(200)
    settle({ status: 'done', text: 'unsafe' }); await new Promise(r => setTimeout(r, 10))
    const result = await (await fetch(base + 'requests/' + body.requestId)).json() as any
    expect(result.status).toBe('failed'); expect(result.reply).toBeUndefined(); expect(result.approval).toBeUndefined()
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('denies a pending approval before stopping and denies approvals that arrive after stop (BOXP-503)', async () => {
  let cb: any = () => {}
  const calls: any[] = []
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { cb = onApproval; onRun('run'); onApproval('run', { requestId: 'p1', generation: 1, description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: async (...args: any[]) => { calls.push(['approve', ...args]); return 'ok' }, stop: async (id: string) => { calls.push(['stop', id]); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const post = (path: string, body: object) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post('messages', { requestId: 'owner-950', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 })).status).toBe(202)
    const pending = await (await fetch(base + 'requests/owner-950')).json() as any
    expect(pending.status).toBe('approval')
    expect((await post('requests/owner-950/cancel', {})).status).toBe(202)
    expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1], ['stop', 'run']])
    expect((await post('approvals', { requestId: 'owner-950', approvalId: pending.approval.approvalId, choice: 'once' })).status).not.toBe(200)
    cb('run', { requestId: 'p2', generation: 2, description: 'test', command: 'echo again', choices: ['once', 'deny'] })
    await new Promise(r => setTimeout(r, 10))
    expect(calls.filter(c => c[0] === 'approve' && c[2] === 'once')).toEqual([])
    expect(calls.at(-1)).toEqual(['approve', 'run', 'deny', 'p2', 2])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('waits for an in-flight deny before stopping on concurrent cancel (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  let releaseDeny: (v: 'ok') => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { onRun('run'); onApproval('run', { requestId: 'p1', generation: 1, description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: (...args: any[]) => { calls.push(['approve', ...args]); return new Promise(r => { releaseDeny = r }) }, stop: async (id: string) => { calls.push(['stop', id]); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'owner-951', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  const first = conv.cancel('owner-951'), second = conv.cancel('owner-951')
  await new Promise(r => setTimeout(r, 10))
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1]])
  releaseDeny('ok')
  await Promise.all([first, second])
  expect(calls.slice(1)).toEqual([['stop', 'run'], ['stop', 'run']])
})
it('reports cancel as unconfirmed when the deny before stop is unknown (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { onRun('run'); onApproval('run', { requestId: 'p1', generation: 1, description: 'test', command: 'echo hi', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: async (...args: any[]) => { calls.push(['approve', ...args]); return 'unknown' }, stop: async (id: string) => { calls.push(['stop', id]); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web' })
  conv.submit({ requestId: 'owner-952', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  expect(await conv.cancel('owner-952')).toBe('unknown')
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1], ['stop', 'run']])
})
it('treats only 404/409 approval responses as not pending (BOXP-503)', async () => {
  const { createHermes: real } = await import('./hermes.js')
  for (const [status, expected] of [[409, 'not_pending'], [404, 'not_pending'], [429, 'unknown'], [400, 'unknown'], [200, 'ok']] as const) {
    const hermes = real({ url: 'http://h', key: 'k', fetch: (async () => new Response(status === 200 ? '{}' : 'x', { status })) as typeof fetch })
    expect(await hermes.approve('run', 'deny', 'p1', 1)).toBe(expected)
  }
})
it('does not report cancel as successful when a deny for an approval arriving after stop is unknown (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  let cb: any = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { cb = onApproval; onRun('run'); return new Promise(() => {}) }, approve: async (...args: any[]) => { calls.push(['approve', ...args]); return 'unknown' }, stop: async (id: string) => { calls.push(['stop', id]); setTimeout(() => cb('run', { requestId: 'p2', generation: 2, description: 'test', command: 'echo late', choices: ['once', 'deny'] }), 5); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 50 })
  conv.submit({ requestId: 'owner-953', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  expect(await conv.cancel('owner-953')).toBe('unknown')
  expect(calls).toEqual([['stop', 'run'], ['approve', 'run', 'deny', 'p2', 2], ['approve', 'run', 'deny', 'p2', 2]])
  expect(await conv.approve('owner-953', conv.get('owner-953')!.approval!.approvalId, 'once')).toBe('approval_conflict')
  // 窓の外で届いた場合も、記録された未確認状態により後続の cancel は成功を返さない。
  cb('run', { requestId: 'p3', generation: 3, description: 'test', command: 'echo later', choices: ['once', 'deny'] })
  expect(await conv.cancel('owner-953')).toBe('unknown')
})
it('does not report cancel as successful while the run end is unconfirmed (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  let settle: (v: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, _onApproval: any, _a: any, onRun: any) => { onRun('run'); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'owner-954', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  expect(await conv.cancel('owner-954')).toBe('unknown')
  const second = conv.submit({ requestId: 'owner-955', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  expect(second).toEqual({ error: 'busy' })
  settle({ status: 'failed', error: 'x' }); await new Promise(r => setTimeout(r, 5))
  expect(conv.get('owner-954')!.status).toBe('failed')
})
it('does not report cancel as successful when the run settles as unknown (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  let settle: (v: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, _onApproval: any, _a: any, onRun: any) => { onRun('run'); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async () => { settle({ status: 'unknown', error: 'poll_failed' }); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'owner-957', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }, 'i')
  expect(await conv.cancel('owner-957')).toBe('unknown')
  expect(conv.get('owner-957')!.status).toBe('unknown')
})
it('waits for the touch auto-deny before stopping and reports its unknown result (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  let releaseDeny: (v: 'unknown') => void = () => {}, settle: (v: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { onRun('run'); onApproval('run', { requestId: 'p1', generation: 1, description: 'x', command: 'echo x', choices: ['once', 'deny'] }); return new Promise(r => { settle = r }) }, approve: (...args: any[]) => { calls.push(['approve', ...args]); return new Promise(r => { releaseDeny = r }) }, stop: async (id: string) => { calls.push(['stop', id]); settle({ status: 'failed', error: 'stopped' }); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'touch-956', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 1 }, expiresAt: Date.now() + 60000 }, 'i')
  const cancelled = conv.cancel('touch-956')
  await new Promise(r => setTimeout(r, 10))
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1]])
  releaseDeny('unknown')
  expect(await cancelled).toBe('unknown')
  expect(calls.slice(1)).toEqual([['stop', 'run']])
})
it('does not report cancel as successful when a touch run settles as unknown (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  let settle: (v: any) => void = () => {}
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { onRun('run'); onApproval('run', { requestId: 'p1', generation: 1, description: 'x', command: 'echo x', choices: ['once', 'deny'] }); return new Promise(r => { settle = r }) }, approve: async () => 'ok', stop: async () => { settle({ status: 'unknown', error: 'poll_failed' }); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'touch-958', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 1 }, expiresAt: Date.now() + 60000 }, 'i')
  expect(await conv.cancel('touch-958')).toBe('unknown')
  expect(conv.get('touch-958')!.status).toBe('failed')
})
it('does not resend or overwrite the touch auto-deny when the same approval is re-notified (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  const releases: ((v: any) => void)[] = []
  let settle: (v: any) => void = () => {}, cb: any = () => {}
  const req = { requestId: 'p1', generation: 1, description: 'x', command: 'echo x', choices: ['once', 'deny'] }
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { cb = onApproval; onRun('run'); onApproval('run', req); return new Promise(r => { settle = r }) }, approve: (...args: any[]) => { calls.push(['approve', ...args]); return new Promise(r => { releases.push(r) }) }, stop: async (id: string) => { calls.push(['stop', id]); settle({ status: 'failed', error: 'stopped' }); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'touch-959', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 1 }, expiresAt: Date.now() + 60000 }, 'i')
  const first = conv.get('touch-959')!.approval
  cb('run', req)
  expect(conv.get('touch-959')!.approval).toBe(first)
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1]])
  const cancelled = conv.cancel('touch-959')
  await new Promise(r => setTimeout(r, 10))
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1]])
  releases[0]('unknown')
  expect(await cancelled).toBe('unknown')
  expect(calls.slice(1)).toEqual([['stop', 'run']])
})
it('retries the touch auto-deny when the same approval is re-notified after an unknown result (BOXP-503)', async () => {
  const { createConversation } = await import('./conversation.js')
  const calls: any[] = []
  const results = ['unknown', 'ok']
  let settle: (v: any) => void = () => {}, cb: any = () => {}
  const req = { requestId: 'p1', generation: 1, description: 'x', command: 'echo x', choices: ['once', 'deny'] }
  const hermes = { run: (_id: string, _text: string, _session: string, _i: string, onApproval: any, _a: any, onRun: any) => { cb = onApproval; onRun('run'); onApproval('run', req); return new Promise(r => { settle = r }) }, approve: async (...args: any[]) => { calls.push(['approve', ...args]); return results.shift() }, stop: async (id: string) => { calls.push(['stop', id]); settle({ status: 'failed', error: 'stopped' }); return 'ok' } } as unknown as ReturnType<typeof createHermes>
  const conv = createConversation({ now: Date.now, hermes, prefix: 'kohako-web', cancelSettleMs: 20 })
  conv.submit({ requestId: 'touch-960', kind: 'touch', touch: { zone: 'head', action: 'pat', count: 1 }, expiresAt: Date.now() + 60000 }, 'i')
  await new Promise(r => setTimeout(r, 0))
  expect(conv.get('touch-960')!.approval!.result).toBe('unknown')
  cb('run', req)
  await new Promise(r => setTimeout(r, 0))
  expect(calls).toEqual([['approve', 'run', 'deny', 'p1', 1], ['approve', 'run', 'deny', 'p1', 1]])
  expect(conv.get('touch-960')!.approval!.result).toBe('ok')
  expect(await conv.cancel('touch-960')).toBe('ok')
})
it('serves status only to authenticated principals and only by GET', async () => {
  const { createStatus } = await import('./status.js')
  const status = createStatus({ fetch, now: Date.now, quotaUrl: '', boardUrl: '' })
  for (const enabled of [false, true]) {
    const server = createServer(createApp({ authenticate: async h => h.authorization === 'owner' ? 'owner' : h.authorization === 'verifier' ? 'verifier' : null, ...(enabled ? { status } : {}) }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/status`
      expect((await fetch(url)).status).toBe(401)
      for (const authorization of ['owner', 'verifier']) { const response = await fetch(url, { headers: { authorization } }); expect(response.status).toBe(enabled ? 200 : 503); expect(response.headers.get('cache-control')).toBe('no-store') }
      expect((await fetch(url, { method: 'POST', headers: { authorization: 'owner' } })).status).toBe(404)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})
it('returns cleaned replies and only valid views', async () => {
  let output = ''
  const seen: string[] = [], hermes = { run: async (_i: string, _t: string, _s: string, ins: string) => { seen.push(ins); return { status: 'done', text: output } } } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    for (const [id, json, valid] of [['view-123', '{"kind":"usage"}', true], ['view-456', '{"kind":"usage","x":1}', false]] as const) {
      output = `返答\n\`\`\`kohako-view\n${json}\n\`\`\``
      await fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, kind: 'text', text: 'hello', expiresAt: Date.now() + 60000, views: true }) })
      await new Promise(r => setTimeout(r, 10))
      const item = await (await fetch(base + `requests/${id}`)).json() as any
      expect(item.reply.text).toBe('返答'); expect(item.reply.views).toEqual(valid ? [{ kind: 'usage' }] : undefined)
    }
    // Studio（views 未指定）では view 形式を指示せず、本文もそのまま返す（ブロックを消して結果を失わない）。
    expect(seen.at(-1)).toBe(instructions)
    output = "返答\n```kohako-view\n{\"kind\":\"usage\"}\n```"
    await fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'studio-123', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000 }) })
    await new Promise(r => setTimeout(r, 10))
    const studio = await (await fetch(base + 'requests/studio-123')).json() as any
    expect(seen.at(-1)).toBe(studioInstructions); expect(studioInstructions).not.toContain('kohako-view')
    expect(studio.reply.text).toBe(output); expect(studio.reply.views).toBeUndefined()
    expect((await fetch(base + 'messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'studio-456', kind: 'text', text: 'hello', expiresAt: Date.now() + 60000, views: 'yes' }) })).status).toBe(400)
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
it('separates notifier and verifier audiences including cached reviews', async () => {
  const a = createAuth({ jwks: { getKey: async () => publicKey.export({ format: 'jwk' }) }, issuer: 'https://access.example.test', audience: 'abc', ownerEmails: ['owner@example.test'], verifierEnabled: true, verifierUsername: 'sa', notifierEnabled: true, notifierUsername: 'sa', now: Date.now, review: async (token, audience) => ({ status: { authenticated: token === audience, user: { username: 'sa' }, audiences: [audience] } }) })
  expect(await a({ authorization: 'Bearer kohako-bff-verifier' })).toBe('verifier')
  expect(await a({ authorization: 'Bearer kohako-bff-notifier' })).toBe('notifier')
  expect(await a({ authorization: 'Bearer kohako-bff-verifier' })).toBe('verifier')
  expect(await a({ authorization: 'Bearer other' })).toBeNull()
})
it('disables notification routes without storage and restricts verifier', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { createPush } = await import('./push.js'), { createNotifications } = await import('./notifications.js')
  const dir = await mkdtemp(join(tmpdir(), 'routes-')), push = await createPush(dir, { subject: 'https://example.com', quietHours: '2-9' }), notifications = await createNotifications(dir, push.send)
  const authenticate = async (h: any) => h.authorization === 'verifier' ? 'verifier' as const : h.authorization === 'notifier' ? 'notifier' as const : 'owner' as const
  const server = createServer(createApp({ authenticate, notifications, push })), disabled = createServer(createApp({ authenticate }))
  await Promise.all([server, disabled].map(s => new Promise<void>(r => s.listen(0, '127.0.0.1', r))))
  try {
    const base = (s: typeof server) => `http://127.0.0.1:${(s.address() as { port: number }).port}/kohako/api/v1/`
    const post = (path: string, who: string) => fetch(base(server) + path, { method: 'POST', headers: { authorization: who, 'content-type': 'application/json' }, body: '{}' })
    expect((await fetch(base(disabled) + 'notifications')).status).toBe(503)
    expect((await post('notifications/ingest', 'verifier')).status).toBe(403)
    expect((await post('notifications/ingest', 'owner')).status).toBe(403)
    expect((await post('notifications/event-123456/reply', 'verifier')).status).toBe(403)
    expect((await fetch(base(server) + 'notifications', { headers: { authorization: 'verifier' } })).status).toBe(200)
  } finally { for (const s of [server, disabled]) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())) }; await rm(dir, { recursive: true, force: true }) }
})
it('resumes a notification reply after a BFF restart without executing it twice in Hermes', async () => {
  const { mkdtemp, rm, readFile, writeFile } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { createPush } = await import('./push.js'), { createNotifications } = await import('./notifications.js'), { createHermes: real } = await import('./hermes.js')
  const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  // Hermes の durable idempotency（同じ鍵・同じ本文なら同じ run を replay、本文違いは 409）を模した上流。
  const keys = new Map<string, { body: string; runId: string }>(), posts: string[] = [], polls: string[] = []; let executions = 0
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/toolsets')) return json(200, { data: [] })
    if (url.endsWith('/v1/runs')) {
      const key = (init!.headers as Record<string, string>)['Idempotency-Key'], body = String(init!.body), seen = keys.get(key); posts.push(key)
      if (seen) return seen.body === body ? json(202, { run_id: seen.runId, replayed: true }) : json(409, { error: { code: 'idempotency_key_conflict' } })
      const runId = `run${++executions}`; keys.set(key, { body, runId }); return json(202, { run_id: runId })
    }
    polls.push(url.split('/').pop()!); return json(200, { status: 'completed', output: '了解しました' })
  }) as unknown as typeof fetch
  const dir = await mkdtemp(join(tmpdir(), 'resume-')), push = await createPush(dir, { subject: 'https://example.com', quietHours: '2-9' })
  const start = async () => { const notifications = await createNotifications(dir, push.send), server = createServer(createApp({ authenticate: async () => 'owner', notifications, push, hermes: real({ url: 'http://h', key: 'k', fetch: fetcher, sleep: async () => {} }) })); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return { notifications, server } }
  const stop = async (s: Awaited<ReturnType<typeof start>>) => { s.server.closeAllConnections(); await new Promise<void>(r => s.server.close(() => r())) }
  const api = (s: Awaited<ReturnType<typeof start>>, path: string, body?: object) => fetch(`http://127.0.0.1:${(s.server.address() as { port: number }).port}/kohako/api/v1/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  const until = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)) } throw Error('timeout') }
  const reply = { replyId: 'reply-123456', kind: 'choice', value: 'A' }
  let s = await start()
  try {
    await s.notifications.ingest({ eventId: 'event-123456', source: 'task-board', eventType: 'run-finished', ticketId: 'BOXP-1', title: 't', body: 'b', choices: ['A', 'B'], createdAt: '2026-01-01T00:00:00Z' })
    const first = await (await api(s, 'notifications/event-123456/reply', reply)).json() as { requestId: string; status: string }
    expect(first.status).toBe('submitted')
    await until(async () => (await (await api(s, `requests/${first.requestId}`)).json() as { status: string }).status === 'done')
    const file = join(dir, 'notifications.json')
    await until(async () => JSON.parse(await readFile(file, 'utf8'))[0].reply.runId === 'run1')
    expect(executions).toBe(1); expect(posts).toHaveLength(1)
    // 再起動 1: run id が記録済み → 再送せず run1 の追跡だけを再開する。
    await stop(s); s = await start()
    expect((await api(s, `requests/${first.requestId}`)).status).toBe(404)
    const resumed = await (await api(s, 'notifications/event-123456/reply', reply)).json() as { requestId: string; status: string }
    expect(resumed).toMatchObject({ requestId: first.requestId, status: 'submitted' })
    await until(async () => (await (await api(s, `requests/${first.requestId}`)).json() as { status: string }).status === 'done')
    expect(posts).toHaveLength(1); expect(executions).toBe(1); expect(polls.at(-1)).toBe('run1')
    // 再起動 2: run id を記録する前に止まった場合 → 同じ鍵・同じ本文で再送し Hermes が同じ run を replay する（新しい実行はない）。
    const items = JSON.parse(await readFile(file, 'utf8')); delete items[0].reply.runId; await writeFile(file, JSON.stringify(items))
    await stop(s); s = await start()
    await api(s, 'notifications/event-123456/reply', reply)
    await until(async () => (await (await api(s, `requests/${first.requestId}`)).json() as { status: string }).status === 'done')
    expect(posts).toHaveLength(2); expect(new Set(posts).size).toBe(1); expect(executions).toBe(1)
  } finally { await stop(s); await rm(dir, { recursive: true, force: true }) }
})
