import { it, expect } from 'vitest'
import { extractViews, validateView } from './views.js'
const block = (s: string) => `\`\`\`kohako-view\n${s}\n\`\`\``
it('cleans all blocks and keeps the first valid one', () => {
  expect(
    extractViews(`前 ${block('bad')} ${block('{"kind":"usage"}')} ${block('{"kind":"usage","title":"二"}')} 後`),
  ).toEqual({ text: '前    後', views: [{ kind: 'usage' }] })
  expect(extractViews('前\n```kohako-view\n{"kind":')).toEqual({ text: '前', views: [] })
})
it('rejects unknown fields, kinds, controls and long strings', () => {
  for (const v of [
    { kind: 'other' },
    { kind: 'usage', extra: 1 },
    { kind: 'map', title: 'x', destination: { name: 'x', url: 'javascript:alert(1)' } },
    { kind: 'html', title: 'x', html: 'a'.repeat(20001) },
    { kind: 'map', title: '\u0001', destination: { name: 'x' } },
  ])
    expect(validateView(v)).toBeNull()
})

it('accepts inline JSON, inline closing fences and case variations without weakening validation', () => {
  expect(
    extractViews(
      '前 ```KOHAKO-VIEW{"kind":"usage","extra":1}``` 中 ```kohako-view {"kind":"usage"}``` 後 ```kohako-view\n{"kind":"usage","title":"二"}```',
    ),
  ).toEqual({ text: '前  中  後', views: [{ kind: 'usage' }] })
  expect(extractViews('```kohako-view{"kind":"usage","extra":1}```')).toEqual({ text: '', views: [] })
})
