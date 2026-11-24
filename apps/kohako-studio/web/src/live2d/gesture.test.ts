import { must } from '../must'
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import {
  BENT_ART,
  JOY_HAND_SCALE,
  GREET_WAVE,
  GUIDE_ARM,
  guideArmMotion,
  guideArmPoint,
  greetArmPoint,
  greetWave,
  haltForeWeight,
  HALT_ARM,
  haltArmAngle,
  haltArmPoint,
  SHY_ARM,
  shyArmMotion,
  shyArmPoint,
  SWITCH_SECONDS,
  SWITCHED,
  LEAD_SECONDS,
  TRAIL_SECONDS,
  trailSeconds,
  SHY_SPEAK,
  leadSeconds,
  leadStart,
  matchArm,
  swingShorten,
  interruptPlan,
  bentSide,
  bentWeight,
  placeBent,
  placeBentFore,
  browPin,
  type ArmPose,
  idleArmPoses,
  clips,
  createActingStage,
  crossfadeArms,
  deformArm,
  deformFore,
  deformHand,
  deformSleeve,
  faces,
  foreScale,
  isForearm,
  sample,
  sleeveAngle,
  solveArm,
} from './gesture'
import type { Player } from './rig'
import type { RigModel } from './model'
import { emotions, gestures } from './acting'

const bone = { S: [710, 533], E: [760, 733], W: [844, 928], band: 34, arm: 22, hand: 20, mirror: false } as const
const HEM = [
  [771, 663],
  [841, 691],
] as const // 紫の袖の下縁
const CUFF_EDGE = [
  [729, 758.5],
  [745, 761.5],
  [760, 759.5],
  [769, 753],
  [773, 746],
  [777, 733],
  [781, 713],
  [784, 702],
  [787, 697.5],
] as const // 小手の金の開口（FOREARM_POLY の上辺）
const rest = { up: 0, upS: 1, fo: 0, foS: 1, ha: 0, haS: 1 }

describe('生成素材の手と前腕の分離', () => {
  const bone = { S: [710, 533], E: [760, 733], W: [844, 928], arm: 22, hand: 20, mirror: false } as const
  it('前腕の支点は親の肘の位置にそのまま付く（肘で離れない）', () => {
    const pose = { up: 0.2, upS: 0.9, fo: 2.4, foS: 1, ha: 0, haS: 1 }
    const [x, y] = deformFore(bone, pose, bone.E[0], bone.E[1]),
      elbow = solveArm(bone, pose).elbow
    expect(x).toBeCloseTo(elbow[0])
    expect(y).toBeCloseTo(elbow[1])
  })
  it('前腕パーツは従来の前腕の変形と同じ位置へ動く', () => {
    const pose = { up: 0, upS: 1, fo: 1.2, foS: 0.95, ha: 0.1, haS: 1 }
    const [x, y] = [800, 850]
    expect(deformFore(bone, pose, x, y)).toEqual(deformArm(bone, pose, x, y, x, y))
  })
  it('制止と照れは保持区間で手の絵が完全に切り替わり、始点では元の手のまま', () => {
    expect(sample(clips.halt, 1).right).toMatchObject({ art: 'palm', artW: 1 })
    expect(sample(clips.shyHand, 2).right).toMatchObject({ art: 'cover', artW: 1 })
    expect(sample(clips.halt, 0).right.artW ?? 0).toBe(0)
    expect(sample(clips.shyHand, 0).right.artW ?? 0).toBe(0)
  })
  it('挨拶など手の絵を持たない動作では重みが 0 のまま', () => {
    expect(sample(clips.greet, 0.9).right.artW ?? 0).toBe(0)
  })
})

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
      const t = clip.keys.map((k) => k.t)
      expect([...t].sort((a, b) => a - b)).toEqual(t)
      expect(t[t.length - 1]).toBeLessThanOrEqual(clip.duration)
    }
  })
})

