import { describe, expect, it } from 'vitest'
import { obsidianNotePath, obsidianNoteUrl, parseInline, parseMarkdown, plainText, renderMarkdown } from './markdown'

// BOXP-613: 変異テストで parseMarkdown / renderMarkdown のブロック解釈と DOM 出力が
// どのテストにも観測されていなかった（行の継続・終了条件、見出し段数、入れ子リスト、外部リンク属性など）。
// web のテストは DOM 環境を持たないため、renderMarkdown には出力木を記録するだけの最小の document を渡す。
describe('parseMarkdown のブロック解釈', () => {
  it('改行コードを揃え、空行を区切りとして読み飛ばす', () => {
    expect(parseMarkdown('一\r\n二\r三\n\n\n  \n四')).toEqual([
      { type: 'paragraph', text: '一\n二\n三', inline: [{ type: 'text', text: '一\n二\n三' }] },
      { type: 'paragraph', text: '四', inline: [{ type: 'text', text: '四' }] },
    ])
    expect(parseMarkdown('')).toEqual([])
  })

  it('コードフェンスの中は空行や記法も含めてそのまま保ち、閉じ忘れは末尾まで含める', () => {
    expect(parseMarkdown('```\n# 見出しではない\n\n- 項目ではない\n  ```\n後')).toEqual([
      { type: 'code', text: '# 見出しではない\n\n- 項目ではない' },
      { type: 'paragraph', text: '後', inline: [{ type: 'text', text: '後' }] },
    ])
    expect(parseMarkdown('前\n```js\na\nb')).toEqual([
      { type: 'paragraph', text: '前', inline: [{ type: 'text', text: '前' }] },
      { type: 'code', text: 'a\nb' },
    ])
  })

  it('行頭（字下げ可）の ``` だけをフェンスにし、文中の ``` では開閉しない', () => {
    expect(parseMarkdown('a ``` b\n  ```\nx ```\n```').map((b) => [b.type, b.text])).toEqual([
      ['paragraph', 'a ``` b'],
      ['code', 'x ```'],
    ])
  })

  it('--- だけの行は区切り線にし、他の文字を含む行は段落に残す', () => {
    expect(parseMarkdown('  ---  \n----\nx---')).toEqual([
      { type: 'rule' },
      { type: 'paragraph', text: '----\nx---', inline: [{ type: 'text', text: '----\nx---' }] },
    ])
  })

  it('見出しは # の数を段数にし、空白なしや 7 個以上は段落にする', () => {
    expect(parseMarkdown('# 一\n###### 六\n####### 七\n#題')).toEqual([
      { type: 'heading', level: 1, text: '一', inline: [{ type: 'text', text: '一' }] },
      { type: 'heading', level: 6, text: '六', inline: [{ type: 'text', text: '六' }] },
      {
        type: 'paragraph',
        text: '####### 七\n#題',
        inline: [{ type: 'text', text: '####### 七\n#題' }],
      },
    ])
  })

  it('2 桁の番号から始まるリストも番号付きにし、記号の後の連続空白は項目に含めない', () => {
    expect(parseMarkdown('10. 十\n11.  十一')).toEqual([
      { type: 'list', ordered: true, items: ['十', '十一'], indents: [0, 0] },
    ])
    expect(parseMarkdown('-  一\nあ - い')).toEqual([
      { type: 'list', ordered: false, items: ['一'], indents: [0] },
      { type: 'paragraph', text: 'あ - い', inline: [{ type: 'text', text: 'あ - い' }] },
    ])
    expect(parseMarkdown('#  題')[0]).toMatchObject({ type: 'heading', level: 1, text: '題' })
  })

  it('リストは記号の種類を問わず続け、番号付きとの切り替えで別のリストにする', () => {
    expect(parseMarkdown('- 一\n* 二\n  + 三\n1. 四\n10. 五\n- 六')).toEqual([
      { type: 'list', ordered: false, items: ['一', '二', '三'], indents: [0, 0, 2] },
      { type: 'list', ordered: true, items: ['四', '五'], indents: [0, 0] },
      { type: 'list', ordered: false, items: ['六'], indents: [0] },
    ])
  })

  it('引用は連続する > 行をまとめて記号と直後の空白 1 つを除く', () => {
    // 行の途中の > では引用を続けない。
    expect(parseMarkdown('> 一\na > b').map((b) => [b.type, b.text])).toEqual([
      ['quote', '一'],
      ['paragraph', 'a > b'],
    ])
    expect(parseMarkdown('> 一\n>二\n  >  三\n後')).toEqual([
      { type: 'quote', text: '一\n二\n 三', inline: [{ type: 'text', text: '一\n二\n 三' }] },
      { type: 'paragraph', text: '後', inline: [{ type: 'text', text: '後' }] },
    ])
  })

  it('段落は次の空行か、見出し・リスト・引用・フェンス・区切り線の行の手前で終える', () => {
    for (const [line, type] of [
      ['## 見出し', 'heading'],
      ['- 項目', 'list'],
      ['2. 項目', 'list'],
      ['> 引用', 'quote'],
      ['```', 'code'],
      ['---', 'rule'],
      // 字下げされた記号・2 桁の番号・前後に空白のある区切り線でも段落を終える。
      ['  ```', 'code'],
      ['  - 項目', 'list'],
      ['  10. 項目', 'list'],
      ['  ---  ', 'rule'],
    ]) {
      expect(parseMarkdown(`一\n二\n${line}`).map((b) => b.type)).toEqual(['paragraph', type])
      expect(parseMarkdown(`一\n二\n${line}`)[0].text).toBe('一\n二')
    }
    // 記号の後に空白が無い行、--- の後に文字が続く行、空白だけの行で区切られた行の扱い。
    expect(parseMarkdown('一\n---x\n--- x').map((b) => b.text)).toEqual(['一\n---x\n--- x'])
    expect(parseMarkdown('一\n  \n二').map((b) => b.text)).toEqual(['一', '二'])
    // 記号の後に空白が無い行は段落の続き。
    expect(parseMarkdown('一\n-二\n2.三\n#四')).toEqual([
      { type: 'paragraph', text: '一\n-二\n2.三\n#四', inline: [{ type: 'text', text: '一\n-二\n2.三\n#四' }] },
    ])
  })
})

