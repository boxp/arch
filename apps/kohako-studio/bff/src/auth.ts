import { must } from './must.js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { verifyAccessJwt } from './jwt.js'
import type { JwksProvider } from './jwks.js'
const audience = 'kohako-bff-verifier'
export const G2_TOKEN_AUDIENCE = 'kohako-bff-g2'
export const G2_OWNER_HEADER = 'x-kohako-owner-assertion'
const saPath = '/var/run/secrets/kubernetes.io/serviceaccount'
type Review = { status?: { authenticated?: boolean; user?: { username?: string }; audiences?: string[] } }
async function tokenReview(token: string, audience: string): Promise<Review> {
  const [serviceToken, ca] = await Promise.all([readFile(`${saPath}/token`, 'utf8'), readFile(`${saPath}/ca.crt`)])
  const body = JSON.stringify({
    apiVersion: 'authentication.k8s.io/v1',
    kind: 'TokenReview',
    spec: { token, audiences: [audience] },
  })
  return new Promise((resolve, reject) => {
    const req = request(
      'https://kubernetes.default.svc/apis/authentication.k8s.io/v1/tokenreviews',
      {
        method: 'POST',
        ca,
        headers: {
          authorization: `Bearer ${serviceToken.trim()}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
          if (data.length > 65536) req.destroy()
        })
        res.on('end', () => {
          try {
            if (res.statusCode !== 201 && res.statusCode !== 200) throw Error()
            resolve(JSON.parse(data))
          } catch {
            reject(Error('review failed'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', reject)
    req.end(body)
  })
}
export function createAuth(options: {
  jwks: JwksProvider
  issuer: string
  audience: string
  ownerEmails: string[]
  verifierEnabled: boolean
  verifierUsername: string
  now: () => number
  notifierEnabled?: boolean
  notifierUsername?: string
  /**
   * BOXP-657: 眼鏡の入口（G2 の BFF）用の principal。既定は無効。
   * 「G2 の Pod であること」（audience kohako-bff-g2 の ServiceAccount token）と「本人の操作であること」
   * （G2 の BFF が受け取った本人の Access JWT。G2 の AUD・Owner・期限を確かめる）の両方がそろった時だけ通す。
   */
  g2Enabled?: boolean
  g2Username?: string
  g2Audience?: string
  review?: (token: string, audience: string) => Promise<Review>
}) {
  const cache = new Map<string, number>()
  return async (
    headers: import('node:http').IncomingHttpHeaders,
  ): Promise<'owner' | 'verifier' | 'notifier' | 'g2' | null> => {
    const jwt = headers['cf-access-jwt-assertion']
    if (typeof jwt === 'string') {
      const result = await verifyAccessJwt(jwt, { ...options, now: options.now })
      return result.ok ? 'owner' : null
    }
    const auth = headers.authorization
    if (!auth || !/^Bearer [^\s]+$/.test(auth) || auth.length > 8199) return null
    const token = auth.slice(7),
      hash = createHash('sha256').update(token).digest('hex'),
      now = options.now()
    const principals = (
      [
        ['verifier', audience, options.verifierUsername, options.verifierEnabled],
        ['notifier', 'kohako-bff-notifier', options.notifierUsername, options.notifierEnabled],
        [
          'g2',
          G2_TOKEN_AUDIENCE,
          options.g2Username,
          options.g2Enabled && !!options.g2Username && !!options.g2Audience,
        ],
      ] as const
    ).filter((p) => p[3])
    // Pod の確認は 60 秒使い回すが、本人の証明は依頼ごとに確かめる（期限切れ・別 AUD・本人以外はその場で拒否）。
    const confirm = async (principal: (typeof principals)[number][0]) => {
      if (principal !== 'g2') return principal
      const assertion = headers[G2_OWNER_HEADER]
      if (typeof assertion !== 'string') return null
      const result = await verifyAccessJwt(assertion, {
        jwks: options.jwks,
        issuer: options.issuer,
        audience: must(options.g2Audience),
        ownerEmails: options.ownerEmails,
        now: options.now,
      })
      return result.ok ? principal : null
    }
    // 確認済みの token は、ほかの audience の TokenReview を呼ばずに返す（眼鏡の定期的な読み取りで API server を叩かない）。
    for (const [principal, aud] of principals) if ((cache.get(`${aud}:${hash}`) ?? 0) > now) return confirm(principal)
    for (const [principal, aud, username] of principals) {
      try {
        const status = (await (options.review ?? tokenReview)(token, aud)).status
        if (status?.authenticated === true && status.user?.username === username && status.audiences?.includes(aud)) {
          for (const [k, expiry] of cache) if (expiry <= now) cache.delete(k)
          if (cache.size >= 1000) cache.delete(must(cache.keys().next().value))
          cache.set(`${aud}:${hash}`, now + 60_000)
          return await confirm(principal)
        }
      } catch {
        /* fail closed */
      }
    }
    return null
  }
}
