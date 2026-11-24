import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OTHER_MAX_BYTES, PDF_MAX_BYTES, PDF_MAX_PAGES } from './attachment-limits.js'
import { createAttachments } from './attachments.js'
import { partialNote } from './conversation.js'

/** BOXP-677: ページ数・本文・余白（大きな画像相当の stream）を指定した合成 PDF。 */
function pdf(pages: number, padTo = 0, line = (p: number) => `page ${p} ID-677`) {
  const parts: Buffer[] = [],
    offsets: number[] = []
  let len = 0
  const push = (b: Buffer) => {
    parts.push(b)
    len += b.length
  }
  push(Buffer.from('%PDF-1.4\n'))
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')
  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  for (let p = 1; p <= pages; p++) {
    const s = line(p)
      .split('\n')
      .map((l, i) => `BT /F1 10 Tf 20 ${780 - (i % 70) * 10} Td (${l}) Tj ET`)
      .join('\n')
    objs.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (p - 1) * 2} 0 R >>`,
      ),
      Buffer.from(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`),
    )
  }
  objs.forEach((o, i) => {
    offsets.push(len)
    push(Buffer.from(`${i + 1} 0 obj\n`))
    push(o)
    push(Buffer.from('\nendobj\n'))
  })
  const xref = len,
    tail = Buffer.from(
      `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    )
  // 末尾の %%EOF の後ろに PDF のコメント行で詰めて指定サイズにする（読み取りには影響しない）。
  const body = Buffer.concat([...parts, tail])
  if (padTo <= body.length) return body
  const pad = Buffer.alloc(padTo - body.length, 0x20)
  pad[0] = 0x25 // '%'
  pad[pad.length - 1] = 0x0a
  return Buffer.concat([body, pad])
}

describe('large PDF attachments (BOXP-677)', () => {
  it('accepts a 30 MiB PDF, reads its text and does not keep the original', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-677-'))
    try {
      const store = createAttachments(dir)
      const item = await store.upload(pdf(3, PDF_MAX_BYTES), 'application/pdf', 'big.pdf', 'owner', 1)
      expect(item).toMatchObject({
        size: PDF_MAX_BYTES,
        read: 'full',
        truncated: false,
        pages: 3,
        pagesRead: 3,
        stored: 0,
      })
      expect(item.extractedText).toContain('page 3 ID-677')
      const bin = (await readdir(join(dir, 'attachments'))).find((x) => x.endsWith('.bin')) as string
      expect((await stat(join(dir, 'attachments', bin))).size).toBe(0)
      const got = await store.get(item.id, 'owner', 1)
      expect(got?.meta.extractedText).toContain('page 1 ID-677')
      // 30 MiB を 1 バイト超えたら読まずに断る
      await expect(
        store.upload(pdf(1, PDF_MAX_BYTES + 1), 'application/pdf', 'over.pdf', 'owner', 1),
      ).rejects.toMatchObject({ status: 413, code: 'too_large' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps 5 MiB for images and text', async () => {
    const store = createAttachments()
    const png = (n: number) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(n - 8)])
    expect((await store.upload(png(OTHER_MAX_BYTES), 'image/png', 'a.png', 'owner', 1)).read).toBe('none')
    await expect(store.upload(png(OTHER_MAX_BYTES + 1), 'image/png', 'a.png', 'owner', 1)).rejects.toMatchObject({
      status: 413,
    })
    await expect(
      store.upload(Buffer.alloc(OTHER_MAX_BYTES + 1, 0x61), 'text/plain', 'a.txt', 'owner', 1),
    ).rejects.toMatchObject({ status: 413, code: 'too_large' })
  })

  it('reports a PDF over the page limit as partially read, never as fully read', async () => {
    const store = createAttachments()
    const at = await store.upload(pdf(PDF_MAX_PAGES), 'application/pdf', 'a.pdf', 'owner', 1)
    expect(at).toMatchObject({ read: 'full', truncated: false, pages: 30, pagesRead: 30 })
    const over = await store.upload(pdf(PDF_MAX_PAGES + 1), 'application/pdf', 'b.pdf', 'owner', 1)
    expect(over).toMatchObject({ read: 'partial', partialReason: 'pages', truncated: true, pages: 31, pagesRead: 30 })
    expect(over.extractedText).toContain('page 30 ID-677')
    expect(over.extractedText).not.toContain('page 31 ID-677')
    expect(partialNote(over)).toContain('全31ページのうち先頭30ページだけ')
    expect(partialNote(at)).toBe('')
    const long = await store.upload(
      pdf(10, 0, (p) => Array.from({ length: 60 }, (_, i) => `p${p}-${i} ${'x'.repeat(90)}`).join('\n')),
      'application/pdf',
      'c.pdf',
      'owner',
      1,
    )
    expect(long).toMatchObject({ read: 'partial', partialReason: 'text', truncated: true, pages: 10 })
    expect(Buffer.byteLength(long.extractedText ?? '')).toBeLessThanOrEqual(48000)
    expect(partialNote(long)).toContain('本文上限')
  })

  it('rejects a broken PDF as unreadable', async () => {
    const store = createAttachments()
    await expect(
      store.upload(Buffer.from('%PDF-1.4\nbroken'), 'application/pdf', 'x.pdf', 'owner', 1),
    ).rejects.toMatchObject({ status: 422, code: 'pdf_unreadable' })
  })

  it('refuses an oversized declared body without reading it and runs one large upload at a time', async () => {
    const { createApp } = await import('./app.js'),
      { createConversation } = await import('./conversation.js')
    const hermes = {} as unknown as ReturnType<typeof import('./hermes.js').createHermes>
    let release: () => void = () => {}
    const slow = new Promise<void>((r) => {
      release = r
    })
    const store = createAttachments()
    const attachments = {
      ...store,
      upload: async (...args: Parameters<typeof store.upload>) => {
        if (args[2] === 'slow.pdf') await slow
        return store.upload(...args)
      },
    }
    const server = createServer(
      createApp({
        authenticate: async (h) => (h.authorization === 'owner' ? 'owner' : null),
        conversations: { owner: createConversation({ now: Date.now, hermes, prefix: 'kohako-web' }) },
        attachments,
      } as Parameters<typeof createApp>[0]),
    )
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/attachments`
      const post = (name: string, body: Buffer) =>
        fetch(url, {
          method: 'POST',
          headers: { authorization: 'owner', 'content-type': 'application/pdf', 'x-kohako-filename': name },
          body: body as BodyInit,
        })
      const big = pdf(2, 6 * 1024 * 1024)
      const first = post('slow.pdf', big)
      await new Promise((r) => setTimeout(r, 200))
      const busy = await post('second.pdf', big)
      expect(busy.status).toBe(429)
      expect(await busy.json()).toEqual({ error: 'attachment_busy' })
      // 5 MiB 以下は大きな添付の処理中でも受け付ける
      expect((await post('small.pdf', pdf(1))).status).toBe(201)
      release()
      const done = await first
      expect(done.status).toBe(201)
      expect(await done.json()).toMatchObject({ read: 'full', pages: 2, pagesRead: 2, size: big.length })
      expect((await post('again.pdf', big)).status).toBe(201)
      const over = await post('over.pdf', pdf(1, PDF_MAX_BYTES + 1))
      expect(over.status).toBe(413)
      expect(await over.json()).toEqual({ error: 'too_large' })
    } finally {
      release()
      server.close()
    }
  })
})
