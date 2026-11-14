export async function fetchJson(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(Error('timeout'))
        }, timeoutMs)
      }),
      (async () => {
        const response = await fetcher(url, { signal: controller.signal, redirect: 'error' })
        if (!response.ok || !response.body) throw Error('upstream')
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
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
        } finally {
          reader.releaseLock()
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      })(),
    ])
  } finally {
    clearTimeout(timer)
  }
}
