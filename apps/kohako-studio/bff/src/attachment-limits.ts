/**
 * BOXP-677: 添付の上限と結果の分類。値と規則は contract/attachment-model/AttachmentModel.lean と同じで、
 * そのモデルが生成した境界表（contract/attachment-model/cases.jsonl）を attachment-limits.test.ts が照合する。
 * 表示は 2 進単位（MiB = 1024 × 1024 バイト）にそろえる。
 */
export const MIB = 1024 * 1024
/** PDF 1 件の上限（30 MiB = 31,457,280 バイト）。 */
export const PDF_MAX_BYTES = 30 * MIB
/** 画像・テキスト 1 件の上限（5 MiB = 5,242,880 バイト）。BOXP-517 から変えない。 */
export const OTHER_MAX_BYTES = 5 * MIB
/** nginx の client_max_body_size（31m）。PDF 上限より大きくし、上限付近の超過でも BFF が理由付きの JSON を返せるようにする。 */
export const PROXY_MAX_BYTES = 31 * MIB
/** PDF から本文を読むページ数の上限。 */
export const PDF_MAX_PAGES = 30
/** 1 件・1 回の送信あたりの抽出本文の上限（UTF-8 バイト）。Hermes の正規化テキスト上限 64KB に枠込みで収まる値。 */
export const TEXT_MAX_BYTES = 48000

export type AttachmentKind = 'image' | 'pdf' | 'text'
export const maxBytesFor = (kind: AttachmentKind): number => (kind === 'pdf' ? PDF_MAX_BYTES : OTHER_MAX_BYTES)

/** 本文の読取状態。full = 全文を読めた、partial = 上限で途中まで、none = 本文なし（画像）。 */
export type ReadState = 'full' | 'partial' | 'none'
export type PartialReason = 'pages' | 'text'

/** PDF を開いて読んだ結果（抽出処理の観測値）。 */
export type PdfFacts =
  | { status: 'encrypted' | 'unreadable' | 'timeout' }
  | { status: 'ok'; pages: number; textBytes: number; hasText: boolean }

export type UploadFacts =
  | { kind: 'unsupported'; size: number }
  | { kind: 'image'; size: number }
  | { kind: 'text'; size: number; textBytes: number }
  | { kind: 'pdf'; size: number; pdf?: PdfFacts }

export type UploadOutcome =
  | { ok: true; read: ReadState; reason?: PartialReason; pagesRead?: number }
  | { ok: false; status: number; error: string }

/**
 * 添付 1 件の結果。サイズ超過は形式判定より先（読まずに捨てる）、未対応形式は本文読取より先。
 * PDF の本文は先頭 PDF_MAX_PAGES ページ・TEXT_MAX_BYTES までで、どちらかを超えたら partial（成功扱いにしない）。
 */
export function classifyUpload(f: UploadFacts): UploadOutcome {
  if (f.size > PDF_MAX_BYTES || (f.kind !== 'pdf' && f.kind !== 'unsupported' && f.size > OTHER_MAX_BYTES))
    return { ok: false, status: 413, error: 'too_large' }
  if (f.kind === 'unsupported') return { ok: false, status: 415, error: 'unsupported_type' }
  if (f.kind === 'image') return { ok: true, read: 'none' }
  if (f.kind === 'text')
    return f.textBytes > TEXT_MAX_BYTES ? { ok: true, read: 'partial', reason: 'text' } : { ok: true, read: 'full' }
  const pdf = f.pdf ?? { status: 'unreadable' as const }
  if (pdf.status !== 'ok') return { ok: false, status: 422, error: `pdf_${pdf.status}` }
  if (!pdf.hasText) return { ok: false, status: 422, error: 'pdf_no_text' }
  if (pdf.textBytes > TEXT_MAX_BYTES) return { ok: true, read: 'partial', reason: 'text' }
  if (pdf.pages > PDF_MAX_PAGES) return { ok: true, read: 'partial', reason: 'pages', pagesRead: PDF_MAX_PAGES }
  return { ok: true, read: 'full', pagesRead: pdf.pages }
}
