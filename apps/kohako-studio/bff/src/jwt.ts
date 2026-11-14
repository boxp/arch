import { createPublicKey, verify } from 'node:crypto'
import type { JwksProvider } from './jwks.js'
export type JwtResult =
  | { ok: true; email: string; exp: number }
  | { ok: false; reason: 'malformed' | 'algorithm' | 'key' | 'signature' | 'claims' | 'owner' }
export async function verifyAccessJwt(
  token: string,
  {
    jwks,
    issuer,
    audience,
    ownerEmails,
    now,
  }: { jwks: JwksProvider; issuer: string; audience: string; ownerEmails: string[]; now: () => number },
): Promise<JwtResult> {
  const bad = (reason: Extract<JwtResult, { ok: false }>['reason']): JwtResult => ({ ok: false, reason })
  if (token.length > 8192) return bad('malformed')
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((x) => !x || !/^[A-Za-z0-9_-]+$/.test(x))) return bad('malformed')
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (header?.alg !== 'RS256') return bad('algorithm')
    if (typeof header.kid !== 'string' || !header.kid) return bad('key')
    const jwk = await jwks.getKey(header.kid)
    if (jwk?.kty !== 'RSA') return bad('key')
    if (
      !verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      )
    )
      return bad('signature')
    const current = now() / 1000
    if (
      claims.iss !== issuer ||
      !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience))) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      current >= claims.exp ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > current + 60)) ||
      (claims.iat !== undefined &&
        (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > current + 60))
    )
      return bad('claims')
    if (typeof claims.email !== 'string' || !ownerEmails.includes(claims.email.toLowerCase())) return bad('owner')
    return { ok: true, email: claims.email.toLowerCase(), exp: claims.exp }
  } catch {
    return bad('malformed')
  }
}
