import { expect, it } from 'vitest'
import { attachmentValidation } from './attachments'
it('validates attachment count, size and supported formats', () => {
  const file = { name: 'a.txt', type: 'text/plain', size: 10 }
  expect(attachmentValidation(file, [])).toBeNull()
  expect(attachmentValidation(file, [file, file, file])).toContain('3件まで')
  expect(attachmentValidation({ ...file, size: 5 * 1024 * 1024 + 1 }, [])).toContain('サイズ超過')
  expect(attachmentValidation({ ...file, name: 'a.exe', type: 'application/octet-stream' }, [])).toContain('未対応')
  expect(attachmentValidation({ ...file, name: 'a.json', type: '' }, [])).toBeNull()
})
it('limits the total image size per message', () => {
  const img = (mb: number) => ({ name: 'a.png', type: 'image/png', size: mb * 1024 * 1024 })
  expect(attachmentValidation(img(2.5), [img(2.5)])).toBeNull()
  expect(attachmentValidation(img(5), [img(2.5)])).toContain('合計5.5 MiB')
  expect(attachmentValidation(img(5), [{ type: 'text/plain', size: 5 * 1024 * 1024 }])).toBeNull()
})
