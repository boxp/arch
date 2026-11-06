import { fetchJson } from './fetchJson.js'
import type { JsonWebKey } from 'node:crypto'
export type JwksProvider = { getKey(kid: string): Promise<JsonWebKey | null> }
export function createJwksProvider({
  url,
  fetch: fetcher,
  now,
  ttlMs = 600_000,
  refetchMinIntervalMs = 60_000,
  timeoutMs = 3000,
  maxBytes = 65536,
}: {
  url: string
  fetch: typeof fetch
  now: () => number
  ttlMs?: number
  refetchMinIntervalMs?: number
  timeoutMs?: number
  maxBytes?: number
}): JwksProvider {
  let keys = new Map<string, JsonWebKey>(),
    fetchedAt = -Infinity,
    lastAttempt = -Infinity
  let pending: Promise<void> | undefined
  async function refresh() {
    if (pending) return pending
    lastAttempt = now()
    pending = (async () => {
      try {
        const data = (await fetchJson(url, fetcher, timeoutMs, maxBytes)) as { keys?: unknown }
        if (!Array.isArray(data?.keys)) throw Error('invalid jwks')
        const next = new Map<string, JsonWebKey>()
        for (const key of data.keys)
          if (key && key.kty === 'RSA' && typeof key.kid === 'string' && key.kid) next.set(key.kid, key)
        keys = next
        fetchedAt = now()
      } catch {
        /* Fail closed until the next allowed refresh. */
      }
    })()
    try {
      await pending
    } finally {
      pending = undefined
    }
  }
  return {
    async getKey(kid) {
      if (pending) await pending
      const time = now()
      if ((time - fetchedAt >= ttlMs || !keys.has(kid)) && time - lastAttempt >= refetchMinIntervalMs) await refresh()
      return now() - fetchedAt < ttlMs ? (keys.get(kid) ?? null) : null
    },
  }
}
