import { describe, expect, it } from 'vitest'
import { browPin, clips, createActingStage, crossfadeArms, deformArm, deformHand, faces, foreScale, isForearm, sample, solveArm } from './gesture'
import type { Player } from './rig'
import type { RigModel } from './model'
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
  it('照れの動作は開始と終了で肘と手首が跳ばない', () => {
    const clip = clips.shyHand, restPos = solveArm(bone, rest), step = 1 / 60
    for (const time of [0, clip.duration]) {
      const { elbow, wrist } = solveArm(bone, sample(clip, time).right)
      expect(elbow[0]).toBeCloseTo(restPos.elbow[0]); expect(elbow[1]).toBeCloseTo(restPos.elbow[1])
      expect(wrist[0]).toBeCloseTo(restPos.wrist[0]); expect(wrist[1]).toBeCloseTo(restPos.wrist[1])
    }
    let previous = solveArm(bone, sample(clip, 0).right)
    for (let time = step; time <= clip.duration; time += step) {
      const current = solveArm(bone, sample(clip, time).right)
      expect(Math.hypot(current.elbow[0] - previous.elbow[0], current.elbow[1] - previous.elbow[1])).toBeLessThan(8)
      previous = current
    }
  })
  it('案内の動作では手首が肘より上へ上がり、休止より大きく動く', () => {
    const { elbow, wrist } = solveArm(bone, sample(clips.guide, 1.5).right)
    expect(wrist[1]).toBeLessThan(elbow[1])
    expect(bone.W[1] - wrist[1]).toBeGreaterThan(250)
  })
  it('肩の装甲と裏地は前腕の回転に付いていかない', () => {
    expect(isForearm(bone, 800, 850)).toBe(true) // 前腕
    expect(isForearm(bone, 720, 600)).toBe(false) // 肩の装甲
    expect(isForearm(bone, 842, 690)).toBe(false) // 裏地の先端
  })
  it('照れも制止も、手首は体の内側を通って上がる（外へ大回りしない）', () => {
    for (const clip of [clips.shyHand, clips.halt]) {
      for (let time = 0; time <= 1.2; time += 1 / 30) expect(solveArm(bone, sample(clip, time).right).wrist[0]).toBeLessThanOrEqual(bone.W[0] + 1)
    }
  })
  it('眉の外端は動かさず、内側だけ動かす', () => {
    expect(browPin(0.3)).toBe(1)
    expect(browPin(0.87)).toBe(0)
    expect(browPin(1)).toBe(0)
    expect(browPin(0.66)).toBeGreaterThan(0.3)
    expect(browPin(0.66)).toBeLessThan(0.7)
  })
  it('体の前を通る前腕は水平付近で短く描き、始点と終点の長さは変えない', () => {
    const pose = { up: 0, upS: 1, fo: 1.75, foS: 1, ha: 0, haS: 1 }
    expect(foreScale({ ...pose, front: true })).toBeCloseTo(0.5)
    expect(foreScale(pose)).toBe(1) // 外へ出す動作は短縮しない
    expect(foreScale({ ...pose, fo: 0, front: true })).toBeGreaterThan(0.99)
    expect(foreScale({ ...pose, fo: 3.45, front: true })).toBeGreaterThan(0.99)
  })
  it('肘より肩側の頂点は肘の目標移動の影響を受けない', () => {
    const shy = sample(clips.shyHand, 2).right
    const out = deformArm(bone, { ...shy, up: 0, upS: 1 }, 720, 560, 720, 560)
    expect(out[0]).toBeCloseTo(720); expect(out[1]).toBeCloseTo(560)
  })
})

describe('動作の切り替え', () => {
  it('挨拶の途中で頷きに切り替えても手首が跳ばない', () => {
    const from = sample(clips.greet, 1.45), to = sample(clips.nod, 0)
    const wrist = (x: number) => solveArm(bone, crossfadeArms(from, to, x).right).wrist
    expect(wrist(0)[0]).toBeCloseTo(solveArm(bone, from.right).wrist[0])
    expect(wrist(0)[1]).toBeCloseTo(solveArm(bone, from.right).wrist[1])
    expect(wrist(1)[0]).toBeCloseTo(solveArm(bone, to.right).wrist[0])
    expect(wrist(1)[1]).toBeCloseTo(solveArm(bone, to.right).wrist[1])
    const whole = Math.hypot(wrist(0)[0] - wrist(1)[0], wrist(0)[1] - wrist(1)[1])
    expect(whole).toBeGreaterThan(100)
    // 0.5 秒を 60fps で刻んだ 1 コマの移動は全体の 10% 以内に収まる。
    const steps = 30
    for (let i = 0; i < steps; i++) {
      const a = wrist(i / steps), b = wrist((i + 1) / steps)
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(whole * 0.1)
    }
  })
})

describe('実行時の動作の割り込み', () => {
  const HAND = 20, ARM = 22
  // p2l の WASM 出力の代わりに、毎回休止位置の頂点を返す最小の実行環境。手のメッシュの 1 頂点は手首に置く。
  function setup() {
    const memory = new WebAssembly.Memory({ initial: 1 }), points: Record<number, readonly number[]> = { [HAND]: bone.W, [ARM]: bone.E }
    const player = {
      rig: 0, expressions: [], meshes: Array.from({ length: 33 }, (_, i) => ({ vertices: points[i] ? 1 : 0 })),
      expression() {}, setParameter() {}, update(_dt: number) {},
      rt: {
        memory, p2l_render_commands: () => 0,
        p2l_mesh_vertices(_rig: number, mesh: number) { new Float32Array(memory.buffer, mesh * 16, 2).set(points[mesh] ?? []); return mesh * 16 },
      },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
    const frame = () => {
      player.update(1 / 60)
      player.rt.p2l_mesh_vertices(0, ARM)
      const pointer = player.rt.p2l_mesh_vertices(0, HAND), v = new Float32Array(memory.buffer, pointer, 2)
      return [v[0] as number, v[1] as number] as const
    }
    return { stage, frame }
  }
  const run = (frame: () => readonly [number, number], seconds: number) => { let last = frame(); for (let i = 1; i < Math.round(seconds * 60); i++) last = frame(); return last }
  const distance = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

  it('解除で戻る途中に次の動作が来ても手首が跳ばない', () => {
    for (const released of [0.05, 0.1, 0.2, 0.3, 0.4]) {
      const { stage, frame } = setup()
      stage.playGesture('shyHand'); run(frame, 1.5)
      stage.reset()
      let previous = run(frame, released)
      stage.playGesture('greet')
      const first = frame()
      expect(distance(first, previous)).toBeLessThan(45)
      previous = first
      for (let i = 0; i < 40; i++) { const current = frame(); expect(distance(current, previous)).toBeLessThan(45); previous = current }
    }
  })
  it('解除後は腕の変形が外れて休止位置へ戻る', () => {
    const { stage, frame } = setup()
    stage.playGesture('shyHand'); run(frame, 1.5)
    stage.reset()
    const wrist = run(frame, 0.7)
    expect(distance(wrist, bone.W)).toBeLessThan(0.01)
    expect((stage as ReturnType<typeof createActingStage>).report().armBlend).toBe(0)
  })
  it('解除の途中で再度止めても戻り切る', () => {
    const { stage, frame } = setup()
    stage.playGesture('halt'); run(frame, 1)
    stage.reset()
    for (let i = 0; i < 60; i++) { frame(); stage.reset() }
    expect((stage as ReturnType<typeof createActingStage>).report().armBlend).toBe(0)
  })
})
