// BOXP-738: 期待値は vault の Projects/kohako-home/idle-framecap-738.md（指定の表・間引いてよい条件・描くかどうかの例）から書いている。
import { describe, expect, it } from 'vitest'
import { type CapInput, capWanted, drawDue, frameCapOption, nextDrawAt } from './framecap'

describe('frameCapOption（URL の指定）', () => {
  it('指定なしは 30 回/秒', () => expect(frameCapOption('')).toBe(30))
  it('?idlefps=off は間引かない', () => expect(frameCapOption('?idlefps=off')).toBeNull())
  it('10〜60 の整数はその値', () => {
    expect(frameCapOption('?idlefps=10')).toBe(10)
    expect(frameCapOption('?idlefps=24')).toBe(24)
    expect(frameCapOption('?idlefps=60')).toBe(60)
  })
  it('それ以外は既定の 30', () => {
    for (const q of ['?idlefps=abc', '?idlefps=5', '?idlefps=61', '?idlefps=30.5', '?idlefps=', '?idlefps=-30'])
      expect(frameCapOption(q)).toBe(30)
  })
  it('他の指定と並んでも読む', () => expect(frameCapOption('?seat=now&idlefps=off')).toBeNull())
})

const CALM: CapInput = {
  idle: true,
  home: true,
  touching: false,
  recording: false,
  sinceMoveMs: 10_000,
}

describe('capWanted（間引いてよい条件）', () => {
  it('静かな待機は間引く', () => expect(capWanted(CALM)).toBe(true))
  it('待機でない（聞いている・考えている・話している・確認待ち・失敗・送信中）は毎フレーム', () =>
    expect(capWanted({ ...CALM, idle: false })).toBe(false))
  it('おでかけ中・帰還の演出中は毎フレーム', () => expect(capWanted({ ...CALM, home: false })).toBe(false))
  it('なで・タップ・身振りの最中は毎フレーム', () => expect(capWanted({ ...CALM, touching: true })).toBe(false))
  it('録音・長押し中は毎フレーム', () => expect(capWanted({ ...CALM, recording: true })).toBe(false))
  it('マウスを動かしてから 4 秒未満は毎フレーム、4 秒たてば間引く', () => {
    expect(capWanted({ ...CALM, sinceMoveMs: 0 })).toBe(false)
    expect(capWanted({ ...CALM, sinceMoveMs: 3999 })).toBe(false)
    expect(capWanted({ ...CALM, sinceMoveMs: 4001 })).toBe(true)
  })
  it('一度も動かしていない（Infinity）は間引く', () =>
    expect(capWanted({ ...CALM, sinceMoveMs: Number.POSITIVE_INFINITY })).toBe(true))
})

/** 間隔 step ms の画面で、0 から total ms まで描いた時刻を返す。 */
function drawsOn(step: number, total: number, fps: number | null, capped: (t: number) => boolean = () => true) {
  const out: number[] = []
  let next = Number.NEGATIVE_INFINITY
  for (let i = 0; i * step <= total + 1e-9; i++) {
    const t = i * step
    const c = capped(t)
    if (drawDue(t, next, fps, c)) {
      out.push(+t.toFixed(1))
      next = nextDrawAt(next, t, fps, c)
    }
  }
  return out
}

describe('drawDue（描くかどうか）', () => {
  it('60Hz で上限 30: 0, 33.3, 66.7 … ms で描く（30 回/秒）', () => {
    expect(drawsOn(1000 / 60, 100, 30)).toEqual([0, 33.3, 66.7, 100])
    expect(drawsOn(1000 / 60, 1000 - 1, 30)).toHaveLength(30)
  })
  it('120Hz で上限 30: 0, 33.3, 66.7 … ms（30 回/秒）', () => {
    expect(drawsOn(1000 / 120, 100, 30)).toEqual([0, 33.3, 66.7, 100])
    expect(drawsOn(1000 / 120, 1000 - 1, 30)).toHaveLength(30)
  })
  it('144Hz で上限 30: 0, 34.7, 69.4, 104.2 …（予定 33.3 ms ごとの直後のフレーム。30 回/秒）', () => {
    expect(drawsOn(1000 / 144, 105, 30)).toEqual([0, 34.7, 69.4, 104.2])
    expect(drawsOn(1000 / 144, 1000 - 1, 30)).toHaveLength(30)
  })
  it('上限を超えて描かない（144Hz・上限 60 → 1 秒に 60 回以下、61Hz・上限 60 → 60 回以下）', () => {
    expect(drawsOn(1000 / 144, 1000 - 1, 60).length).toBeLessThanOrEqual(60)
    expect(drawsOn(1000 / 144, 1000 - 1, 60).length).toBeGreaterThanOrEqual(58)
    expect(drawsOn(1000 / 61, 1000 - 1, 60).length).toBeLessThanOrEqual(60)
    expect(drawsOn(1000 / 120, 1000 - 1, 24).length).toBeLessThanOrEqual(24)
  })
  it('30Hz 以下の画面は毎回描く', () => {
    expect(drawsOn(1000 / 30, 100, 30)).toEqual([0, 33.3, 66.7, 100])
    expect(drawsOn(50, 200, 30)).toEqual([0, 50, 100, 150, 200])
  })
  it('間引かない指定（null）・間引かない状況では毎回描く', () => {
    expect(drawsOn(1000 / 60, 50, null)).toEqual([0, 16.7, 33.3, 50])
    expect(drawsOn(1000 / 60, 50, 30, () => false)).toEqual([0, 16.7, 33.3, 50])
  })
  it('間引き中に会話・なでが始まると、そのフレームから毎回描く', () => {
    // 40 ms から毎フレームへ。間引き中に最後に描いたのは 33.3 ms。
    expect(drawsOn(1000 / 60, 100, 30, (t) => t < 40)).toEqual([0, 33.3, 50, 66.7, 83.3, 100])
  })
  it('毎フレームから間引きへ移ると、最後に描いてから 1 間隔あけて描く', () => {
    // 50 ms まで毎フレーム（最後は 50 ms）、以後は間引き → 次は 83.3 ms。
    expect(drawsOn(1000 / 60, 120, 30, (t) => t > 55)).toEqual([0, 16.7, 33.3, 50, 83.3, 116.7])
  })
  it('裏タブから戻った直後は（予定を過ぎているので）必ず描き、そこから数え直す', () => {
    expect(drawDue(60_000, 33.3, 30, true)).toBe(true)
    expect(nextDrawAt(33.3, 60_000, 30, true)).toBeCloseTo(60_033.3, 1)
  })
  it('重くて 30 回/秒に届かない環境（58 ms ごと）では毎回描く', () =>
    expect(drawsOn(58, 300, 30)).toEqual([0, 58, 116, 174, 232, 290]))
})
