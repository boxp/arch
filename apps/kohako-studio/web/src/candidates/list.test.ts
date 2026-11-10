import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { candidateURL, parseIndex, sortNewestFirst, statusClass } from './list'

const ok = { id: 'arm-4980edd', commit: '4980edd3a5a89232b4f0bb343e604fafca2d2828', title: '腕', status: '試作', built: true }

describe('試作候補の一覧', () => {
  it('本人採用は動作単位の表記でも採用の色にする', () => {
    expect(statusClass('本人採用（制止）')).toBe('adopted')
    expect(statusClass('独立判定合格（照れ）')).toBe('pass')
    expect(statusClass('不合格')).toBe('ng')
    expect(statusClass('試作')).toBe('trial')
    expect(statusClass('その他')).toBe('unknown')
  })
  it('形の崩れた項目を捨てる', () => {
    expect(parseIndex({ candidates: [ok, { ...ok, id: '../x' }, { ...ok, commit: 'abc' }, null] })).toHaveLength(1)
    expect(parseIndex(null)).toEqual([])
  })
  it('候補ごとの固定パスへ acting 付きでリンクする', () => {
    expect(candidateURL(ok)).toBe('./candidates/arm-4980edd/live2d.html?acting=1')
    expect(candidateURL(ok, 'studio')).toBe('./candidates/arm-4980edd/studio.html?acting=1')
  })
  it('Studio の固定入口から候補一覧へ行ける', () => {
    expect(readFileSync(new URL('../../studio.html', import.meta.url), 'utf8')).toContain('href="./candidates.html"')
  })
  it('新しい試作を先頭に並べる（created の降順、無いものは末尾）', () => {
    const a = { ...ok, id: 'a', created: '2026-11-10T01:00:00Z' }, b = { ...ok, id: 'b', created: '2026-11-10T13:00:00Z' }, c = { ...ok, id: 'c' }
    expect(sortNewestFirst([a, c, b]).map(x => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('candidates.json は全候補に created があり新しい順で並ぶ', () => {
    const m = JSON.parse(readFileSync(new URL('../../../candidates/candidates.json', import.meta.url), 'utf8')) as { candidates: { id: string, created: string }[] }
    for (const c of m.candidates) expect(c.created, c.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const created = m.candidates.map(c => c.created)
    expect(created).toEqual([...created].sort().reverse())
  })
})
