import { expect, it } from 'vitest'
import { parseInline, plainText, vaultImageUrl } from './markdown'
it('renders only vault images through the authenticated same-origin endpoint', () => {
  const path = 'attachments/日本語 案.jpg',
    raw = `kohako-vault:${encodeURIComponent(path)}`
  expect(parseInline(`![和装](${raw})`)).toEqual([
    { type: 'image', text: '和装', url: `/kohako/api/v1/vault-image?path=${encodeURIComponent(path)}` },
  ])
  expect(plainText(`![和装](${raw})`)).toBe('和装')
  for (const raw of [
    'https://evil.test/image.png',
    'file:/etc/x.png',
    'data:image/png;base64,eA==',
    'kohako-vault:../secret.png',
    'kohako-vault:%2Fetc%2Fx.png',
    'kohako-vault:.obsidian/private.png',
    'kohako-vault:a%5Cb.png',
    'kohako-vault:a.svg',
    'kohako-vault:%00.png',
    'kohako-vault:%ZZ',
  ]) {
    expect(vaultImageUrl(raw)).toBeUndefined()
    expect(parseInline(`![x](${raw})`).every((x) => x.type !== 'image')).toBe(true)
  }
})