type Node = {
  tag: string
  children: Node[]
  listeners: Record<string, () => void>
  [key: string]: unknown
}
const fakeDocument = () => {
  const make = (tag: string): Node => ({
    tag,
    children: [],
    listeners: {},
    append(...children: Node[]) {
      this.children.push(...children)
    },
    addEventListener(type: string, listener: () => void, options?: unknown) {
      this.listeners[type] = listener
      this.listenerOptions = options
    },
  })
  return { createDocumentFragment: () => make('fragment'), createElement: make } as unknown as Document
}
const render = (src: string) => renderMarkdown(src, fakeDocument()) as unknown as Node
// 出力木を「タグ(子…)」と葉の文字列で表す。属性は個別に確かめる。
const shape = (n: Node): string =>
  n.children.length ? `${n.tag}(${n.children.map(shape).join(' ')})` : n.tag === 'span' ? `"${n.textContent}"` : n.tag

describe('renderMarkdown の DOM 出力', () => {
  it('ブロックを対応する要素にし、見出しは 2 段下げて h6 で止める', () => {
    expect(shape(render('# 一\n### 三\n#### 四\n\n---\n> 引用\n\n```\n<b>\n```\n\n段落'))).toBe(
      'fragment(h3(span("一")) h5(span("三")) h6(span("四")) hr blockquote(span("引用")) pre(code) p(span("段落")))',
    )
    const code = render('```\n<b>x</b>\n```').children[0].children[0]
    expect(code).toMatchObject({ tag: 'code', textContent: '<b>x</b>' })
  })

  it('段落内の改行は br にし、行ごとの文字はそのまま文字として置く', () => {
    expect(shape(render('一\n<b>二</b>'))).toBe('fragment(p(span("一" br "<b>二</b>")))')
  })

  it('リストは番号の有無で ol/ul にし、先頭より深い項目を直前の項目の下に入れ子にする', () => {
    expect(shape(render('- 一\n  - 一の一\n  - 一の二\n- 二\n\n1. 甲\n   1. 甲の一'))).toBe(
      'fragment(ul(li(span("一") ul(li(span("一の一")) li(span("一の二")))) li(span("二"))) ol(li(span("甲") ol(li(span("甲の一"))))))',
    )
    // 先頭が既に字下げされていても、同じ深さの項目は入れ子にしない。
    expect(shape(render('  - 一\n  - 二'))).toBe('fragment(ul(li(span("一")) li(span("二"))))')
  })

  it('インライン記法を対応する要素にする', () => {
    expect(shape(render('`c` **b** *i* ~~消す~~ a _斜_'))).toBe(
      'fragment(p(code("c") span(" ") strong("b") span(" ") em("i") span(" ") del("消す") span(" a ") em("斜")))',
    )
    // 英数字に挟まれた _ は斜体にしない。外部リンク以外の要素には href を付けない。
    expect(shape(render('snake_case_name'))).toBe('fragment(p(span("snake_case_name")))')
    expect(render('`c`').children[0].children[0]).not.toHaveProperty('href')
    expect(render('`c`').children[0].children[0]).not.toHaveProperty('target')
  })

  it('外部リンクは新しいタブで開き、遷移元と opener を渡さない', () => {
    const a = render('[例](https://example.com/x)').children[0].children[0]
    expect(a).toMatchObject({
      tag: 'a',
      href: 'https://example.com/x',
      target: '_blank',
      rel: 'noopener noreferrer',
      referrerPolicy: 'no-referrer',
    })
    expect(shape(a)).toBe('a("例")')
    // 太字の中のリンクも同じ属性のリンクとして入れ子にする。
    const bold = render('**[例](https://example.com/x)**').children[0].children[0]
    expect(shape(bold)).toBe('strong(a("例"))')
    expect(bold.children[0]).toMatchObject({
      href: 'https://example.com/x',
      target: '_blank',
      rel: 'noopener noreferrer',
    })
  })

  it('vault 画像は遅延読み込みのリンク付き画像にし、読み込めない時は理由を表示する', () => {
    const wrap = render('![和装](kohako-vault:a.png)').children[0].children[0]
    const url = '/kohako/api/v1/vault-image?path=a.png'
    expect(wrap).toMatchObject({ tag: 'span', className: 'vault-image' })
    const link = wrap.children[0],
      image = link.children[0]
    expect(link).toMatchObject({ tag: 'a', href: url, target: '_blank', rel: 'noopener noreferrer' })
    expect(image).toMatchObject({ tag: 'img', src: url, alt: '和装', loading: 'lazy', referrerPolicy: 'no-referrer' })
    expect(wrap.children).toHaveLength(1)
    // 読み込み失敗の案内は 1 回だけ出す。
    expect(image.listenerOptions).toEqual({ once: true })
    image.listeners.error()
    expect(image.hidden).toBe(true)
    expect(wrap.children[1].tag).toBe('span')
    expect(wrap.children[1].textContent).toBe(
      '画像を表示できません（和装）。削除・移動・対応形式・認証を確認してください。',
    )
    const unnamed = render('![](kohako-vault:b.png)').children[0].children[0]
    unnamed.children[0].children[0].listeners.error()
    expect(unnamed.children[1].textContent).toBe(
      '画像を表示できません（vault画像）。削除・移動・対応形式・認証を確認してください。',
    )
  })

  it('Obsidian ノートは同じタブで開くリンクにし、パスを title に示す', () => {
    const a = render('Tickets/BOXP-1.md').children[0].children[0]
    expect(a).toMatchObject({
      tag: 'a',
      className: 'obsidian-note',
      href: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-1.md',
      title: 'Obsidianで開く: Tickets/BOXP-1.md',
      referrerPolicy: 'no-referrer',
    })
    expect(a).not.toHaveProperty('target')
    expect(a.children.map((c) => [c.tag, c.className ?? '', c.textContent])).toEqual([
      ['span', '', 'BOXP-1'],
      ['span', 'obsidian-note-badge', 'Obsidianで開く'],
    ])
  })
})

