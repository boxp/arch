// BOXP-476: 受入済みモデルの素材を増やさずに、表情と腕・体のしぐさを描画直前の頂点変形で足す。
// p2l.js はそのまま使い、WASM 出力の頂点を読み書きする経路（p2l_mesh_vertices / p2l_render_commands）だけを差し替える。
// v11r の層番号と関節位置は、実測した描画（モデル座標 1143x2048）に基づく。他のモデルでは表情名だけ適用する。
import type { ActingStage, Emotion, Gesture } from './acting'
import type { Player } from './rig'
import type { RigModel } from './model'
import { patchFaceTexture } from './face-texture'

type Vec = readonly [number, number]
export type ArmPose = { up: number; upS: number; fo: number; foS: number; ha: number; haS: number; elbowTo?: Vec; elbowW?: number; front?: boolean }
export type BodyPose = { headX: number; headY: number; headZ: number; bodyX: number; bodyZ: number; lean: number; eyeX: number; eyeY: number }
type Key = { t: number; right?: ArmPose; left?: ArmPose; body?: Partial<BodyPose> }
export type Clip = { duration: number; keys: Key[] }
type Face = { browOuter: number; browInner: number; browY: number; eyeSX: number; eyeSY: number; mouth: number; mouthCorner: number; mouthWidth: number; head: Partial<BodyPose>; expression: string | null }

const CX = 572
// 前腕の金の縁（モデル座標）。ここより手先だけを肘で回し、肩の装甲・裏地・内側の黒は上腕に残す。
// メッシュは 1 枚なので、境界をまたぐ三角形は曲げの間だけ外す（下の applyCut）。
const CUFF_A: Vec = [727, 760], CUFF_B: Vec = [795, 700], CUFF_REACH = 95, CUFF_MARGIN = 14, STUB_GAP = 45, BENT = 0.3
type Bone = { S: Vec; E: Vec; W: Vec; arm: number; hand: number; mirror: boolean }
const RIGHT: Bone = { S: [710, 533], E: [758, 757], W: [844, 928], arm: 22, hand: 20, mirror: false }
const mirrorX = (v: Vec): Vec => [2 * CX - v[0], v[1]]
const LEFT: Bone = { S: mirrorX(RIGHT.S), E: mirrorX(RIGHT.E), W: mirrorX(RIGHT.W), arm: 23, hand: 21, mirror: true }
const BROW = 1
const EYES = new Set([5, 6, 7, 8, 10, 11, 12, 13, 14, 15])
const MOUTH = 4
const MOUTH_C: Vec = [574, 352]
const EYE_L: Vec = [517.5, 276]
const EYE_R: Vec = [631.5, 278]

const CROSSFADE_SECONDS = 0.55
const FORESHORTEN_AT = 1.75, FORESHORTEN_WIDTH = 0.85, FORESHORTEN_DEPTH = 0.5, FORESHORTEN_FADE = 0.5
const REST: ArmPose = { up: 0, upS: 1, fo: 0, foS: 1, ha: 0, haS: 1 }
const NO_BODY: BodyPose = { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyZ: 0, lean: 0, eyeX: 0, eyeY: 0 }

