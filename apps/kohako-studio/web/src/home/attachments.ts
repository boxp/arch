/** BFF と同じ上限。画像は 1 メッセージ合計 5.5 MiB（Hermes の要求上限 10MB に base64 で収まる値）。 */
export const IMAGE_TOTAL = 5.5 * 1024 * 1024
const IMAGE = /^image\/(png|jpeg|webp|gif)$/
export function attachmentValidation(
  file: Pick<File, 'size' | 'type' | 'name'>,
  current: { size: number; type: string }[],
): string | null {
  if (current.length >= 3) return '添付は3件までです。'
  if (file.size > 5 * 1024 * 1024) return 'サイズ超過：1件5 MiBまでです。'
  if (
    !/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/)/.test(file.type) &&
    !/\.(txt|md|csv|json|log|yaml|yml|tsv)$/i.test(file.name)
  )
    return '未対応の形式です。'
  if (
    IMAGE.test(file.type) &&
    current.filter((x) => IMAGE.test(x.type)).reduce((n, x) => n + x.size, file.size) > IMAGE_TOTAL
  )
    return 'サイズ超過：画像は1回の送信で合計5.5 MiBまでです。'
  return null
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