describe('インライン・読み上げ用の補助', () => {
  it('vault 以外の画像はリンクにして「画像:」を付け、太字の中のリンク以外はただの文字にする', () => {
    expect(parseInline('![図](https://example.com/a.png)')).toEqual([
      { type: 'link', text: '画像: 図', url: 'https://example.com/a.png' },
    ])
    const bold = parseInline('**`c` [x](https://example.com/)**')[0]
    expect(bold).toMatchObject({ type: 'bold', text: 'c x' })
    expect((bold as { children: { type: string }[] }).children.map((c) => c.type)).toEqual(['text', 'text', 'link'])
  })

  it('obsidian URL の = を持たない引数は、名前が vault/file に見えても拒否する', () => {
    expect(obsidianNotePath('obsidian://open?vault=BOXP&file=a.md')).toBe('a.md')
    expect(obsidianNotePath('obsidian://open?vault=BOXP&fileX')).toBeUndefined()
    expect(obsidianNotePath('obsidian://open?vault=BOXP&file=a.md&=x')).toBeUndefined()
  })

  it('ノートのパスの予約記号は大文字の 16 進でエスケープする', () => {
    expect(obsidianNoteUrl("a*(1)!'.md")).toBe('obsidian://open?vault=BOXP&file=a%2A%281%29%21%27.md')
  })

  it('plainText はリストの項目を行ごとに並べ、区切り線や空のブロックで空行を作らない', () => {
    expect(plainText('一\n\n---\n\n- 甲\n- 乙\n\n```\n```\n\n二')).toBe('一\n甲\n乙\n二')
  })
})