describe('腕の変形', () => {
  it('休止姿勢では頂点が動かない', () => {
    for (const point of [
      [700, 500],
      [758, 757],
      [850, 930],
      [730, 720],
    ] as const) {
      const out = deformArm(bone, rest, point[0], point[1], point[0], point[1])
      expect(out[0]).toBeCloseTo(point[0])
      expect(out[1]).toBeCloseTo(point[1])
    }
    const hand = deformHand(bone, rest, 900, 1000)
    expect(hand[0]).toBeCloseTo(900)
    expect(hand[1]).toBeCloseTo(1000)
  })
  it('照れの動作では手首が胸元より上へ来る', () => {
    const shy = sample(clips.shyHand, 2).right
    expect(solveArm(bone, shy).wrist[1]).toBeLessThan(560)
  })
  it('照れの保持は肘が肩の下に残り、前腕が胸の前を斜めに渡る（肘を胸の中央へ寄せて上腕を隠さない）', () => {
    const { elbow, wrist } = solveArm(bone, sample(clips.shyHand, 2).right)
    expect(Math.abs(elbow[0] - bone.S[0])).toBeLessThanOrEqual(40)
    expect(elbow[0] - wrist[0]).toBeGreaterThanOrEqual(60)
  })
  it('照れの動作は開始と終了で肘と手首が跳ばない', () => {
    const clip = clips.shyHand,
      restPos = solveArm(bone, rest),
      step = 1 / 60
    for (const time of [0, clip.duration]) {
      const { elbow, wrist } = solveArm(bone, sample(clip, time).right)
      expect(elbow[0]).toBeCloseTo(restPos.elbow[0])
      expect(elbow[1]).toBeCloseTo(restPos.elbow[1])
      expect(wrist[0]).toBeCloseTo(restPos.wrist[0])
      expect(wrist[1]).toBeCloseTo(restPos.wrist[1])
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
  // 関節に見えるかの必要条件（最終判断は実描画の連続コマ）。上腕と前腕が別の線分として開き、前腕の長さが保たれ、肘が動くこと。
  it.each([
    ['制止', 'halt', 1.5],
    ['照れ', 'shyHand', 2],
    ['挨拶', 'greet', 0.55],
    ['案内', 'guide', 1.5],
    ['喜び', 'joy', 0.75],
  ] as const)('%s の保持は肘が開いて見える', (_name, gesture, time) => {
    const pose = sample(clips[gesture], time).right,
      { elbow, wrist } = solveArm(bone, pose)
    const toShoulder = [bone.S[0] - elbow[0], bone.S[1] - elbow[1]] as const,
      toWrist = [wrist[0] - elbow[0], wrist[1] - elbow[1]] as const
    const inner =
      (Math.acos(
        (toShoulder[0] * toWrist[0] + toShoulder[1] * toWrist[1]) /
          (Math.hypot(...toShoulder) * Math.hypot(...toWrist)),
      ) *
        180) /
      Math.PI
    expect(inner).toBeGreaterThanOrEqual(29)
    expect(inner).toBeLessThanOrEqual(145)
    const restLength = Math.hypot(bone.W[0] - bone.E[0], bone.W[1] - bone.E[1])
    expect(Math.hypot(...toWrist) / restLength).toBeGreaterThanOrEqual(0.9)
    expect(Math.hypot(...toWrist) / restLength).toBeLessThanOrEqual(1.1)
    // 肩から肘の長さは、袖に隠れる上端を含めて休止の 1.14 倍まで。袖の下に見えている区間は休止より長くしない。
    expect(Math.hypot(...toShoulder)).toBeLessThanOrEqual(
      Math.hypot(bone.E[0] - bone.S[0], bone.E[1] - bone.S[1]) * 1.14,
    )
    expect(Math.hypot(elbow[0] - bone.E[0], elbow[1] - bone.E[1])).toBeGreaterThanOrEqual(60)
    expect(elbow[1]).toBeLessThanOrEqual(bone.E[1] + 5) // 腰より下へは大きく下げない（袖の下に上腕を見せる分だけ休止より少し下げてよい。BOXP-485）
  })
  it.each([
    ['制止', 'halt', 1.5],
    ['挨拶', 'greet', 0.55],
    ['案内', 'guide', 1.5],
    ['喜び', 'joy', 0.75],
  ] as const)('%s の保持は肘が袖の下縁より下に出て上腕が見える', (_name, gesture, time) => {
    const { elbow } = solveArm(bone, sample(clips[gesture], time).right)
    const hemY = 663 + ((elbow[0] - 771) * (691 - 663)) / (841 - 771)
    expect(elbow[1] - hemY).toBeGreaterThanOrEqual(20)
  })
  // 袖の下縁から小手の開口まで、肩→肘の中心線が見える長さ。袖と小手を実際の変形で動かして測る（BOXP-485 の条件 1 と 3）。
  const visibleUpper = (pose: ArmPose) => {
    const m = pose,
      { elbow, wrist } = solveArm(bone, m),
      length = (v: readonly [number, number]) => Math.hypot(v[0], v[1])
    const toCuff = [wrist[0] - elbow[0], wrist[1] - elbow[1]] as const,
      b = [elbow[0] + (toCuff[0] / length(toCuff)) * 30, elbow[1] + (toCuff[1] / length(toCuff)) * 30] as const
    const angle = sleeveAngle(bone, m),
      hem = HEM.map((p) => deformSleeve(bone, angle, p[0], p[1], p[0], p[1])),
      cuff = CUFF_EDGE.map((p) => deformFore(bone, m, p[0], p[1]))
    const hit = (line: readonly (readonly [number, number])[], pick: (a: number, b: number) => number) => {
      let found = NaN
      for (let i = 0; i + 1 < line.length; i++) {
        const p = line[i] as readonly [number, number],
          q = line[i + 1] as readonly [number, number],
          dx = b[0] - bone.S[0],
          dy = b[1] - bone.S[1],
          ex = q[0] - p[0],
          ey = q[1] - p[1],
          d = dx * ey - dy * ex
        if (Math.abs(d) < 1e-9) continue
        const s = ((p[0] - bone.S[0]) * ey - (p[1] - bone.S[1]) * ex) / d,
          u = ((p[0] - bone.S[0]) * dy - (p[1] - bone.S[1]) * dx) / d
        if (u < 0 || u > 1) continue
        found = Number.isNaN(found) ? s : pick(found, s)
      }
      return found
    }
    const total = Math.hypot(b[0] - bone.S[0], b[1] - bone.S[1])
    const end = hit(cuff, Math.min) // 開口の金の縁をかすめて届かないときは、上腕の下端までを見える区間とする
    return (Math.min(Number.isNaN(end) ? 1 : end, 1) - hit(hem, Math.max)) * total
  }
  it.each([
    ['制止', 'halt', 1.5],
    ['挨拶', 'greet', 0.55],
    ['案内', 'guide', 1.5],
    ['喜び', 'joy', 0.75],
  ] as const)('%s の保持は袖の下縁から小手まで上腕が 50px 以上見え、休止より長くは見えない', (_name, gesture, time) => {
    const visible = visibleUpper(sample(clips[gesture], time).right)
    expect(visible).toBeGreaterThanOrEqual(50)
    expect(visible).toBeLessThanOrEqual(74)
  })
  it('制止の保持は体の外側で手を肩より高く上げる（胸の前へ折り畳まない）', () => {
    const { elbow, wrist } = solveArm(bone, sample(clips.halt, 1.5).right)
    expect(elbow[0]).toBeGreaterThan(bone.E[0])
    expect(wrist[0]).toBeGreaterThan(bone.W[0])
    expect(wrist[1]).toBeLessThan(bone.S[1] + 50) // 掌は手首より約 170px 上まで届き、顔の高さへ出る
  })
  it('肘を外へ上げると袖が肩口を固定したまま持ち上がり、休止と内側への動作では動かない', () => {
    expect(sleeveAngle(bone, rest)).toBeCloseTo(0)
    expect(sleeveAngle(bone, sample(clips.shyHand, 2).right)).toBe(0)
    const angle = sleeveAngle(bone, sample(clips.halt, 1.5).right)
    expect(angle).toBeLessThan(-0.05)
    // 袖は上腕より少なく回って垂れる（同じだけ回すと上腕が袖の裏に隠れ続ける）
    const pose = sample(clips.halt, 1.5).right,
      elbow = solveArm(bone, pose).elbow,
      armAngle =
        Math.atan2(elbow[1] - bone.S[1], elbow[0] - bone.S[0]) -
        Math.atan2(bone.E[1] - bone.S[1], bone.E[0] - bone.S[0])
    expect(angle).toBeGreaterThan(armAngle * 0.8)
    const shoulder = deformSleeve(bone, angle, bone.S[0], bone.S[1] + 5, bone.S[0], bone.S[1] + 5),
      tip = deformSleeve(bone, angle, 845, 695, 845, 695)
    expect(shoulder[1]).toBeCloseTo(bone.S[1] + 5)
    expect(tip[1]).toBeLessThan(695 - 2)
  })
  it('眉の外端は動かさず、内側だけ動かす', () => {
    expect(browPin(0.3)).toBe(1)
    expect(browPin(0.87)).toBe(0)
    expect(browPin(1)).toBe(0)
    expect(browPin(0.66)).toBeGreaterThan(0.3)
    expect(browPin(0.66)).toBeLessThan(0.7)
  })
  it('体の前を通る前腕は水平付近で短く描き、始点と終点の長さは変えない', () => {
    const pose = { up: 0, upS: 1, fo: 2.1, foS: 1, ha: 0, haS: 1 }
    expect(foreScale({ ...pose, fo: 2.1, front: true })).toBeCloseTo(0.5)
    expect(foreScale(pose)).toBe(1) // 外へ出す動作は短縮しない
    expect(foreScale({ ...pose, fo: 0, front: true })).toBeGreaterThan(0.99)
    expect(foreScale({ ...pose, fo: 3.45, front: true })).toBeGreaterThan(0.99)
  })
  it('肘より肩側の頂点は肘の目標移動の影響を受けない', () => {
    const shy = sample(clips.shyHand, 2).right
    const out = deformArm(bone, { ...shy, up: 0, upS: 1 }, 720, 560, 720, 560)
    expect(out[0]).toBeCloseTo(720)
    expect(out[1]).toBeCloseTo(560)
  })
})

describe('動作の切り替え', () => {
  it('挨拶の途中で頷きに切り替えても手首が跳ばない', () => {
    const from = sample(clips.greet, 1.45),
      to = sample(clips.nod, 0)
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
      const a = wrist(i / steps),
        b = wrist((i + 1) / steps)
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(whole * 0.1)
    }
  })
})

describe('上げた腕からの反対側への割込み（BOXP-476 TD-02）', () => {
  const held = (gesture: 'shyHand' | 'halt', time: number) => sample(clips[gesture], time)
  const path = (from: 'shyHand' | 'halt', fromTime: number, to: 'shyHand' | 'halt') => {
    const start = held(from, fromTime),
      plan = interruptPlan(start, clips[to])
    return {
      plan,
      frames: Array.from({ length: 21 }, (_, i) => {
        const x = i / 20
        return solveArm(bone, crossfadeArms(plan.from, sample(clips[to], plan.at + x * 0.8), x).right)
      }),
    }
  }
  it('照れ→制止は上を回り、手首が腹の高さへ下がらない', () => {
    const { plan, frames } = path('shyHand', 1.2, 'halt')
    expect(plan.at).toBeGreaterThan(0)
    expect(Math.abs(plan.from.right.fo - must(must(clips.halt.keys[2]).right).fo)).toBeLessThan(Math.PI)
    for (const { wrist, elbow } of frames) {
      expect(wrist[1]).toBeLessThan(elbow[1])
      expect(wrist[1]).toBeLessThan(600)
    }
  })
  it('制止→照れも逆向きに同じ', () => {
    const { frames } = path('halt', 1.2, 'shyHand')
    for (const { wrist, elbow } of frames) {
      expect(wrist[1]).toBeLessThan(elbow[1])
      expect(wrist[1]).toBeLessThan(600)
    }
  })
  it('上がっていない腕や同じ側への切替は経路も開始時刻も変えない', () => {
    const low = { right: rest, left: rest }
    expect(interruptPlan(low, clips.halt)).toEqual({ from: low, at: 0 })
    const raised = held('halt', 1.2)
    expect(interruptPlan(raised, clips.greet).at).toBe(0)
  })
  it('曲げの絵の裏返しは割込みで回る途中の 1 回だけ', () => {
    const { plan } = path('shyHand', 1.2, 'halt'),
      from = plan.from.right.fo,
      to = must(must(clips.halt.keys[2]).right).fo
    const sides = Array.from({ length: 41 }, (_, i) =>
      bentSide({ mirror: false }, { fo: from + ((to - from) * i) / 40 }),
    )
    expect(sides[0]).toBe(bentSide({ mirror: false }, { fo: 3.41 }))
    expect(sides.at(-1)).toBe(1)
    expect(sides.filter((v, i) => i > 0 && v !== sides[i - 1]).length).toBe(1)
  })
})

describe('実行時の動作の割り込み', () => {
  const HAND = 20,
    ARM = 22
  // p2l の WASM 出力の代わりに、毎回休止位置の頂点を返す最小の実行環境。手のメッシュの 1 頂点は手首に置く。
  function setup() {
    const memory = new WebAssembly.Memory({ initial: 1 }),
      points: Record<number, readonly number[]> = { [HAND]: bone.W, [ARM]: bone.E }
    const player = {
      rig: 0,
      expressions: [],
      meshes: Array.from({ length: 33 }, (_, i) => ({ vertices: points[i] ? 1 : 0 })),
      expression() {},
      setParameter() {},
      update(_dt: number) {},
      rt: {
        memory,
        p2l_render_commands: () => 0,
        p2l_mesh_vertices(_rig: number, mesh: number) {
          new Float32Array(memory.buffer, mesh * 16, 2).set(points[mesh] ?? [])
          return mesh * 16
        },
      },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
    const frame = () => {
      player.update(1 / 60)
      player.rt.p2l_mesh_vertices(0, ARM)
      const pointer = player.rt.p2l_mesh_vertices(0, HAND),
        v = new Float32Array(memory.buffer, pointer, 2)
      return [v[0] as number, v[1] as number] as const
    }
    return { stage, frame }
  }
  const run = (frame: () => readonly [number, number], seconds: number) => {
    let last = frame()
    for (let i = 1; i < Math.round(seconds * 60); i++) last = frame()
    return last
  }
  const distance = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

  it('解除で戻る途中に次の動作が来ても手首が跳ばない', () => {
    for (const released of [0.05, 0.1, 0.2, 0.3, 0.4]) {
      const { stage, frame } = setup()
      stage.playGesture('joy')
      run(frame, 1.5) // 照れは 1 枚腕の差し替え（フェード）になったので、変形で戻る動作で確かめる
      stage.reset()
      let previous = run(frame, released)
      stage.playGesture('joy') // 挨拶・案内も 1 枚腕の差し替えになったので、変形で上げる喜びで確かめる
      const first = frame()
      expect(distance(first, previous)).toBeLessThan(45)
      previous = first
      for (let i = 0; i < 40; i++) {
        const current = frame()
        expect(distance(current, previous)).toBeLessThan(45)
        previous = current
      }
    }
  })
  it('解除後は腕の変形が外れて休止位置へ戻る', () => {
    const { stage, frame } = setup()
    stage.playGesture('shyHand')
    run(frame, 1.5)
    stage.reset()
    const wrist = run(frame, 0.7)
    expect(distance(wrist, bone.W)).toBeLessThan(0.01)
    expect((stage as ReturnType<typeof createActingStage>).report().armBlend).toBe(0)
  })
  it('解除の途中で再度止めても戻り切る', () => {
    const { stage, frame } = setup()
    stage.playGesture('halt')
    run(frame, 1)
    stage.reset()
    for (let i = 0; i < 60; i++) {
      frame()
      stage.reset()
    }
    expect((stage as ReturnType<typeof createActingStage>).report().armBlend).toBe(0)
  })
})

describe('曲げの絵（BOXP-476 TD-02）', () => {
  // BOXP-694（仕様 C1）: 以前は肘 0.94〜0.96 で替えていたので、腕が大きく動いている途中で小手の形と太さが急に変わり（肘のポップ）、
  // 0.3〜0.94 で止めるしぐさ（伸び 0.72）では V 字の小手の切れ目がむき出しになった。
  it('待機（曲げ 0）では元の小手のまま。曲げ始めのごく小さい角度（0.02〜0.045）で丸い小手へ替え、それより曲げた腕は常に丸い小手', () => {
    expect(bentWeight(0)).toBe(0)
    expect(bentWeight(0.02)).toBe(0)
    expect(bentWeight(-0.02)).toBe(0)
    for (const fo of [0.045, 0.05, 0.2, 0.72, 0.93, 0.97, 1.28, -1.1, -2.05, 3.41]) expect(bentWeight(fo)).toBe(1)
  })
  it('替わり目は単調で、腕がほとんど動いていない範囲（0.05 未満）に収まる', () => {
    let prev = 0
    for (let fo = 0; fo <= 0.06; fo += 0.001) {
      const w = bentWeight(fo)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
    expect(prev).toBe(1)
  })
  it('内回りと左腕では絵を裏返す', () => {
    expect(bentSide({ mirror: false }, { fo: -2 })).toBe(1)
    expect(bentSide({ mirror: false }, { fo: 3.4 })).toBe(-1)
    expect(bentSide({ mirror: true }, { fo: -1.85 })).toBe(-1)
  })
  it('絵は肘を原点に軸の向きへ置く', () => {
    const near = (a: readonly [number, number], b: readonly [number, number]) => {
      expect(a[0]).toBeCloseTo(b[0], 6)
      expect(a[1]).toBeCloseTo(b[1], 6)
    }
    near(placeBent([100, 200], [0, -1], 1, [0, 50]), [100, 150])
    near(placeBent([100, 200], [0, -1], 1, [10, 0]), [110, 200])
    near(placeBent([100, 200], [0, -1], -1, [10, 0]), [90, 200])
  })
  it('照れの途中で前腕が短縮しても、曲げた小手の先は手首に付いたまま縮む', () => {
    const length = Math.hypot(bone.W[0] - bone.E[0], bone.W[1] - bone.E[1])
    const shortened: ArmPose = { ...rest, fo: 2.1, front: true }
    expect(foreScale(shortened)).toBeCloseTo(0.5)
    const { elbow, wrist } = solveArm(bone, shortened),
      tip = placeBentFore(bone, shortened, [0, length])
    expect(tip[0]).toBeCloseTo(wrist[0], 6)
    expect(tip[1]).toBeCloseTo(wrist[1], 6)
    const origin = placeBentFore(bone, shortened, [0, 0])
    expect(origin[0]).toBeCloseTo(elbow[0], 6)
    expect(origin[1]).toBeCloseTo(elbow[1], 6)
    const left = { ...bone, S: [1210, 533], E: [1160, 733], W: [1076, 928], mirror: true } as const // 左腕も同じ（中心 960 で反転）
    // 姿勢は右腕の向きで書く（左腕は鏡映される）。短縮は鏡映前の向きで決まるので、左腕でも同じ 0.5 倍になる。
    const s = solveArm(left, { ...shortened, fo: -2.1, flipped: true }),
      leftTip = placeBentFore(left, shortened, [0, length])
    expect(Math.hypot(s.wrist[0] - s.elbow[0], s.wrist[1] - s.elbow[1])).toBeCloseTo(length * 0.5, 6)
    expect(Math.hypot(leftTip[0] - s.elbow[0], leftTip[1] - s.elbow[1])).toBeCloseTo(length * 0.5, 6)
  })
  it('素材の肘の位置は画像の範囲内にある', () => {
    for (const art of [BENT_ART.fore, BENT_ART.elbow]) {
      expect(art.anchor[0]).toBeGreaterThan(0)
      expect(art.anchor[0]).toBeLessThan(art.w)
      expect(art.anchor[1]).toBeGreaterThan(0)
      expect(art.anchor[1]).toBeLessThan(art.h)
    }
  })
})

// 期待値は仕様（vault Projects/kohako-home/arm-switch-spec.md）から。段取りそのもの（lead → in → hold → out）は arm-switch.test.ts。
describe('1 枚腕への差し替え: 変形の腕を重ねてから差し替える（BOXP-694、仕様 A）', () => {
  const HAND = 20,
    ARM = 22
  // この偽の実行環境では腕の追加パーツ（1 枚腕の絵）を作れないので、1 枚腕は「読めていない」扱い（A6）になり、
  // 変形の腕が従来の保持姿勢まで動く。腕の経路（跳ばない・待機から始まる・待機へ戻る）はここで確かめる。
  function setup() {
    const memory = new WebAssembly.Memory({ initial: 1 }),
      points: Record<number, readonly number[]> = { [HAND]: bone.W, [ARM]: bone.E }
    const player = {
      rig: 0,
      expressions: [],
      meshes: Array.from({ length: 33 }, (_, i) => ({ vertices: points[i] ? 1 : 0 })),
      expression() {},
      setParameter() {},
      update(_dt: number) {},
      rt: {
        memory,
        p2l_render_commands: () => 0,
        p2l_mesh_vertices(_rig: number, mesh: number) {
          new Float32Array(memory.buffer, mesh * 16, 2).set(points[mesh] ?? [])
          return mesh * 16
        },
      },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel) as ReturnType<
      typeof createActingStage
    >
    const frame = () => {
      player.update(1 / 60)
      player.rt.p2l_mesh_vertices(0, ARM)
      const v = new Float32Array(memory.buffer, player.rt.p2l_mesh_vertices(0, HAND), 2)
      return [v[0] as number, v[1] as number] as const
    }
    /** seconds 進め、最後の手首の位置と、1 コマでの最大の移動量を返す。 */
    const run = (seconds: number, from?: readonly [number, number]) => {
      let last = from ?? frame(),
        max = 0
      for (let i = from ? 0 : 1; i < Math.round(seconds * 60); i++) {
        const next = frame()
        max = Math.max(max, Math.hypot(next[0] - last[0], next[1] - last[1]))
        last = next
      }
      return Object.assign(last, { max })
    }
    return { stage, frame, run }
  }
  const haltWrist = solveArm(bone, SWITCHED.halt as ArmPose).wrist
  const near = (a: readonly [number, number], b: readonly [number, number], d = 0.5) =>
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(d)
  // 手首の 1 コマ（1/60 秒）の移動の上限は、腕の長さ（肩〜手首 約 410）の 1/6。
  // 以前の差し替えは、最初のコマで手首が待機から制止の位置まで 370 ほど跳んだ。
  const NO_JUMP = Math.hypot(bone.W[0] - bone.S[0], bone.W[1] - bone.S[1]) / 6
  it('A1: 休止からの制止は、待機の位置から腕を動かして上げる（離れた位置にいきなり制止の腕を置かない）', () => {
    const { stage, frame, run } = setup()
    stage.playGesture('halt')
    const first = frame()
    near(first, bone.W, 10)
    expect(stage.report().armSwitch).toMatchObject({ phase: 'lead' })
    const end = run(1, first)
    expect(end.max).toBeLessThan(NO_JUMP)
    near(end, haltWrist)
    expect(stage.report().armSwitch).toBeNull()
  })
  it('A3: 待機から上げ切るまでは 0.32 秒（前腕を大きく回す照れは角度に比例して延ばす）', () => {
    const { stage, run } = setup()
    stage.playGesture('halt')
    run(LEAD_SECONDS - 0.03)
    expect(stage.report().armSwitch).toMatchObject({ phase: 'lead' })
    run(0.06)
    expect(stage.report().armSwitch).toBeNull()
    expect(leadSeconds(rest, { ...rest, fo: -2.05 })).toBe(LEAD_SECONDS)
    expect(leadSeconds(rest, { ...rest, fo: 3.14 })).toBeCloseTo((LEAD_SECONDS * 3.14) / 2.4, 6)
    // 戻りも同じ（制止は 0.45 秒、照れは角度に比例）。
    expect(trailSeconds({ ...rest, fo: -2.05 })).toBe(TRAIL_SECONDS)
    expect(trailSeconds({ ...rest, fo: 3.14 })).toBeCloseTo((TRAIL_SECONDS * 3.14) / 2.4, 6)
  })
  it('A4: 解除すると、制止の位置から待機へ跳ばずに 0.45 秒で戻る', () => {
    const { stage, frame, run } = setup()
    stage.playGesture('halt')
    run(1)
    stage.reset()
    const first = frame()
    near(first, haltWrist, 6)
    const end = run(TRAIL_SECONDS + 0.05, first)
    expect(end.max).toBeLessThan(NO_JUMP)
    near(end, bone.W)
    expect(stage.report()).toMatchObject({ armBlend: 0, armSwitch: null, switched: false })
  })
  it('A4: 動作の終わりも同じく待機へ戻る', () => {
    const { stage, run } = setup()
    stage.playGesture('halt')
    run(clips.halt.duration + 0.02)
    expect(stage.report()).toMatchObject({ gesture: 'none', switched: false })
    const end = run(TRAIL_SECONDS + 0.05)
    expect(end.max).toBeLessThan(NO_JUMP)
    near(end, bone.W)
    expect(stage.report().armBlend).toBe(0)
  })
  it('A5: 照れ⇄制止は、上げたまま上を通って移る（跳ばず、手が腹の前まで下りない）', () => {
    for (const [a, b] of [
      ['shyHand', 'halt'],
      ['halt', 'shyHand'],
    ] as const) {
      const { stage, frame, run } = setup()
      stage.playGesture(a)
      const from = run(1.5)
      stage.playGesture(b)
      let last: readonly [number, number] = from,
        lowest = 0,
        max = 0
      for (let i = 0; i < 60; i++) {
        const p = frame()
        max = Math.max(max, Math.hypot(p[0] - last[0], p[1] - last[1]))
        lowest = Math.max(lowest, p[1])
        last = p
      }
      expect(max).toBeLessThan(NO_JUMP)
      expect(lowest).toBeLessThan(bone.E[1]) // 手首は肘の高さより下へ行かない
      expect(stage.report()).toMatchObject({ gesture: b, switched: true, armSwitch: null })
      near(last, solveArm(bone, SWITCHED[b] as ArmPose).wrist)
    }
  })
  it('A5: 上げた腕から反対回りの上げ姿勢へ寄せる起点は、角度を 1 周ずらして短い経路にする', () => {
    const shy = SWITCHED.shyHand as ArmPose,
      halt = SWITCHED.halt as ArmPose
    expect(leadStart(rest, halt)).toBe(rest)
    expect(Math.abs(leadStart(shy, halt).fo - halt.fo)).toBeLessThan(Math.PI)
    expect(Math.abs(leadStart(halt, shy).fo - shy.fo)).toBeLessThan(Math.PI)
    // 1 周ずらしても同じ向き。
    expect(Math.cos(leadStart(shy, halt).fo)).toBeCloseTo(Math.cos(shy.fo), 9)
  })
  it('A5: 終える途中に次の動作が来たら、それを始める（最後の要求が勝つ）', () => {
    const { stage, run } = setup()
    stage.playGesture('halt')
    run(1)
    stage.reset()
    run(0.05)
    stage.playGesture('guide')
    const end = run(1)
    expect(end.max).toBeLessThan(NO_JUMP)
    expect(stage.report()).toMatchObject({ gesture: 'guide', armSwitch: null, switched: true })
  })
  it('A5: 変形の腕で動く動作（喜び）の途中からでも、その時点の腕の位置から 1 枚腕の動作へ移る', () => {
    const { stage, run } = setup()
    stage.playGesture('joy')
    const from = run(0.6)
    stage.playGesture('halt')
    const end = run(1, from)
    expect(end.max).toBeLessThan(NO_JUMP)
    near(end, haltWrist)
  })
  it('挨拶は制止と同じ 1 枚腕で、手振りが終われば待機の腕へ戻る', () => {
    const { stage, run } = setup()
    stage.playGesture('greet')
    expect(stage.report()).toMatchObject({ armSwitch: { phase: 'lead' }, gesture: 'greet', switched: true })
    run(1)
    expect(stage.report()).toMatchObject({ armSwitch: null, gesture: 'greet' })
    run(clips.greet.duration)
    expect(stage.report()).toMatchObject({ gesture: 'none', switched: false })
  })
  it('A1: 変形の腕は 1 枚腕の肘・手首にぴったり重なる（入りの持ち上げの途中・保持・手振り・発話中の下げた位置のどこでも）', () => {
    const pieces: [string, ArmPose, readonly [number, number], readonly [number, number]][] = []
    for (const t of [0, 0.1, 0.2, 0.32, 0.45, 1, 2]) {
      const a = haltArmAngle(t)
      for (const wave of [0, 0.15, -0.15])
        pieces.push([
          `halt t=${t} wave=${wave}`,
          SWITCHED.halt as ArmPose,
          greetArmPoint(HALT_ARM.elbowPx, a, wave),
          greetArmPoint(HALT_ARM.wristPx, a, wave),
        ])
      const g = guideArmMotion(t)
      pieces.push([
        `guide t=${t}`,
        { ...rest, fo: -1.92, swing: 0 },
        guideArmPoint(GUIDE_ARM.elbowPx, g),
        guideArmPoint(GUIDE_ARM.wristPx, g),
      ])
      for (const speak of [0, 0.5, 1]) {
        const m = shyArmMotion(t, 0, speak)
        pieces.push([
          `shy t=${t} speak=${speak}`,
          SWITCHED.shyHand as ArmPose,
          shyArmPoint(SHY_ARM.elbowPx, m),
          shyArmPoint(SHY_ARM.wristPx, m),
        ])
      }
    }
    for (const [name, like, elbow, wrist] of pieces) {
      const pose = matchArm(bone, elbow, wrist, like),
        got = solveArm(bone, pose)
      expect(Math.hypot(got.elbow[0] - elbow[0], got.elbow[1] - elbow[1]), name).toBeLessThan(1e-6)
      expect(Math.hypot(got.wrist[0] - wrist[0], got.wrist[1] - wrist[1]), name).toBeLessThan(1e-6)
      // 回り方は保持姿勢と同じ側（照れは内回り、制止・案内は外回り）。
      expect(Math.abs(pose.fo - like.fo), name).toBeLessThan(Math.PI)
    }
  })
})

describe('外回りの振り上げは真横へ突っ張った形（T 字）を通らない（BOXP-694、仕様 B）', () => {
  const length = Math.hypot(bone.W[0] - bone.E[0], bone.W[1] - bone.E[1])
  it('B1: 休止（0〜-0.1）と、-1.75 以上に上げた保持（挨拶の振り・喜び・制止）では短縮しない。内回りも短縮しない', () => {
    for (const fo of [0, -0.05, -0.1, -1.75, -1.85, -2.05, -2.15, 0.5, 1.28, 2.1]) expect(swingShorten(fo)).toBe(0)
  })
  it('B1: 振り上げ・戻りの途中（-0.6〜-1.3）は、ずっと 0.45 倍以下に短く描く（腕を伸ばしたまま外へ開く形を通らない）', () => {
    for (let fo = -0.6; fo >= -1.3; fo -= 0.05) expect(foreScale({ ...rest, fo })).toBeLessThanOrEqual(0.45)
    // 縮めすぎて前腕が消えない。
    for (let fo = 0; fo >= -2.2; fo -= 0.05) expect(foreScale({ ...rest, fo })).toBeGreaterThanOrEqual(0.4)
  })
  it('B1: 前腕が水平付近（-1.1 前後）を通る間は、半分ほどまで短く描く。変化は滑らか', () => {
    expect(swingShorten(-1.16)).toBeGreaterThan(0.45)
    expect(swingShorten(-1.16)).toBeLessThanOrEqual(0.6)
    for (let fo = 0; fo > -2.2; fo -= 0.01)
      expect(Math.abs(swingShorten(fo) - swingShorten(fo - 0.01))).toBeLessThan(0.03)
  })
  it('B1: 喜びの入りから戻りまで、前腕が水平から ±0.2 ラジアン以内にある間は長さが 0.6 倍以下（左右とも）', () => {
    const left = { ...bone, S: [434, 533], E: [384, 733], W: [300, 928], mirror: true } as const
    let horizontal = 0
    for (let t = 0; t <= clips.joy.duration; t += 1 / 120) {
      const pose = sample(clips.joy, t)
      for (const [b, p] of [
        [bone, pose.right],
        [left, { ...pose.left, fo: -pose.left.fo, ha: -pose.left.ha, flipped: true }],
      ] as const) {
        const { elbow, wrist } = solveArm(b, p),
          dx = wrist[0] - elbow[0],
          dy = wrist[1] - elbow[1]
        if (Math.abs(Math.atan2(dy, Math.abs(dx))) < 0.2 && Math.hypot(dx, dy) > 1) {
          horizontal++
          expect(Math.hypot(dx, dy) / length).toBeLessThanOrEqual(0.6)
        }
      }
    }
    expect(horizontal).toBeGreaterThan(4) // 水平は実際に通っている（検査が空振りしていない）
  })
  it('B2: 水平を通る間は手首を先に返し、前腕と手が一直線に並ばない。保持と休止では返さない', () => {
    const tip = [bone.W[0] + 30, bone.W[1] + 70] as const
    const angle = (fo: number) => {
      const pose = { ...rest, fo },
        w = solveArm(bone, pose).wrist,
        h = deformHand(bone, pose, tip[0], tip[1]),
        r = deformHand(bone, { ...pose, swing: 0 }, tip[0], tip[1])
      return Math.atan2(h[1] - w[1], h[0] - w[0]) - Math.atan2(r[1] - w[1], r[0] - w[0])
    }
    expect(Math.abs(angle(-1.1))).toBeGreaterThan(0.4)
    expect(Math.abs(angle(-1.85))).toBeLessThan(1e-9)
    expect(Math.abs(angle(0))).toBeLessThan(1e-9)
  })
  it('B3: 横へ差し出して止める姿勢（案内）は短縮しない', () => {
    expect(foreScale({ ...rest, fo: -1.1, swing: 0 })).toBe(1)
    expect(foreScale({ ...rest, fo: -1.1 })).toBeLessThan(0.6)
    // 途中の割合は線形に掛かる。
    expect(foreScale({ ...rest, fo: -1.1, swing: 0.5 })).toBeCloseTo(1 - swingShorten(-1.1) / 2, 9)
  })
})

describe('話している間の照れの手（BOXP-694、仕様 E）', () => {
  const MOUTH_Y = 352,
    FIST_RADIUS = 30
  const fistTop = (speak: number) => shyArmPoint(SHY_ARM.fistPx, shyArmMotion(1.5, 0, speak))[1] - FIST_RADIUS
  it('E1: 話していない間（待機の「口元に手」）は、拳が口に掛かる（従来どおり）', () => {
    expect(fistTop(0)).toBeLessThan(MOUTH_Y + 10)
  })
  it('E1: 話している間は、拳の上端が口より 30 以上下（あごの下）へ下がり、口が見える', () => {
    expect(fistTop(1)).toBeGreaterThanOrEqual(MOUTH_Y + 30)
    // 下げすぎて胸まで落とさない。
    expect(fistTop(1)).toBeLessThan(MOUTH_Y + 80)
  })
  it('E2: 下げ・戻しは 0.3 秒で、途中は滑らかに動く', () => {
    expect(SHY_SPEAK.seconds).toBeCloseTo(0.3, 6)
    let prev = fistTop(0)
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const y = fistTop(s)
      expect(y).toBeGreaterThanOrEqual(prev)
      expect(y - prev).toBeLessThan(12)
      prev = y
    }
  })
  it('E2: 口形が来ている間だけ下げ、話し終えたら口元へ戻す', () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    const player = {
      rig: 0,
      expressions: [],
      meshes: Array.from({ length: 33 }, () => ({ vertices: 0 })),
      expression() {},
      setParameter() {},
      update(_dt: number) {},
      rt: { memory, p2l_render_commands: () => 0, p2l_mesh_vertices: () => 0 },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s * 60); i++) player.update(1 / 60)
    }
    stage.playGesture('shyHand')
    run(1)
    expect(stage.report().shySpeak).toBe(0)
    stage.setViseme?.({ open: 0.6, width: 1 })
    run(0.15)
    expect(stage.report().shySpeak).toBeGreaterThan(0.3)
    expect(stage.report().shySpeak).toBeLessThan(0.7)
    run(0.2)
    expect(stage.report().shySpeak).toBe(1)
    stage.setViseme?.(null)
    run(0.35)
    expect(stage.report().shySpeak).toBe(0)
  })
})

