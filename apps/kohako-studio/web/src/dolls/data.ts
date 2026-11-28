// 人形の絵を見比べるページのデータ（BOXP-760）。決まりは vault の Projects/kohako-home/model-dolls-760.md。
// 人形の名前・由来・持ち物・主色は企画（BOXP-757 の 6 章）の表のまま。絵は agy の画像生成で 1 体 1 枚。
export type Version = {
  /** 版の番号（1 から）。版の札は <人形の鍵>-v<番号>。一度出した札は別の絵に付け替えない。 */
  n: number
  stage: '初稿' | '改稿'
  /** 担当が絵を見て気づいた点（企画との違い・弱い所）。採否ではない。 */
  notes?: string[]
}
export type Doll = {
  key: string
  name: string
  assignee: string
  model: string
  origin: string
  item: string
  colors: string
  versions: Version[]
}

export const DOLLS: Doll[] = [
  {
    key: 'fable',
    name: '語り部の人形',
    assignee: 'claude-fable',
    model: 'claude-fable-5-2',
    origin: 'Fable＝寓話',
    item: '開いた絵本を抱える。髪に栞',
    colors: '深緑と生成り',
    versions: [
      {
        n: 1,
        stage: '初稿',
        notes: [
          '本を持つ、という題材は、既存の Claude の二次創作の絵（本を抱える・本を開く）と重なります。髪・服・色・頭身は別です。最初の案は茶色の三つ編みで、既存の絵の 1 つと「茶色の編んだ髪＋開いた本」が重なったため、髪だけ変えて描き直しました（前の案は一覧に出していません）',
          '顔と立ち方は、歌詠み・庭師・灯守りなどと同じ型です',
        ],
      },
    ],
  },
  {
    key: 'opus',
    name: '楽長の人形',
    assignee: 'claude-opus',
    model: 'claude-opus-5-5',
    origin: 'Opus＝作品番号',
    item: '指揮棒を上げる。帯に五線',
    colors: 'えんじと黒',
    versions: [
      {
        n: 1,
        stage: '初稿',
        notes: [
          '回路の線が両袖に 1 本ずつ、計 2 本あります（企画は 1 本）',
          '9 体の中で、立ち方がいちばん違います（腕を上げている）',
        ],
      },
    ],
  },
  {
    key: 'sonnet',
    name: '歌詠みの人形',
    assignee: 'claude-sonnet',
    model: 'claude-sonnet-5-5',
    origin: 'Sonnet＝十四行詩',
    item: '短冊と筆',
    colors: '若草と白',
    versions: [{ n: 1, stage: '初稿', notes: ['短冊と筆は細く、小さい表示では見分けにくいかもしれません'] }],
  },
  {
    key: 'terra',
    name: '庭師の人形',
    assignee: 'codex / codex-terra',
    model: 'gpt-6.1-terra',
    origin: 'Terra＝大地',
    item: '植木鉢と小さな移植ごて',
    colors: '土色と苔色',
    versions: [{ n: 1, stage: '初稿', notes: ['背中の笠で、小さい表示でも輪郭が他と違います'] }],
  },
  {
    key: 'sol',
    name: '灯守りの人形',
    assignee: 'codex-sol / codex-full',
    model: 'gpt-6.1-sol',
    origin: 'Sol＝太陽',
    item: '日輪の提灯',
    colors: '山吹と白',
    versions: [{ n: 1, stage: '初稿', notes: ['提灯が体の横に大きく出るので、小さい表示でも見分けやすい側です'] }],
  },
  {
    key: 'luna',
    name: '月見の人形',
    assignee: 'codex-mini',
    model: 'gpt-5.6-luna',
    origin: 'Luna＝月',
    item: '三日月のうちわ。ひと回り小さい',
    colors: '藍と銀',
    versions: [
      {
        n: 1,
        stage: '初稿',
        notes: [
          '企画の「ひと回り小さい」にはなっていません（他と同じ背丈）',
          '口を結んだ静かな顔です（他は笑顔）。最初の絵は緑の裾が混ざり、うちわの柄が離れていたので描き直しました',
        ],
      },
    ],
  },
  {
    key: 'astra',
    name: '星見の人形',
    assignee: 'codex-astra',
    model: 'gpt-6-astra',
    origin: 'Astra＝星',
    item: '遠眼鏡',
    colors: '紺と白',
    versions: [
      {
        n: 1,
        stage: '初稿',
        notes: [
          '青系の髪と星の髪飾りは、既存の Gemini の二次創作の絵（青紫の髪・星の飾り・猫耳）と一部が重なります。猫耳・紫・服の形はありません。この人形は GPT 系（astra）の担当で、対応するモデルは別です',
        ],
      },
    ],
  },
  {
    key: 'neon',
    name: '灯り細工の人形',
    assignee: 'antigravity',
    model: 'gemini-4-neon-*',
    origin: 'Neon＝ネオン管の灯り',
    item: '曲げたガラス管の輪',
    colors: '桃と水色',
    versions: [{ n: 1, stage: '初稿', notes: ['輪は閉じておらず、下に切れ目があります（ガラス管の両端）'] }],
  },
  {
    key: 'plain',
    name: '無地の人形',
    assignee: '上に無いモデル、モデル未確認',
    model: '—',
    origin: '—',
    item: '木地のまま。名札だけ',
    colors: '木の色',
    versions: [
      {
        n: 1,
        stage: '初稿',
        notes: ['目は点 2 つ、小さな口があります。名札は空白です。最初の絵は名札に英字が入ったので描き直しました'],
      },
    ],
  },
]

export const tagOf = (d: Doll, v: Version) => `${d.key}-v${v.n}`
/** 新しい版から順に（番号の大きい順）。 */
export const newestFirst = (d: Doll) => [...d.versions].sort((a, b) => b.n - a.n)
/** 最新の版。版の無い人形は checkDolls が落とすので、ここへは来ない。 */
export const latest = (d: Doll): Version => newestFirst(d)[0] as Version
/** 絵は候補の中の kohako/dolls/ だけを指す（外部や別の場所は指さない）。 */
export const imageURL = (tag: string) => `./kohako/dolls/${tag}.jpg`
/** 一覧の札に文字で出す 3 行。 */
export const cardLines = (d: Doll) => {
  const v = latest(d)
  return { name: d.name, who: `${d.assignee} → ${d.model}`, tag: `${tagOf(d, v)}（${v.stage}）` }
}

const KEY = /^[a-z]{1,12}$/
/** データの崩れを文で返す（空なら良い）。崩れたまま絵の札を作らないよう、テストと画面の両方で使う。 */
export function checkDolls(dolls: Doll[]): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const d of dolls) {
    if (!KEY.test(d.key)) problems.push(`${d.key}: 人形の鍵の形が違う`)
    if (keys.has(d.key)) problems.push(`${d.key}: 人形の鍵が重なっている`)
    keys.add(d.key)
    if (d.versions.length === 0) problems.push(`${d.key}: 版が無い`)
    const ns = new Set<number>()
    for (const v of d.versions) {
      if (!Number.isInteger(v.n) || v.n < 1 || v.n > 99) problems.push(`${d.key}: 版の番号 ${v.n} が違う`)
      else if (ns.has(v.n)) problems.push(`${d.key}: 版の番号 ${v.n} が重なっている`)
      ns.add(v.n)
    }
  }
  return problems
}
