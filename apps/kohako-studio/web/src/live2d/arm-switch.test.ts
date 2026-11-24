import { describe, expect, it } from 'vitest'
import { ArmSwitch, SWITCH_SECONDS } from './arm-switch'

// 期待値は仕様（vault Projects/kohako-home/arm-switch-spec.md の A1〜A6）から。実装の分岐を写していない。
const DT = 1 / 60
const run = (s: ArmSwitch, seconds: number, ready: boolean) => {
  let ended = 0
  for (let i = 0; i < Math.ceil(seconds / DT) + 1; i++) if (s.tick(DT, ready)) ended++
  return ended
}

describe('1 枚腕への差し替えの段取り（BOXP-694）', () => {
  it('A1: lead の間は 1 枚腕を描かず、変形の腕だけを描く', () => {
    const s = new ArmSwitch()
    s.enter(0.32)
    for (let t = 0; t < 0.3; t += DT) {
      expect(s.phase).toBe('lead')
      expect(s.pieceShown(true)).toBe(false)
      expect(s.rigShown(true)).toBe(true)
      s.tick(DT, true)
    }
  })
  it('A1・A3: lead が終わると 0.12 秒のフェードインに入り、終われば保持になる', () => {
    const s = new ArmSwitch()
    s.enter(0.32)
    run(s, 0.32, true)
    expect(s.phase).toBe('in')
    run(s, SWITCH_SECONDS / 2 - DT, true)
    expect(s.alpha).toBeGreaterThan(0.2)
    expect(s.alpha).toBeLessThan(0.8)
    run(s, SWITCH_SECONDS / 2, true)
    expect(s.phase).toBe('hold')
    expect(s.alpha).toBe(1)
    expect(SWITCH_SECONDS).toBeLessThanOrEqual(0.15)
  })
  it('A2: フェードの間は変形の腕を下に残し（背景が透けない）、保持では変形の腕を描かない', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 0.2, true)
    for (let i = 0; i < 5; i++) {
      s.tick(DT, true)
      if (s.phase !== 'in') break
      expect(s.rigShown(true)).toBe(true)
    }
    run(s, SWITCH_SECONDS, true)
    expect(s.phase).toBe('hold')
    expect(s.rigShown(true)).toBe(false)
    expect(s.pieceShown(true)).toBe(true)
    expect(s.leave(true)).toBe(false)
    expect(s.phase).toBe('out')
    expect(s.rigShown(true)).toBe(true)
  })
  it('A4: 保持からの終了は 0.12 秒のフェードアウトの後に 1 回だけ終わりを知らせる', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 0.5, true)
    expect(s.leave(true)).toBe(false)
    expect(run(s, SWITCH_SECONDS, true)).toBe(1)
    expect(s.phase).toBe('off')
    expect(s.alpha).toBe(0)
    expect(run(s, 1, true)).toBe(0)
  })
  it('A4: lead の途中の終了は、フェードを挟まずその場で終わる', () => {
    const s = new ArmSwitch()
    s.enter(0.32)
    run(s, 0.1, true)
    expect(s.leave(true)).toBe(true)
    expect(s.phase).toBe('off')
  })
  it('A4: フェードインの途中の終了は、いまの不透明度から続けて消す（跳ばない）', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 0.2, true)
    s.tick(DT, true)
    s.tick(DT, true)
    const before = s.alpha
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(1)
    expect(s.leave(true)).toBe(false)
    expect(s.alpha).toBeCloseTo(before, 6)
    s.tick(DT, true)
    expect(s.alpha).toBeLessThan(before)
  })
  it('A4: フェードアウトの途中の再要求は何もしない', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 0.5, true)
    s.leave(true)
    s.tick(DT, true)
    const { alpha, t } = s
    expect(s.leave(true)).toBe(false)
    expect(s.alpha).toBe(alpha)
    expect(s.t).toBe(t)
  })
  it('A6: 絵が読めていないときはフェードを挟まず、変形の腕を描き続ける', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 1, false)
    expect(s.phase).toBe('hold')
    expect(s.pieceShown(false)).toBe(false)
    expect(s.rigShown(false)).toBe(true)
    expect(s.leave(false)).toBe(true)
    expect(s.phase).toBe('off')
  })
  it('A6b: hold の間に絵が読めたら、いきなり出さず 0.12 秒でフェードインする（不透明度は跳ばない）', () => {
    const s = new ArmSwitch()
    s.enter(0.2)
    run(s, 1, false)
    // 読めた最初のコマ: まだ 1 枚腕は出ておらず、変形の腕が描かれている。
    expect(s.pieceShown(true)).toBe(false)
    expect(s.rigShown(true)).toBe(true)
    let last = s.alpha
    expect(last).toBe(0)
    for (let i = 0; i < Math.ceil(SWITCH_SECONDS / DT) + 2; i++) {
      s.tick(DT, true)
      expect(Math.abs(s.alpha - last)).toBeLessThan(0.35)
      if (s.alpha < 1) expect(s.rigShown(true)).toBe(true)
      last = s.alpha
    }
    expect(s.phase).toBe('hold')
    expect(s.alpha).toBe(1)
    expect(s.rigShown(true)).toBe(false)
    expect(s.pieceShown(true)).toBe(true)
  })
  it('どの順序でも: 1 枚腕は lead・off で出ず、不透明度は跳ばず、終了の要求から 0.12 秒以内に終わる（操作列の総当たり）', () => {
    // 操作: enter / leave / 1 コマ進める / 0.1 秒進める / 0.5 秒進める。長さ 7 の全ての並び（5^7 = 78,125 通り）を最初から再生する。
    // 不変条件は仕様の文から: A1（lead・off では出ない）、A2（腕が 1 本も描かれないコマは無い・保持は不透明）、
    // A3（不透明度は 1 コマで ease の最大の傾きぶんまでしか変わらない）、A4（終了はその場か、0.12 秒以内）。
    const ops = ['enter', 'leave', 'tick', 'short', 'long'] as const,
      LENGTH = 7,
      MAX_STEP = (1.5 * DT) / SWITCH_SECONDS + 1e-9,
      OUT_FRAMES = Math.ceil(SWITCH_SECONDS / DT) + 1
    const failures: string[] = []
    let frames = 0
    for (let code = 0; code < ops.length ** LENGTH; code++) {
      const s = new ArmSwitch(),
        names: string[] = []
      let prev = 0,
        /** 終了を要求してからのコマ数（要求していなければ -1）。 */
        leaving = -1
      const fail = (why: string) => {
        if (failures.length < 5) failures.push(`${names.join(' ')}: ${why}`)
      }
      const check = () => {
        frames++
        if (!(s.alpha >= 0 && s.alpha <= 1)) fail(`不透明度 ${s.alpha}`)
        if ((s.phase === 'off' || s.phase === 'lead') && s.pieceShown(true)) fail(`${s.phase} で 1 枚腕が出た`)
        if (s.phase === 'hold' && s.alpha !== 1) fail('保持で不透明でない')
        if (!s.rigShown(true) && !s.pieceShown(true)) fail('腕が 1 本も描かれない')
        if (!s.rigShown(true) && s.phase !== 'hold') fail(`${s.phase} で変形の腕を消した`)
        if (Math.abs(s.alpha - prev) > MAX_STEP) fail(`不透明度が跳んだ ${prev} → ${s.alpha}`)
        prev = s.alpha
      }
      let n = code
      for (let i = 0; i < LENGTH; i++) {
        const op = ops[n % ops.length]
        n = Math.floor(n / ops.length)
        names.push(op)
        if (op === 'enter') {
          // 1 枚腕が出ている間の出し直しは、呼び出し側が必ず終了を済ませてから行う（A5）。
          if (s.on) continue
          s.enter(0.32)
          leaving = -1
          check()
        } else if (op === 'leave') {
          // A4: 1 枚腕がまだ見えていない（off・lead・不透明度 0）ならその場で終わり、見えていればその場では消えない。
          const was = s.phase,
            visible = s.pieceShown(true),
            ended = s.leave(true)
          if (ended !== !visible) fail(`${was}（見えている=${visible}）からの終了が ${ended}`)
          if (ended && s.phase !== 'off') fail('終わったのに off でない')
          if (!ended && leaving < 0) leaving = 0
          if (ended) leaving = -1
          check()
        } else
          for (let k = 0; k < (op === 'tick' ? 1 : op === 'short' ? 6 : 30); k++) {
            const ended = s.tick(DT, true)
            if (leaving >= 0) {
              leaving++
              if (ended) leaving = -1
              else if (leaving > OUT_FRAMES) fail('終了の要求から 0.12 秒を過ぎても終わらない')
            } else if (ended) fail('要求していないのに終わった')
            check()
          }
      }
    }
    expect(failures).toEqual([])
    expect(frames).toBeGreaterThan(1_000_000)
  })
})
