import { must } from './must.js'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomic } from './storage.js'
import {
  type AttachmentKind as Kind,
  classifyUpload,
  OTHER_MAX_BYTES,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  type PartialReason,
  type PdfFacts,
  type ReadState,
  TEXT_MAX_BYTES,
} from './attachment-limits.js'
/** 1 メッセージの画像合計（生バイト）。base64 化後も Hermes の要求上限 10MB に収まる値。 */
export const ATTACHMENT_IMAGE_TOTAL = 5.5 * 1024 * 1024
/** 1 メッセージの抽出テキスト合計（UTF-8 バイト）。枠・本文込みで Hermes の正規化テキスト上限 64KB に収まる値。1 件の上限も同じ。 */
export const ATTACHMENT_TEXT_TOTAL = TEXT_MAX_BYTES
/** PDF を開いて本文を読む時間の上限。30 MiB の PDF でも通常 1 秒未満（BOXP-677 実測）。nginx の応答待ち 60s より十分短くする。 */
export const PDF_TIMEOUT_MS = 20000
export type Attachment = {
  id: string
  principal: string
  sessionKey: number
  kind: Kind
  mime: string
  size: number
  displayName: string
  createdAt: number
  truncated: boolean
  /** 本文の読取状態。BOXP-677 より前の保存分には無い（truncated から読む）。 */
  read?: ReadState
  partialReason?: PartialReason
  /** PDF の総ページ数と、本文を読んだページ数。 */
  pages?: number
  pagesRead?: number
  /** 保存領域で使うバイト数。PDF は本文だけを使うため原本を保存せず 0。古い保存分には無い（size と同じ）。 */
  stored?: number
  extractedText?: string
}
export class AttachmentError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}
const fail = (code: string, status: number): never => {
  throw new AttachmentError(code, status)
}
/**
 * PDF の本文を先頭 PDF_MAX_PAGES ページ、TEXT_MAX_BYTES を超えるまで読む。スクリプト・フォント読込・外部取得はしない。
 * data の中身は pdfjs に渡したあと使わない（複製せずに渡し、30 MiB の PDF でメモリを二重に使わない）。
 */
