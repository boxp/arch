import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Studio 画面の表記', () => {
  const html = readFileSync(new URL('../../studio.html', import.meta.url), 'utf8')
  it('Telegram・Even G2 とは別の会話であることを画面に明示する', () => {
    expect(html).toContain('id="channel"')
    expect(html).toMatch(/Telegram・Even G2 とは別の会話/)
    expect(html).toMatch(/Hermes の人格と既存 memory だけ/)
  })
  it('既定モデルを固定版として誤表記しない', () => {
    expect(html).not.toContain('最小本人モデル v0')
  })
})