export const faces: Record<Emotion, Face> = {
  neutral: { browOuter: 0, browInner: 0, browY: 0, eyeSX: 1, eyeSY: 1, mouth: 0, mouthCorner: 0, mouthWidth: 1, head: {}, expression: null },
  smile: { browOuter: -3, browInner: -5, browY: -2, eyeSX: 1.01, eyeSY: 0.97, mouth: 0.75, mouthCorner: -2.5, mouthWidth: 1.14, head: { headZ: 3 }, expression: 'smile' },
  shy: { browOuter: 4, browInner: -7, browY: 0, eyeSX: 1, eyeSY: 0.95, mouth: 0.35, mouthCorner: -0.5, mouthWidth: 0.8, head: { headX: -10, headY: -7, headZ: -4, eyeX: -0.8, eyeY: -0.5 }, expression: null },
  troubled: { browOuter: 6, browInner: -11, browY: 0, eyeSX: 1, eyeSY: 0.97, mouth: -0.45, mouthCorner: 11, mouthWidth: 0.86, head: { headZ: -5, headY: -4, eyeY: -0.25 }, expression: null },
  surprised: { browOuter: -11, browInner: -4, browY: -4, eyeSX: 1.06, eyeSY: 1.14, mouth: -0.2, mouthCorner: 7, mouthWidth: 0.62, head: { headY: 4, lean: -2 }, expression: null },
  serious: { browOuter: -3, browInner: 11, browY: 3, eyeSX: 1, eyeSY: 0.91, mouth: -0.35, mouthCorner: 12, mouthWidth: 0.92, head: { headY: -3 }, expression: null },
}

const wave = (t: number, fo: number): Key => ({ t, right: { up: 0, upS: 1, fo, foS: 1, ha: fo < -2 ? 0.35 : -0.3, haS: 1 } })
const GUIDE: ArmPose = { up: 0, upS: 1, fo: -1.92, foS: 1, ha: 0.15, haS: 1 }
// 制止: 肘を体の脇に置いたまま前腕を内側から立て、胸の前で掌を相手へ向ける。
const HALT: ArmPose = { up: 0, upS: 1, fo: 3.45, foS: 0.95, ha: 0.1, haS: 1.1, elbowTo: [738, 745], front: true }
const HALT_RISE: ArmPose = { up: 0, upS: 1, fo: 1.85, foS: 0.92, ha: 0.2, haS: 1.05, elbowTo: [748, 750], front: true }
// 照れ: 体の前を通って手を口元へ運ぶ（外へ大回りしない）。終端の向きは従来と同じ。
const SHY: ArmPose = { up: 0, upS: 1, fo: 3.2, foS: 1.32, ha: 0.02, haS: 0.95, elbowTo: [712, 730], front: true }
const SHY_RISE: ArmPose = { up: 0, upS: 1, fo: 1.95, foS: 1.1, ha: 0.1, haS: 0.98, elbowTo: [735, 745], front: true }
const JOY: ArmPose = { up: 0, upS: 1, fo: -0.42, foS: 1, ha: 0.25, haS: 1 }