describe('挨拶の手振り（制止の 1 枚腕の肘から先だけを振る、BOXP-476 TD-06）', () => {
  it('制止⇄挨拶は同じ 1 枚腕のまま直接つなぎ、腕を消して出し直さない', () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    const player = {
      rig: 0,
      expressions: [],
      meshes: Array.from({ length: 33 }, () => ({ vertices: 0 })),
      expression() {},
      setParameter() {},
      update(_dt: number) {},
      rt: { memory, p2l_render_commands: () => 0, p2l_mesh_vertices: () => 0 },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s * 60); i++) player.update(1 / 60)
    }
    stage.playGesture('halt')
    run(1.2)
    stage.playGesture('greet')
    expect(stage.report()).toMatchObject({ gesture: 'greet', armSwitch: null, switched: true })
    run(0.5)
    expect(stage.report()).toMatchObject({ gesture: 'greet', armSwitch: null })
    stage.playGesture('halt')
    expect(stage.report()).toMatchObject({ gesture: 'halt', armSwitch: null, switched: true })
  })
  it('手振りは保持の間だけで、始まりと終わりと戻りでは 0（制止と同じ位置）', () => {
    for (const [t, o] of [
      [0, 0],
      [GREET_WAVE.start, 0],
      [2.4, 0],
      [1, 1],
    ] as const)
      expect(Math.abs(greetWave(t, o))).toBeLessThan(1e-12)
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => Math.abs(greetWave(0.6 + i * 0.013))))
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThanOrEqual(GREET_WAVE.amp + 1e-9)
  })
  it('上腕と肩は動かさず、手首と手は肘の周りを回る（肘からの距離は変わらない）', () => {
    const H = HALT_ARM,
      a = haltArmAngle(1.5)
    expect(haltForeWeight(H.shoulderPx)).toBe(0)
    expect(haltForeWeight(H.wristPx)).toBe(1)
    const s0 = haltArmPoint(H.shoulderPx, a),
      s1 = greetArmPoint(H.shoulderPx, a, 0.15)
    expect(Math.hypot(s1[0] - s0[0], s1[1] - s0[1])).toBeLessThan(1e-9)
    const e = haltArmPoint(H.elbowPx, a),
      w0 = haltArmPoint(H.wristPx, a),
      w1 = greetArmPoint(H.wristPx, a, 0.15)
    expect(Math.hypot(w1[0] - w0[0], w1[1] - w0[1])).toBeGreaterThan(15)
    expect(Math.abs(Math.hypot(w1[0] - e[0], w1[1] - e[1]) - Math.hypot(w0[0] - e[0], w0[1] - e[1]))).toBeLessThan(1e-6)
  })
  it('手振り 0 のときは制止と完全に同じ写像', () => {
    for (const px of [
      [131, 234],
      [600, 800],
      [1177, 1333],
      [967, 790],
    ] as const)
      expect(greetArmPoint(px as unknown as [number, number], -0.18, 0)).toEqual(
        haltArmPoint(px as unknown as [number, number], -0.18),
      )
  })
})

