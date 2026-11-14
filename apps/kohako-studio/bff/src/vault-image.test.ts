import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createHermes } from './hermes.js'

it('keeps vault reads Owner-only and returns private raster bytes', async () => {
  const image = Buffer.from('ffd8ff1122', 'hex')
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ mime: 'image/jpeg', data: image.toString('base64') })),
  )
  const hermes = createHermes({ url: 'http://hermes', key: 'server-secret', fetch: fetcher as typeof fetch })
  const server = createServer(
    createApp({
      authenticate: async (h) =>
        ['owner', 'verifier', 'notifier'].includes(h.authorization ?? '')
          ? (h.authorization as 'owner' | 'verifier' | 'notifier')
          : null,
      hermes,
    }),
  )
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/kohako/api/v1/vault-image?path=`
  try {
    for (const [who, status] of [
      ['', 401],
      ['verifier', 403],
      ['notifier', 403],
    ] as const)
      expect((await fetch(base + 'a.jpg', { headers: { authorization: who } })).status).toBe(status)
    expect(fetcher).not.toHaveBeenCalled()
    const r = await fetch(base + encodeURIComponent('attachments/案 1.jpg'), { headers: { authorization: 'owner' } })
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer())).toEqual(image)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://hermes/v1/kohako/vault-image?path=' + encodeURIComponent('attachments/案 1.jpg'),
    )
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({
      Authorization: 'Bearer server-secret',
    })
    expect((await fetch(base + '..%2Fsecret.jpg', { headers: { authorization: 'owner' } })).status).toBe(404)
    fetcher.mockImplementationOnce(async () => new Response('{}', { status: 404 }))
    expect((await fetch(base + 'missing.jpg', { headers: { authorization: 'owner' } })).status).toBe(404)
    fetcher.mockImplementationOnce(async () => {
      throw Error('offline')
    })
    expect((await fetch(base + 'a.jpg', { headers: { authorization: 'owner' } })).status).toBe(502)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})