export const clips: Record<Exclude<Gesture, 'none'>, Clip> = {
  nod: { duration: 1.1, keys: [{ t: 0, body: {} }, { t: 0.28, body: { headY: -12, lean: 1.2 } }, { t: 0.55, body: {} }, { t: 0.8, body: { headY: -8, lean: 0.8 } }, { t: 1.1, body: {} }] },
  tilt: { duration: 1.5, keys: [{ t: 0, body: {} }, { t: 0.4, body: { headZ: 13, headX: 8, bodyZ: 3, eyeX: 0.3 } }, { t: 1.1, body: { headZ: 13, headX: 8, bodyZ: 3, eyeX: 0.3 } }, { t: 1.5, body: {} }] },
  joy: { duration: 1.8, keys: [{ t: 0, right: REST, left: REST, body: {} }, { t: 0.4, right: JOY, left: JOY, body: { bodyZ: 5, headZ: 6, lean: 3, headY: 5 } }, { t: 0.75, right: JOY, left: JOY, body: { bodyZ: -5, headZ: -6, lean: 3, headY: 5 } }, { t: 1.1, right: JOY, left: JOY, body: { bodyZ: 5, headZ: 6, lean: 3, headY: 5 } }, { t: 1.8, right: REST, left: REST, body: {} }] },
  greet: { duration: 2.6, keys: [{ t: 0, right: REST, body: {} }, { ...wave(0.55, -2.15), body: { bodyZ: -4, headZ: 5, headX: 6 } }, { ...wave(0.85, -1.75), body: { bodyZ: -4, headZ: 5, headX: 6 } }, { ...wave(1.15, -2.15), body: { bodyZ: -4, headZ: 5, headX: 6 } }, { ...wave(1.45, -1.75), body: { bodyZ: -4, headZ: 5, headX: 6 } }, { t: 2.1, right: REST, body: {} }, { t: 2.6, right: REST, body: {} }] },
  guide: { duration: 3.2, keys: [{ t: 0, right: REST, body: {} }, { t: 0.7, right: GUIDE, body: { bodyZ: -3, headX: 12, headZ: 3, eyeX: 0.7, eyeY: 0.2 } }, { t: 2.6, right: GUIDE, body: { bodyZ: -3, headX: 12, headZ: 3, eyeX: 0.7, eyeY: 0.2 } }, { t: 3.2, right: REST, body: {} }] },
  shyHand: { duration: 3.9, keys: [{ t: 0, right: REST, body: {} }, { t: 0.6, right: SHY_RISE, body: { bodyZ: 1, lean: 1 } }, { t: 1.2, right: SHY, body: { bodyZ: 2, lean: 2 } }, { t: 3, right: SHY, body: { bodyZ: 2, lean: 2 } }, { t: 3.45, right: SHY_RISE, body: { bodyZ: 1, lean: 1 } }, { t: 3.9, right: REST, body: {} }] },
  halt: { duration: 2.9, keys: [{ t: 0, right: REST, body: {} }, { t: 0.3, right: HALT_RISE, body: { bodyZ: -1, lean: 1 } }, { t: 0.6, right: HALT, body: { bodyZ: -2, lean: 2, headY: -2 } }, { t: 2.2, right: HALT, body: { bodyZ: -2, lean: 2, headY: -2 } }, { t: 2.55, right: HALT_RISE, body: { bodyZ: -1, lean: 1 } }, { t: 2.9, right: REST, body: {} }] },
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** 眉の外端の尾は前髪の層に焼き込まれていて動かせない。外側ほど変位を 0 に寄せて、動く眉を尾へつなぐ。 */
export const browPin = (outer: number) => 1 - smooth(0.45, 0.87, outer)
const ease = (t: number) => t * t * (3 - 2 * t)
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1]
const rot = (v: Vec, a: number): Vec => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c] }
const norm = (v: Vec): Vec => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l] }
const scaleV = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k]

