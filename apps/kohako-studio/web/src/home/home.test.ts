import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SceneDirector, targetScene, type SceneInput } from './scene'
import { cardsFromText } from './cards'
import { bboxOf, classifyTouch, TouchLimiter, TouchBatcher, toScreenRect, type Point } from './touch'
import { parseResume, parseUnconfirmed, pollVerdict } from './resume'
import { parsePrefs, parseVolume } from './prefs'

const base: SceneInput = { state: 'idle', thinkingMs: 0, cardsOpen: false, idleMs: 0, hasReply: false, netDown: false }
describe('場面', () => {
  it('状態から場面を選ぶ', () => {
    expect(targetScene(base)).toBe('relax')
    expect(targetScene({ ...base, state: 'thinking', thinkingMs: 3000 })).toBe('talk')
    expect(targetScene({ ...base, state: 'thinking', thinkingMs: 8001 })).toBe('work')
    expect(targetScene({ ...base, state: 'approval', cardsOpen: true })).toBe('confirm')
    expect(targetScene({ ...base, state: 'failed' })).toBe('offline')
    expect(targetScene({ ...base, state: 'thinking', netDown: true })).toBe('offline')
    expect(targetScene({ ...base, state: 'done', cardsOpen: true })).toBe('show')
    expect(targetScene({ ...base, state: 'done', hasReply: true, idleMs: 10_000 })).toBe('talk')
    expect(targetScene({ ...base, state: 'done', hasReply: true, idleMs: 60_001 })).toBe('relax')
  })
  it('切替は 1.5 秒に 1 回・操作中は保留・固定中は止める。確認と切断は即時', () => {
    const d = new SceneDirector('relax')
    expect(d.decide('talk', 0, { holding: false, pinned: false })).toBe('talk')
    expect(d.decide('show', 1000, { holding: false, pinned: false })).toBe('talk')
    expect(d.decide('show', 1600, { holding: true, pinned: false })).toBe('talk')
    expect(d.decide('show', 1700, { holding: false, pinned: true })).toBe('talk')
    expect(d.decide('confirm', 1700, { holding: true, pinned: true })).toBe('confirm')
    expect(d.decide('work', 1701, { holding: true, pinned: true })).toBe('work')
    expect(d.decide('relax', 1702, { holding: false, pinned: false, force: true })).toBe('relax')
    expect(d.decide('talk', 5000, { holding: false, pinned: false })).toBe('talk')
  })
})
describe('結果カード', () => {
  it('箇条書き・https リンク・コードだけを取り出す', () => {
    const cards = cardsFromText(
      '予定です。\n- 10:00 定例\n- 15:00 歯医者\n詳しくは https://example.com/a?b=1 を。http://insecure.example は対象外。\n```\nls -la\n```',
    )
    expect(cards).toEqual([
      { kind: 'code', text: 'ls -la' },
      { kind: 'list', items: ['10:00 定例', '15:00 歯医者'] },
      { kind: 'link', url: 'https://example.com/a?b=1', host: 'example.com' },
    ])
  })
  it('1 行だけの箇条書きや javascript: はカードにしない', () => {
    expect(cardsFromText('- ひとつだけ\njavascript:alert(1) <img src=x>')).toEqual([])
  })
  it('記号なしの短い行の列挙も一覧にする（文章の段落は一覧にしない）', () => {
    expect(
      cardsFromText(
        'ご主人さま、こんなことはどうですか。\n\n用事をひとつ進める\n散歩する\n振り返る\n\nhttps://www.jma.go.jp/',
      ),
    ).toEqual([
      { kind: 'list', items: ['用事をひとつ進める', '散歩する', '振り返る'] },
      { kind: 'link', url: 'https://www.jma.go.jp/', host: 'www.jma.go.jp' },
    ])
    expect(cardsFromText('一文目です。\n二文目です。\n三文目です。')).toEqual([])
  })
  it('句読点で URL を切る', () => {
    expect(cardsFromText('こちらです（https://a.example/x）。')).toEqual([
      { kind: 'link', url: 'https://a.example/x', host: 'a.example' },
    ])
  })
})
const line = (pts: [number, number, number][]): Point[] => pts.map(([x, y, time]) => ({ x, y, time }))
describe('ふれあい', () => {
  it('タップ・なでる・長押し・縦スクロールを見分ける', () => {
    expect(
      classifyTouch(
        line([
          [0, 0, 0],
          [2, 1, 150],
        ]),
        'hand',
      ),
    ).toBe('tap')
    expect(
      classifyTouch(
        line([
          [0, 0, 0],
          [0, 0, 700],
        ]),
        'head',
      ),
    ).toBeNull()
    expect(
      classifyTouch(
        line([
          [0, 0, 0],
          [30, 2, 150],
          [0, 3, 300],
          [30, 2, 450],
          [0, 1, 600],
        ]),
        'head',
      ),
    ).toBe('pat')
    expect(
      classifyTouch(
        line([
          [0, 0, 0],
          [30, 2, 150],
          [0, 3, 300],
          [30, 2, 450],
          [0, 1, 600],
        ]),
        'hand',
      ),
    ).toBeNull()
    expect(
      classifyTouch(
        line([
          [0, 0, 0],
          [5, 80, 200],
          [8, 160, 400],
        ]),
        'head',
      ),
    ).toBeNull()
  })
  it('台詞は 20 秒に 1 回、同じ反応を続けない、なですぎると控えめになる', () => {
    const l = new TouchLimiter(),
      opts = { lines: true, quietOnly: false }
    const a = l.react('tap', 'head', 0, opts),
      b = l.react('tap', 'head', 1000, opts)
    expect(a).toEqual({ reaction: 'nod', line: expect.any(String) })
    expect(b.reaction).not.toBe('nod')
    expect(b.line).toBeNull()
    expect(l.react('tap', 'hand', 21_000, opts)).toEqual({ reaction: 'highFive', line: 'はい、ハイタッチです！' })
    for (let t = 22_000; t < 25_000; t += 1000) l.react('tap', 'head', t, opts)
    const over = l.react('pat', 'head', 25_500, opts)
    expect(over).toEqual({ reaction: 'tickle', line: 'くすぐったいです…' })
    expect(l.subdued(80_000)).toBe(true)
    expect(l.react('pat', 'head', 80_000, opts)).toEqual({ reaction: 'quiet', line: null })
    expect(l.subdued(86_000)).toBe(false)
  })
  it('ひとこと OFF・作業中は台詞を出さない', () => {
    expect(new TouchLimiter().react('tap', 'head', 0, { lines: false, quietOnly: false }).line).toBeNull()
    expect(new TouchLimiter().react('pat', 'head', 0, { lines: true, quietOnly: true })).toEqual({
      reaction: 'quiet',
      line: null,
    })
  })
  it('モデル座標の範囲を画面の矩形へ写し、44px 以上にする', () => {
    expect(bboxOf([1, 2, 5, 9, 3, 0])).toEqual([1, 0, 5, 9])
    const r = toScreenRect([100, 200, 110, 210], { scale: 0.5, left: 10, top: 20 }, 0)
    expect(r).toEqual({ x: 10 + 50 + 2.5 - 22, y: 20 + 100 + 2.5 - 22, w: 44, h: 44 })
  })
})
describe('保存', () => {
  it('期限内の進行中依頼だけ読み直す', () => {
    expect(parseResume('{"requestId":"abcdefgh","expiresAt":100,"accepted":true}', 99)?.requestId).toBe('abcdefgh')
    expect(parseResume('{"requestId":"abcdefgh","expiresAt":100,"accepted":true}', 100)).toBeNull()
    expect(parseResume('{"requestId":"../x","expiresAt":100,"accepted":true}', 0)).toBeNull()
    expect(parseResume('壊れた', 0)).toBeNull()
  })
  it('受理未確認の送信を形が合うときだけ戻す', () => {
    expect(parseUnconfirmed('{"kind":"text","text":"やあ","requestId":"abcdefgh-1","expiresAt":5}')).toEqual({
      kind: 'text',
      text: 'やあ',
      requestId: 'abcdefgh-1',
      expiresAt: 5,
    })
    expect(parseUnconfirmed('{"kind":"text","text":1,"requestId":"abcdefgh","expiresAt":5}')).toBeNull()
  })
  it('不正な設定は既定値にする', () => {
    expect(parsePrefs('{"touch":"yes","intensity":"loud","pinned":true}')).toEqual({
      voice: 'kohaku',
      volume: 100,
      mix: true,
      touch: true,
      follow: true,
      lines: true,
      intensity: 'normal',
      pinned: true,
      reducedMotion: false,
      bgMotion: true,
      chestSway: true,
    })
    expect(parsePrefs('{"bgMotion":false}').bgMotion).toBe(false)
    expect(parsePrefs('{"voice":"browser"}').voice).toBe('browser')
    expect(parsePrefs('{"voice":"other"}').voice).toBe('kohaku')
    expect(parsePrefs('[]').touch).toBe(true)
    // BOXP-534: 読み上げ音量は 0〜100 の整数。範囲外は端に寄せ、数値でなければ既定 100。
    expect(parsePrefs(null).mix).toBe(true)
    expect(parsePrefs('{"mix":false}').mix).toBe(false)
    expect(parsePrefs('{"mix":"false"}').mix).toBe(true)
    expect(parsePrefs(null).volume).toBe(100)
    expect(parsePrefs('{"volume":40}').volume).toBe(40)
    expect(parsePrefs('{"volume":0}').volume).toBe(0)
    expect(parsePrefs('{"volume":250}').volume).toBe(100)
    expect(parsePrefs('{"volume":-5}').volume).toBe(0)
    expect(parsePrefs('{"volume":33.6}').volume).toBe(34)
    expect(parsePrefs('{"volume":"loud"}').volume).toBe(100)
    expect(parsePrefs('{"volume":null}').volume).toBe(100)
    expect(parseVolume('55')).toBe(55)
    expect(parseVolume('')).toBe(100)
  })
})
describe('home.html', () => {
  it('縦表示では時計と利用枠を隠す (BOXP-544)', () => {
    const css = readFileSync('src/home/style.css', 'utf8')
    expect(css).toMatch(
      /body\[data-shape="portrait"\] \.clock-face,body\[data-shape="portrait"\] \.status-anchor\{display:none\}/,
    )
  })
  it('必要な要素があり、インラインスクリプトがない', () => {
    const html = readFileSync('home.html', 'utf8')
    for (const id of [
      'rig',
      'reply',
      'approval',
      'allow',
      'deny',
      'message',
      'send',
      'stop',
      'record',
      'cards',
      'history',
      'settings',
      'touch-open',
      'reconnect',
      'clock',
      'state',
      'pref-volume',
      'pref-volume-value',
    ])
      expect(html).toContain(`id="${id}"`)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).toContain('href="studio.html"')
  })
  it('腕が枠外へ振れても切れないよう canvas に左右の余白を持たせ、上下だけ切る (BOXP-510 TD-02)', () => {
    expect(readFileSync('home.html', 'utf8')).toMatch(/<canvas id="rig" data-bleed/)
    const css = readFileSync('src/home/style.css', 'utf8')
    expect(css).toContain('#rig[data-bleed]{left:calc(-1 * var(--rig-bleed));width:calc(100% + 2 * var(--rig-bleed))}')
    expect(css).toContain('.character:not(.mini){overflow:visible;clip-path:inset(0 -100vmax)}')
    expect(css).toMatch(/\.character\[data-frame="upper"\] #rig\{[^}]*2 \* var\(--rig-bleed-upper\)/)
  })
})

