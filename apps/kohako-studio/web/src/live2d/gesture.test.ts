import { describe, expect, it } from 'vitest'
import { clips, deformArm, deformHand, faces, sample, solveArm } from './gesture'
import { emotions, gestures } from './acting'

const bone = { S: [710, 533], E: [758, 757], W: [844, 928], band: 34, arm: 22, hand: 20, mirror: false } as const
const rest = { up: 0, upS: 1, fo: 0, foS: 1, ha: 0, haS: 1 }

describe('動作の定義', () => {
  it('全ての表情と動作に定義がある', () => {
    for (const e of emotions) expect(faces[e]).toBeDefined()
    for (const g of gestures) if (g !== 'none') expect(clips[g].keys.length).toBeGreaterThan(1)
  })
  it('各動作は休止姿勢で始まり終わる', () => {
    for (const g of gestures) {
      if (g === 'none') continue
      const clip = clips[g]
      for (const time of [0, clip.duration]) {
        const s = sample(clip, time)
        expect(Math.abs(s.right.fo) + Math.abs(s.left.fo)).toBeCloseTo(0)
        expect(s.body.headY).toBeCloseTo(0)
      }
    }
  })
  it('キー時刻が昇順で duration 内に収まる', () => {
    for (const clip of Object.values(clips)) {
      const t = clip.keys.map(k => k.t)
      expect([...t].sort((a, b) => a - b)).toEqual(t)
      expect(t[t.length - 1]).toBeLessThanOrEqual(clip.duration)
    }
  })
})

describe('腕の変形', () => {
  it('休止姿勢では頂点が動かない', () => {
    for (const point of [[700, 500], [758, 757], [850, 930], [730, 720]] as const) {
      const out = deformArm(bone, rest, point[0], point[1], point[0], point[1])
      expect(out[0]).toBeCloseTo(point[0]); expect(out[1]).toBeCloseTo(point[1])
    }
    const hand = deformHand(bone, rest, 900, 1000)
    expect(hand[0]).toBeCloseTo(900); expect(hand[1]).toBeCloseTo(1000)
  })
  it('照れの動作では手首が胸元より上へ来る', () => {
    const shy = sample(clips.shyHand, 2).right
    expect(solveArm(bone, shy).wrist[1]).toBeLessThan(560)
  })
  it('案内の動作では手首が肘より上へ上がり、休止より大きく動く', () => {
    const { elbow, wrist } = solveArm(bone, sample(clips.guide, 1.5).right)
    expect(wrist[1]).toBeLessThan(elbow[1])
    expect(bone.W[1] - wrist[1]).toBeGreaterThan(250)
  })
  it('肘より肩側の頂点は肘の目標移動の影響を受けない', () => {
    const shy = sample(clips.shyHand, 2).right
    const out = deformArm(bone, { ...shy, up: 0, upS: 1 }, 720, 560, 720, 560)
    expect(out[0]).toBeCloseTo(720); expect(out[1]).toBeCloseTo(560)
  })
})