async function readPdf(data: Buffer): Promise<{ facts: PdfFacts; text: string; pagesRead: number }> {
  let text = '',
    pagesRead = 0
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // pdfjs-dist 6 no longer compiles fonts with eval/new Function, so the former isEvalSupported:false option was removed.
    const task = pdfjs.getDocument({
      data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: true,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pages = await Promise.race([
        (async () => {
          const pdf = await task.promise
          for (let i = 1; i <= Math.min(pdf.numPages, PDF_MAX_PAGES); i++) {
            const page = await pdf.getPage(i),
              content = await page.getTextContent()
            text += `${content.items.map((x) => ('str' in x ? x.str : '')).join(' ')}\n`
            pagesRead = i
            if (Buffer.byteLength(text) > TEXT_MAX_BYTES) break
          }
          return pdf.numPages
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new PdfTimeout()), PDF_TIMEOUT_MS)
        }),
      ])
      return {
        facts: { status: 'ok', pages, textBytes: Buffer.byteLength(text), hasText: !!text.trim() },
        text,
        pagesRead,
      }
    } finally {
      clearTimeout(timer)
      await task.destroy()
    }
  } catch (e) {
    const status =
      e instanceof PdfTimeout
        ? 'timeout'
        : e && typeof e === 'object' && 'name' in e && e.name === 'PasswordException'
          ? 'encrypted'
          : 'unreadable'
    return { facts: { status }, text: '', pagesRead }
  }
}
class PdfTimeout extends Error {}
export function createAttachments(dir?: string, now = Date.now, quota = 200 * 1024 * 1024, maxCount = 200) {
  const folder = dir && join(dir, 'attachments'),
    memory = new Map<string, { meta: Attachment; data: Buffer }>()
  let lock = Promise.resolve(),
    expiryTimer: ReturnType<typeof setTimeout> | undefined
  async function list(): Promise<Attachment[]> {
    if (!folder) return [...memory.values()].map((x) => x.meta)
    await mkdir(folder, { recursive: true })
    const names = await readdir(folder),
      items: Attachment[] = []
    for (const name of names)
      if (/^[a-f0-9]{32}\.json$/.test(name)) {
        try {
          const m = JSON.parse(await readFile(join(folder, name), 'utf8')) as Attachment
          if (m.id === name.slice(0, 32)) items.push(m)
        } catch {
          /* invalid metadata */
        }
      }
    return items
  }
  async function remove(id: string) {
    if (!folder) memory.delete(id)
    else
      await Promise.all([
        rm(join(folder, `${id}.json`), { force: true }),
        rm(join(folder, `${id}.bin`), { force: true }),
      ])
  }
  async function clean(extra = 0) {
    const items = (await list()).sort((a, b) => a.createdAt - b.createdAt)
    let total = items.reduce((n, x) => n + (x.stored ?? x.size), 0),
      count = items.length
    const kept: Attachment[] = []
    for (const item of items)
      if (now() - item.createdAt >= 86400000 || total + extra > quota || count >= maxCount) {
        await remove(item.id)
        total -= item.stored ?? item.size
        count--
      } else kept.push(item)
    schedule(kept[0]?.createdAt)
  }
  /** 次に期限を迎える添付の作成から24時間ちょうどで削除を走らせ、保存期間の上限を超えて残さない。 */
  function schedule(oldest?: number) {
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = undefined
    if (oldest === undefined) return
    expiryTimer = setTimeout(
      () => {
        lock = lock.then(() => clean()).catch(() => {})
      },
      Math.min(Math.max(0, oldest + 86400000 - now()), 3600000),
    )
    expiryTimer.unref?.()
  }
  async function get(id: string, principal: string, sessionKey: number) {
    if (!/^[a-f0-9]{32}$/.test(id)) return undefined
    try {
      const meta = folder
        ? (JSON.parse(await readFile(join(folder, `${id}.json`), 'utf8')) as Attachment)
        : memory.get(id)?.meta
      if (
        !meta ||
        meta.id !== id ||
        meta.principal !== principal ||
        meta.sessionKey !== sessionKey ||
        now() - meta.createdAt >= 86400000
      )
        return undefined
      const data = folder ? await readFile(join(folder, `${id}.bin`)) : must(memory.get(id)).data
      return { meta, data }
    } catch {
      return undefined
    }
  }
  async function upload(data: Buffer, claim: string, filename: string, principal: string, sessionKey: number) {
    const size = data.length
    if (size > PDF_MAX_BYTES) fail('too_large', 413)
    const mime = claim.split(';')[0].trim().toLowerCase()
    let kind: Kind,
      detected: string,
      extractedText: string | undefined,
      pdfFacts: PdfFacts | undefined,
      pagesRead = 0
    if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      kind = 'image'
      detected = 'image/png'
    } else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      kind = 'image'
      detected = 'image/jpeg'
    } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
      kind = 'image'
      detected = 'image/webp'
    } else if (/^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) {
      kind = 'image'
      detected = 'image/gif'
    } else if (data.toString('ascii', 0, 5) === '%PDF-') {
      kind = 'pdf'
      detected = 'application/pdf'
    } else {
      // 未対応形式は PDF 上限 (30 MiB) 以下なら 415 を返す（モデルの limitOf unsupported = pdfMax）。
      if (!(mime.startsWith('text/') || /\.(txt|md|csv|json|log|yaml|yml|tsv)$/i.test(filename)))
        fail('unsupported_type', 415)
      // テキストは復号より先にサイズを判定する（5 MiB 超のテキストを復号しない）。
      if (size > OTHER_MAX_BYTES) fail('too_large', 413)
      if (data.includes(0)) fail('unsupported_type', 415)
      try {
        extractedText = new TextDecoder('utf-8', { fatal: true }).decode(data)
      } catch {
        return fail('unsupported_type', 415)
      }
      kind = 'text'
      detected = mime || 'text/plain'
    }
    if (kind !== 'pdf' && size > OTHER_MAX_BYTES) fail('too_large', 413)
    if (
      (kind !== 'text' && mime !== detected) ||
      (kind === 'text' &&
        !(
          mime.startsWith('text/') ||
          ['application/octet-stream', 'application/json', 'application/yaml', 'application/x-yaml', ''].includes(mime)
        ))
    )
      fail('unsupported_type', 415)
    if (kind === 'pdf') {
      const read = await readPdf(data)
      pdfFacts = read.facts
      extractedText = read.text
      pagesRead = read.pagesRead
    }
    const outcome = classifyUpload(
      kind === 'pdf'
        ? { kind, size, ...(pdfFacts ? { pdf: pdfFacts } : {}) }
        : kind === 'text'
          ? { kind, size, textBytes: Buffer.byteLength(extractedText ?? '') }
          : { kind, size },
    )
    if (!outcome.ok) return fail(outcome.error, outcome.status)
    if (extractedText && Buffer.byteLength(extractedText) > ATTACHMENT_TEXT_TOTAL) {
      let low = 0,
        high = extractedText.length
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (Buffer.byteLength(extractedText.slice(0, mid)) <= ATTACHMENT_TEXT_TOTAL) low = mid
        else high = mid - 1
      }
      extractedText = extractedText.slice(0, low)
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 添付ファイル名の C0/C1 制御文字とパス区切りを置換して表示名を安全にする
    const displayName = filename.replace(/[\x00-\x1f\x7f-\x9f/\\]/g, '_').slice(0, 120) || 'file'
    const meta: Attachment = {
      id: randomBytes(16).toString('hex'),
      principal,
      sessionKey,
      kind,
      mime: detected,
      size,
      displayName,
      createdAt: now(),
      truncated: outcome.read === 'partial',
      read: outcome.read,
      ...(outcome.reason ? { partialReason: outcome.reason } : {}),
      ...(pdfFacts?.status === 'ok' ? { pages: pdfFacts.pages, pagesRead } : {}),
      stored: kind === 'pdf' ? 0 : size,
      ...(extractedText !== undefined ? { extractedText } : {}),
    }
    // PDF は抽出した本文だけを Hermes へ渡すため、原本は保存しない（30 MiB の PDF で保存領域を使い切らない）。
    const kept = kind === 'pdf' ? Buffer.alloc(0) : data
    const work = lock.then(async () => {
      await clean(kept.length)
      if (folder) {
        await writeFile(join(folder, `${meta.id}.bin`), kept, { mode: 0o600, flag: 'wx' })
        await atomic(join(folder, `${meta.id}.json`), meta)
      } else memory.set(meta.id, { meta, data: kept })
      if (!expiryTimer) schedule(meta.createdAt)
    })
    lock = work.catch(() => {})
    await work
    return meta
  }
  lock = lock.then(() => clean()).catch(() => {})
  return { upload, get, clean }
}