function lerpArm(a: ArmPose, b: ArmPose, t: number): ArmPose {
  // elbowTo の有無が変わる区間は、指定なし側の自然な肘位置との混合率で補間して跳びを防ぐ。
  const elbowTo = a.elbowTo && b.elbowTo ? [lerp(a.elbowTo[0], b.elbowTo[0], t), lerp(a.elbowTo[1], b.elbowTo[1], t)] as const : b.elbowTo ?? a.elbowTo
  const elbowW = lerp(a.elbowTo ? a.elbowW ?? 1 : 0, b.elbowTo ? b.elbowW ?? 1 : 0, t)
  return { up: lerp(a.up, b.up, t), upS: lerp(a.upS, b.upS, t), fo: lerp(a.fo, b.fo, t), foS: lerp(a.foS, b.foS, t), ha: lerp(a.ha, b.ha, t), haS: lerp(a.haS, b.haS, t), elbowTo, elbowW, front: b.front ?? a.front }
}
/** 時刻 t のキー補間。腕や体の指定が無いキーは休止姿勢として扱う。 */
export function sample(clip: Clip, time: number): { right: ArmPose; left: ArmPose; body: BodyPose } {
  const keys = clip.keys
  let i = 1
  while (i < keys.length - 1 && (keys[i]?.t ?? Infinity) < time) i++
  const a = keys[i - 1] as Key, b = keys[i] as Key
  const t = ease(Math.min(1, Math.max(0, (time - a.t) / Math.max(1e-6, b.t - a.t))))
  const body = { ...NO_BODY } as BodyPose
  for (const k of Object.keys(NO_BODY) as (keyof BodyPose)[]) body[k] = lerp(a.body?.[k] ?? 0, b.body?.[k] ?? 0, t)
  return { right: lerpArm(a.right ?? REST, b.right ?? REST, t), left: lerpArm(a.left ?? REST, b.left ?? REST, t), body }
}
/** 再生中の動作を次の動作へ切り替えるとき、腕を前の姿勢から滑らかに移す（x: 0〜1）。体は呼び出し側の平滑化に任せる。 */
export function crossfadeArms<T extends { right: ArmPose; left: ArmPose }>(from: Pick<T, 'right' | 'left'>, to: T, x: number): T {
  const t = ease(Math.min(1, Math.max(0, x)))
  return { ...to, right: lerpArm(from.right, to.right, t), left: lerpArm(from.left, to.left, t) }
}
/** 体の前を通る動作で前腕が水平付近にあるときの長さ。前腕が手前を向く短縮で描き、手が腹の前を横切らないようにする。 */
export function foreScale(pose: Pick<ArmPose, 'fo' | 'foS' | 'front'>): number {
  if (!pose.front) return pose.foS
  const off = (pose.fo - FORESHORTEN_AT) / FORESHORTEN_WIDTH // 内回り（正の角度）だけ。外回りの挨拶などへの切替では 0 を通るので跳ばない
  return pose.foS * (1 - FORESHORTEN_DEPTH * smooth(0, FORESHORTEN_FADE, pose.fo) * Math.exp(-off * off)) // 角度 0 で完全に 0 にして動作の始点終点をずらさない
}
/** 手首・肘が目標へ届くか確認する検算用の順運動学。 */
export function solveArm(bone: Pick<Bone, 'S' | 'E' | 'W'>, pose: ArmPose): { elbow: Vec; wrist: Vec } {
  const ud = norm(sub(bone.E, bone.S)), fd = norm(sub(bone.W, bone.E)), upperLength = Math.hypot(...sub(bone.E, bone.S)), foreLength = Math.hypot(...sub(bone.W, bone.E))
  const natural = add(bone.S, scaleV(rot(ud, pose.up), upperLength * pose.upS)), w = pose.elbowW ?? 1
  const elbow: Vec = pose.elbowTo ? [lerp(natural[0], pose.elbowTo[0], w), lerp(natural[1], pose.elbowTo[1], w)] : natural
  return { elbow, wrist: add(elbow, scaleV(rot(fd, pose.fo), foreLength * foreScale(pose))) }
}

/** 前腕の金の縁より手先の頂点か（上腕・肩の装甲・裏地は false）。 */
function cuffCoords(bone: Pick<Bone, "mirror">, rx: number, ry: number): { d: number; t: number } {
  const rest: Vec = bone.mirror ? mirrorX([rx, ry]) : [rx, ry], line = norm(sub(CUFF_B, CUFF_A)), r = sub(rest, CUFF_A)
  return { d: dot(r, [-line[1], line[0]]), t: dot(r, line) }
}
export function isForearm(bone: Pick<Bone, "mirror">, rx: number, ry: number): boolean {
  const { d, t } = cuffCoords(bone, rx, ry)
  return d > -CUFF_MARGIN && t <= CUFF_REACH
}
/** 前腕の継ぎ目のすぐ上（内側の黒い部分）か。曲げの間は描かない。 */
function isStubEnd(bone: Pick<Bone, "mirror">, rx: number, ry: number): boolean {
  const { d, t } = cuffCoords(bone, rx, ry)
  return d <= -CUFF_MARGIN && d > -CUFF_MARGIN - STUB_GAP && t <= CUFF_REACH
}
export function deformArm(bone: Bone, pose: ArmPose, vx: number, vy: number, rx: number, ry: number): Vec {
  const mirrorPose = bone.mirror ? { ...pose, up: -pose.up, fo: -pose.fo, ha: -pose.ha, elbowTo: pose.elbowTo ? mirrorX(pose.elbowTo) : undefined } : pose
  const { up, upS, fo } = mirrorPose, foS = foreScale(mirrorPose)
  const ud = norm(sub(bone.E, bone.S)), fd = norm(sub(bone.W, bone.E))
  const newE = solveArm(bone, mirrorPose).elbow
  const forearm = isForearm(bone, rx, ry)
  if (forearm) { const f = sub([vx, vy], bone.E), fa = dot(f, fd); return add(newE, rot(add(scaleV(fd, fa * foS), sub(f, scaleV(fd, fa))), fo)) }
  const u = sub([vx, vy], bone.S), ua = dot(u, ud)
  return add(bone.S, rot(add(scaleV(ud, ua * upS), sub(u, scaleV(ud, ua))), up))
}
export function deformHand(bone: Bone, pose: ArmPose, vx: number, vy: number): Vec {
  const m = bone.mirror ? { ...pose, up: -pose.up, fo: -pose.fo, ha: -pose.ha, elbowTo: pose.elbowTo ? mirrorX(pose.elbowTo) : undefined } : pose
  return add(solveArm(bone, m).wrist, rot(scaleV(sub([vx, vy], bone.W), m.haS), m.fo + m.ha))
}

