import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arrivalNote, arrivalPhase, LANDING_MS } from './arrival'
const base = { rigLoading: false, visit: false, returnedAt: null, now: 10_000 }
describe('家へ戻る演出（BOXP-599 TD-01）', () => {
  it('実際の処理状態から段階を決める', () => {
    expect(arrivalPhase({ ...base, rigLoading: true })).toBe('arriving')
    expect(arrivalPhase({ ...base, visit: true })).toBe('away')
    expect(arrivalPhase({ ...base, rigLoading: true, visit: true })).toBe('away')
    expect(arrivalPhase(base)).toBe('home')
  })
  it('戻った直後だけ短く着地し、待たせない', () => {
    expect(arrivalPhase({ ...base, returnedAt: 10_000 })).toBe('landing')
    expect(arrivalPhase({ ...base, returnedAt: 10_000 - LANDING_MS + 1 })).toBe('landing')
    expect(arrivalPhase({ ...base, returnedAt: 10_000 - LANDING_MS })).toBe('home')
    expect(LANDING_MS).toBeLessThanOrEqual(1000)
  })
  it('段階ごとの短い案内', () => {
    expect(arrivalNote.arriving).toContain('戻っています')
    expect(arrivalNote.away).toContain('現場')
    expect(arrivalNote.landing).toContain('戻りました')
    expect(arrivalNote.home).toBe('')
  })
})
describe('帰還の演出の見た目（転送ゲート）', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../../home.html', import.meta.url), 'utf8')
  it('メダルは作画資料の顔（アイコンと同じ絵）を使い、ドット絵を使わない', () => {
    expect(html).toMatch(/id="gate-sprite"[^>]*src="\.\/kohako\/icons\/icon-192-v2\.png"/)
    expect(css).not.toMatch(/\.gate-sprite\{[^}]*pixelated/)
    expect(html).toMatch(/class="gate" aria-hidden="true"/)
    expect(css).not.toMatch(/\.gate[^{]*\{[^}]*url\(/)
  })
  it('ゲートは操作を受けず、小さい表示では出さない', () => {
    expect(css).toContain('.gate{position:absolute;inset:0;pointer-events:none}')
    expect(css).toContain('.character.mini .gate,.character.mini .arrival-note{display:none}')
  })
  it('「動きを減らす」と OS の設定では動かさず、現場中の姿は静かに隠す', () => {
    expect(css).toMatch(/body\.reduce \.gate \*[^{]*\{animation:none!important\}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.gate \*[^{]*\{animation:none!important\}/)
    expect(css).toContain('body.reduce .character:not(.mini)[data-arrival="away"] > :is(img,#rig){opacity:0}')
  })
  it('明滅させない（往復する不透明度の繰り返しを置かない）', () => {
    for (const m of css.matchAll(/@keyframes (gate-[a-z-]+)\{([^@]*)\}/g)) {
      const infinite = new RegExp(`${m[1]} [^;},]*infinite`).test(css)
      if (infinite) expect(m[2]).not.toContain('opacity')
    }
  })
})