describe('pollVerdict', () => {
  it('一時的な失敗では追跡を続ける', () => {
    for (const s of [502, 503, 504, 500, 429, 408]) expect(pollVerdict(s, true)).toBe('retry')
    expect(pollVerdict(200, false)).toBe('retry')
  })
  it('成功と終了条件を区別する', () => {
    expect(pollVerdict(200, true)).toBe('ok')
    for (const s of [401, 403, 404, 400]) expect(pollVerdict(s, true)).toBe('terminal')
  })
})

it('aggregates touches after quiet time and suppresses in-flight and frequent requests', () => {
  const b = new TouchBatcher()
  b.add('head', 'pat', 0)
  b.add('head', 'pat', 500)
  expect(b.take(1699, true)).toBeNull()
  expect(b.take(1700, true)).toEqual({ zone: 'head', action: 'pat', count: 2 })
  b.add('hand', 'tap', 2000)
  expect(b.take(4000, true)).toBeNull()
  b.finish()
  b.add('hand', 'tap', 4000)
  expect(b.take(5200, true)).toBeNull()
  b.add('head', 'tap', 16000)
  expect(b.take(17200, false)).toBeNull()
  b.add('hand', 'tap', 18000)
  expect(b.take(19200, true)).toEqual({ zone: 'hand', action: 'tap', count: 1 })
})