describe('制止の 1 枚腕（BOXP-476 TD-06 Owner 2）', () => {
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  it('部品に切らない: 肩・肘・手首の距離はどの角度でも元の絵の比のまま（剛体の 1 枚）', () => {
    const H = HALT_ARM,
      u0 = dist(H.shoulderPx, H.elbowPx) * H.scale,
      f0 = dist(H.elbowPx, H.wristPx) * H.scale
    for (const a of [-0.3, -0.1, 0, 0.2, 0.5]) {
      const s = haltArmPoint(H.shoulderPx, a),
        e = haltArmPoint(H.elbowPx, a),
        w = haltArmPoint(H.wristPx, a)
      expect(Math.abs(dist(s, e) - u0)).toBeLessThan(1e-6)
      expect(Math.abs(dist(e, w) - f0)).toBeLessThan(1e-6)
      expect(dist(s, H.at)).toBeLessThan(1e-6)
    }
  })
  it('保持: 手首は肩より外・上、肘は肩より外、前腕の長さは休止の 0.8〜1.1 倍（上腕の上端は肩の装甲の下に隠れる）', () => {
    const a = haltArmAngle(2),
      w = haltArmPoint(HALT_ARM.wristPx, a),
      e = haltArmPoint(HALT_ARM.elbowPx, a)
    expect(w[0]).toBeGreaterThan(840)
    expect(w[1]).toBeLessThan(660)
    expect(e[0]).toBeGreaterThan(HALT_ARM.at[0])
    const r = dist(e, w) / Math.hypot(844 - 760, 928 - 733)
    expect(r).toBeGreaterThan(0.8)
    expect(r).toBeLessThan(1.1)
  })
  it('入りは下げた位置から持ち上げ、保持の揺れは小さく、戻りで下げる', () => {
    expect(haltArmAngle(0) - HALT_ARM.angle).toBeGreaterThan(0.25)
    for (let t = 0.8; t < 4; t += 0.05) expect(Math.abs(haltArmAngle(t) - HALT_ARM.angle)).toBeLessThan(0.02)
    expect(haltArmAngle(2, 1) - HALT_ARM.angle).toBeGreaterThan(0.2)
  })
  it('素材ファイルが揃っている', () => {
    for (const f of [HALT_ARM.back, HALT_ARM.front])
      expect(existsSync(new URL(`../../public/kohako/live2d/acting/${f}`, import.meta.url))).toBe(true)
  })
})

