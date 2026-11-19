import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCharacterMorph, layoutKey, MORPH_MS, morphWanted, type Rect } from './morph'

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height })
const R = (r: Rect) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top })

/** DOM を持たないテスト環境向けの最小の偽物。canvas の位置は change() の中で書き換える。 */
function fakes(start: Rect) {
  let canvasRect = start,
    charRect = start
  const children: unknown[] = []
  const classes = new Set<string>()
  const character = {
    dataset: { frame: 'full', arrival: 'home' } as Record<string, string>,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    style: { setProperty: vi.fn() },
    get offsetWidth() {
      return 1
    },
    getBoundingClientRect: () => R(charRect),
    parentElement: {
      getBoundingClientRect: () => R(rect(0, 0, 1440, 800)),
      insertBefore: (n: unknown) => children.push(n),
    },
  }
  const drawn: string[] = []
  const created: { width: number; height: number; style: Record<string, string>; removed: boolean }[] = []
  const canvas = {
    width: 1728,
    height: 1558,
    getBoundingClientRect: () => R(canvasRect),
    ownerDocument: {
      createElement: () => {
        const c = {
          width: 0,
          height: 0,
          style: {} as Record<string, string>,
          className: '',
          removed: false,
          setAttribute: vi.fn(),
          getContext: () => ({ drawImage: () => drawn.push('copy') }),
          remove() {
            c.removed = true
          },
        }
        created.push(c)
        return c
      },
    },
  }
  return {
    character,
    canvas,
    classes,
    children,
    created,
    drawn,
    move: (r: Rect, c: Rect = r) => {
      canvasRect = r
      charRect = c
    },
  }
}

