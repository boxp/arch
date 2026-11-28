import { expect, it } from 'vitest'
import { dollOf, familyOf, groupDolls } from './dolls.js'
// 期待値は現行仕様 Projects/kohako-home/model-dolls-home-spec.md 2 章・5 章の例から。
const t = (id: number, assignee: string) => ({ id: `BOXP-${id}`, assignee })
const view = (g: ReturnType<typeof groupDolls>) => g.map((d) => [d.key, d.plainLabel, d.tickets.map((x) => x.id)])
it('同じ人形の票は 1 体にまとめ、件数の多い順に並べる（例 1）', () => {
  expect(view(groupDolls([t(1, 'claude-opus'), t(2, 'claude-opus'), t(3, 'claude-fable')]))).toEqual([
    ['opus', null, ['BOXP-1', 'BOXP-2']],
    ['fable', null, ['BOXP-3']],
  ])
})
it('同数は表の順（fable, opus, … neon, plain）', () => {
  const g = groupDolls([t(1, 'antigravity'), t(2, 'codex'), t(3, 'claude-opus'), t(4, 'claude-fable'), t(5, 'zzz')])
  expect(g.map((d) => d.key)).toEqual(['fable', 'opus', 'terra', 'neon', 'plain'])
})
it('推論段の違う担当名・別名は同じ人形で、担当名は票ごとに残す（例 2）', () => {
  const g = groupDolls([t(4, 'codex-sol-xhigh'), t(5, 'codex-full')])
  expect(view(g)).toEqual([['sol', null, ['BOXP-4', 'BOXP-5']]])
  expect(g[0].tickets.map((x) => x.assignee)).toEqual(['codex-sol-xhigh', 'codex-full'])
  expect(g[0]).toMatchObject({ name: '灯守りの人形', model: 'gpt-6.1-sol' })
})
it('版上げは同じ系列（例 3）', () => {
  expect(familyOf('claude-fable-5-3')).toBe('fable')
  expect(familyOf('gpt-7-sol')).toBe('sol')
  expect(familyOf('gpt-6.1-terra')).toBe('terra')
  expect(familyOf('gemini-4-neon-xhigh')).toBe('neon')
  expect(familyOf('gemini-5-neon')).toBe('neon')
  expect(familyOf('agy-default')).toBeNull()
  expect(familyOf('neon')).toBeNull()
})
it('絵の無い系列・分からないモデルは無地で、モデルの導入を止めない（例 4・5）', () => {
  expect(dollOf('claude-haiku')).toMatchObject({ key: 'plain', name: '無地の人形', plainLabel: 'claude-haiku 系' })
  expect(dollOf('newagent')).toMatchObject({ key: 'plain', plainLabel: 'モデル未確認', model: null })
  expect(dollOf('localllm')).toMatchObject({ key: 'plain', plainLabel: 'localllm', model: null })
})
it('無地は札ごとに別の 1 体', () => {
  expect(view(groupDolls([t(1, 'claude-haiku'), t(2, 'newagent'), t(3, 'other')]))).toEqual([
    ['plain', 'モデル未確認', ['BOXP-2', 'BOXP-3']],
    ['plain', 'claude-haiku 系', ['BOXP-1']],
  ])
})
it('本人・未割り当ては人形にしない（例 6）', () => {
  expect(dollOf('boxp')).toBeNull()
  expect(dollOf('unknown')).toBeNull()
  expect(dollOf(' ')).toBeNull()
  expect(groupDolls([t(9, 'boxp')])).toEqual([])
})
it('9 案すべての鍵に届く', () => {
  const keys = [
    'claude-fable',
    'claude-opus',
    'claude-sonnet',
    'codex',
    'codex-sol',
    'codex-mini',
    'codex-astra',
    'antigravity',
    'x',
  ]
  expect(keys.map((a) => dollOf(a)?.key)).toEqual([
    'fable',
    'opus',
    'sonnet',
    'terra',
    'sol',
    'luna',
    'astra',
    'neon',
    'plain',
  ])
  expect(dollOf('fable')?.model).toBe('claude-fable-5-2')
  expect(dollOf('antigravity')?.model).toBeNull()
})