describe('照れの 1 枚腕（BOXP-476 TD-06）', () => {
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  it('部品に切らない: 肩・肘・拳の距離はどの時刻でも元の絵の比のまま（剛体の 1 枚）', () => {
    const H = SHY_ARM,
      u0 = dist(H.shoulderPx, H.elbowPx) * H.scale,
      f0 = dist(H.elbowPx, H.fistPx) * H.scale
    for (const t of [0, 0.2, 0.5, 1, 2])
      for (const out of [0, 0.5, 1]) {
        const m = shyArmMotion(t, out),
          s = shyArmPoint(H.shoulderPx, m),
          e = shyArmPoint(H.elbowPx, m),
          w = shyArmPoint(H.fistPx, m)
        expect(Math.abs(dist(s, e) - u0)).toBeLessThan(1e-6)
        expect(Math.abs(dist(e, w) - f0)).toBeLessThan(1e-6)
      }
  })
  it('保持では拳が口元（口の中心の近く）にあり、入りは拳が下から上がってくる', () => {
    const hold = shyArmPoint(SHY_ARM.fistPx, shyArmMotion(1.5)),
      start = shyArmPoint(SHY_ARM.fistPx, shyArmMotion(0))
    expect(dist(hold, [574, 352])).toBeLessThan(60)
    expect(start[1]).toBeGreaterThan(hold[1] + 40)
  })
  it('拳は口を覆い鼻先を覆わない大きさと高さ（a97beafe/4b6f3fc『拳が大きい』・172a094『拳が顎の下で口が見える』への是正）', () => {
    // 0.31 倍では鼻先まで覆い、0.28 倍でも拳が口〜顎を大きく占めた。素材の拳を手首から 0.78 倍へ縮め（shrink-fist.mjs）、
    // 172a094（支点 y565）は拳の上端が口の下に留まり口が見えた。上端が口の中心より上で、鼻先（口の約 30 上）へ届かないこと。
    expect(SHY_ARM.scale).toBeLessThanOrEqual(0.29)
    const top = shyArmPoint([727, 332], shyArmMotion(1.5))
    expect(top[1]).toBeGreaterThan(352 - 25)
    expect(top[1]).toBeLessThan(352)
  })
  it('肘は肩の下（体の外へ張り出さず、袖の下縁より下）に来る', () => {
    const e = shyArmPoint(SHY_ARM.elbowPx, shyArmMotion(1.5))
    expect(e[0]).toBeGreaterThan(660)
    expect(e[0]).toBeLessThan(780)
    expect(e[1]).toBeGreaterThan(680)
  })
  it('照れは腕セットの切替で出す', () => {
    expect(SWITCHED.shyHand).toBeDefined()
  })
})