describe('BOXP-626 コハコの配置替え', () => {
  it('枠の切替と、ひと息の大きな移動・伸縮だけを写しで移す', () => {
    const a = rect(43, 60, 864, 780)
    expect(morphWanted(a, rect(29, 60, 778, 780), false)).toBe(true)
    expect(morphWanted(a, a, true)).toBe(true)
    // ウィンドウを少しずつ広げる操作（数 px）では写しを作らない。
    expect(morphWanted(a, rect(45, 60, 870, 784), false)).toBe(false)
    expect(morphWanted(a, rect(43, 60, 0, 0), true)).toBe(false)
    expect(morphWanted(rect(0, 0, 0, 0), a, true)).toBe(false)
  })

  it('配置の組が同じなら同じ鍵、場面・形・枠・小窓・表示欄・高さのどれかが変われば別の鍵', () => {
    const x = { scene: 'talk', shape: 'pc', kbd: false, upper: false, mini: false, viewer: false, vh: 900 }
    expect(layoutKey(x)).toBe(layoutKey({ ...x }))
    for (const d of [
      { scene: 'work' },
      { shape: 'landscape' },
      { kbd: true },
      { upper: true },
      { mini: true },
      { viewer: true },
      { vh: 640 },
    ])
      expect(layoutKey({ ...x, ...d })).not.toBe(layoutKey(x))
  })

  it('大きく動く時は配置替えの前に描いて写し、元の位置・元の見える範囲に置いて新しい絵を浮かび上がらせる', () => {
    vi.useFakeTimers()
    const f = fakes(rect(43, 40, 864, 900))
    f.move(rect(43, 40, 864, 900), rect(43, 60, 576, 780))
    let draws = 0
    const m = createCharacterMorph({
      character: f.character as unknown as HTMLElement,
      canvas: f.canvas as unknown as HTMLCanvasElement,
      draw: () => draws++,
      enabled: () => true,
    })
    const order: string[] = []
    m.around(() => {
      order.push(`change after ${draws} draw / ${f.drawn.length} copy`)
      f.character.dataset.frame = 'upper'
      f.move(rect(-200, 0, 1740, 1443))
    })
    expect(order).toEqual(['change after 1 draw / 1 copy'])
    expect(m.count).toBe(1)
    expect(m.active).toBe(1)
    const ghost = f.created[0]
    expect(f.children).toEqual([ghost])
    expect(ghost.style).toMatchObject({ left: '43px', top: '40px', width: '864px', height: '900px' })
    // .character は canvas の上下を切っている。写しも同じ範囲（上 20px・下 100px を隠す）。
    expect(ghost.style.clipPath).toBe('inset(20px 0px 100px 0px)')
    // 写しは画面の解像度まで縮める（DPR 1 の環境で 864 幅）。
    expect(ghost.width).toBe(864)
    expect(f.classes.has('morph-in')).toBe(true)
    vi.advanceTimersByTime(MORPH_MS + 100)
    expect(ghost.removed).toBe(true)
    expect(f.classes.has('morph-in')).toBe(false)
    expect(m.active).toBe(0)
    vi.useRealTimers()
  })

  it('動きを減らす等で無効な時・変化が小さい時は写しを残さない', () => {
    const f = fakes(rect(43, 60, 864, 780))
    let enabled = false,
      draws = 0
    const m = createCharacterMorph({
      character: f.character as unknown as HTMLElement,
      canvas: f.canvas as unknown as HTMLCanvasElement,
      draw: () => draws++,
      enabled: () => enabled,
    })
    let changed = 0
    m.around(() => {
      changed++
      f.character.dataset.frame = 'upper'
    })
    expect([changed, draws, f.created.length, m.count]).toEqual([1, 0, 0, 0])
    enabled = true
    m.around(() => {
      changed++
      f.move(rect(46, 60, 870, 784))
    })
    expect(changed).toBe(2)
    expect(f.children).toEqual([])
    expect(m.count).toBe(0)
  })

  it('移っている途中にまた替わった時は浮かび上がりをやり直さず（点滅させず）、配置だけ替える', () => {
    vi.useFakeTimers()
    const f = fakes(rect(43, 60, 864, 780))
    let frames = 0
    const m = createCharacterMorph({
      character: f.character as unknown as HTMLElement,
      canvas: f.canvas as unknown as HTMLCanvasElement,
      draw: () => {},
      enabled: () => true,
      frameChanged: () => frames++,
    })
    m.around(() => f.move(rect(29, 60, 600, 780)))
    let changed = 0
    m.around(() => {
      changed++
      f.character.dataset.frame = 'upper'
      f.move(rect(300, 60, 300, 780))
    })
    expect([changed, frames, f.created.length, m.count, m.active]).toEqual([1, 1, 1, 1, 1])
    vi.advanceTimersByTime(MORPH_MS + 100)
    expect(m.active).toBe(0)
    // 終わった後の替わりは新しく写す。
    m.around(() => f.move(rect(29, 60, 600, 780)))
    expect([f.created.length, m.count]).toEqual([2, 2])
    vi.useRealTimers()
  })

  it('画面の大きさ自体が変わった時は写しを使わず即時に切り替え、枠の替わりだけ知らせる', () => {
    const f = fakes(rect(43, 60, 864, 780))
    let frames = 0,
      draws = 0
    const m = createCharacterMorph({
      character: f.character as unknown as HTMLElement,
      canvas: f.canvas as unknown as HTMLCanvasElement,
      draw: () => draws++,
      enabled: () => true,
      frameChanged: () => frames++,
    })
    m.around(
      () => {
        f.character.dataset.frame = 'upper'
        f.move(rect(-200, 0, 1740, 1443))
      },
      { instant: true },
    )
    expect([draws, frames, f.created.length, m.count, m.active]).toEqual([0, 1, 0, 0, 0])
  })

  it('リグ表示中は箱を CSS で伸び縮みさせず、写しと新しい絵の溶け合いは動きを減らす設定で止まる', () => {
    const css = readFileSync('src/home/style.css', 'utf8')
    expect(css).toContain('.character:has(> #rig:not([hidden])){transition:none}')
    // 吹き出しは位置だけ滑らせ、幅は遷移させない（本文の折り返しが毎フレーム変わって揺れないように）。
    const bubble = /\.bubble\{position:absolute;[^}]*transition:([^;}]*)/.exec(css)?.[1]
    expect(bubble).toBe('left .3s ease,top .3s ease,opacity .3s')
    expect(css).toMatch(/\.morph-ghost\{[^}]*pointer-events:none[^}]*animation:morph-out/)
    expect(css).toMatch(/\.character\.morph-in > #rig\{animation:morph-in/)
    // 既存の一括停止（body.reduce / OS の reduced-motion）が写しにも新しい絵にも効く。
    expect(css).toContain('body.reduce *,body.reduce *::before{transition:none!important;animation:none!important}')
    expect(css).toContain(
      '@media (prefers-reduced-motion:reduce){*,*::before{transition:none!important;animation:none!important}}',
    )
  })
})
