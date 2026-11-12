/** BFF と同じ上限。画像は 1 メッセージ合計 5.5 MiB（Hermes の要求上限 10MB に base64 で収まる値）。 */
export const IMAGE_TOTAL = 5.5 * 1024 * 1024
const IMAGE = /^image\/(png|jpeg|webp|gif)$/
export function attachmentValidation(file: Pick<File, 'size' | 'type' | 'name'>, current: { size: number; type: string }[]): string | null {
  if (current.length >= 3) return '添付は3件までです。'
  if (file.size > 5 * 1024 * 1024) return 'サイズ超過：1件5 MiBまでです。'
  if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/)/.test(file.type) && !/\.(txt|md|csv|json|log|yaml|yml|tsv)$/i.test(file.name)) return '未対応の形式です。'
  if (IMAGE.test(file.type) && current.filter(x => IMAGE.test(x.type)).reduce((n, x) => n + x.size, file.size) > IMAGE_TOTAL) return 'サイズ超過：画像は1回の送信で合計5.5 MiBまでです。'
  return null
}