describe('案内の 1 枚腕（案内専用の生成絵、BOXP-476 TD-06）', () => {
  it('案内は制止と別の腕セット（同じ 1 枚腕の開きではない）', () => {
    expect(SWITCHED.guide).toBeDefined()
    expect(GUIDE_ARM.back).not.toBe(HALT_ARM.back)
  })
  it('保持では肩の点は動かず、手先が手首より外（画面右）でほぼ同じ高さ＝指先が上ではなく横を向く', () => {
    const m = guideArmMotion(1.5),
      s = guideArmPoint(GUIDE_ARM.shoulderPx, m),
      w = guideArmPoint(GUIDE_ARM.wristPx, m),
      tip = guideArmPoint(GUIDE_ARM.tipPx, m)
    expect(Math.hypot(s[0] - GUIDE_ARM.at[0], s[1] - GUIDE_ARM.at[1])).toBeLessThan(2)
    expect(tip[0]).toBeGreaterThan(w[0] + 120)
    expect(Math.abs(tip[1] - w[1])).toBeLessThan(40)
  })
  it('保持の肩の点は袖の内側（x≥745）で上腕が袖の下に隠れ、指先は画面の右端（1143）より内側', () => {
    const m = guideArmMotion(1.5),
      tip = guideArmPoint(GUIDE_ARM.tipPx, m)
    expect(GUIDE_ARM.at[0]).toBeGreaterThanOrEqual(745)
    expect(tip[0]).toBeLessThan(1143 - 8)
  })
  it('入りは手を下から差し出し、1/60 秒ごとの手先の移動は跳ばない', () => {
    let prev = guideArmPoint(GUIDE_ARM.tipPx, guideArmMotion(0)),
      max = 0
    expect(prev[1]).toBeGreaterThan(guideArmPoint(GUIDE_ARM.tipPx, guideArmMotion(1.5))[1] + 60)
    for (let i = 1; i <= 120; i++) {
      const q = guideArmPoint(GUIDE_ARM.tipPx, guideArmMotion(i / 60))
      max = Math.max(max, Math.hypot(q[0] - prev[0], q[1] - prev[1]))
      prev = q
    }
    expect(max).toBeLessThan(25)
  })
  it('制止→案内は制止の腕を終えてから案内へ移り、案内の終わりで待機の腕へ戻る', () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    const player = {
      rig: 0,
      expressions: [],
      meshes: Array.from({ length: 33 }, () => ({ vertices: 0 })),
      expression() {},
      setParameter() {},
      update(_dt: number) {},
      rt: { memory, p2l_render_commands: () => 0, p2l_mesh_vertices: () => 0 },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s * 60); i++) player.update(1 / 60)
    }
    stage.playGesture('halt')
    run(1.2)
    stage.playGesture('guide')
    run(SWITCH_SECONDS + 0.02)
    expect(stage.report()).toMatchObject({ gesture: 'guide', switched: true })
    run(clips.guide.duration + 0.5)
    expect(stage.report()).toMatchObject({ gesture: 'none', switched: false })
  })
})

