import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { chatEntries } from './chatlog'
describe('portrait chat log', () => {
  it('omits only a matching final Kohako entry and keeps the latest 50', () => {
    const entries = Array.from({ length: 55 }, (_, i) => ({ who: 'あなた', text: String(i) }))
    expect(chatEntries(entries, '')).toHaveLength(50)
    expect(chatEntries([...entries, { who: 'コハコ', text: '返事' }], '返事')).toHaveLength(49)
    expect(chatEntries([{ who: 'あなた', text: '返事' }], '返事')).toHaveLength(1)
    expect(chatEntries([{ who: 'コハコ', text: '別' }], '返事')).toHaveLength(1)
  })
  it('displays the log only in portrait', () => {
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.chatlog\{display:none\}/)
    expect(css).toMatch(/body\[data-shape="portrait"\] \.chatlog\{display:block/)
  })
})
