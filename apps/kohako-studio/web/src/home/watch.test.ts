import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSegmenter, frameSize, SEGMENT, wakeCalled, watchStep, type WatchEvent, type WatchState } from './watch'

// 期待値は Obsidian の Projects/kohako-home/watch-together-spec.md（決まり・例）と Lean モデルの cases.txt から。
describe('wakeCalled（決まり 4）', () => {
  it.each([
    ['ヘイ、コハコ。この景色どう？', true],
    ['Hey Kohako, what is this?', true],
    ['hey kohako', true],
    ['ねえ小箱、これ何？', true],
    ['こはこ', true],
    ['おーい　コハコちゃん、見て', true],
    ['ＫＯＨＡＫＯ！', true],
    ['今日のワールドきれいだね', false],
    ['さっき琥珀色の空を見たよ、こはこにも見せたかったなあ', false],
    ['コハク、これ見て', false],
    ['', false],
  ])('%s → %s', (text, called) => {
    expect(wakeCalled(text)).toBe(called)
  })
  it('位置 8 で始まれば呼びかけ、9 なら呼びかけでない', () => {
    expect(wakeCalled('あいうえおかきくこはこ')).toBe(true)
    expect(wakeCalled('あいうえおかきくけこはこ')).toBe(false)
  })
})

describe('発話の区切り（決まり 3）', () => {
  const rate = 16000
  const chunk = (ms: number, level: number) => new Float32Array((rate * ms) / 1000).fill(level)
  const feed = (seg: ReturnType<typeof createSegmenter>, parts: Float32Array[]) => {
    const out: Float32Array[] = []
    for (const p of parts) {
      const u = seg.push(p)
      if (u) out.push(u)
    }
    return out
  }
  it('声 1 秒＋無音 0.8 秒で 1 発話', () => {
    const seg = createSegmenter(rate)
    const parts = [...Array(10).fill(chunk(100, 0.1)), ...Array(8).fill(chunk(100, 0))]
    const out = feed(seg, parts)
    expect(out).toHaveLength(1)
    expect(out[0].length).toBeGreaterThanOrEqual(rate * 1)
  })
  it('無音 0.7 秒では区切らない', () => {
    const seg = createSegmenter(rate)
    expect(feed(seg, [...Array(10).fill(chunk(100, 0.1)), ...Array(7).fill(chunk(100, 0))])).toHaveLength(0)
  })
  it('0.4 秒未満の声は捨てる', () => {
    const seg = createSegmenter(rate)
    expect(feed(seg, [...Array(3).fill(chunk(100, 0.1)), ...Array(10).fill(chunk(100, 0))])).toHaveLength(0)
  })
  it('静かなままなら何も出さない', () => {
    const seg = createSegmenter(rate)
    expect(feed(seg, Array(50).fill(chunk(100, 0.001)))).toHaveLength(0)
  })
  it('10 秒で区切る', () => {
    const seg = createSegmenter(rate)
    const out = feed(seg, Array(120).fill(chunk(100, 0.1)))
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0].length).toBeLessThanOrEqual(rate * (SEGMENT.maxMs / 1000) + rate * 0.2)
  })
  it('reset で途中の発話を捨てる', () => {
    const seg = createSegmenter(rate)
    feed(seg, Array(10).fill(chunk(100, 0.1)))
    seg.reset()
    expect(feed(seg, Array(10).fill(chunk(100, 0)))).toHaveLength(0)
  })
})

describe('frameSize（決まり 5: 長辺 1280px 以下）', () => {
  it.each([
    [1920, 1080, 1280, 720],
    [1080, 1920, 720, 1280],
    [1280, 720, 1280, 720],
    [800, 600, 800, 600],
    [3840, 2160, 1280, 720],
  ])('%ix%i → %ix%i', (w, h, ew, eh) => {
    expect(frameSize(w, h)).toEqual({ width: ew, height: eh })
  })
})

describe('watchStep は Lean モデルの全ての並び（長さ 4 まで）で同じ', () => {
  const lines = readFileSync(new URL('../../contract/watch-model/cases.txt', import.meta.url), 'utf8')
    .trim()
    .split('\n')
  const ev = (code: string, s: WatchState): WatchEvent => {
    const cur = s.gen,
      old = s.gen - 1
    switch (code) {
      case 'S':
        return { type: 'start' }
      case 'X':
        return { type: 'stop' }
      case 'U':
        return { type: 'utter' }
      case 'R':
        return { type: 'ready', gen: cur }
      case 'F':
        return { type: 'fail', gen: cur }
      case 'Y':
        return { type: 'heard', gen: cur, heard: 'yes' }
      case 'B':
        return { type: 'heard', gen: cur, heard: 'busy' }
      case 'N':
        return { type: 'heard', gen: cur, heard: 'no' }
      case 'A':
        return { type: 'replied', gen: cur }
      case 'D':
        return { type: 'spoken', gen: cur }
      case 'y':
        return { type: 'heard', gen: old, heard: 'yes' }
      case 'a':
        return { type: 'replied', gen: old }
      default:
        throw new Error(code)
    }
  }
  it('22620 本', () => {
    expect(lines).toHaveLength(22620)
    const bad: string[] = []
    for (const line of lines) {
      const [seq, effects, phase] = line.split(' ')
      let s: WatchState = { phase: 'off', gen: 0 }
      const got: string[] = []
      for (const code of seq.split('.')) {
        const r = watchStep(s, ev(code, s))
        got.push(r.effect)
        s = r.state
      }
      if (got.join('.') !== effects || s.phase !== phase) bad.push(`${line} / got ${got.join('.')} ${s.phase}`)
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
  it('止める前の回の遅れた結果は、再び始めた後も効かない', () => {
    let s: WatchState = { phase: 'off', gen: 0 }
    s = watchStep(s, { type: 'start' }).state
    s = watchStep(s, { type: 'ready', gen: s.gen }).state
    s = watchStep(s, { type: 'utter' }).state
    const oldGen = s.gen
    s = watchStep(s, { type: 'stop' }).state
    s = watchStep(s, { type: 'start' }).state
    s = watchStep(s, { type: 'ready', gen: s.gen }).state
    s = watchStep(s, { type: 'utter' }).state
    const late = watchStep(s, { type: 'heard', gen: oldGen, heard: 'yes' })
    expect(late.effect).toBe('none')
    expect(late.state).toEqual(s)
  })
})