describe('喜びの手の大きさ（BOXP-476 Owner 指摘）', () => {
  it('保持で手を手首の輪を支点に約 1.2 倍にし、制止・案内の 1 枚腕の手と比率をそろえる', () => {
    expect(JOY_HAND_SCALE).toBeGreaterThanOrEqual(1.15)
    expect(JOY_HAND_SCALE).toBeLessThanOrEqual(1.3)
    const holds = clips.joy.keys.filter((k) => k.right && Math.abs(k.right.fo) > 1)
    expect(holds.length).toBeGreaterThan(0)
    for (const k of holds) {
      expect(must(k.right).haS).toBe(JOY_HAND_SCALE)
      expect(must(k.left).haS).toBe(JOY_HAND_SCALE)
    }
    // 待機と始点・終点は等倍（入りと戻りで手の大きさが跳ばない）
    expect(must(clips.joy.keys[0].right).haS).toBe(1)
    expect(must(clips.joy.keys[clips.joy.keys.length - 1].right).haS).toBe(1)
  })
})

import { closedEyeTarget } from './gesture'

it('にっこりだけ閉眼し、通常へ戻すと開く', () => {
  expect(closedEyeTarget('smileClosed')).toBe(1)
  expect(closedEyeTarget('smile')).toBe(0)
  expect(closedEyeTarget('neutral')).toBe(0)
})

describe('v11r 以外のモデルの表情', () => {
  it('にっこりはモデルの smile 表情へフォールバックする', () => {
    const calls: (string | null)[] = []
    const player = {
      expressions: ['smile', 'sad'],
      expression: (name: string | null) => {
        calls.push(name)
      },
    }
    const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v9' } as RigModel)
    stage.setEmotion('smileClosed')
    stage.setEmotion('surprised')
    expect(calls).toEqual(['smile', null])
  })
})

it('表情の重みと虹彩縮小は 0 で元に戻る', async () => {
  const { emotionWeight, irisScale } = await import('./gesture')
  expect(emotionWeight('surprised', 'surprised', 0)).toBe(0)
  expect(emotionWeight('surprised', 'surprised', 1)).toBe(1)
  expect(emotionWeight('neutral', 'surprised', 1)).toBe(0)
  expect(emotionWeight('smile', 'troubled', 1)).toBe(0)
  expect(irisScale(0)).toBe(1)
  expect(irisScale(1)).toBeCloseTo(0.8)
})

it('なで閉眼は滑らかに閉じて開き、まばたきを妨げない', async () => {
  const { petEyeStep, eyeOpenFor } = await import('./gesture')
  let v = 0
  for (let i = 0; i < 21; i++) {
    const next = petEyeStep(v, true, 1 / 60)
    expect(next).toBeGreaterThanOrEqual(v)
    expect(next).toBeLessThanOrEqual(1)
    v = next
  }
  expect(v).toBeGreaterThan(0.95)
  expect(petEyeStep(v, false, 0)).toBe(v)
  for (let i = 0; i < 36; i++) {
    const next = petEyeStep(v, false, 1 / 60)
    expect(next).toBeLessThanOrEqual(v)
    expect(next).toBeGreaterThanOrEqual(0)
    v = next
  }
  expect(v).toBeLessThan(0.05)
  expect(eyeOpenFor(0.2, 0, 0.5)).toBe(0.2)
  expect(eyeOpenFor(1, 1, 0)).toBe(0)
  expect(eyeOpenFor(0.6, 0, 0)).toBe(0.6)
})

