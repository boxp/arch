import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cardLines, checkDolls, DOLLS, type Doll, imageURL, latest, newestFirst, tagOf } from './data'

// 期待値は vault の決まり Projects/kohako-home/model-dolls-760.md（R1〜R8 と 1.3 の例）から取る。
const two: Doll = {
  key: 'fable',
  name: '語り部の人形',
  assignee: 'claude-fable',
  model: 'claude-fable-5-2',
  origin: 'Fable＝寓話',
  item: '開いた絵本',
  colors: '深緑と生成り',
  versions: [
    { n: 1, stage: '初稿' },
    { n: 2, stage: '改稿' },
  ],
}

describe('人形の絵を見比べるページのデータ（BOXP-760）', () => {
  it('R1: 9 体を企画 6 章の表の順で持つ', () => {
    expect(DOLLS.map((d) => d.key)).toEqual([
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
  })
  it('R2: 札には名前・担当名・実行モデル・最新の版の札と段階を文字で出す', () => {
    expect(cardLines({ ...two, versions: [{ n: 1, stage: '初稿' }] })).toEqual({
      name: '語り部の人形',
      who: 'claude-fable → claude-fable-5-2',
      tag: 'fable-v1（初稿）',
    })
  })
  it('R2: 企画どおりの担当名と実行モデル（無地は実行モデルなし）', () => {
    const who = Object.fromEntries(DOLLS.map((d) => [d.key, cardLines(d).who]))
    expect(who).toEqual({
      fable: 'claude-fable → claude-fable-5-2',
      opus: 'claude-opus → claude-opus-5-5',
      sonnet: 'claude-sonnet → claude-sonnet-5-5',
      terra: 'codex / codex-terra → gpt-6.1-terra',
      sol: 'codex-sol / codex-full → gpt-6.1-sol',
      luna: 'codex-mini → gpt-5.6-luna',
      astra: 'codex-astra → gpt-6-astra',
      neon: 'antigravity → gemini-4-neon-*',
      plain: '上に無いモデル、モデル未確認 → —',
    })
  })
  it('R3: 版が複数なら一覧は最新、個別は新しい順', () => {
    expect(tagOf(two, latest(two))).toBe('fable-v2')
    expect(cardLines(two).tag).toBe('fable-v2（改稿）')
    expect(newestFirst(two).map((v) => tagOf(two, v))).toEqual(['fable-v2', 'fable-v1'])
  })
  it('R7: 絵は候補の中の kohako/dolls/<版の札>.jpg だけを指す', () => {
    expect(imageURL('fable-v1')).toBe('./kohako/dolls/fable-v1.jpg')
  })
  it('R7: データにある版の絵のファイルがすべて在る', () => {
    for (const d of DOLLS)
      for (const v of d.versions)
        expect(existsSync(new URL(`../../public/kohako/dolls/${tagOf(d, v)}.jpg`, import.meta.url)), tagOf(d, v)).toBe(
          true,
        )
  })
  it('1.3 の例: 形の違う札・版なし・版の重複はデータの検査で落とす', () => {
    expect(checkDolls(DOLLS)).toEqual([])
    expect(checkDolls([{ ...two, key: 'Fable' }])).toEqual(['Fable: 人形の鍵の形が違う'])
    expect(checkDolls([{ ...two, versions: [{ n: 0, stage: '初稿' }] }])).toEqual(['fable: 版の番号 0 が違う'])
    expect(checkDolls([{ ...two, versions: [] }])).toEqual(['fable: 版が無い'])
    expect(
      checkDolls([
        {
          ...two,
          versions: [
            { n: 1, stage: '初稿' },
            { n: 1, stage: '改稿' },
          ],
        },
      ]),
    ).toEqual(['fable: 版の番号 1 が重なっている'])
    expect(checkDolls([two, two])).toEqual(['fable: 人形の鍵が重なっている'])
  })
  it('R6・R8: ページに非公式・採用未定・感想の伝え方があり、API を呼ばない', () => {
    const html = readFileSync(new URL('../../dolls.html', import.meta.url), 'utf8')
    expect(html).toContain('この家だけの非公式の人形')
    expect(html).toContain('採用はまだ決めていません')
    expect(html).toContain('版の札')
    const src =
      readFileSync(new URL('./main.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('./view.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/fetch\(|innerHTML|XMLHttpRequest|WebSocket/)
  })
})
