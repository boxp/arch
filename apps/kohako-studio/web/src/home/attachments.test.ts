import { expect, it } from 'vitest'
import { attachmentValidation } from './attachments'
it('validates attachment count, size and supported formats', () => {
  const file = { name: 'a.txt', type: 'text/plain', size: 10 }
  expect(attachmentValidation(file, 0)).toBeNull()
  expect(attachmentValidation(file, 3)).toContain('3件まで')
  expect(attachmentValidation({ ...file, size: 5 * 1024 * 1024 + 1 }, 0)).toContain('サイズ超過')
  expect(attachmentValidation({ ...file, name: 'a.exe', type: 'application/octet-stream' }, 0)).toContain('未対応')
  expect(attachmentValidation({ ...file, name: 'a.json', type: '' }, 0)).toBeNull()
})