type Runtime = { memory: WebAssembly.Memory; p2l_mesh_vertices(rig: number, mesh: number): number; p2l_render_commands(rig: number, pointer: number, capacity: number): number }
type Internal = Player & { rt: Runtime; update(dt: number): void; rig: number }
const PARAMS: Record<keyof BodyPose, string> = { headX: 'ParamAngleX', headY: 'ParamAngleY', headZ: 'ParamAngleZ', bodyX: 'ParamBodyAngleX', bodyZ: 'ParamBodyAngleZ', lean: 'ParamBodyLean', eyeX: 'ParamEyeBallX', eyeY: 'ParamEyeBallY' }

export function createActingStage(player: Player, model: RigModel): ActingStage & { report(): Record<string, unknown> } {
  if (model.id !== 'kohako-full-v11r') {
    const names: Partial<Record<Emotion, string>> = { smile: 'smile', shy: 'shy', troubled: 'sad', surprised: 'surprised', serious: 'angry' }
    return { setEmotion(e) { player.expression(names[e] && player.expressions.includes(names[e]) ? names[e] : null) }, playGesture() {}, reset() { player.expression(null) }, report: () => ({ supported: false }) }
  }
  const p = player as Internal, rt = p.rt, rests = new Map<number, Float32Array>(), done = new Map<number, number>()
  let facePatch: Record<string, unknown>
  try { facePatch = patchFaceTexture(p as unknown as Parameters<typeof patchFaceTexture>[0]) } catch (e) { facePatch = { patched: false, error: e instanceof Error ? e.message : String(e) } }
  let generation = 0, target = faces.neutral, face = { ...faces.neutral }, clip: Clip | null = null, clipName: Gesture = 'none', clipTime = 0, emotion: Emotion = 'neutral'
  let pose: ReturnType<typeof sample> = { right: REST, left: REST, body: NO_BODY }, armBlend = 0
  const headCurrent = { ...NO_BODY }
  let fadeFrom: { right: ArmPose; left: ArmPose } | null = null, fadeTime = 0, fadeSeconds = CROSSFADE_SECONDS
  // 腕の表示は常に pose そのもの。解除も関節の補間で戻すので、どの時点で次の動作が来ても pose から正確につなげる。
  const startFade = (seconds = CROSSFADE_SECONDS) => { fadeFrom = { right: pose.right, left: pose.left }; fadeTime = 0; fadeSeconds = seconds }
  // 前腕の回転量が大きい切替（内回りの照れ→外回りの挨拶など）は、回す角度に応じて時間をかける。
  const fadeFor = (next: Clip) => CROSSFADE_SECONDS * Math.max(1, Math.max(...next.keys.flatMap(k => [Math.abs((k.right?.fo ?? 0) - pose.right.fo), Math.abs((k.left?.fo ?? 0) - pose.left.fo)])) / 2.4)
  // 肘を曲げている間だけ、前腕と上腕をまたぐ三角形を描かない（引き伸ばしの裂けを出さない）。
  type IndexArray = Uint16Array | Uint32Array
  const cuts = new Map<number, { full: IndexArray; cut: IndexArray; bent: boolean }>()
  const gl = player.gl
  const armMesh = (m: number) => p.meshes[m] as { indices: IndexArray; indexBuffer: WebGLBuffer; vertices: number }
  const prepareCut = (bone: Bone) => {
    const mesh = armMesh(bone.arm), v = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(p.rig, bone.arm), mesh.vertices * 2), full = mesh.indices, kept: number[] = [], forearm: number[] = []
    if (!full?.length) return
    for (let i = 0; i + 2 < full.length; i += 3) { const tri = [full[i] as number, full[i + 1] as number, full[i + 2] as number], at = (n: number) => [v[2 * n] as number, v[2 * n + 1] as number] as const, fore = tri.map(n => isForearm(bone, ...at(n))), stubEnd = tri.some(n => isStubEnd(bone, ...at(n))); if (fore.every(Boolean)) forearm.push(...tri); else if (!fore.some(Boolean) && !stubEnd) kept.push(...tri) }
    cuts.set(bone.arm, { full, cut: new (full.constructor as new (a: number[]) => IndexArray)([...kept, ...forearm]), bent: false })
  }
  const applyCut = (bone: Bone, armPose: ArmPose) => {
    const entry = cuts.get(bone.arm); if (!entry) return
    const bent = armBlend > 0.001 && (Math.abs(armPose.fo) > BENT || !!armPose.elbowTo && (armPose.elbowW ?? 0) > 0.05)
    if (bent === entry.bent) return
    entry.bent = bent
    const mesh = armMesh(bone.arm), indices = bent ? entry.cut : entry.full
    mesh.indices = indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  }
  prepareCut(RIGHT); prepareCut(LEFT)
  const frontMeshes = (): number[] => [pose.right.front && armBlend > 0.3 ? RIGHT.hand : -1, pose.left.front && armBlend > 0.3 ? LEFT.hand : -1].filter(i => i >= 0)

  const apply = (mesh: number, pointer: number, count: number) => {
    const v = new Float32Array(rt.memory.buffer, pointer, count * 2)
    if (!rests.has(mesh)) rests.set(mesh, v.slice())
    const rest = rests.get(mesh) as Float32Array
    for (let i = 0; i < count; i++) {
      const x = v[2 * i] as number, y = v[2 * i + 1] as number, rx = rest[2 * i] as number, ry = rest[2 * i + 1] as number
      let out: Vec = [x, y]
      if (armBlend > 0.001 && (mesh === RIGHT.arm || mesh === LEFT.arm)) { const b = mesh === RIGHT.arm ? RIGHT : LEFT; const d = deformArm(b, mesh === RIGHT.arm ? pose.right : pose.left, x, y, rx, ry); out = [lerp(x, d[0], armBlend), lerp(y, d[1], armBlend)] }
      else if (armBlend > 0.001 && (mesh === RIGHT.hand || mesh === LEFT.hand)) { const b = mesh === RIGHT.hand ? RIGHT : LEFT; const d = deformHand(b, mesh === RIGHT.hand ? pose.right : pose.left, x, y); out = [lerp(x, d[0], armBlend), lerp(y, d[1], armBlend)] }
      else if (mesh === BROW) { const outer = Math.min(1, Math.abs(rx - CX) / 75); out = [x, y + (face.browY + lerp(face.browInner, face.browOuter, smooth(0.15, 0.95, outer))) * browPin(outer)] }
      else if (mesh === MOUTH) { const u = Math.min(1, Math.abs(rx - MOUTH_C[0]) / 30); out = [MOUTH_C[0] + (x - MOUTH_C[0]) * face.mouthWidth, y + face.mouthCorner * (u * u - 0.35)] }
      else if (EYES.has(mesh)) { const c = rx < CX ? EYE_L : EYE_R; out = [c[0] + (x - c[0]) * face.eyeSX, c[1] + (y - c[1]) * face.eyeSY] }
      v[2 * i] = out[0]; v[2 * i + 1] = out[1]
    }
  }
  const hookVertices = (rig: number, mesh: number) => {
    const pointer = rt.p2l_mesh_vertices(rig, mesh)
    if ((mesh === BROW || mesh === MOUTH || EYES.has(mesh) || mesh === RIGHT.arm || mesh === LEFT.arm || mesh === RIGHT.hand || mesh === LEFT.hand) && done.get(mesh) !== generation) {
      apply(mesh, pointer, (p.meshes[mesh] as { vertices: number }).vertices); done.set(mesh, generation)
    }
    return pointer
  }
  const hookCommands = (rig: number, pointer: number, capacity: number) => {
    const count = rt.p2l_render_commands(rig, pointer, capacity), front = frontMeshes()
    if (!front.length) return count
    const view = new Int32Array(rt.memory.buffer, pointer, Math.min(count, capacity)), list = Array.from(view)
    view.set([...list.filter(c => !front.includes(c)), ...front.filter(m => list.includes(m))])
    return count
  }
  p.rt = Object.create(rt, { p2l_mesh_vertices: { value: hookVertices }, p2l_render_commands: { value: hookCommands } }) as Runtime
  const baseUpdate = p.update.bind(p)
  p.update = (dt: number) => {
    generation++
    if (clip) { clipTime += dt; if (clipTime >= clip.duration) { clip = null; clipName = 'none'; startFade() } }
    const sampled = clip ? sample(clip, clipTime) : null
    const goal = sampled ?? (fadeFrom ? { right: REST, left: REST, body: NO_BODY } : null)
    let shown = goal
    if (goal && fadeFrom) {
      fadeTime += dt
      if (fadeTime >= fadeSeconds) fadeFrom = null
      else shown = crossfadeArms(fadeFrom, goal, fadeTime / fadeSeconds)
    }
    const k = 1 - Math.exp(-dt * 7)
    for (const key of Object.keys(face) as (keyof Face)[]) if (typeof face[key] === 'number' && typeof target[key] === 'number') (face[key] as number) = lerp(face[key] as number, target[key] as number, k)
    if (shown) pose = shown
    armBlend = shown ? 1 : 0
    applyCut(RIGHT, pose.right); applyCut(LEFT, pose.left)
    for (const key of Object.keys(NO_BODY) as (keyof BodyPose)[]) {
      const want = (sampled?.body[key] ?? 0) + (target.head[key] ?? 0)
      headCurrent[key] = lerp(headCurrent[key], want, k)
      p.setParameter(PARAMS[key], headCurrent[key])
    }
    p.setParameter('ParamMouthForm', face.mouth)
    baseUpdate(dt)
  }
  return {
    setEmotion(next) { emotion = next; target = faces[next]; player.expression(target.expression && player.expressions.includes(target.expression) ? target.expression : null) },
    playGesture(next) {
      if (next === 'none') return
      // 前の動作の途中や解除後の戻りの途中でも、その時点の腕の見た目から次の動作へつなぐ。
      startFade(fadeFor(clips[next]))
      clip = clips[next]; clipName = next; clipTime = 0; armBlend = 1
    },
    reset() { emotion = 'neutral'; target = faces.neutral; player.expression(null); if (clip) startFade(); clip = null; clipName = 'none' },
    report: () => ({ supported: true, facePatch, emotion, gesture: clipName, armBlend, clipTime, face: { browY: face.browY, browInner: face.browInner, eyeSY: face.eyeSY, mouthCorner: face.mouthCorner } }),
  }
}
