import { describe, expect, it } from 'vitest'
import { type GlEvent, nextRigGl, type RigGl } from './glloss'

const run = (start: RigGl, steps: [GlEvent, boolean][]) => {
  let s = start
  const actions: string[] = []
  for (const [ev, lost] of steps) {
    const r = nextRigGl(s, ev, lost)
    s = r.next
    if (r.action) actions.push(r.action)
  }
  return { state: s, actions }
}

describe('nextRigGl（BOXP-663）', () => {
  it('失われたら静止画へ、戻ったら読み直して動く姿を出す', () => {
    expect(
      run('live', [
        ['lost', true],
        ['restored', false],
        ['rebuilt', false],
      ]),
    ).toEqual({ state: 'live', actions: ['fallback', 'rebuild', 'show'] })
  })
  it('喪失のイベントを取りこぼしても、画面に戻った時に失われていれば静止画へ切り替える', () => {
    expect(nextRigGl('live', 'visible', true)).toEqual({ next: 'lost', action: 'fallback' })
    expect(nextRigGl('live', 'visible', false)).toEqual({ next: 'live', action: null })
  })
  it('復帰のイベントを取りこぼしても、画面に戻った時にコンテキストが使えれば読み直す', () => {
    expect(nextRigGl('lost', 'visible', false)).toEqual({ next: 'rebuilding', action: 'rebuild' })
    expect(nextRigGl('lost', 'visible', true)).toEqual({ next: 'lost', action: null })
  })
  it('読み直しの途中でまた失われたら、結果を出さず次の復帰を待つ', () => {
    expect(
      run('live', [
        ['lost', true],
        ['restored', false],
        ['lost', true],
        ['rebuilt', true],
        ['restored', false],
        ['rebuilt', false],
      ]),
    ).toEqual({ state: 'live', actions: ['fallback', 'rebuild', 'rebuild', 'show'] })
  })
  it('読み直しが終わった時点でまた失われていれば出さない', () => {
    expect(nextRigGl('rebuilding', 'rebuilt', true)).toEqual({ next: 'lost', action: null })
  })
  it('読み直しに失敗したら静止画のまま次の復帰を待つ', () => {
    expect(nextRigGl('rebuilding', 'failed', false)).toEqual({ next: 'lost', action: null })
    expect(nextRigGl('lost', 'restored', false)).toEqual({ next: 'rebuilding', action: 'rebuild' })
  })
  it('読み直し中の重複した復帰・画面復帰では二重に読み直さない', () => {
    expect(nextRigGl('rebuilding', 'restored', false)).toEqual({ next: 'rebuilding', action: null })
    expect(nextRigGl('rebuilding', 'visible', false)).toEqual({ next: 'rebuilding', action: null })
  })
  it('動く姿を使っていない時は何もしない', () => {
    for (const ev of ['lost', 'restored', 'visible', 'rebuilt', 'failed'] as const)
      expect(nextRigGl('none', ev, true)).toEqual({ next: 'none', action: null })
  })
  it('描いている間の復帰・完了の知らせは無視する', () => {
    for (const ev of ['restored', 'rebuilt', 'failed'] as const)
      expect(nextRigGl('live', ev, false)).toEqual({ next: 'live', action: null })
  })
})
