import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { createApp } from './app.js'
import type { createHermes } from './hermes.js'
import { watchInstructions } from './watch.js'

// BOXP-779 仕様（Projects/kohako-home/watch-together-spec.md 決まり 1・5・6）: 共有画面への呼びかけの発言は
// 本人の家の発言だけ・画像 1 件必須で、その turn の instructions にだけ画面の扱いの指示が付く。
it('accepts watch turns only from the owner home with one image, and adds the turn-only instruction', async () => {
  const calls: unknown[][] = []
  const hermes = {
    run: (...args: unknown[]) => {
      calls.push(args)
      return new Promise(() => {})
    },
    stop: async () => 'ok',
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
  const server = createServer(
    createApp({
      authenticate: async (h) =>
        h.authorization === 'owner' ? 'owner' : h.authorization === 'verifier' ? 'verifier' : null,
      hermes,
    }),
  )
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const upload = async (who: string, type: string, data: string | Buffer) =>
      (
        (await (
          await fetch(`${base}attachments`, {
            method: 'POST',
            headers: { authorization: who, 'content-type': type, 'x-kohako-filename': 'shared-screen.jpg' },
            body: data as BodyInit,
          })
        ).json()) as { attachmentId: string }
      ).attachmentId
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
    const img = await upload('owner', 'image/jpeg', jpeg),
      img2 = await upload('owner', 'image/jpeg', jpeg),
      txt = await upload('owner', 'text/plain', 'hello'),
      vimg = await upload('verifier', 'image/jpeg', jpeg)
    let n = 0
    const send = (who: string, extra: Record<string, unknown>) =>
      fetch(`${base}messages`, {
        method: 'POST',
        headers: { authorization: who, 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: `request-watch-${++n}`,
          kind: 'text',
          text: 'ヘイ、コハコ。この景色どう？',
          expiresAt: Date.now() + 60000,
          ...extra,
        }),
      })
    // 断る: 本人以外・画像なし・画像以外・2 件・views なし・true 以外
    expect((await send('verifier', { views: true, watch: true, attachments: [vimg] })).status).toBe(403)
    expect((await send('owner', { views: true, watch: true })).status).toBe(400)
    expect((await send('owner', { views: true, watch: true, attachments: [txt] })).status).toBe(400)
    expect((await send('owner', { views: true, watch: true, attachments: [img, img2] })).status).toBe(400)
    expect((await send('owner', { watch: true, attachments: [img] })).status).toBe(400)
    expect((await send('owner', { views: true, watch: 'yes', attachments: [img] })).status).toBe(400)
    expect((await send('owner', { views: true, watch: false, attachments: [img] })).status).toBe(400)
    expect(calls).toHaveLength(0)
    // 受ける: 本人・家（views）・画像 1 件
    expect((await send('owner', { views: true, watch: true, attachments: [img] })).status).toBe(202)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(1)
    const input = calls[0][1] as { content: { type: string; text?: string; image_url?: { url: string } }[] }[]
    expect(input[0].content[0].text).toBe('ヘイ、コハコ。この景色どう？')
    expect(input[0].content[1].image_url?.url).toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
    expect(String(calls[0][3])).toContain(watchInstructions)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

it('does not add the watch instruction to ordinary home turns', async () => {
  const calls: unknown[][] = []
  const hermes = {
    run: (...args: unknown[]) => {
      calls.push(args)
      return new Promise(() => {})
    },
    stop: async () => 'ok',
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
  const server = createServer(createApp({ authenticate: async () => 'owner', hermes }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const r = await fetch(`${base}messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'request-plain-1',
        kind: 'text',
        text: 'こんにちは',
        views: true,
        expiresAt: Date.now() + 60000,
      }),
    })
    expect(r.status).toBe(202)
    await new Promise((r) => setTimeout(r, 20))
    expect(String(calls[0][3])).not.toContain(watchInstructions)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

it('says what the shared frame is and what not to keep', () => {
  expect(watchInstructions).toContain('共有')
  expect(watchInstructions).toContain('1 枚')
  expect(watchInstructions).toContain('記憶')
  expect(watchInstructions).toContain('非信頼')
})