it('待機クリップ停止中でもなで解除後に閉眼値が残らない', () => {
  const values = [1, 1],
    memory = new WebAssembly.Memory({ initial: 1 })
  const player = {
    rig: 0,
    expressions: [],
    parameters: ['ParamEyeLOpen', 'ParamEyeROpen'],
    meshes: Array.from({ length: 33 }, () => ({ vertices: 0 })),
    expression() {},
    parameterValues: () => [...values],
    setParameter(id: string, value: number) {
      const i = this.parameters.indexOf(id)
      if (i >= 0) values[i] = value
    },
    update(_dt: number) {},
    rt: { memory, p2l_render_commands: () => 0, p2l_mesh_vertices: () => 0, p2l_update_stages() {} },
  }
  const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
  stage.setPetEyes?.(true)
  for (let i = 0; i < 60; i++) player.update(1 / 60)
  expect(values[0]).toBeLessThan(0.05)
  stage.setPetEyes?.(false)
  for (let i = 0; i < 120; i++) player.update(1 / 60)
  expect(values[0]).toBeGreaterThan(0.95)
  expect(values[1]).toBeGreaterThan(0.95)
})

it('pet eye transition reaches endpoints within the requested durations', async () => {
  const { petEyeStep } = await import('./gesture')
  expect(petEyeStep(0, true, 0.14)).toBe(1)
  expect(petEyeStep(1, false, 0.2)).toBe(0)
})
// BOXP-525: なでの開始・終了で描画する頭の角度が 1 フレームで跳ばない（旧: 待機クリップ停止で 8〜9° の跳び）。
it('smoothAngle はなで前後の頭の角度の跳びを毎フレーム小さく分けて追う', async () => {
  const { smoothAngle } = await import('./gesture')
  let shown = 13,
    maxStep = 0
  for (let i = 0; i < 90; i++) {
    const next = smoothAngle(shown, 0.3, 1 / 60)
    maxStep = Math.max(maxStep, Math.abs(next - shown))
    shown = next
  }
  expect(maxStep).toBeLessThanOrEqual(45 / 60 + 1e-9)
  expect(Math.abs(shown - 0.3)).toBeLessThan(0.05)
  expect(smoothAngle(5, 9, 0)).toBe(5)
})

// BOXP-605: 待機のしぐさから待機クリップへ戻るとき、再開時の角度の差を滑らかに 0 へ溶かす（動くクリップに遅れず、終わりで跳ばない）。
it('idleTailOffset は再開時の差を IDLE_SMOOTH_TAIL 秒で 0 へ滑らかに溶かす', async () => {
  const { idleTailOffset, IDLE_SMOOTH_TAIL } = await import('./gesture')
  expect(idleTailOffset(13, 0)).toBe(13)
  expect(idleTailOffset(13, IDLE_SMOOTH_TAIL)).toBe(0)
  expect(idleTailOffset(13, IDLE_SMOOTH_TAIL + 5)).toBe(0)
  expect(idleTailOffset(-13, IDLE_SMOOTH_TAIL / 2)).toBeCloseTo(-6.5, 6)
  // 待機クリップの頭の最大（13°）の差でも、1/60 秒で 0.2° を超えて動かない。
  let before = 13,
    maxStep = 0
  for (let i = 1; i <= IDLE_SMOOTH_TAIL * 60; i++) {
    const v = idleTailOffset(13, i / 60)
    expect(v).toBeLessThanOrEqual(before)
    maxStep = Math.max(maxStep, before - v)
    before = v
  }
  expect(maxStep).toBeLessThan(0.2)
})
it('BOXP-525: なでで閉じていく間はまばたきの戻りで目が開き直さない', async () => {
  const { petEyeHold } = await import('./gesture')
  expect(petEyeHold(0.78, 0.1, true)).toBe(0.1)
  expect(petEyeHold(0.05, 0.1, true)).toBe(0.05)
  expect(petEyeHold(0.78, 0.1, false)).toBe(0.78)
  expect(petEyeHold(0.78, undefined, true)).toBe(0.78)
})

// BOXP-525: 閉じ目の笑顔・なでで再ステージしても、口パク（behavior）や待機の頭の向き（clip）が基底値へ落ちない。
it('BOXP-525: 再ステージで口パクと頭の向きが基底値へ落ちない', () => {
  const ids = ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamAngleX']
  const base: Record<string, number> = {},
    current = [1, 1, 0, 0],
    memory = new WebAssembly.Memory({ initial: 1 })
  const evaluate = (lip: number | null) =>
    ids.forEach((id, i) => {
      current[i] = base[id] ?? (id.includes('EyeL') || id.includes('EyeR') ? 1 : 0)
      if (lip !== null && id === 'ParamMouthOpenY') current[i] = lip
      if (lip !== null && id === 'ParamAngleX') current[i] += 12
    })
  const player = {
    rig: 0,
    expressions: ['smile'],
    parameters: ids,
    meshes: Array.from({ length: 33 }, () => ({ vertices: 0 })),
    expression() {},
    parameterRanges: () =>
      ids.map((id) => ({ id, min: 0, max: 1, default: id.includes('Open') && id !== 'ParamMouthOpenY' ? 1 : 0 })),
    parameterValues: () => [...current],
    setParameter(id: string, value: number) {
      base[id] = value
    },
    update(_dt: number) {
      evaluate(0.8)
    },
    rt: {
      memory,
      p2l_render_commands: () => 0,
      p2l_mesh_vertices: () => 0,
      p2l_update_stages() {
        evaluate(null)
      },
    },
  }
  const stage = createActingStage(player as unknown as Player, { id: 'kohako-full-v11r' } as RigModel)
  stage.setEmotion('smileClosed')
  stage.setViseme?.({ open: 0.8, width: 1 })
  for (let i = 0; i < 60; i++) player.update(1 / 60)
  expect(current[0]).toBeLessThan(0.05)
  expect(current[2]).toBeCloseTo(0.8)
  expect(Math.abs(current[3] - 12)).toBeLessThan(1)
  // 再ステージ用に入れた評価済みの値は基底に残さない（次フレームで二重に足されない）。
  expect(base.ParamMouthOpenY ?? 0).toBe(0)
})

it('restageKeeping は上書きした値を除いて評価済みの値で再ステージし、基底を戻す', async () => {
  const { restageKeeping } = await import('./gesture')
  const log: string[] = []
  restageKeeping(
    ['a', 'b', 'c'],
    [1, 2, Number.NaN],
    new Set(['b']),
    () => 0,
    (id, v) => log.push(`${id}=${v}`),
    () => log.push('restage'),
  )
  expect(log).toEqual(['a=1', 'restage', 'a=0'])
})

it('BOXP-525: capYaw は小さな向きを変えず、大きな左右の向きを ±YAW_MAX 未満へ滑らかに収める', async () => {
  const { capYaw, YAW_KNEE, YAW_MAX } = await import('./gesture')
  expect(capYaw(0)).toBe(0)
  expect(capYaw(5)).toBe(5)
  expect(capYaw(-YAW_KNEE)).toBe(-YAW_KNEE)
  expect(capYaw(32)).toBeLessThan(YAW_MAX)
  expect(capYaw(32)).toBeGreaterThan(YAW_MAX - 0.5)
  expect(capYaw(-32)).toBeCloseTo(-capYaw(32))
  let last = capYaw(-40)
  for (let v = -40; v <= 40; v += 0.5) {
    const next = capYaw(v)
    expect(next).toBeGreaterThanOrEqual(last)
    expect(next - last).toBeLessThanOrEqual(0.5 + 1e-9)
    last = next
  }
})

describe('待機のしぐさの腕（BOXP-605）', () => {
  it('動きが無ければ null（腕の変形を通さず、描画は待機のまま）', () => {
    expect(idleArmPoses(null)).toBeNull()
    expect(idleArmPoses({})).toBeNull()
    expect(idleArmPoses({ right: { up: 0, fo: 0, ha: 0 }, left: {} })).toBeNull()
    expect(idleArmPoses({ right: { up: 0.00002 } })).toBeNull()
  })
  it('角度だけを入れ、長さ・絵の差し替え・肘の位置指定は持たない', () => {
    const p = idleArmPoses({ right: { up: -0.17, ha: -0.25 }, left: { fo: 0.28 } })
    expect(p?.right).toEqual({ up: -0.17, upS: 1, fo: 0, foS: 1, ha: -0.25, haS: 1 })
    expect(p?.left).toEqual({ up: 0, upS: 1, fo: 0.28, foS: 1, ha: 0, haS: 1 })
  })
})
