import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { verifyAccessJwt } from './jwt.js'
import type { JwksProvider } from './jwks.js'
const audience = 'kohako-bff-verifier'
const saPath = '/var/run/secrets/kubernetes.io/serviceaccount'
type Review = { status?: { authenticated?: boolean; user?: { username?: string }; audiences?: string[] } }
async function tokenReview(token: string): Promise<Review> {
  const [serviceToken, ca] = await Promise.all([readFile(`${saPath}/token`, 'utf8'), readFile(`${saPath}/ca.crt`)])
  const body = JSON.stringify({ apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview', spec: { token, audiences: [audience] } })
  return new Promise((resolve, reject) => {
    const req = request('https://kubernetes.default.svc/apis/authentication.k8s.io/v1/tokenreviews', { method: 'POST', ca, headers: { authorization: `Bearer ${serviceToken.trim()}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 5000 }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; if (data.length > 65536) req.destroy() }); res.on('end', () => { try { if (res.statusCode !== 201 && res.statusCode !== 200) throw Error(); resolve(JSON.parse(data)) } catch { reject(Error('review failed')) } })
    }); req.on('timeout', () => req.destroy()); req.on('error', reject); req.end(body)
  })
}
export function createAuth(options: { jwks: JwksProvider; issuer: string; audience: string; ownerEmails: string[]; verifierEnabled: boolean; verifierUsername: string; now: () => number; review?: (token: string) => Promise<Review> }) {
  const cache = new Map<string, number>()
  return async (headers: import('node:http').IncomingHttpHeaders): Promise<'owner' | 'verifier' | null> => {
    const jwt = headers['cf-access-jwt-assertion']
    if (typeof jwt === 'string') {
      const result = await verifyAccessJwt(jwt, { ...options, now: options.now })
      return result.ok ? 'owner' : null
    }
    const auth = headers.authorization
    if (!options.verifierEnabled || !auth || !/^Bearer [^\s]+$/.test(auth) || auth.length > 8199) return null
    const token = auth.slice(7), hash = createHash('sha256').update(token).digest('hex'), now = options.now()
    if ((cache.get(hash) ?? 0) > now) return 'verifier'
    try {
      const result = await (options.review ?? tokenReview)(token), status = result.status
      if (status?.authenticated === true && status.user?.username === options.verifierUsername && status.audiences?.includes(audience)) {
        for (const [key, expiry] of cache) if (expiry <= now) cache.delete(key)
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
        cache.set(hash, now + 60_000); return 'verifier'
      }
    } catch { /* fail closed */ }
    return null
  }
}
