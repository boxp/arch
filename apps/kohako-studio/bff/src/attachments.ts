import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomic } from './storage.js'
/** 1 メッセージの画像合計（生バイト）。base64 化後も Hermes の要求上限 10MB に収まる値。 */
export const ATTACHMENT_IMAGE_TOTAL = 5.5 * 1024 * 1024
/** 1 メッセージの抽出テキスト合計（UTF-8 バイト）。枠・本文込みで Hermes の正規化テキスト上限 64KB に収まる値。1 件の上限も同じ。 */
export const ATTACHMENT_TEXT_TOTAL = 48000

type Kind = 'image' | 'pdf' | 'text'
export type Attachment = { id: string; principal: string; sessionKey: number; kind: Kind; mime: string; size: number; displayName: string; createdAt: number; truncated: boolean; extractedText?: string }
export class AttachmentError extends Error { constructor(public code: string, public status: number) { super(code) } }
const fail = (code: string, status: number): never => { throw new AttachmentError(code, status) }
export function createAttachments(dir?: string, now = Date.now, quota = 200 * 1024 * 1024, maxCount = 200) {
  const folder = dir && join(dir, 'attachments'), memory = new Map<string, { meta: Attachment; data: Buffer }>()
  let lock = Promise.resolve()
  async function list(): Promise<Attachment[]> {
    if (!folder) return [...memory.values()].map(x => x.meta)
    await mkdir(folder, { recursive: true })
    const names = await readdir(folder), items: Attachment[] = []
    for (const name of names) if (/^[a-f0-9]{32}\.json$/.test(name)) { try { const m = JSON.parse(await readFile(join(folder, name), 'utf8')) as Attachment; if (m.id === name.slice(0, 32)) items.push(m) } catch { /* invalid metadata */ } }
    return items
  }
  async function remove(id: string) { if (!folder) memory.delete(id); else await Promise.all([rm(join(folder, id + '.json'), { force: true }), rm(join(folder, id + '.bin'), { force: true })]) }
  async function clean(extra = 0) {
    const items = (await list()).sort ( (a, b) => a.createdAt - b.createdAt )
    let total = items.reduce((n, x) => n + x.size, 0), count = items.length
    for (const item of items) if (now() - item.createdAt >= 86400000 || total + extra > quota || count >= maxCount) { await remove(item.id); total -= item.size; count-- }
  }
  async function get(id: string, principal: string, sessionKey: number) {
    if (!/^[a-f0-9]{32}$/.test(id)) return undefined
    try {
      const meta = folder ? JSON.parse(await readFile(join(folder, id + '.json'), 'utf8')) as Attachment : memory.get(id)?.meta
      if (!meta || meta.id !== id || meta.principal !== principal || meta.sessionKey !== sessionKey || now() - meta.createdAt >= 86400000) return undefined
      const data = folder ? await readFile(join(folder, id + '.bin')) : memory.get(id)!.data
      return { meta, data }
    } catch { return undefined }
  }
  async function upload(data: Buffer, claim: string, filename: string, principal: string, sessionKey: number) {
    if (data.length > 5 * 1024 * 1024) fail('too_large', 413)
    const mime = claim.split(';')[0].trim().toLowerCase()
    let kind: Kind, detected: string, extractedText: string | undefined, truncated = false
    if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) { kind = 'image'; detected = 'image/png' }
    else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) { kind = 'image'; detected = 'image/jpeg' }
    else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') { kind = 'image'; detected = 'image/webp' }
    else if (/^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) { kind = 'image'; detected = 'image/gif' }
    else if (data.toString('ascii', 0, 5) === '%PDF-') { kind = 'pdf'; detected = 'application/pdf' }
    else {
      if (!(mime.startsWith('text/') || /\.(txt|md|csv|json|log|yaml|yml|tsv)$/i.test(filename)) || data.includes(0)) fail('unsupported_type', 415)
      try { extractedText = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { return fail('unsupported_type', 415) }
      kind = 'text'; detected = mime || 'text/plain'
    }
    if (kind !== 'text' && mime !== detected || kind === 'text' && !(mime.startsWith('text/') || ['application/octet-stream', 'application/json', 'application/yaml', 'application/x-yaml', ''].includes(mime))) fail('unsupported_type', 415)
    if (kind === 'pdf') {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true })
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const result = await Promise.race([(async () => { const pdf = await task.promise; let text = ''; for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) { const page = await pdf.getPage(i), content = await page.getTextContent(); text += content.items.map(x => 'str' in x ? x.str : '').join(' ') + '\n'; if (text.length > 40000) break } truncated = pdf.numPages > 30 || text.length > 40000; return text })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 10000) })])
          extractedText = result; if (!result.trim()) fail('pdf_no_text', 422)
        } finally { clearTimeout(timer); await task.destroy() }
      } catch (e) { if (e instanceof AttachmentError) throw e; return fail('pdf_unreadable', 422) }
    }
    if (extractedText && extractedText.length > 40000) { extractedText = extractedText.slice(0, 40000); truncated = true }
    if (extractedText && Buffer.byteLength(extractedText) > ATTACHMENT_TEXT_TOTAL) { let low = 0, high = extractedText.length; while (low < high) { const mid = Math.ceil((low + high) / 2); if (Buffer.byteLength(extractedText.slice(0, mid)) <= ATTACHMENT_TEXT_TOTAL) low = mid; else high = mid - 1 } extractedText = extractedText.slice(0, low); truncated = true }
    const displayName = filename.replace(/[\x00-\x1f\x7f-\x9f/\\]/g, '_').slice(0, 120) || 'file'
    const meta: Attachment = { id: randomBytes(16).toString('hex'), principal, sessionKey, kind, mime: detected, size: data.length, displayName, createdAt: now(), truncated, ...(extractedText !== undefined ? { extractedText } : {}) }
    const work = lock.then(async () => { await clean(data.length); if (folder) { await writeFile(join(folder, meta.id + '.bin'), data, { mode: 0o600, flag: 'wx' }); await atomic(join(folder, meta.id + '.json'), meta) } else memory.set(meta.id, { meta, data }) })
    lock = work.catch(() => {}); await work
    return meta
  }
  void clean().catch(() => {})
  const timer = setInterval(() => { lock = lock.then(() => clean()).catch(() => {}) }, 3600000); timer.unref()
  return { upload, get, clean }
}
