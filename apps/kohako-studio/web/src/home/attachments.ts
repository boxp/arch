export function attachmentValidation(file: Pick<File, 'size' | 'type' | 'name'>, count: number): string | null {
  if (count >= 3) return '添付は3件までです。'
  if (file.size > 5 * 1024 * 1024) return 'サイズ超過：1件5 MiBまでです。'
  if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/)/.test(file.type) && !/\.(txt|md|csv|json|log|yaml|yml|tsv)$/i.test(file.name)) return '未対応の形式です。'
  return null
}
