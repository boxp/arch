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
  const hermes = { run: (_id: string, _text: string, session: string, _instructions: string, cb: any) => { sessions.push(session); cb('run', { description: 'test', command: '', choices: ['once', 'deny'] }); return new Promise(() => {}) }, approve: async () => 'ok', stop: async () => 'ok' } as unknown as ReturnType<typeof createHermes>
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
