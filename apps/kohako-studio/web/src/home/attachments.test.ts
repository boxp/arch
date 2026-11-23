import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  attachmentProblem,
  attachmentSubmitAction,
  attachmentValidation,
  formatFileSize,
  OTHER_MAX_BYTES,
  PDF_MAX_BYTES,
  remainingAttachmentNotice,
  uploadContentType,
  uploadedState,
} from './attachments'
it('validates attachment count, size and supported formats', () => {
  const file = { name: 'a.txt', type: 'text/plain', size: 10 }
  expect(attachmentValidation(file, [])).toBeNull()
  expect(attachmentValidation(file, [file, file, file])).toContain('3件まで')
  expect(attachmentValidation({ ...file, size: 5 * 1024 * 1024 + 1 }, [])).toContain('大きすぎます')
  expect(attachmentValidation({ ...file, name: 'a.exe', type: 'application/octet-stream' }, [])).toContain(
    '対応していない',
  )
  expect(attachmentValidation({ ...file, name: 'a.json', type: '' }, [])).toBeNull()
})
it('allows PDFs up to 30 MiB and shows the limit in the same unit (BOXP-677)', () => {
  const pdf = { name: 'a.pdf', type: 'application/pdf', size: PDF_MAX_BYTES }
  expect(attachmentValidation(pdf, [])).toBeNull()
  const over = attachmentValidation({ ...pdf, size: PDF_MAX_BYTES + 1 }, [])
  expect(over).toContain('30 MiB（31,457,280 バイト）')
  expect(over).toContain('30.0 MiB = 31,457,281 バイト')
  // スマホで型が空でも拡張子で PDF と分かれば PDF の上限と Content-Type を使う
  expect(attachmentValidation({ name: 'b.PDF', type: '', size: 20 * 1024 * 1024 }, [])).toBeNull()
  expect(uploadContentType({ name: 'b.PDF', type: '' })).toBe('application/pdf')
  expect(uploadContentType({ name: 'b.bin', type: '' })).toBe('application/octet-stream')
  expect(attachmentValidation({ name: 'a.png', type: 'image/png', size: OTHER_MAX_BYTES + 1 }, [])).toContain(
    '5 MiB（5,242,880 バイト）',
  )
  expect(formatFileSize(PDF_MAX_BYTES)).toBe('30.0 MiB')
  expect(formatFileSize(PDF_MAX_BYTES + 1)).toBe('30.0 MiB')
  expect(formatFileSize(1536)).toBe('1.5 KiB')
})
it('agrees with the Lean model on which sizes the screen refuses before upload', () => {
  const cases = readFileSync(new URL('./attachment-cases.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { kind: string; size: number; clientRejects: boolean })
  expect(cases.length).toBeGreaterThan(700)
  const file = (kind: string, size: number) =>
    kind === 'pdf'
      ? { name: 'a.pdf', type: 'application/pdf', size }
      : kind === 'image'
        ? { name: 'a.png', type: 'image/png', size }
        : kind === 'text'
          ? { name: 'a.txt', type: 'text/plain', size }
          : { name: 'a.exe', type: 'application/octet-stream', size }
  for (const c of cases) {
    const msg = attachmentValidation(file(c.kind, c.size), [])
    if (c.kind === 'unsupported') expect(msg).toContain('対応していない')
    else if (c.clientRejects) expect(msg, JSON.stringify(c)).toContain('大きすぎます')
    else expect(msg, JSON.stringify(c)).toBeNull()
  }
})
it('separates uploaded from fully read and explains partial reads', () => {
  expect(uploadedState('a.png', { kind: 'image', read: 'none' })).toEqual({ chip: '✓ 添付済み', notice: null })
  expect(uploadedState('a.pdf', { kind: 'pdf', read: 'full', pages: 12 })).toEqual({
    chip: '✓ 本文読取済（12ページ）',
    notice: null,
  })
  const pages = uploadedState('b.pdf', {
    kind: 'pdf',
    read: 'partial',
    partialReason: 'pages',
    pages: 120,
    pagesRead: 30,
  })
  expect(pages.chip).toBe('⚠ 一部のみ読取')
  expect(pages.notice).toContain('全120ページのうち先頭30ページだけ')
  expect(pages.notice).toContain('ファイルを分けて')
  const text = uploadedState('c.pdf', { kind: 'pdf', read: 'partial', partialReason: 'text', pages: 10, pagesRead: 9 })
  expect(text.notice).toContain('9ページ目の途中まで')
  // 旧 BFF の応答（read なし）でも一部省略を成功扱いにしない
  expect(uploadedState('d.txt', { kind: 'text', truncated: true }).chip).toBe('⚠ 一部のみ読取')
})
it('tells what went wrong and what to do next for every upload failure', () => {
  const cases: [number, string | null, string][] = [
    [0, null, '通信状態を確認'],
    [401, null, 'ログインし直して'],
    [413, 'too_large', '30 MiB'],
    [413, null, '30 MiB'],
    [415, 'unsupported_type', '保存し直して'],
    [422, 'pdf_encrypted', 'パスワード'],
    [422, 'pdf_timeout', '時間がかかりすぎた'],
    [422, 'pdf_no_text', 'スキャン'],
    [422, 'pdf_unreadable', '書き出し直して'],
    [429, 'attachment_busy', '少し待ってから'],
    [503, 'bff_unavailable', '再起動中'],
    [502, null, '再起動中'],
    [500, 'internal', '（500）'],
  ]
  for (const [status, error, expected] of cases) {
    const msg = attachmentProblem(status, error ? { error } : null, 'x.pdf')
    expect(msg, `${status} ${error}`).toContain(expected)
    expect(msg).toContain('「x.pdf」')
  }
})
it('limits the total image size per message', () => {
  const img = (mb: number) => ({ name: 'a.png', type: 'image/png', size: mb * 1024 * 1024 })
  expect(attachmentValidation(img(2.5), [img(2.5)])).toBeNull()
  expect(attachmentValidation(img(5), [img(2.5)])).toContain('合計 5.5 MiB')
  expect(attachmentValidation(img(5), [{ type: 'text/plain', size: 5 * 1024 * 1024 }])).toBeNull()
})
it('confirms an unconfirmed request before sending attachments instead of rejecting', () => {
  expect(attachmentSubmitAction(true, false, true)).toBe('confirm-pending')
  // 受理未確認の控えが送信待ち由来でも、同じ受付番号で確認を優先する（チップは取り消さなくてよい）。
  expect(attachmentSubmitAction(true, true, true)).toBe('confirm-pending')
  expect(attachmentSubmitAction(true, true, false)).toBe('reject-queue')
  expect(attachmentSubmitAction(true, false, false)).toBe('send')
  expect(attachmentSubmitAction(false, true, true)).toBe('send')
})

it('BOXP-677: 別の添付を取り消しても、残る一部読取の添付の注意は出し続ける', () => {
  const partial = uploadedState('big.pdf', {
    kind: 'pdf',
    read: 'partial',
    partialReason: 'pages',
    pages: 120,
    pagesRead: 30,
  })
  expect(partial.notice).toBeTruthy()
  const chips = [{ notice: partial.notice }, {}]
  expect(remainingAttachmentNotice(chips)).toBe(partial.notice)
  expect(remainingAttachmentNotice([{}])).toBe('')
  expect(remainingAttachmentNotice([])).toBe('')
})
