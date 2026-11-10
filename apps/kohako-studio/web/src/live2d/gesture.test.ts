import { describe, expect, it } from 'vitest'
import { BENT_ART, interruptPlan, bentSide, bentWeight, placeBent, placeBentFore, browPin, handSwap, type ArmPose, clips, createActingStage, crossfadeArms, deformArm, deformFore, deformHand, deformSleeve, faces, foreScale, isForearm, sample, sleeveAngle, solveArm } from './gesture'
import type { Player } from './rig'
import type { RigModel } from './model'
import { emotions, gestures } from './acting'

const bone = { S: [710, 533], E: [760, 733], W: [844, 928], band: 34, arm: 22, hand: 20, mirror: false } as const
const HEM = [[771, 663], [841, 691]] as const // 紫の袖の下縁
const CUFF_EDGE = [[729, 758.5], [745, 761.5], [760, 759.5], [769, 753], [773, 746], [777, 733], [781, 713], [784, 702], [787, 697.5]] as const // 小手の金の開口（FOREARM_POLY の上辺）
const rest = { up: 0, upS: 1, fo: 0, foS: 1, ha: 0, haS: 1 }

describe('生成素材の手と前腕の分離', () => {
  const bone = { S: [710, 533], E: [760, 733], W: [844, 928], arm: 22, hand: 20, mirror: false } as const
  it('前腕の支点は親の肘の位置にそのまま付く（肘で離れない）', () => {
    const pose = { up: 0.2, upS: 0.9, fo: 2.4, foS: 1, ha: 0, haS: 1 }
    const [x, y] = deformFore(bone, pose, bone.E[0], bone.E[1]), elbow = solveArm(bone, pose).elbow
    expect(x).toBeCloseTo(elbow[0]); expect(y).toBeCloseTo(elbow[1])
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
  it('照れの保持は肘が肩の下に残り、前腕が胸の前を斜めに渡る（肘を胸の中央へ寄せて上腕を隠さない）', () => {
    const { elbow, wrist } = solveArm(bone, sample(clips.shyHand, 2).right)
    expect(Math.abs(elbow[0] - bone.S[0])).toBeLessThanOrEqual(40)
    expect(elbow[0] - wrist[0]).toBeGreaterThanOrEqual(60)
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
  // 関節に見えるかの必要条件（最終判断は実描画の連続コマ）。上腕と前腕が別の線分として開き、前腕の長さが保たれ、肘が動くこと。
  // 照れは手を口元へ運ぶため前腕が少し手前を向く（短縮して見える）。肘を袖の下に寄せたまま手が口元へ届く長さ（BOXP-476 Owner B）。
  it.each([['制止', 'halt', 1.5, 0.9], ['挨拶', 'greet', 0.55, 0.9], ['案内', 'guide', 1.5, 0.9], ['喜び', 'joy', 0.75, 0.9]] as const)('%s の保持は肘が開いて見える', (_name, gesture, time, minFore) => {
    const pose = sample(clips[gesture], time).right, { elbow, wrist } = solveArm(bone, pose)
    const toShoulder = [bone.S[0] - elbow[0], bone.S[1] - elbow[1]] as const, toWrist = [wrist[0] - elbow[0], wrist[1] - elbow[1]] as const
    const inner = Math.acos((toShoulder[0] * toWrist[0] + toShoulder[1] * toWrist[1]) / (Math.hypot(...toShoulder) * Math.hypot(...toWrist))) * 180 / Math.PI
    expect(inner).toBeGreaterThanOrEqual(29)
    expect(inner).toBeLessThanOrEqual(145)
    const restLength = Math.hypot(bone.W[0] - bone.E[0], bone.W[1] - bone.E[1])
    expect(Math.hypot(...toWrist) / restLength).toBeGreaterThanOrEqual(minFore)
    expect(Math.hypot(...toWrist) / restLength).toBeLessThanOrEqual(1.1)
    // 肩から肘の長さは、袖に隠れる上端を含めて休止の 1.14 倍まで。袖の下に見えている区間は休止より長くしない。
    expect(Math.hypot(...toShoulder)).toBeLessThanOrEqual(Math.hypot(bone.E[0] - bone.S[0], bone.E[1] - bone.S[1]) * 1.14)
    expect(Math.hypot(elbow[0] - bone.E[0], elbow[1] - bone.E[1])).toBeGreaterThanOrEqual(60)
    expect(elbow[1]).toBeLessThanOrEqual(bone.E[1] + 5) // 腰より下へは大きく下げない（袖の下に上腕を見せる分だけ休止より少し下げてよい。BOXP-485）
  })
  // 照れは正本の照れ（手前へ向いた太い前腕が口元へ斜めに渡る遠近の構図）に合わせ、肘を袖の下縁の 50〜70px 下に出し、前腕は休止より長く太く見せる（BOXP-488 案D）。内角と前腕長 ±10% の条件は照れに適用しない。
  it('曲げた小手は肘の関節点で金縁の筒口として終わり、肩側へ張り出して上腕を覆わない（BOXP-488 案C）', () => {
    const over = (BENT_ART.fore.h - BENT_ART.fore.anchor[1]) * BENT_ART.fore.scale
    expect(over).toBeGreaterThan(0)
    expect(over).toBeLessThanOrEqual(15)
  })
  it('照れ の保持は肘が袖の下縁の下に見え、手が口元に届き、前腕は手前へ太く見える', () => {
    const pose = sample(clips.shyHand, 2).right, { elbow, wrist } = solveArm(bone, pose)
    const [[x0, y0], [x1, y1]] = HEM, hemY = y0 + (y1 - y0) * (elbow[0] - x0) / (x1 - x0)
    expect(elbow[1] - hemY).toBeGreaterThanOrEqual(50)
    expect(elbow[1] - hemY).toBeLessThanOrEqual(70)
    expect(elbow[0]).toBeLessThan(812) // 袖の角より外へ出さない
    expect(wrist[1]).toBeLessThan(500) // 口元の手
    expect(Math.abs(wrist[0] - 607)).toBeLessThan(15)
    const near = placeBentFore(bone, pose, [10, 0]), far = placeBentFore(bone, pose, [-10, 0])
    expect(Math.hypot(near[0] - far[0], near[1] - far[1])).toBeGreaterThan(20 * 1.2) // 遠近で太く（横方向 1.2 倍超）
  })
  it.each([['制止', 'halt', 1.5], ['挨拶', 'greet', 0.55], ['案内', 'guide', 1.5], ['喜び', 'joy', 0.75]] as const)('%s の保持は肘が袖の下縁より下に出て上腕が見える', (_name, gesture, time) => {
    const { elbow } = solveArm(bone, sample(clips[gesture], time).right)
    const hemY = 663 + (elbow[0] - 771) * (691 - 663) / (841 - 771)
    expect(elbow[1] - hemY).toBeGreaterThanOrEqual(20)
  })
  // 袖の下縁から小手の開口まで、肩→肘の中心線が見える長さ。袖と小手を実際の変形で動かして測る（BOXP-485 の条件 1 と 3）。
  const visibleUpper = (pose: ArmPose) => {
    const m = pose, { elbow, wrist } = solveArm(bone, m), length = (v: readonly [number, number]) => Math.hypot(v[0], v[1])
    const toCuff = [wrist[0] - elbow[0], wrist[1] - elbow[1]] as const, b = [elbow[0] + toCuff[0] / length(toCuff) * 30, elbow[1] + toCuff[1] / length(toCuff) * 30] as const
    const angle = sleeveAngle(bone, m), hem = HEM.map(p => deformSleeve(bone, angle, p[0], p[1], p[0], p[1])), cuff = CUFF_EDGE.map(p => deformFore(bone, m, p[0], p[1]))
    const hit = (line: readonly (readonly [number, number])[], pick: (a: number, b: number) => number) => {
      let found = NaN
      for (let i = 0; i + 1 < line.length; i++) {
        const p = line[i] as readonly [number, number], q = line[i + 1] as readonly [number, number], dx = b[0] - bone.S[0], dy = b[1] - bone.S[1], ex = q[0] - p[0], ey = q[1] - p[1], d = dx * ey - dy * ex
        if (Math.abs(d) < 1e-9) continue
        const s = ((p[0] - bone.S[0]) * ey - (p[1] - bone.S[1]) * ex) / d, u = ((p[0] - bone.S[0]) * dy - (p[1] - bone.S[1]) * dx) / d
        if (u < 0 || u > 1) continue
        found = Number.isNaN(found) ? s : pick(found, s)
      }
      return found
    }
    const total = Math.hypot(b[0] - bone.S[0], b[1] - bone.S[1])
    const end = hit(cuff, Math.min) // 開口の金の縁をかすめて届かないときは、上腕の下端までを見える区間とする
    return (Math.min(Number.isNaN(end) ? 1 : end, 1) - hit(hem, Math.max)) * total
  }
  it.each([['制止', 'halt', 1.5], ['挨拶', 'greet', 0.55], ['案内', 'guide', 1.5], ['喜び', 'joy', 0.75]] as const)('%s の保持は袖の下縁から小手まで上腕が 50px 以上見え、休止より長くは見えない', (_name, gesture, time) => {
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
    const pose = sample(clips.halt, 1.5).right, elbow = solveArm(bone, pose).elbow, armAngle = Math.atan2(elbow[1] - bone.S[1], elbow[0] - bone.S[0]) - Math.atan2(bone.E[1] - bone.S[1], bone.E[0] - bone.S[0])
    expect(angle).toBeGreaterThan(armAngle * 0.8)
    const shoulder = deformSleeve(bone, angle, bone.S[0], bone.S[1] + 5, bone.S[0], bone.S[1] + 5), tip = deformSleeve(bone, angle, 845, 695, 845, 695)
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

describe('上げた腕からの反対側への割込み（BOXP-476 TD-02）', () => {
  const held = (gesture: 'shyHand' | 'halt', time: number) => sample(clips[gesture], time)
  const path = (from: 'shyHand' | 'halt', fromTime: number, to: 'shyHand' | 'halt') => {
    const start = held(from, fromTime), plan = interruptPlan(start, clips[to])
    return { plan, frames: Array.from({ length: 21 }, (_, i) => { const x = i / 20; return solveArm(bone, crossfadeArms(plan.from, sample(clips[to], plan.at + x * 0.8), x).right) }) }
  }
  it('照れ→制止は上を回り、手首が腹の高さへ下がらない', () => {
    const { plan, frames } = path('shyHand', 1.2, 'halt')
    expect(plan.at).toBeGreaterThan(0)
    expect(Math.abs(plan.from.right.fo - clips.halt.keys[2]!.right!.fo)).toBeLessThan(Math.PI)
    for (const { wrist, elbow } of frames) { expect(wrist[1]).toBeLessThan(elbow[1]); expect(wrist[1]).toBeLessThan(600) }
  })
  it('制止→照れも逆向きに同じ', () => {
    const { frames } = path('halt', 1.2, 'shyHand')
    for (const { wrist, elbow } of frames) { expect(wrist[1]).toBeLessThan(elbow[1]); expect(wrist[1]).toBeLessThan(600) }
  })
  it('上がっていない腕や同じ側への切替は経路も開始時刻も変えない', () => {
    const low = { right: rest, left: rest }
    expect(interruptPlan(low, clips.halt)).toEqual({ from: low, at: 0 })
    const raised = held('halt', 1.2)
    expect(interruptPlan(raised, clips.greet).at).toBe(0)
  })
  it('曲げの絵の裏返しは割込みで回る途中の 1 回だけ', () => {
    const { plan } = path('shyHand', 1.2, 'halt'), from = plan.from.right.fo, to = clips.halt.keys[2]!.right!.fo
    const sides = Array.from({ length: 41 }, (_, i) => bentSide({ mirror: false }, { fo: from + (to - from) * i / 40 }))
    expect(sides[0]).toBe(bentSide({ mirror: false }, { fo: 3.41 }))
    expect(sides.at(-1)).toBe(1)
    expect(sides.filter((v, i) => i > 0 && v !== sides[i - 1]).length).toBe(1)
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

describe('曲げの絵（BOXP-476 TD-02）', () => {
  it('前腕の曲げが小さいときは元の小手のまま、保持では差し替える', () => {
    expect(bentWeight(0)).toBe(0)
    expect(bentWeight(0.3)).toBe(0)
    expect(bentWeight(-2.05)).toBe(1)
    expect(bentWeight(3.41)).toBe(1)
  })
  it('差し替えは半透明の二重を見せないよう、ごく狭い角度で切り替える', () => {
    expect(bentWeight(0.43)).toBe(1)
    expect(bentWeight(0.39)).toBe(0)
  })
  it('内回りと左腕では絵を裏返す', () => {
    expect(bentSide({ mirror: false }, { fo: -2 })).toBe(1)
    expect(bentSide({ mirror: false }, { fo: 3.4 })).toBe(-1)
    expect(bentSide({ mirror: true }, { fo: -1.85 })).toBe(-1)
  })
  it('絵は肘を原点に軸の向きへ置く', () => {
    const near = (a: readonly [number, number], b: readonly [number, number]) => { expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6) }
    near(placeBent([100, 200], [0, -1], 1, [0, 50]), [100, 150])
    near(placeBent([100, 200], [0, -1], 1, [10, 0]), [110, 200])
    near(placeBent([100, 200], [0, -1], -1, [10, 0]), [90, 200])
  })
  it('照れの途中で前腕が短縮しても、曲げた小手の先は手首に付いたまま縮む', () => {
    const length = Math.hypot(bone.W[0] - bone.E[0], bone.W[1] - bone.E[1])
    const shortened: ArmPose = { ...rest, fo: 2.1, front: true }
    expect(foreScale(shortened)).toBeCloseTo(0.5)
    const { elbow, wrist } = solveArm(bone, shortened), tip = placeBentFore(bone, shortened, [0, length])
    expect(tip[0]).toBeCloseTo(wrist[0], 6); expect(tip[1]).toBeCloseTo(wrist[1], 6)
    const origin = placeBentFore(bone, shortened, [0, 0]); expect(origin[0]).toBeCloseTo(elbow[0], 6); expect(origin[1]).toBeCloseTo(elbow[1], 6)
    const left = { ...bone, S: [1210, 533], E: [1160, 733], W: [1076, 928], mirror: true } as const // 左腕も同じ（中心 960 で反転）
    const mirroredPose: ArmPose = { ...shortened, fo: -2.1 }, s = solveArm(left, shortened), leftTip = placeBentFore(left, mirroredPose, [0, length])
    expect(Math.hypot(s.wrist[0] - s.elbow[0], s.wrist[1] - s.elbow[1])).toBeCloseTo(length * 0.5, 6)
    expect(Math.hypot(leftTip[0] - s.elbow[0], leftTip[1] - s.elbow[1])).toBeCloseTo(length * 0.5, 6)
  })
  it('素材の肘の位置は画像の範囲内にある', () => {
    for (const art of [BENT_ART.fore, BENT_ART.elbow]) { expect(art.anchor[0]).toBeGreaterThan(0); expect(art.anchor[0]).toBeLessThan(art.w); expect(art.anchor[1]).toBeGreaterThan(0); expect(art.anchor[1]).toBeLessThan(art.h) }
  })
})

describe('照れの経路と手の切替（BOXP-476 Owner B）', () => {
  const bone = { S: [710, 533] as const, E: [760, 733] as const, W: [844, 928] as const }
  it('手を口元へ運ぶ途中と戻りで、手首が腹の前を横へ大きく外れない', () => {
    let widest = 0
    for (let time = 0; time <= clips.shyHand.duration; time += 1 / 60) {
      const { elbow, wrist } = solveArm(bone, sample(clips.shyHand, time).right)
      if (wrist[1] > 620) widest = Math.max(widest, Math.abs(wrist[0] - elbow[0]))
    }
    expect(widest).toBeLessThan(110)
  })
  it('元の手と手の素材は半透明で重ねず、どちらか一方だけを描く', () => {
    for (let w = 0; w <= 1; w += 0.01) expect([0, 1]).toContain(handSwap(w))
    expect(handSwap(0.49)).toBe(0)
    expect(handSwap(0.51)).toBe(1)
  })
})
