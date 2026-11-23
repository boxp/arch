/**
 * 添付の上限（BFF の attachment-limits.ts と同じ値。BOXP-677 の Lean モデルの境界表で両方を照合する）。
 * 表示は 2 進単位: 1 MiB = 1024 × 1024 バイト。
 */
export const MIB = 1024 * 1024
export const PDF_MAX_BYTES = 30 * MIB
export const OTHER_MAX_BYTES = 5 * MIB
export const PDF_MAX_PAGES = 30
/** 画像は 1 メッセージ合計 5.5 MiB（Hermes の要求上限 10MB に base64 で収まる値）。 */
export const IMAGE_TOTAL = 5.5 * MIB
const IMAGE = /^image\/(png|jpeg|webp|gif)$/
const TEXT_NAME = /\.(txt|md|csv|json|log|yaml|yml|tsv)$/i
export const isPdf = (file: Pick<File, 'type' | 'name'>) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
/** ファイルサイズの表示。上限と同じ 2 進単位（KiB / MiB）にそろえる。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(Math.floor((bytes / MIB) * 10) / 10).toFixed(1)} MiB`
}
const limitText = (pdf: boolean) =>
  pdf ? 'PDF は1件 30 MiB（31,457,280 バイト）まで' : '画像・テキストは1件 5 MiB（5,242,880 バイト）まで'
/** アップロード時に送る Content-Type。拡張子だけ分かる PDF（スマホで型が空のとき）も PDF として送る。 */
export function uploadContentType(file: Pick<File, 'type' | 'name'>): string {
  if (!file.type && isPdf(file)) return 'application/pdf'
  return file.type || 'application/octet-stream'
}
export function attachmentValidation(
  file: Pick<File, 'size' | 'type' | 'name'>,
  current: { size: number; type: string }[],
): string | null {
  if (current.length >= 3) return '添付できるのは1回につき3件までです。送信してから残りを追加してください。'
  const pdf = isPdf(file)
  if (!pdf && !IMAGE.test(file.type) && !/^text\//.test(file.type) && !TEXT_NAME.test(file.name))
    return `「${file.name}」は対応していないファイル形式です。PNG/JPEG/WebP/GIF・PDF・テキストに変換して添付してください。`
  if (file.size > (pdf ? PDF_MAX_BYTES : OTHER_MAX_BYTES))
    return `「${file.name}」（${formatFileSize(file.size)} = ${file.size.toLocaleString('en-US')} バイト）は大きすぎます。${limitText(pdf)}です。${
      pdf ? 'ページを分けるか圧縮して小さくしてから' : '小さくしてから'
    }添付し直してください。`
  if (
    IMAGE.test(file.type) &&
    current.filter((x) => IMAGE.test(x.type)).reduce((n, x) => n + x.size, file.size) > IMAGE_TOTAL
  )
    return '画像の合計サイズが大きすぎます（1回の送信で合計 5.5 MiB まで）。画像を減らすか、分けて送ってください。'
  return null
}

export type UploadResult = {
  kind?: unknown
  read?: unknown
  truncated?: unknown
  partialReason?: unknown
  pages?: unknown
  pagesRead?: unknown
}
/**
 * アップロード成功後のチップ表示。「受け取れた」と「本文を全部読めた」を分け、一部しか読めないときは注意文も返す。
 */
export function uploadedState(name: string, r: UploadResult): { chip: string; notice: string | null } {
  const read = r.read ?? (r.truncated ? 'partial' : r.kind === 'image' ? 'none' : 'full')
  if (read === 'none') return { chip: '✓ 添付済み', notice: null }
  if (read !== 'partial')
    return {
      chip: typeof r.pages === 'number' ? `✓ 本文読取済（${r.pages}ページ）` : '✓ 本文読取済',
      notice: null,
    }
  const where =
    r.partialReason === 'pages' && typeof r.pages === 'number'
      ? `全${r.pages}ページのうち先頭${typeof r.pagesRead === 'number' ? r.pagesRead : PDF_MAX_PAGES}ページだけ`
      : typeof r.pages === 'number'
        ? `全${r.pages}ページのうち${typeof r.pagesRead === 'number' ? `${r.pagesRead}ページ目の途中` : '途中'}まで（本文の上限 約48KB）`
        : '途中まで（本文の上限 約48KB）'
  return {
    chip: '⚠ 一部のみ読取',
    notice: `「${name}」はアップロードできましたが、本文は${where}しか読めません。このまま送ると読んだ範囲だけで答えます。全体を読ませたい場合は、取り消してファイルを分けて（PDF は${PDF_MAX_PAGES}ページ・本文 約48KB ごと）送ってください。`,
  }
}

/**
 * 添付のアップロード失敗の理由と、次にすること。無言にしない（不明な失敗も状態番号付きで再試行を促す）。
 * status 0 は通信失敗（オフライン・切断）。
 */
export function attachmentProblem(status: number, data: Record<string, unknown> | null, name: string): string {
  const error = typeof data?.error === 'string' ? data.error : ''
  const f = `「${name}」`
  if (status === 0)
    return `${f}を送れませんでした（通信が切れたか、時間がかかりすぎました）。通信状態を確認し、× で取り消して追加し直してください。`
  if (status === 401 || status === 403)
    return `${f}を送れませんでした。ログインの有効期限が切れています。画面を再読み込みしてログインし直してから、追加し直してください。`
  if (error === 'too_large' || status === 413)
    return `${f}は大きすぎて受け付けられませんでした。PDF は1件 30 MiB、画像・テキストは1件 5 MiB までです。小さくしてから追加し直してください。`
  if (error === 'unsupported_type' || status === 415)
    return `${f}は対応していない形式か、拡張子と中身が一致しません。PNG/JPEG/WebP/GIF・PDF・UTF-8 テキストとして保存し直して添付してください。`
  if (error === 'pdf_encrypted')
    return `${f}はパスワードで保護されているため読めません。保護を外した PDF を添付してください。`
  if (error === 'pdf_timeout')
    return `${f}は読み取りに時間がかかりすぎたため中断しました。ページを分けるか、文字が入った PDF として書き出し直して添付してください。`
  if (error === 'pdf_no_text')
    return `${f}から文字を読み取れませんでした（スキャン画像だけの PDF など）。文字入りの PDF にするか、読ませたいページを画像（PNG/JPEG）で添付してください。`
  if (error === 'pdf_unreadable' || status === 422)
    return `${f}は壊れているか、読めない形式の PDF です。別のアプリで PDF に書き出し直してから添付してください。`
  if (error === 'attachment_busy' || status === 429)
    return `${f}を受け付けられませんでした。別の大きなファイルを処理中です。少し待ってから追加し直してください。`
  if (error === 'conversation_disabled') return '会話機能が現在無効のため、添付できません。'
  if (error === 'bff_unavailable' || status === 502 || status === 503 || status === 504)
    return `${f}を送れませんでした。サーバーが再起動中か一時的に応答していません。1分ほど待ってから × で取り消して追加し直してください。`
  return `${f}のアップロードに失敗しました（${status}）。× で取り消して追加し直してください。続く場合は時間をおいてください。`
}
/**
 * 添付チップがある状態での送信操作の扱い。受理未確認の前回発言（添付付きの同じ依頼を含む）があれば、
 * 新規送信を拒否せず、まず同じ受付番号で受理状況の確認・再送を行う（チップと入力は残し、二重実行もしない）。
 */
export function attachmentSubmitAction(
  hasChips: boolean,
  queueing: boolean,
  unconfirmed: boolean,
): 'send' | 'reject-queue' | 'confirm-pending' {
  if (!hasChips) return 'send'
  if (unconfirmed) return 'confirm-pending'
  return queueing ? 'reject-queue' : 'send'
}

/** 添付を取り消した後も、残っている一部読取の添付の注意（読取範囲と次の手順）を出し続けるための文面。無ければ空文字。 */
export function remainingAttachmentNotice(chips: readonly { notice?: string | null }[]): string {
  return chips
    .map((x) => x.notice)
    .filter((x): x is string => !!x)
    .join(' ')
}
