import { describe, expect, it } from 'vitest'
import { choiceButtonText, extractChoices } from './choices'

const values = (t: string) => extractChoices(t)?.map((c) => c.value) ?? null

describe('extractChoices (BOXP-646)', () => {
  it('行頭の A）／A：／A. 形式を取り出す（従来の受信箱と同じ）', () => {
    expect(values('A) yes\nB) no')).toEqual(['A', 'B'])
    expect(values('- **A) yes**\n・ B： no\nA) again')).toEqual(['A', 'B'])
    expect(values('B) yes\nC) no')).toBeNull()
    expect(values('A) only')).toBeNull()
    expect(values('A) yes\nC) no')).toBeNull()
  })
  it('従来ボタンにならなかった書き方もそろえて取り出す', () => {
    // BOXP-588: 「A（推奨）：」
    expect(extractChoices('- **A（推奨）：段階実装** — まず\n- **B：項目化まで**\n- **C：見送り**')).toEqual([
      { value: 'A', label: '（推奨）段階実装 — まず' },
      { value: 'B', label: '項目化まで' },
      { value: 'C', label: '見送り' },
    ])
    // BOXP-589: 「A「…」」
    expect(values('- **A「もうひとりの守り手」（推奨）**\n  説明\n- **B「研究者の標本箱」**')).toEqual(['A', 'B'])
    // BOXP-644: 1 行に並べた「A：…／B：…」
    expect(extractChoices('次の一判断です。\n\n**A：このおすすめで実装へ進む／B：監修結果を見てから決める**')).toEqual([
      { value: 'A', label: 'このおすすめで実装へ進む' },
      { value: 'B', label: '監修結果を見てから決める' },
    ])
    // BOXP-586: 「B1（おすすめ）」「**B2**：」
    expect(
      values(
        '次はどちらにしますか？\n- **B1（おすすめ）**：限定実装\n- **B2**：上限だけ\n- **B3**：B1に加え\n- **保留**：変更しない',
      ),
    ).toEqual(['B1', 'B2', 'B3'])
    // BOXP-604: 番号付き＋「どちら」
    expect(
      values(
        '次はどちらにしましょう？\n1. **任意委譲を既定として確定する（担当推奨）**\n2. 追加観察する\n3. 必須委譲へ戻す',
      ),
    ).toEqual(['1', '2', '3'])
  })
  it('手順・確認項目の番号付き箇条書きはボタンにしない', () => {
    // BOXP-634: 手順（「などの」の「どの」は選択の言葉に数えない）
    expect(
      values(
        '矢印・Enterなどの操作ボタンを追加しました。\n1. 「→」を押します。\n2. 「Enter」を押して確定します。\n成功したか教えてください。',
      ),
    ).toBeNull()
    // BOXP-545: 確認項目
    expect(values('次をお試しください。\n1. **ON**で止まらないか\n2. 停止できるか\n3. OFFでも読めるか')).toBeNull()
    expect(values('1. a\n2. b\nどれにしますか')).toEqual(['1', '2'])
    expect(values('1. **おすすめ**：a\n2. b')).toEqual(['1', '2'])
  })
  it('連番が崩れる・多すぎるものは対象外', () => {
    expect(values('A: a\nB: b\nC: c\nD: d\nE: e\nF: f\nG: g')).toBeNull()
    expect(values('どれ？\n1. a\n2. b\n4. d')).toBeNull()
    expect(values('A／Bのどちらで進めましょうか')).toBeNull()
    expect(values('1.5GB と 2.0GB のどちら?')).toBeNull()
    expect(values('')).toBeNull()
  })
  it('最後の選択肢の組を使う', () => {
    expect(values('どれにする？\n1. 手順a\n2. 手順b\n\nA: 案a\nB: 案b')).toEqual(['A', 'B'])
  })
  it('ボタン文言は記号＋説明の先頭', () => {
    expect(choiceButtonText({ value: 'A', label: 'はい' })).toBe('A：はい')
    expect(choiceButtonText({ value: 'B', label: 'あいうえおかきくけこさしすせそたちつてとなにぬねのは' })).toBe(
      'B：あいうえおかきくけこさしすせそたちつてとなにぬね…',
    )
    expect(choiceButtonText({ value: 'C', label: '' })).toBe('C')
  })
})
