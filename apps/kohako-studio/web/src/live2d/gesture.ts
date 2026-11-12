// BOXP-476: 受入済みモデルの素材を増やさずに、表情と腕・体のしぐさを描画直前の頂点変形で足す。
// p2l.js はそのまま使い、WASM 出力の頂点を読み書きする経路（p2l_mesh_vertices / p2l_render_commands）だけを差し替える。
// v11r の層番号と関節位置は、実測した描画（モデル座標 1143x2048）に基づく。他のモデルでは表情名だけ適用する。
import type { ActingStage, Emotion, Gesture } from './acting'
import type { Player } from './rig'
import type { RigModel } from './model'
import { patchFaceTexture } from './face-texture'
import { atBind, bindPoint, BUST, chestGrid, createChestSpring, stepChest, type Bind } from './chest'
import { addGhost, addGrid, addQuad, addShared, addTexture, CUFF_POLY, eraseAtlas, FOREARM_POLY, isSleeveLining, isStaticUpper, loadTexture, mirrorPolygon, paintCapeCorner, splitMesh, type PartsPlayer, type Polygon, type Split } from './arm-parts'

type Vec = readonly [number, number]
type HandArt = 'palm' | 'cover'
export type ArmPose = { up: number; upS: number; fo: number; foS: number; ha: number; haS: number; elbowTo?: Vec; elbowW?: number; front?: boolean; art?: HandArt; artW?: number }
export type BodyPose = { headX: number; headY: number; headZ: number; bodyX: number; bodyZ: number; lean: number; eyeX: number; eyeY: number }
type Key = { t: number; right?: ArmPose; left?: ArmPose; body?: Partial<BodyPose> }
export type Clip = { duration: number; keys: Key[] }
type Face = { browOuter: number; browInner: number; browY: number; eyeSX: number; eyeSY: number; mouth: number; mouthCorner: number; mouthWidth: number; head: Partial<BodyPose>; expression: string | null }

const CX = 572
// 前腕の金の縁（モデル座標）。ここより手先だけを肘で回し、肩の装甲・裏地・内側の黒は上腕に残す。
// メッシュは 1 枚なので、境界をまたぐ三角形は曲げの間だけ外す（下の applyCut）。
const CUFF_A: Vec = [727, 760], CUFF_B: Vec = [795, 700], CUFF_REACH = 95, CUFF_MARGIN = 14, STUB_GAP = 45, BENT = 0.3
type Bone = { S: Vec; E: Vec; W: Vec; arm: number; hand: number; mirror: boolean }
// E は前腕の金の縁の開口の中央。ここを回すと、曲げたときに縁が肘の先へ突き出さず、上腕の端が開口へ入って見える。
const RIGHT: Bone = { S: [710, 533], E: [760, 733], W: [844, 928], arm: 22, hand: 20, mirror: false }
const mirrorX = (v: Vec): Vec => [2 * CX - v[0], v[1]]
const LEFT: Bone = { S: mirrorX(RIGHT.S), E: mirrorX(RIGHT.E), W: mirrorX(RIGHT.W), arm: 23, hand: 21, mirror: true }
const BROW = 1
const BODY = 26
const EYES = new Set([5, 6, 7, 8, 10, 11, 12, 13, 14, 15])
const MOUTH = 4
const MOUTH_C: Vec = [574, 352]
const EYE_L: Vec = [517.5, 276]
const EYE_R: Vec = [631.5, 278]

const CROSSFADE_SECONDS = 0.55
const FORESHORTEN_AT = 2.1, FORESHORTEN_WIDTH = 0.75, FORESHORTEN_DEPTH = 0.5, FORESHORTEN_FADE = 0.5
// 肘を外へ上げるとき、肩の広い袖（ケープ）は肩口を動かさず垂らす（正本シートの上げた腕と同じ）。上腕は曲げの絵（BENT_ART）の黒い袖で見せるので、裾は持ち上げない。
const SLEEVE_FOLLOW = 0.25, SLEEVE_FROM = 15, SLEEVE_TO = 130
const REST: ArmPose = { up: 0, upS: 1, fo: 0, foS: 1, ha: 0, haS: 1 }
const NO_BODY: BodyPose = { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyZ: 0, lean: 0, eyeX: 0, eyeY: 0 }

export const faces: Record<Emotion, Face> = {
  neutral: { browOuter: 0, browInner: 0, browY: 0, eyeSX: 1, eyeSY: 1, mouth: 0, mouthCorner: 0, mouthWidth: 1, head: {}, expression: null },
  smile: { browOuter: -3, browInner: -5, browY: -2, eyeSX: 1.01, eyeSY: 0.97, mouth: 0.75, mouthCorner: -2.5, mouthWidth: 1.14, head: { headZ: 3 }, expression: 'smile' },
  smileClosed: { browOuter: -3, browInner: -5, browY: -2, eyeSX: 1.01, eyeSY: 0.97, mouth: 0.75, mouthCorner: -2.5, mouthWidth: 1.14, head: { headZ: 3 }, expression: 'smile' },
  shy: { browOuter: 4, browInner: -7, browY: 0, eyeSX: 1, eyeSY: 0.95, mouth: 0.35, mouthCorner: -0.5, mouthWidth: 0.8, head: { headX: -10, headY: -7, headZ: -4, eyeX: -0.8, eyeY: -0.5 }, expression: null },
  troubled: { browOuter: 6, browInner: -11, browY: 0, eyeSX: 1, eyeSY: 0.82, mouth: -0.45, mouthCorner: 11, mouthWidth: 0.86, head: { headZ: -5, headY: -4, eyeY: -0.25 }, expression: null },
  surprised: { browOuter: -11, browInner: -4, browY: -4, eyeSX: 1.06, eyeSY: 1.14, mouth: -0.2, mouthCorner: 7, mouthWidth: 0.62, head: { headY: 4, lean: -2 }, expression: null },
  serious: { browOuter: -3, browInner: 11, browY: 3, eyeSX: 1, eyeSY: 0.91, mouth: -0.35, mouthCorner: 12, mouthWidth: 0.92, head: { headY: -3 }, expression: null },
}

// 外へ上げる肘の位置。袖の裾を持ち上げた下に上腕が見える高さで、肩〜肘の総長は休止の 1.14 倍以内に収める。これより上げると小手の開口が袖の裾に重なって上腕が隠れる（BOXP-485）。
const ELBOW_OUT: Vec = [828, 736]
const wave = (t: number, fo: number): Key => ({ t, right: { up: 0, upS: 1, fo, foS: 1, ha: fo < -2 ? 0.35 : -0.3, haS: 1, elbowTo: ELBOW_OUT } })
const GUIDE: ArmPose = { up: 0, upS: 1, fo: -1.92, foS: 1, ha: 0.15, haS: 1, elbowTo: ELBOW_OUT }
// 制止: 肘を外へ上げ、体の外側で前腕を斜めに立てて掌を相手へ向ける。前腕を真上まで立てると上腕に重なって上腕が隠れるため、内角を開いた角度で止める（BOXP-482/485）。
const HALT: ArmPose = { up: 0, upS: 1, fo: -2.05, foS: 1, ha: 0.1, haS: 1.1, elbowTo: ELBOW_OUT, front: true, art: 'palm', artW: 1 }
const HALT_RISE: ArmPose = { up: 0, upS: 1, fo: -1.1, foS: 1, ha: 0.2, haS: 1.05, elbowTo: [805, 725], front: true, art: 'palm', artW: 0 }
// 照れ: 肘は体の脇寄りに残し、前腕を胸の前へ斜めに渡して手を口元へ運ぶ。肘を胸の中央まで寄せると前腕が上腕の真下に立って上腕が読めない（#14730 P1）。
const SHY: ArmPose = { up: 0, upS: 1, fo: 3.14, foS: 1.09, ha: 0.02, haS: 0.95, elbowTo: [690, 714], front: true, art: 'cover', artW: 1 }
const SHY_RISE: ArmPose = { up: 0, upS: 1, fo: 2.75, foS: 0.95, ha: 0.7, haS: 0.98, elbowTo: [715, 712], front: true, art: 'cover', artW: 0 }
// 喜び: v11r の手は待機で垂らした横向きの絵のまま回すため、1 枚腕の制止・案内の手より約 2 割小さく見える（BOXP-476 Owner 指摘）。手首の輪を支点に 1.2 倍して比率をそろえる（1.35 では輪の上で手の甲が膨らむ）。
export const JOY_HAND_SCALE = 1.2
const JOY: ArmPose = { up: 0, upS: 1, fo: -1.85, foS: 1, ha: 0.25, haS: JOY_HAND_SCALE, elbowTo: ELBOW_OUT }

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
  // 手の絵の重みは、絵の種類が変わる切替でも 0 を通るようにする。
  const art = (t < 0.5 ? a.art ?? b.art : b.art ?? a.art), sameArt = a.art === b.art
  const artW = sameArt || !a.art || !b.art ? lerp(a.artW ?? 0, b.artW ?? 0, t) : (t < 0.5 ? lerp(a.artW ?? 0, 0, t * 2) : lerp(0, b.artW ?? 0, t * 2 - 1))
  return { up: lerp(a.up, b.up, t), upS: lerp(a.upS, b.upS, t), fo: lerp(a.fo, b.fo, t), foS: lerp(a.foS, b.foS, t), ha: lerp(a.ha, b.ha, t), haS: lerp(a.haS, b.haS, t), elbowTo, elbowW, front: b.front ?? a.front, art, artW }
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
const TAU = 2 * Math.PI, RAISED = 1.5, FO_CUT = 3.82 // 照れの保持(3.41)と制止の保持(-2.05 = 4.23)の中間。割込みで 1 周ずらした角度を元の範囲へ戻すときの境目
const normalizeFo = (fo: number) => fo >= FO_CUT ? fo - TAU : fo <= FO_CUT - TAU ? fo + TAU : fo
/**
 * 割込みの起点。腕を上げたまま反対側の上げ姿勢へ移るとき（照れ→制止など）、角度をそのまま補間すると腕が下を回って手が腹の前を横切る。
 * そこで起点の角度を 1 周ずらして上を通る短い経路にし、次の動作の振り上げ（休止から上げる区間）を飛ばす。at は次の動作の開始時刻。
 */
export function interruptPlan(from: { right: ArmPose; left: ArmPose }, next: Clip): { from: { right: ArmPose; left: ArmPose }; at: number } {
  const out = { ...from }
  let at = 0
  for (const side of ['right', 'left'] as const) {
    const current = from[side], key = Math.abs(current.fo) < RAISED ? undefined : next.keys.find(k => Math.abs(k[side]?.fo ?? 0) >= RAISED), target = key?.[side]?.fo
    if (!key || target == null || Math.abs(target - current.fo) <= Math.PI) continue
    out[side] = { ...current, fo: current.fo + (target > current.fo ? TAU : -TAU) }
    at = Math.max(at, key.t)
  }
  return { from: out, at }
}
/** 体の前を通る動作で前腕が水平付近にあるときの長さ。前腕が手前を向く短縮で描き、手が腹の前を横切らないようにする。 */
export function foreScale(pose: Pick<ArmPose, 'fo' | 'foS' | 'front'>): number {
  if (!pose.front) return pose.foS
  const fo = normalizeFo(pose.fo), off = (fo - FORESHORTEN_AT) / FORESHORTEN_WIDTH // 内回り（正の角度）だけ。外回りの挨拶などへの切替では 0 を通るので跳ばない
  return pose.foS * (1 - FORESHORTEN_DEPTH * smooth(0, FORESHORTEN_FADE, fo) * (1 - smooth(2.8, 3.35, fo)) * Math.exp(-off * off)) // 始点(角度 0)と保持(手前を向き切った後)では完全に 0 にして長さをずらさない
}
/** 手首・肘が目標へ届くか確認する検算用の順運動学。 */
export function solveArm(bone: Pick<Bone, 'S' | 'E' | 'W'>, pose: ArmPose): { elbow: Vec; wrist: Vec } {
  const ud = norm(sub(bone.E, bone.S)), fd = norm(sub(bone.W, bone.E)), upperLength = Math.hypot(...sub(bone.E, bone.S)), foreLength = Math.hypot(...sub(bone.W, bone.E))
  const natural = add(bone.S, scaleV(rot(ud, pose.up), upperLength * pose.upS)), w = pose.elbowW ?? 1
  const elbow: Vec = pose.elbowTo ? [lerp(natural[0], pose.elbowTo[0], w), lerp(natural[1], pose.elbowTo[1], w)] : natural
  return { elbow, wrist: add(elbow, scaleV(rot(fd, pose.fo), foreLength * foreScale(pose))) }
}

const mirrored = (bone: Pick<Bone, 'mirror'>, pose: ArmPose): ArmPose => bone.mirror ? { ...pose, up: -pose.up, fo: -pose.fo, ha: -pose.ha, elbowTo: pose.elbowTo ? mirrorX(pose.elbowTo) : undefined } : pose
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
/** 肘が外へ上がった分だけ袖を回す角度（画面の角度。内側へ寄せる動作では 0）。 */
export function sleeveAngle(bone: Pick<Bone, 'S' | 'E' | 'W' | 'mirror'>, pose: ArmPose): number {
  const elbow = solveArm(bone, mirrored(bone, pose)).elbow, delta = wrapAngle(Math.atan2(elbow[1] - bone.S[1], elbow[0] - bone.S[0]) - Math.atan2(bone.E[1] - bone.S[1], bone.E[0] - bone.S[0]))
  return (bone.mirror ? Math.max(delta, 0) : Math.min(delta, 0)) * SLEEVE_FOLLOW
}
/** 肩の袖の頂点を、肩口を固定したまま袖口ほど大きく回す。 */
export function deformSleeve(bone: Pick<Bone, 'S' | 'E' | 'mirror'>, angle: number, vx: number, vy: number, rx: number, ry: number): Vec {
  const axis = norm(sub(bone.E, bone.S)), offset = sub([rx, ry], bone.S)
  return add(bone.S, rot(sub([vx, vy], bone.S), angle * smooth(SLEEVE_FROM, SLEEVE_TO, dot(offset, axis))))
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
  const mirrorPose = mirrored(bone, pose)
  const { up, upS, fo } = mirrorPose, foS = foreScale(mirrorPose)
  const ud = norm(sub(bone.E, bone.S)), fd = norm(sub(bone.W, bone.E))
  const newE = solveArm(bone, mirrorPose).elbow
  const forearm = isForearm(bone, rx, ry)
  if (forearm) { const f = sub([vx, vy], bone.E), fa = dot(f, fd); return add(newE, rot(add(scaleV(fd, fa * foS), sub(f, scaleV(fd, fa))), fo)) }
  const u = sub([vx, vy], bone.S), ua = dot(u, ud)
  return add(bone.S, rot(add(scaleV(ud, ua * upS), sub(u, scaleV(ud, ua))), up))
}
/** 前腕の絵を肘で回す（分離した前腕のパーツ用。deformArm の前腕の枝と同じ式）。 */
export function deformFore(bone: Bone, pose: ArmPose, vx: number, vy: number): Vec {
  const m = mirrored(bone, pose)
  const fd = norm(sub(bone.W, bone.E)), newE = solveArm(bone, m).elbow, f = sub([vx, vy], bone.E), fa = dot(f, fd)
  return add(newE, rot(add(scaleV(fd, fa * foreScale(m)), sub(f, scaleV(fd, fa))), m.fo))
}
export function deformHand(bone: Bone, pose: ArmPose, vx: number, vy: number): Vec {
  const m = mirrored(bone, pose)
  return add(solveArm(bone, m).wrist, rot(scaleV(sub([vx, vy], bone.W), m.haS), m.fo + m.ha))
}

// 手の素材は上向きに描かれているので、保持姿勢の回転の逆を掛けた位置を休止座標とする。アンカーは手首（素材の px）。
const ART: Record<HandArt, { file: string; w: number; h: number; anchor: Vec; scale: number; tilt: number; hold: ArmPose }> = {
  palm: { file: 'palm.png', w: 360, h: 628, anchor: [227, 612], scale: 0.27, tilt: -0.1, hold: HALT },
  cover: { file: 'cover.png', w: 360, h: 595, anchor: [55, 579], scale: 0.235, tilt: -0.35, hold: SHY },
}
/** マントの下に隠れていた上腕（生成素材）の配置。下端は肘に付いて動く。 */
const UPPER_ART = { file: 'upper.png', top: [750, 640] as Vec, bottom: [761, 764] as Vec, halfWidth: 39 }
const UPPER_ART_REACH = 114 // 肩の関節から素材の上端までの距離（休止時の top と同じ）
const UPPER_ART_REACH_INWARD = 8 // 肘を体の前へ寄せたときの上端の距離。袖の裏まで伸ばし、棒の切り口を胴の上に見せない
const UPPER_ART_INTO_CUFF = 30 // 上腕の下端を肘より先へ出す量。曲げの絵（丸い小手）の間は肩→肘の延長線上に置いて肘の丸みと両縁をつなげ、元の V 字の小手の間は手首の側へ置いて端を開口の内側に収める
const SEPARATE_AT = 0.02
// 曲げた腕の絵。v11r の小手の肘側は V 字に切れ込んでいて、回すと先端が二股の板に見える（肘の丸みが無い）。曲げの間だけ、丸い金縁で肘側を閉じた小手と、肘を包む黒い袖へ差し替える。小手は v11r の前腕の太さと先細りに合わせた生成素材（Gemini、正本シートの曲げ腕と v11r の前腕を参照）、肘の袖は正本シートからの切り出し。anchor は素材 px の肘、scale は素材 px→モデル座標。
export const BENT_ART = { fore: { file: 'fore-bent.png', w: 170, h: 540, anchor: [82.5, 417.5] as Vec, scale: 0.518 }, elbow: { file: 'elbow-upper.png', w: 294, h: 314, anchor: [147, 156.8] as Vec, scale: 0.5 } }
const BENT_FROM = 0.94, BENT_TO = 0.96
/** 前腕の曲げ量に応じた、差し替えの絵の重み（0〜1）。 */
export const bentWeight = (fo: number) => smooth(BENT_FROM, BENT_TO, Math.abs(fo))
/** 絵の左右。正本は「手先へ向かって肩が左」の絵。内回り（fo>0）と左腕では裏返す。 */
export const bentSide = (bone: Pick<Bone, 'mirror'>, pose: Pick<ArmPose, 'fo'>) => (normalizeFo(pose.fo) > 0 ? -1 : 1) * (bone.mirror ? -1 : 1)
const artCorners = (art: { w: number; h: number; anchor: Vec; scale: number }): Vec[] => ([[0, 0], [art.w, 0], [art.w, art.h], [0, art.h]] as Vec[]).map(([x, y]) => [(x - art.anchor[0]) * art.scale, (art.anchor[1] - y) * art.scale])
/** 素材の座標（横 b, 軸方向 a）を、肘を原点に軸 axis の向きへ置く。 */
export function placeBent(elbow: Vec, axis: Vec, side: number, [b, a]: Vec): Vec { const u = norm(axis); return add(elbow, add(scaleV(u, a), scaleV([-u[1], u[0]], b * side))) }
/** 曲げた前腕の絵の点。軸方向は deformFore と同じ foreScale で縮め、照れの途中の短縮でも小手の先が手首から離れないようにする。 */
export function placeBentFore(bone: Pick<Bone, 'S' | 'E' | 'W' | 'mirror'>, pose: ArmPose, [b, a]: Vec): Vec {
  const m = mirrored(bone, pose), { elbow, wrist } = solveArm(bone, m)
  return placeBent(elbow, sub(wrist, elbow), bentSide(bone, pose), [b, a * foreScale(m)])
}
/**
 * 腕セットの切替（BOXP-476 TD-06 Y'）。一般的な Live2D の「腕 A/B」と同じく、待機の腕を変形で制止の形まで曲げず、
 * 動作の始まりに短いフェードで制止の腕へ差し替える。ここでは制止の腕に既存の比較版の保持姿勢（HALT）の絵を使う。
 */
export const SWITCH_SECONDS = 0.25
export const SWITCHED: Partial<Record<Exclude<Gesture, 'none'>, ArmPose>> = { halt: HALT, shyHand: SHY, greet: HALT, guide: HALT }
/** Cubism のポーズのフェードと同じ考え方で、裏に残す腕の不透明度を決める（背景が透ける割合を 0.15 以下に抑える）。 */
export function backOpacity(front: number): number {
  const a = Math.min(1, Math.max(0, front)); let o = 1 - a
  if ((1 - o) * (1 - a) > 0.15) o = 1 - 0.15 / (1 - a)
  return Math.min(1, Math.max(0, o))
}
/**
 * 制止の 1 枚腕（BOXP-476 TD-06 Owner 2）。Gemini で生成した制止の腕（肩〜肘〜小手〜手が 1 本に描かれた絵）を部品に切らず、
 * 1 枚のまま動作の始まりにフェードで差し替え、肩を支点に絵全体を回して持ち上げ・保持の微動・戻りを付ける（肘や手首は曲げない）。
 * back は腕全体（肩の丸みだけ肩の装甲の下へ隠れるようぼかした絵）で袖の表地の裏に、front は同じ絵・同じ位置で肘から先だけを
 * 残したアルファで表地の手前に描く（2 枚は完全に重なるので 1 枚の絵として見える）。box は生成画像の画素（ファイルは 0.5 倍）。
 */
export const HALT_ARM = {
  back: 'halt-arm.png', front: 'halt-arm-front.png', box: [131, 234, 1046, 1099] as const,
  shoulderPx: [288, 352] as Vec, elbowPx: [520, 1170] as Vec, wristPx: [967, 790] as Vec,
  /** 生成画像の肩の点を置くモデル座標と、倍率・保持の回転（反時計回りが負）。 */
  at: [718, 540] as Vec, scale: 0.31, angle: -0.18,
}
/** 1 枚腕の回転（ラジアン、画面の時計回りが正）。t は差し替え開始からの秒、out(0〜1)は戻りの進み。入りは下げた位置から持ち上げる。 */
export function haltArmAngle(t: number, out = 0): number {
  const rise = 1 - ease(Math.min(1, Math.max(0, t / 0.45))), hold = smooth(0.3, 0.8, t)
  return HALT_ARM.angle + 0.3 * rise + 0.012 * Math.sin(t * 2.4) * hold + 0.25 * ease(out)
}
/** 生成画像の画素 → モデル座標（絵全体を肩の点で回すだけ）。 */
export function haltArmPoint(px: Vec, angle: number): Vec {
  const H = HALT_ARM
  return add(H.at, scaleV(rot(sub(px, H.shoulderPx), angle), H.scale))
}
/**
 * 挨拶の 1 枚腕（BOXP-476 TD-06、生成なし）。本人採用の制止 7fa4a2f の 1 枚腕（掌を見せて手を挙げた絵）をそのまま使い、
 * 持ち上げまでは制止と同じ。保持の間だけ、肘から先を肘を中心に左右へ振って手を振る。肘をまたぐ帯（幅 band 画素）は
 * 重みを滑らかに変え、上腕は動かさない（絵は切らない）。wave=0 のときは制止と同じ位置（制止の見た目は変えない）。
 */
export const GREET_WAVE = { amp: 0.15, hz: 1.4, start: 0.4, band: 90 }
/** 同じ 1 枚腕（制止の絵）を使う動作。互いの切替では腕を消さない。 */
const SAME_ARM: ReadonlySet<string> = new Set(['halt', 'greet'])
/**
 * 案内の 1 枚腕（BOXP-476 TD-06、照れと同じ方式）。847deb4a では制止の絵を外へ開いたが、独立判定で「指先が上・掌が正面で
 * 制止/挨拶に見える」とされたため、案内専用の絵（td06u-guide1: 肩の切り口〜下がる上腕〜直角の肘〜ほぼ水平に外へ出る前腕〜
 * 掌を上へ向け指先を画面の UI 側へ揃えた手）を Gemini で生成し、部品に切らず動作の始まりにフェードで差し替える。
 * back は腕全体で袖の表地の裏に、front は同じ絵・同じ位置で上腕の上部を除いたアルファで表地の手前に描く。box は生成画像の画素（ファイルは 0.5 倍）。
 * 0.31 倍・角度 0 では手先がモデルの画面の右端（x≈1143）を越えて切れたため、0.28 倍（照れと同じ）にして肩で下へ回した。
 * cce68801 の独立判定で「袖とケープの間に上腕が細い帯で見え肘が硬い」とされたため、肩の点を外へ 30 画素寄せて上腕を袖の下に収め
 * （袖の下から太い上腕が出て肘で曲がる）、角度を 0.25 にして指先を画面内に保つ。入り・戻りは腕を下げた位置（+0.45rad）から
 * 持ち上げ、待機の腕とのフェードの重なりが腰の前を水平に横切らないようにする。
 * 32cff098 の独立判定で「元絵の肘が直角で黒いしわが密集し塊に見える」とされたため、肘を約 120 度に開きしわを抑えた絵
 * （td06u2-guide2）を生成し直した。絵の腕が太く描かれているので 0.21 倍に縮め、角度 0.14 で指先を横へ向けたまま手先を画面内に保つ。
 */
export const GUIDE_ARM = {
  back: 'guide-arm.png', front: 'guide-arm-front.png', box: [204, 264, 2152, 1219] as const,
  shoulderPx: [410, 345] as Vec, elbowPx: [760, 1240] as Vec, wristPx: [1577, 1188] as Vec, tipPx: [2351, 1250] as Vec,
  at: [748, 540] as Vec, scale: 0.21, angle: 0.14,
}
/** 案内の 1 枚腕の回転と沈み。入りは手を下から差し出し、保持は小さく揺らし、戻りは下げながら消す。 */
export function guideArmMotion(t: number, out = 0): { angle: number; drop: number } {
  const rise = 1 - ease(Math.min(1, Math.max(0, t / 0.45))), hold = smooth(0.35, 0.85, t), o = ease(out)
  return { angle: GUIDE_ARM.angle + 0.45 * rise + 0.012 * Math.sin(t * 2.2) * hold + 0.45 * o, drop: 25 * rise + 25 * o }
}
export function guideArmPoint(px: Vec, m: { angle: number; drop: number }): Vec {
  const H = GUIDE_ARM
  return add(add(H.at, [0, m.drop]), scaleV(rot(sub(px, H.shoulderPx), m.angle), H.scale))
}
/** 手振りの角度（ラジアン、時計回りが正）。t は差し替え開始からの秒、out(0〜1)は戻りの進み。 */
export function greetWave(t: number, out = 0): number {
  const G = GREET_WAVE, env = smooth(G.start, G.start + 0.25, t) * (1 - smooth(1.95, 2.35, t)) * (1 - ease(out))
  return G.amp * Math.sin(2 * Math.PI * G.hz * (t - G.start)) * env
}
/** 1 枚腕の画素が前腕側にある度合い（0=上腕、1=前腕と手）。肘の角の二等分線からの距離で決める。 */
export function haltForeWeight(px: Vec): number {
  const H = HALT_ARM, unit = (v: Vec): Vec => scaleV(v, 1 / Math.hypot(v[0], v[1]))
  const up = unit(sub(H.shoulderPx, H.elbowPx)), fore = unit(sub(H.wristPx, H.elbowPx)), bis = unit(add(up, fore))
  let n: Vec = [-bis[1], bis[0]]; if (n[0] * fore[0] + n[1] * fore[1] < 0) n = scaleV(n, -1)
  const d = (px[0] - H.elbowPx[0]) * n[0] + (px[1] - H.elbowPx[1]) * n[1]
  return smooth(-GREET_WAVE.band / 2, GREET_WAVE.band / 2, d)
}
/** 挨拶: 肘から先を wave だけ肘の周りに回してから、制止と同じく絵全体を肩の点で回して置く。 */
export function greetArmPoint(px: Vec, angle: number, wave: number): Vec {
  const w = haltForeWeight(px) * wave, E = HALT_ARM.elbowPx
  return haltArmPoint(w ? add(E, rot(sub(px, E), w)) : px, angle)
}
/**
 * 照れの 1 枚腕（BOXP-476 TD-06、採用済みの制止 7fa4a2f と同じ方式）。Gemini で生成した照れの腕（肩の切り口〜手前へ出た肘〜
 * 急に立ち上がる前腕〜口元の拳が 1 本に描かれた絵）を部品に切らず、動作の始まりにフェードで差し替え、肩を支点に回して持ち上げる。
 * back は腕全体（切り口は肩の装甲の下へ隠れるようぼかした絵）で袖の表地の裏に、front は同じ絵・同じ位置で上腕の上部を除いた
 * アルファで、口元を隠すため顔の手前（描画の最後）に描く。box は生成画像の画素（ファイルは 0.5 倍）。
 * a97beafe（0.31 倍）は独立判定で拳が大きく鼻先まで覆ったため、0.28 倍に縮め拳を口の高さへ下げた（肩の支点も少し内上へ）。
 * 4b6f3fc（0.28 倍）も独立判定で拳が顔に対して大きいとされたため、素材の拳だけを手首の輪から 0.78 倍へ縮め（生成なしの加工
 * shrink-fist.mjs、腕・肘・輪は不変）、拳が口元に届くよう支点を 20 上げた。172a094 は独立判定で拳が顎の下に留まり口が見えたため、支点をさらに 15 上げた。fistPx は縮めた後の拳の中心。
 */
export const SHY_ARM = {
  back: 'shy-arm.png', front: 'shy-arm-front.png', box: [544, 236, 960, 1460] as const,
  shoulderPx: [1343, 1000] as Vec, elbowPx: [1327, 1519] as Vec, fistPx: [740, 494] as Vec,
  at: [726, 550] as Vec, scale: 0.28, angle: 0.15,
}
/** 照れの 1 枚腕の回転と沈み。入りは拳を胸の高さから口元へ持ち上げ、保持は小さく揺らし、戻りは下げながら消す。 */
export function shyArmMotion(t: number, out = 0): { angle: number; drop: number } {
  const rise = 1 - ease(Math.min(1, Math.max(0, t / 0.5))), hold = smooth(0.4, 0.9, t), o = ease(out)
  return { angle: SHY_ARM.angle - 0.22 * rise + 0.01 * Math.sin(t * 2.1) * hold - 0.18 * o, drop: 55 * rise + 45 * o }
}
export function shyArmPoint(px: Vec, m: { angle: number; drop: number }): Vec {
  const H = SHY_ARM
  return add(add(H.at, [0, m.drop]), scaleV(rot(sub(px, H.shoulderPx), m.angle), H.scale))
}
const posed = (a: ArmPose) => Math.abs(a.fo) > SEPARATE_AT || (!!a.elbowTo && (a.elbowW ?? 0) > SEPARATE_AT) || (a.artW ?? 0) > 0.001
const partURL = (file: string) => new URL(`kohako/live2d/acting/${file}`, location.href).href

type Runtime = { memory: WebAssembly.Memory; p2l_mesh_vertices(rig: number, mesh: number): number; p2l_render_commands(rig: number, pointer: number, capacity: number): number; p2l_mesh_opacity(rig: number, mesh: number): number; p2l_mesh_colors(rig: number, mesh: number, a: number, b: number): void; p2l_update_stages(rig: number, a: number, b: number): void }
type Internal = Player & { rt: Runtime; update(dt: number): void; rig: number }
const PARAMS: Record<keyof BodyPose, string> = { headX: 'ParamAngleX', headY: 'ParamAngleY', headZ: 'ParamAngleZ', bodyX: 'ParamBodyAngleX', bodyZ: 'ParamBodyAngleZ', lean: 'ParamBodyLean', eyeX: 'ParamEyeBallX', eyeY: 'ParamEyeBallY' }

export const emotionWeight = (emotion: Emotion, wanted: Emotion, amount: number): number => emotion === wanted ? Math.max(0, Math.min(1, amount)) : 0
export const irisScale = (amount: number): number => 1 - 0.2 * Math.max(0, Math.min(1, amount))

export const closedEyeTarget = (emotion: Emotion): number => emotion === 'smileClosed' ? 1 : 0

// BOXP-525: なでの閉眼は表情とは独立して滑らかに戻す。
export function petEyeStep(current: number, on: boolean, dt: number): number {
  if (dt <= 0) return current
  const value = Math.max(0, Math.min(1, current))
  return Math.max(0, Math.min(1, value + ((on ? 1 : 0) - value) * (1 - Math.exp(-dt / (on ? 0.115 : 0.18)))))
}
export const eyeOpenFor = (blinkOpen: number, emotionClosed: number, petClosed: number): number => Math.min(blinkOpen, 1 - Math.max(emotionClosed, petClosed))

export function createActingStage(player: Player, model: RigModel): ActingStage & { report(): Record<string, unknown> } {
  if (model.id !== 'kohako-full-v11r') {
    const names: Partial<Record<Emotion, string>> = { smile: 'smile', smileClosed: 'smile', shy: 'shy', troubled: 'sad', surprised: 'surprised', serious: 'angry' }
    return { setEmotion(e) { player.expression(names[e] && player.expressions.includes(names[e]) ? names[e] : null) }, playGesture() {}, reset() { player.expression(null) }, report: () => ({ supported: false }) }
  }
  const p = player as Internal, rt = p.rt, rests = new Map<number, Float32Array>(), done = new Map<number, number>()
  let facePatch: Record<string, unknown>
  try { facePatch = patchFaceTexture(p as unknown as Parameters<typeof patchFaceTexture>[0]) } catch (e) { facePatch = { patched: false, error: e instanceof Error ? e.message : String(e) } }
  let petEyes = false, petClosed = 0
  let blush = 0, eyeClosed = 0, surprised = 0, troubled = 0, speaking = false, mouthOverride = false
  let generation = 0, target = faces.neutral, face = { ...faces.neutral }, clip: Clip | null = null, clipName: Gesture = 'none', clipTime = 0, emotion: Emotion = 'neutral'
  let pose: ReturnType<typeof sample> = { right: REST, left: REST, body: NO_BODY }, armBlend = 0
  const headCurrent = { ...NO_BODY }
  let visemeWidth = 1, visemeWant = 1, petOffset = { headX: 0, headY: 0, headZ: 0 }
  let fadeFrom: { right: ArmPose; left: ArmPose } | null = null, fadeTime = 0, fadeSeconds = CROSSFADE_SECONDS
  // 腕の表示は常に pose そのもの。解除も関節の補間で戻すので、どの時点で次の動作が来ても pose から正確につなげる。
  const startFade = (seconds = CROSSFADE_SECONDS, from: { right: ArmPose; left: ArmPose } = pose) => { fadeFrom = { right: from.right, left: from.left }; fadeTime = 0; fadeSeconds = seconds }
  // 前腕の回転量が大きい切替（内回りの照れ→外回りの挨拶など）は、回す角度に応じて時間をかける。
  const fadeFor = (next: Clip, from: { right: ArmPose; left: ArmPose }, at: number) => CROSSFADE_SECONDS * Math.max(1, Math.max(...next.keys.filter(k => k.t >= at).flatMap(k => [Math.abs((k.right?.fo ?? 0) - from.right.fo), Math.abs((k.left?.fo ?? 0) - from.left.fo)])) / 2.4)
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
    const entry = cuts.get(bone.arm); if (!entry || parts) return // 分離パーツが使えるときは三角形を間引かない
    const bent = armBlend > 0.001 && (Math.abs(armPose.fo) > BENT || !!armPose.elbowTo && (armPose.elbowW ?? 0) > 0.05)
    if (bent === entry.bent) return
    entry.bent = bent
    const mesh = armMesh(bone.arm), indices = bent ? entry.cut : entry.full
    mesh.indices = indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  }
  prepareCut(RIGHT); prepareCut(LEFT)
  // 追加パーツ: 腕の絵を前腕と上腕に画素で分け、隠れていた上腕と手の素材を描き足す。作れない環境では従来の間引きで動く。
  type Side = { bone: Bone; split: Split; upperTexture: number; originalTexture: number; originalUv: WebGLBuffer | null | undefined; fill: number; fore: number; stub: number; outer: number; bentFore: number; bentElbow: number; on: boolean }
  type Synth = { base: number; pointer: number; write(out: Float32Array): void; opacity(): number; shared?: number; ghost?: boolean; count?: number }
  const synth = new Map<number, Synth>(), sway = new Map<number, Vec>()
  let parts: { right: Side; left: Side; art: Partial<Record<HandArt, number>>; cuff: number } | null = null, partsStatus: Record<string, unknown> = { ready: false }
  const armOf = (b: Bone) => b === RIGHT ? pose.right : pose.left
  // 腕セットの切替の状態。out は今の腕を待機の腕へ、in は待機の腕から切替先の腕へフェードする。
  let sw: { phase: 'in' | 'out'; t: number; then?: () => void } | null = null, posedAlpha = 1, switched = false, frozen: ReturnType<typeof sample> | null = null
  let fadeSides = { right: false, left: false }
  const ghosts = new Map<number, { index: number; pointer: number; side: 'right' | 'left' }>()
  const sideOf = (m: number): 'right' | 'left' | null => m === RIGHT.arm || m === RIGHT.hand ? 'right' : m === LEFT.arm || m === LEFT.hand ? 'left' : null
  const posedFor = (side: 'right' | 'left' | null) => side && sw && fadeSides[side] ? posedAlpha : 1
  const ghostFor = (side: 'right' | 'left') => sw && fadeSides[side] ? backOpacity(posedAlpha) : 0
  // 制止の腕セットの状態。haltTime は差し替え開始からの秒、haltOut は戻りのフェードの進み(0〜1)。
  // 照れの 1 枚腕も同じ時間（haltTime/haltOut）を使う（同時に出るのはどちらか一方）。
  let haltSet = false, haltLoaded = false, haltTime = 0, haltOut = 0, shySet = false, shyLoaded = false, guideSet = false, guideLoaded = false, greetSet = false
  // 挨拶の手振りは挨拶を始めてからの秒で進める（制止から直接つないでも振りが途中から始まらない）。挨拶から制止へ直接つないだときは、そのときの振りを 0.25 秒で 0 へ戻す。
  let greetTime = 0, waveFrom = 0, waveDecay = 1
  const haltQuads: Partial<Record<'back' | 'front', number>> = {}, shyQuads: Partial<Record<'back' | 'front', number>> = {}, guideQuads: Partial<Record<'back' | 'front', number>> = {}
  const haltOn = () => haltSet && haltLoaded, shyOn = () => shySet && shyLoaded, guideOn = () => guideSet && guideLoaded
  const artLoaded: Partial<Record<HandArt, boolean>> = {} // 素材が届くまでは元の手のまま（読込失敗時も同じ）
  const handArt = () => pose.right.art && armBlend > 0.001 && artLoaded[pose.right.art] ? { kind: pose.right.art, w: pose.right.artW ?? 0 } : { kind: undefined, w: 0 }
  const separatedPose = (a: ArmPose) => armBlend > 0.001 && (Math.abs(a.fo) > SEPARATE_AT || (!!a.elbowTo && (a.elbowW ?? 0) > SEPARATE_AT))
  const swayOf = (m: number): Vec => sway.get(m) ?? [0, 0]
  try {
    const pp = p as unknown as PartsPlayer, alloc = rt as unknown as { p2l_alloc(n: number): number; p2l_dealloc(a: number, n: number): void }, cp = p as unknown as { commandsPointer: number; commandCapacity: number }
    const loads: Promise<void>[] = []
    const later = (file: string, loaded?: () => void) => { const index = addTexture(pp); loads.push(loadTexture(gl, partURL(file)).then(t => { pp.textures[index] = t; loaded?.() })); return index }
    const fillTexture = later(UPPER_ART.file)
    const bentMark = { fore: false, elbow: false }, onBent = (k: 'fore' | 'elbow') => () => { bentMark[k] = true }, bentLoaded = () => bentMark.fore && bentMark.elbow // 片方でも読めないときは元の小手のまま
    const bentForeTexture = later(BENT_ART.fore.file, onBent('fore')), bentElbowTexture = later(BENT_ART.elbow.file, onBent('elbow'))
    const makeSide = (bone: Bone): Side => {
      const poly = bone.mirror ? mirrorPolygon(FOREARM_POLY, CX) : FOREARM_POLY, split = splitMesh(pp, bone.arm, poly, (x, y, sample, own) => { const rx = bone.mirror ? 2 * CX - x : x, cape = paintCapeCorner(rx, y, sample(bone.mirror ? 2 * CX - 800 : 800, 696)); return cape ?? (isStaticUpper(rx, y, own, (sx, sy) => sample(bone.mirror ? 2 * CX - sx : sx, sy)) ? 'erase' : null) }, (x, y) => isSleeveLining(bone.mirror ? 2 * CX - x : x, y)), mesh = pp.meshes[bone.arm] as PartsPlayer['meshes'][number]
      const upperTexture = addTexture(pp, split.outside), foreTexture = addTexture(pp, split.inside)
      const unmirror = (a: ArmPose): ArmPose => bone.mirror ? { ...a, up: -a.up, fo: -a.fo, ha: -a.ha, elbowTo: a.elbowTo ? mirrorX(a.elbowTo) : undefined } : a
      const bentWeightOf = () => { const a = armOf(bone); return separatedPose(a) && bentLoaded() ? bentWeight(a.fo) : 0 }
      const bentQuad = (art: typeof BENT_ART.fore | typeof BENT_ART.elbow, texture: number, place: (a: ArmPose, c: Vec) => Vec) => { const quad = addQuad(pp, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), texture), corners = artCorners(art); synth.set(quad.index, { base: bone.arm, pointer: quad.pointer, opacity: bentWeightOf, write(out) { const a = armOf(bone), [dx, dy] = swayOf(bone.arm); corners.forEach((c, i) => { const q = place(a, c); out[2 * i] = q[0] + dx; out[2 * i + 1] = q[1] + dy }) } }); return quad.index }
      const bentFore = bentQuad(BENT_ART.fore, bentForeTexture, (a, c) => placeBentFore(bone, a, c)), bentElbow = bentQuad(BENT_ART.elbow, bentElbowTexture, (a, c) => { const { elbow } = solveArm(bone, unmirror(a)); return placeBent(elbow, sub(bone.S, elbow), bentSide(bone, a), c) })
      const xs = poly.map(c => c[0]), ys = poly.map(c => c[1]), corners: Vec[] = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]]
      const fore = addQuad(pp, new Float32Array(corners.flatMap(c => split.rectUv(c[0], c[1]))), foreTexture)
      synth.set(fore.index, { base: bone.arm, pointer: fore.pointer, opacity: () => separatedPose(armOf(bone)) && bentWeightOf() < 0.995 ? 1 : 0, write(out) { const [dx, dy] = swayOf(bone.arm); corners.forEach((c, i) => { const q = deformFore(bone, armOf(bone), c[0] + dx, c[1] + dy); out[2 * i] = q[0]; out[2 * i + 1] = q[1] }) } })
      const place = (v: Vec): Vec => bone.mirror ? mirrorX(v) : v, side = bone.mirror ? -1 : 1
      const fill = addQuad(pp, new Float32Array(bone.mirror ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1]), fillTexture)
      synth.set(fill.index, { base: bone.arm, pointer: fill.pointer, opacity: () => separatedPose(armOf(bone)) ? 1 : 0, write(out) {
        const a = armOf(bone), m = bone.mirror ? { ...a, up: -a.up, fo: -a.fo, ha: -a.ha, elbowTo: a.elbowTo ? mirrorX(a.elbowTo) : undefined } : a, [dx, dy] = swayOf(bone.arm), e = sub(solveArm(bone, m).elbow, bone.E)
        // 上腕は肩から肘へ向かう棒として張る（親子変形）。下端の丸みが肘の先になる。
        // 上端は肩の関節から肘へ向かう線の上に置く（肩の装甲の裏に隠れる）。肘がどちらへ動いても肩から生えて見える。
        const elbow = solveArm(bone, m), toUpper = norm(sub(elbow.elbow, bone.S)), toWrist = norm(sub(elbow.wrist, elbow.elbow)), axisW = smooth(0.7, 1.1, Math.abs(m.fo)), intoCuff = add(elbow.elbow, scaleV(norm([lerp(toWrist[0], toUpper[0], axisW), lerp(toWrist[1], toUpper[1], axisW)]), UPPER_ART_INTO_CUFF)), b: Vec = (() => { const rest = add(place(UPPER_ART.bottom), e), w = smooth(0.05, 0.4, Math.abs(m.fo)); return [lerp(rest[0], intoCuff[0], w), lerp(rest[1], intoCuff[1], w)] })(), inward = Math.max(0, bone.mirror ? elbow.elbow[0] - bone.E[0] : bone.E[0] - elbow.elbow[0]), t = add(bone.S, scaleV(norm(sub(b, bone.S)), lerp(UPPER_ART_REACH, UPPER_ART_REACH_INWARD, smooth(0, 50, inward)))), along = norm(sub(b, t)), across: Vec = scaleV([-along[1] * side, along[0] * side], UPPER_ART.halfWidth)
        ;[add(t, across), sub(t, across), sub(b, across), add(b, across)].forEach((c, i) => { out[2 * i] = c[0] + dx; out[2 * i + 1] = c[1] + dy })
      } })
      // 動き始めは元の上腕の絵を重ねて見せ、曲げるにつれて生成の上腕へ移す（絵の切り替わりで一瞬光らないように）。
      const stub = addShared(pp, bone.arm, split, addTexture(pp, split.erased))
      synth.set(stub, { base: bone.arm, pointer: -1, shared: bone.arm, write() {}, opacity: () => { const a = armOf(bone), moved = Math.hypot(...sub(solveArm(bone, bone.mirror ? { ...a, up: -a.up, fo: -a.fo, ha: -a.ha, elbowTo: a.elbowTo ? mirrorX(a.elbowTo) : undefined } : a).elbow, bone.E)); return separatedPose(a) ? 1 - Math.max(smooth(0.05, 0.4, Math.abs(a.fo)), smooth(4, 18, moved)) : 0 } })
      // 袖の紫の表地だけのコピー。上腕は裏地の手前、表地の裏を通る（描画順は hookCommands）。
      const outer = addShared(pp, bone.arm, split, addTexture(pp, split.front as WebGLTexture))
      synth.set(outer, { base: bone.arm, pointer: -1, shared: bone.arm, write() {}, opacity: () => separatedPose(armOf(bone)) ? 1 : 0 })
      return { bone, split, upperTexture, originalTexture: mesh.texture, originalUv: mesh.uvBuffer, fill: fill.index, fore: fore.index, stub, outer, bentFore, bentElbow, on: false }
    }
    // 体の層の、腕の裏に隠れていた下塗りの断片を消す（腕を上げると肘の下に残って見える）。
    const smear = (mirror: boolean): number => {
      const box: Polygon = [[711, 743], [762, 743], [762, 795], [711, 795]], tanBox: Polygon = [[688, 750], [711, 750], [711, 795], [695, 795]]
      // 肩の袖の裏に隠れていた胴の横の下塗り（横に引き伸ばした色の帯）。袖を持ち上げると四角いにじみとして見え、消すと背景が透けるので、髪の暗色で塗る。
      const side: Polygon = [[696, 610], [725, 610], [729, 750], [674, 750], [683, 678], [696, 640]]
      const m = (poly: Polygon) => mirror ? mirrorPolygon(poly, CX) : poly
      return eraseAtlas(pp, BODY, m(box), () => false) + eraseAtlas(pp, BODY, m(tanBox), (r, _g, b) => r <= b + 10) + eraseAtlas(pp, BODY, m(side), () => false, (_x, y) => { const t = smooth(610, 750, y); return [lerp(38, 48, t), lerp(35, 54, t), lerp(50, 78, t)] })
    }
    const erased = smear(false) + smear(true)
    const right = makeSide(RIGHT), left = makeSide(LEFT)
    const cuffSplit = splitMesh(pp, RIGHT.hand, CUFF_POLY), cuffTexture = addTexture(pp, cuffSplit.inside), cuff = addShared(pp, RIGHT.hand, cuffSplit, cuffTexture)
    synth.set(cuff, { base: RIGHT.hand, pointer: -1, shared: RIGHT.hand, write() {}, opacity: () => handArt().w > 0.001 ? 1 : 0 })
    const art: Partial<Record<HandArt, number>> = {}
    for (const kind of Object.keys(ART) as HandArt[]) {
      const spec = ART[kind], local = ([x, y]: Vec) => rot(scaleV(sub([x, y], spec.anchor), spec.scale), spec.tilt), hold = spec.hold.fo + spec.hold.ha
      const corners = ([[0, 0], [spec.w, 0], [spec.w, spec.h], [0, spec.h]] as Vec[]).map(c => add(RIGHT.W, rot(scaleV(local(c), 1 / spec.hold.haS), -hold)))
      const quad = addQuad(pp, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), later(spec.file, () => { artLoaded[kind] = true }))
      art[kind] = quad.index
      synth.set(quad.index, { base: RIGHT.hand, pointer: quad.pointer, opacity: () => { const h = handArt(); return h.kind === kind ? smooth(0.1, 0.6, h.w) : 0 }, write(out) { const [dx, dy] = swayOf(RIGHT.hand); corners.forEach((c, i) => { const q = deformHand(RIGHT, pose.right, c[0] + dx, c[1] + dy); out[2 * i] = q[0]; out[2 * i + 1] = q[1] }) } })
    }
    // 制止の 1 枚腕（back/front は同じ絵の同じ位置）。2 枚とも読めたときだけ使い、読めなければ従来の制止の腕のまま。
    const haltMark = { back: false, front: false }
    // 挨拶も同じ絵を使い肘から先だけ曲げるため、4 頂点ではなく格子にする（wave=0 なら制止の 4 頂点と同じ写像）。
    { const [x0, y0, w, h] = HALT_ARM.box
      for (const layer of ['back', 'front'] as const) {
        const grid = addGrid(pp, 14, 14, later(HALT_ARM[layer], () => { haltMark[layer] = true; haltLoaded = haltMark.back && haltMark.front }))
        const points: Vec[] = grid.uv.map(([u, v]) => [x0 + u * w, y0 + v * h])
        haltQuads[layer] = grid.index
        synth.set(grid.index, { base: RIGHT.arm, pointer: grid.pointer, count: points.length, opacity: () => haltOn() ? 1 : 0, write(out) { const [dx, dy] = swayOf(RIGHT.arm), angle = haltArmAngle(haltTime, haltOut), wave = greetSet ? greetWave(greetTime, haltOut) : waveFrom * (1 - ease(Math.min(1, waveDecay / SWITCH_SECONDS))); points.forEach((c, i) => { const q = greetArmPoint(c, angle, wave); out[2 * i] = q[0] + dx; out[2 * i + 1] = q[1] + dy }) } })
      } }
    // 照れの 1 枚腕。2 枚とも読めたときだけ使い、読めなければ従来の照れの腕のまま。
    const shyMark = { back: false, front: false }
    { const [x0, y0, w, h] = SHY_ARM.box, corners: Vec[] = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]
      for (const layer of ['back', 'front'] as const) {
        const quad = addQuad(pp, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), later(SHY_ARM[layer], () => { shyMark[layer] = true; shyLoaded = shyMark.back && shyMark.front }))
        shyQuads[layer] = quad.index
        synth.set(quad.index, { base: RIGHT.arm, pointer: quad.pointer, opacity: () => shyOn() ? 1 : 0, write(out) { const [dx, dy] = swayOf(RIGHT.arm), m = shyArmMotion(haltTime, haltOut); corners.forEach((c, i) => { const q = shyArmPoint(c, m); out[2 * i] = q[0] + dx; out[2 * i + 1] = q[1] + dy }) } })
      } }
    // 案内の 1 枚腕。2 枚とも読めたときだけ使い、読めなければ従来の案内の腕のまま。
    const guideMark = { back: false, front: false }
    { const [x0, y0, w, h] = GUIDE_ARM.box, corners: Vec[] = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]
      for (const layer of ['back', 'front'] as const) {
        const quad = addQuad(pp, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), later(GUIDE_ARM[layer], () => { guideMark[layer] = true; guideLoaded = guideMark.back && guideMark.front }))
        guideQuads[layer] = quad.index
        synth.set(quad.index, { base: RIGHT.arm, pointer: quad.pointer, opacity: () => guideOn() ? 1 : 0, write(out) { const [dx, dy] = swayOf(RIGHT.arm), m = guideArmMotion(haltTime, haltOut); corners.forEach((c, i) => { const q = guideArmPoint(c, m); out[2 * i] = q[0] + dx; out[2 * i + 1] = q[1] + dy }) } })
      } }
    for (const [m, side] of [[RIGHT.arm, 'right'], [RIGHT.hand, 'right'], [LEFT.arm, 'left'], [LEFT.hand, 'left']] as const) {
      const g = addGhost(pp, m); ghosts.set(m, { ...g, side })
      synth.set(g.index, { base: m, pointer: g.pointer, ghost: true, opacity: () => ghostFor(side), write() {} }) // 頂点は apply が変形前の値を写す
    }
    if (cp.commandCapacity != null) { alloc.p2l_dealloc(cp.commandsPointer, cp.commandCapacity * 4 + 4); cp.commandCapacity += 30; cp.commandsPointer = alloc.p2l_alloc(cp.commandCapacity * 4 + 4) }
    parts = { right, left, art, cuff }
    partsStatus = { ready: true, textures: 'loading', erased }
    Promise.all(loads).then(() => { partsStatus = { ready: true, textures: 'loaded', erased } }).catch(e => { partsStatus = { ready: true, textures: 'failed', error: e instanceof Error ? e.message : String(e) } })
  } catch (e) { parts = null; partsStatus = { ready: false, error: e instanceof Error ? e.message : String(e) } }
  const applySeparate = (side: Side, armPose: ArmPose) => {
    const on = separatedPose(armPose); if (on === side.on) return
    side.on = on
    const mesh = (p.meshes[side.bone.arm] as PartsPlayer['meshes'][number])
    mesh.texture = on ? side.upperTexture : side.originalTexture
    mesh.uvBuffer = on ? side.split.uvBuffer : side.originalUv
  }
  const frontMeshes = (): number[] => [pose.right.front && armBlend > 0.3 ? RIGHT.hand : -1, pose.left.front && armBlend > 0.3 ? LEFT.hand : -1].filter(i => i >= 0)

  const apply = (mesh: number, pointer: number, count: number) => {
    const v = new Float32Array(rt.memory.buffer, pointer, count * 2)
    if (!rests.has(mesh)) rests.set(mesh, v.slice())
    const rest = rests.get(mesh) as Float32Array
    // 虹彩の現在の中心を使い、視線やまばたきの変形に追従させる。
    let irisX = 0, irisY = 0
    if (mesh === 11 || mesh === 14) for (let i = 0; i < count; i++) { irisX += v[2 * i] as number; irisY += v[2 * i + 1] as number }
    if (count) { irisX /= count; irisY /= count }
    const ghost = ghosts.get(mesh); if (ghost) new Float32Array(rt.memory.buffer, ghost.pointer, count * 2).set(v)
    if (mesh === RIGHT.arm || mesh === LEFT.arm || mesh === RIGHT.hand) { let dx = 0, dy = 0; for (let i = 0; i < count; i++) { dx += (v[2 * i] as number) - (rest[2 * i] as number); dy += (v[2 * i + 1] as number) - (rest[2 * i + 1] as number) } sway.set(mesh, count ? [dx / count, dy / count] : [0, 0]) }
    for (let i = 0; i < count; i++) {
      const x = v[2 * i] as number, y = v[2 * i + 1] as number, rx = rest[2 * i] as number, ry = rest[2 * i + 1] as number
      let out: Vec = [x, y]
      if (armBlend > 0.001 && (mesh === RIGHT.arm || mesh === LEFT.arm)) { const b = mesh === RIGHT.arm ? RIGHT : LEFT; const armPose = mesh === RIGHT.arm ? pose.right : pose.left; if (parts && (b === RIGHT ? parts.right.on : parts.left.on)) out = deformSleeve(b, sleeveAngle(b, armPose), x, y, rx, ry); else { const d = deformArm(b, armPose, x, y, rx, ry); out = [lerp(x, d[0], armBlend), lerp(y, d[1], armBlend)] } }
      else if (armBlend > 0.001 && (mesh === RIGHT.hand || mesh === LEFT.hand)) { const b = mesh === RIGHT.hand ? RIGHT : LEFT; const d = deformHand(b, mesh === RIGHT.hand ? pose.right : pose.left, x, y); out = [lerp(x, d[0], armBlend), lerp(y, d[1], armBlend)] }
      else if (mesh === BROW) { const outer = Math.min(1, Math.abs(rx - CX) / 75); out = [x, y + (face.browY + lerp(face.browInner, face.browOuter, smooth(0.15, 0.95, outer))) * browPin(outer)] }
      else if (mesh === MOUTH) { const u = Math.min(1, Math.abs(rx - MOUTH_C[0]) / 30); out = [MOUTH_C[0] + (x - MOUTH_C[0]) * (speaking ? lerp(face.mouthWidth, 1, surprised) : face.mouthWidth) * visemeWidth, y + face.mouthCorner * (speaking ? 1 - surprised : 1) * (u * u - 0.35)] }
      else if (EYES.has(mesh)) { const c = rx < CX ? EYE_L : EYE_R; const scale = mesh === 11 || mesh === 14 ? irisScale(surprised) : 1; const ix = irisX + (x - irisX) * scale, iy = irisY + (y - irisY) * scale; out = [c[0] + (ix - c[0]) * face.eyeSX, c[1] + (iy - c[1]) * face.eyeSY] }
      v[2 * i] = out[0]; v[2 * i + 1] = out[1]
    }
  }
  const hookVertices = (rig: number, mesh: number): number => {
    const extra = synth.get(mesh)
    if (extra) {
      if (extra.shared != null) return hookVertices(rig, extra.shared)
      hookVertices(rig, extra.base)
      if (done.get(mesh) !== generation) { extra.write(new Float32Array(rt.memory.buffer, extra.pointer, (extra.count ?? 4) * 2)); done.set(mesh, generation) }
      return extra.pointer
    }
    const pointer = rt.p2l_mesh_vertices(rig, mesh)
    if ((mesh === BROW || mesh === MOUTH || EYES.has(mesh) || mesh === RIGHT.arm || mesh === LEFT.arm || mesh === RIGHT.hand || mesh === LEFT.hand) && done.get(mesh) !== generation) {
      apply(mesh, pointer, (p.meshes[mesh] as { vertices: number }).vertices); done.set(mesh, generation)
    }
    return pointer
  }
  const hookCommands = (rig: number, pointer: number, capacity: number) => {
    const count = rt.p2l_render_commands(rig, pointer, capacity), front = frontMeshes(), art = handArt(), artMesh = parts && art.kind && art.w > 0.001 ? parts.art[art.kind] : undefined
    const expand = (c: number): number[] => {
      // 制止の 1 枚腕: 元の上腕・小手・手は描かず、腕全体を袖の表地の裏に、同じ絵の肘から先を表地の手前に重ねる。
      if (parts && haltOn() && c === RIGHT.arm && parts.right.on) return [c, haltQuads.back as number, parts.right.outer, haltQuads.front as number]
      if (parts && haltOn() && c === RIGHT.hand) return []
      // 照れの 1 枚腕: 腕全体を袖の表地の裏に置き、肘から先は口元を隠すため描画の最後（顔の手前）に足す。
      if (parts && shyOn() && c === RIGHT.arm && parts.right.on) return [c, shyQuads.back as number, parts.right.outer]
      if (parts && shyOn() && c === RIGHT.hand) return []
      // 案内の 1 枚腕: 制止と同じく腕全体を袖の表地の裏に、同じ絵の肘から先を表地の手前に重ねる。
      if (parts && guideOn() && c === RIGHT.arm && parts.right.on) return [c, guideQuads.back as number, parts.right.outer, guideQuads.front as number]
      if (parts && guideOn() && c === RIGHT.hand) return []
      if (parts && c === RIGHT.arm && parts.right.on) return [parts.right.stub, c, parts.right.fill, parts.right.bentElbow, parts.right.outer, parts.right.fore, parts.right.bentFore]
      if (parts && c === LEFT.arm && parts.left.on) return [parts.left.stub, c, parts.left.fill, parts.left.bentElbow, parts.left.outer, parts.left.fore, parts.left.bentFore]
      if (parts && c === RIGHT.hand && artMesh != null) return [c, artMesh, parts.cuff]
      if (chest && c === BODY && chestShown()) return [c, chest.index]
      return [c]
    }
    if (!front.length && !parts?.right.on && !parts?.left.on && artMesh == null && !sw && !chestShown()) return count
    const list = Array.from(new Int32Array(rt.memory.buffer, pointer, Math.min(count, capacity)))
    // 切替中の待機の腕は元の位置（描画順）に置き、切替先の腕はその手前に重ねる。
    const ghostAt = (c: number): number[] => { const g = ghosts.get(c); return g && ghostFor(g.side) > 0.001 ? [g.index] : [] }
    const out = [...list.flatMap(c => [...ghostAt(c), ...(front.includes(c) ? [] : expand(c))]), ...front.filter(m => list.includes(m)).flatMap(expand), ...(parts && shyOn() && parts.right.on ? [shyQuads.front as number] : [])].slice(0, capacity)
    new Int32Array(rt.memory.buffer, pointer, out.length).set(out)
    return out.length
  }
  // BOXP-521: 胸の揺れ。体の層の胸の範囲に同じ絵の細かい格子を重ね、体の動きから遅れるばねの変位だけ動かす（chest.ts）。
  // 変位が無いときは格子を描かない（静止時の描画は従来と画素一致）。作れない環境では何もしない。
  const spring = createChestSpring()
  let chestEnabled = true, chest: { index: number; count: number; anchor: NonNullable<Bind> } | null = null, chestStatus: Record<string, unknown> = { ready: false }
  const chestShown = () => !!chest && chestEnabled && Math.hypot(...spring.offset) > 0.02
  try {
    const body = p.meshes[BODY] as { vertices: number; uvs: Float32Array; indices: Uint16Array | Uint32Array; texture: number; blend?: number; alphaBlend?: number; culling?: boolean; masks?: number[]; invertMask?: boolean }
    const verts = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(p.rig, BODY), body.vertices * 2).slice()
    const grid = chestGrid(verts, body.indices), anchor = bindPoint([(BUST.left[0] + BUST.right[0]) / 2, BUST.left[1]], verts, body.indices)
    if (!anchor || grid.triangles.length < 100) throw new Error(`胸の格子を体の層に重ねられません (${grid.triangles.length / 3} 三角形)`)
    const count = grid.points.length, uvs = new Float32Array(count * 2)
    grid.binds.forEach((b, i) => { if (b) { uvs[2 * i] = atBind(b, body.uvs, 0); uvs[2 * i + 1] = atBind(b, body.uvs, 1) } })
    const pp = p as unknown as PartsPlayer, alloc = rt as unknown as { p2l_alloc(n: number): number }, pointer = alloc.p2l_alloc(count * 8), uvBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer()
    const indices = new (pp.indexType === gl.UNSIGNED_SHORT ? Uint16Array : Uint32Array)(grid.triangles)
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    pp.meshes.push({ vertices: count, uvs, indices, texture: body.texture, uvBuffer, indexBuffer, blend: body.blend ?? 0, alphaBlend: body.alphaBlend ?? 0, culling: body.culling ?? false, fixed: true, masks: body.masks ?? [], invertMask: body.invertMask ?? false })
    const index = pp.meshes.length - 1
    synth.set(index, { base: BODY, pointer, count, opacity: () => chestShown() ? 1 : 0, write(out) {
      const v = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(p.rig, BODY), body.vertices * 2), [ox, oy] = spring.offset
      grid.binds.forEach((b, i) => { if (!b) return; const w = grid.weights[i] as number; out[2 * i] = atBind(b, v, 0) + ox * w; out[2 * i + 1] = atBind(b, v, 1) + oy * w })
    } })
    chest = { index, count, anchor }
    chestStatus = { ready: true, bodyVertices: body.vertices, gridPoints: count, triangles: grid.triangles.length / 3 }
  } catch (e) { chestStatus = { ready: false, error: e instanceof Error ? e.message : String(e) } }
  const stepChestSpring = (dt: number) => {
    if (!chest) return
    const v = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(p.rig, BODY), (p.meshes[BODY] as { vertices: number }).vertices * 2)
    stepChest(spring, [atBind(chest.anchor, v, 0), atBind(chest.anchor, v, 1)], dt, chestEnabled)
  }
  const hookOpacity = (rig: number, mesh: number) => {
    const extra = synth.get(mesh)
    if (extra) return extra.opacity() * rt.p2l_mesh_opacity(rig, extra.base) * (extra.ghost ? 1 : posedFor(sideOf(extra.base)))
    const base = rt.p2l_mesh_opacity(rig, mesh) * posedFor(sideOf(mesh))
    return mesh === RIGHT.hand && parts ? base * (1 - smooth(0.35, 0.85, handArt().w)) : base
  }
  const hookColors = (rig: number, mesh: number, a: number, b: number) => rt.p2l_mesh_colors(rig, synth.get(mesh)?.base ?? mesh, a, b)
  p.rt = Object.create(rt, { p2l_mesh_vertices: { value: hookVertices }, p2l_render_commands: { value: hookCommands }, p2l_mesh_opacity: { value: hookOpacity }, p2l_mesh_colors: { value: hookColors } }) as Runtime
  const baseUpdate = p.update.bind(p)
  p.update = (dt: number) => {
    generation++
    if (greetSet) greetTime += dt; else waveDecay += dt
    if (haltSet || shySet || guideSet) { haltTime += dt; if (sw?.phase === 'out') haltOut = Math.min(1, (sw.t + dt) / SWITCH_SECONDS) }
    if (sw) {
      sw.t += dt
      const x = Math.min(1, sw.t / SWITCH_SECONDS)
      posedAlpha = sw.phase === 'in' ? ease(x) : 1 - ease(x)
      if (x >= 1) {
        const ended = sw; sw = null; posedAlpha = 1
        if (ended.phase === 'out') { haltSet = false; shySet = false; guideSet = false; greetSet = false; haltOut = 0; frozen = null; switched = false; pose = { right: REST, left: REST, body: NO_BODY }; armBlend = 0 }
        ended.then?.()
      }
    }
    if (clip) { clipTime += dt; if (clipTime >= clip.duration) { if (switched) { switchOut() } else { clip = null; clipName = 'none'; startFade() } } }
    const raw = clip ? sample(clip, clipTime) : null
    const hold = clip && SWITCHED[clipName as Exclude<Gesture, 'none'>]
    const sampled = raw && hold ? { ...raw, right: hold } : raw
    const goal = frozen ?? sampled ?? (fadeFrom ? { right: REST, left: REST, body: NO_BODY } : null)
    let shown = goal
    if (goal && fadeFrom) {
      fadeTime += dt
      if (fadeTime >= fadeSeconds) fadeFrom = null
      else shown = crossfadeArms(fadeFrom, goal, fadeTime / fadeSeconds)
    }
    const k = 1 - Math.exp(-dt * 7)
    // 母音の口幅は約 40ms で追従させ、閉口時も急に戻らないようにする。
    visemeWidth = lerp(visemeWidth, visemeWant, 1 - Math.exp(-dt * 25))
    for (const key of Object.keys(face) as (keyof Face)[]) if (typeof face[key] === 'number' && typeof target[key] === 'number') (face[key] as number) = lerp(face[key] as number, target[key] as number, k)
    if (shown) pose = shown
    armBlend = shown ? 1 : 0
    applyCut(RIGHT, pose.right); applyCut(LEFT, pose.left)
    if (parts) { applySeparate(parts.right, pose.right); applySeparate(parts.left, pose.left) }
    for (const key of Object.keys(NO_BODY) as (keyof BodyPose)[]) {
      const want = (sampled?.body[key] ?? 0) + (target.head[key] ?? 0) + (key === 'headX' || key === 'headY' || key === 'headZ' ? petOffset[key] : 0)
      headCurrent[key] = lerp(headCurrent[key], want, k)
      p.setParameter(PARAMS[key], headCurrent[key])
    }
    blush = lerp(blush, emotion === 'shy' ? 1 : 0, k)
    const wasClosed = Math.max(eyeClosed, petClosed)
    eyeClosed = lerp(eyeClosed, closedEyeTarget(emotion), k)
    petClosed = petEyeStep(petClosed, petEyes, dt)
    surprised = lerp(surprised, emotionWeight(emotion, 'surprised', 1), k)
    troubled = lerp(troubled, emotionWeight(emotion, 'troubled', 1), k)
    ;(facePatch.setBlush as ((amount: number, wet: number) => void) | undefined)?.(blush, troubled)
    p.setParameter('ParamMouthForm', face.mouth)
    const updateMouth = !speaking && (surprised > 0.001 || mouthOverride)
    if (updateMouth) p.lipSync(surprised > 0.001 ? 0.28 * surprised : 0)
    mouthOverride = !speaking && surprised > 0.001
    // BOXP-525: 待機クリップ停止中も前フレームの閉眼値を引きずらず、まばたきを再評価する。
    if (Math.max(wasClosed, eyeClosed, petClosed) > 0.001) {
      p.setParameter('ParamEyeLOpen', 1); p.setParameter('ParamEyeROpen', 1)
    }
    baseUpdate(dt)
    // BOXP-525: 自動まばたきの途中でも目が逆に開かないよう閉眼を重ねる。
    const closed = Math.max(eyeClosed, petClosed)
    if (closed > 0.001) {
      const values = typeof p.parameterValues === 'function' ? p.parameterValues() : []
      for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
        const index = p.parameters?.indexOf(id) ?? -1, blink = values[index]
        p.setParameter(id, typeof blink === 'number' && Number.isFinite(blink) ? eyeOpenFor(blink, eyeClosed, petClosed) : 1 - closed)
      }
      rt.p2l_update_stages(p.rig, 0, 0)
    }
    stepChestSpring(dt)
  }
  // 今の腕を待機の腕へフェードで戻す（姿勢は止めたまま）。then はフェード後に呼ぶ。
  function switchOut(then?: () => void) {
    if (sw?.phase === 'out') { sw.then = then; return }
    frozen = { right: pose.right, left: pose.left, body: pose.body }
    fadeSides = { right: armBlend > 0.001 && posed(pose.right), left: armBlend > 0.001 && posed(pose.left) }
    clip = null; clipName = 'none'; fadeFrom = null
    sw = { phase: 'out', t: 0, then }
  }
  // 待機の腕から、切替先の腕セットへフェードで差し替える。
  function switchIn(next: Exclude<Gesture, 'none'>) {
    clip = clips[next]; clipName = next; clipTime = 0; fadeFrom = null; frozen = null; switched = true; armBlend = 1
    pose = { ...sample(clip, 0), right: SWITCHED[next] as ArmPose }
    fadeSides = { right: true, left: false }
    sw = { phase: 'in', t: 0 }; posedAlpha = 0; haltSet = next === 'halt' || next === 'greet'; greetSet = next === 'greet'; greetTime = 0; waveFrom = 0; waveDecay = 1; shySet = next === 'shyHand'; guideSet = next === 'guide'; haltTime = 0; haltOut = 0
  }
  const atRest = () => !sw && !fadeFrom && (armBlend < 0.001 || !posed(pose.right) && !posed(pose.left))
  return {
    setViseme(v) { speaking = v !== null; visemeWant = v ? Math.max(0.78, Math.min(1.15, v.width)) : 1 },
    setPetOffset(v) { petOffset = v },
    setPetEyes(on) { petEyes = on },
    setChestMotion(on) { chestEnabled = on },
    setEmotion(next) { emotion = next; target = faces[next]; player.expression(target.expression && player.expressions.includes(target.expression) ? target.expression : null) },
    playGesture(next) {
      if (next === 'none') return
      if (SWITCHED[next] || switched || sw) {
        const start = () => { if (SWITCHED[next]) switchIn(next); else { clip = clips[next]; clipName = next; clipTime = 0; fadeFrom = null; armBlend = 1 } }
        if (sw?.phase === 'out') { sw.then = start; return }
        if (switched && clipName === next) { clipTime = Math.min(clipTime, 0.6); return } // 同じ切替動作の再要求は保持を延ばすだけ
        // 制止⇄挨拶⇄案内は同じ 1 枚腕なので、腕を消さずにそのまま次の動作へ移る（上げた腕を下ろして出し直さない）。
        if (switched && SAME_ARM.has(clipName) && SAME_ARM.has(next)) {
          if (next === 'greet') { greetSet = true; greetTime = 0 } else { waveFrom = greetSet ? greetWave(greetTime, haltOut) : 0; waveDecay = 0; greetSet = false }
          clip = clips[next]; clipName = next; clipTime = 0; return
        }
        if (SWITCHED[next] && atRest()) { switchIn(next); return }
        if (switched || SWITCHED[next] || sw) { switchOut(start); return }
      }
      // 前の動作の途中や解除後の戻りの途中でも、その時点の腕の見た目から次の動作へつなぐ。
      const plan = interruptPlan(pose, clips[next])
      startFade(fadeFor(clips[next], plan.from, plan.at), plan.from)
      clip = clips[next]; clipName = next; clipTime = plan.at; armBlend = 1
    },
    reset() { emotion = 'neutral'; target = faces.neutral; player.expression(null); if (switched || sw) { switchOut(); return } if (clip) startFade(); clip = null; clipName = 'none' },
    report: () => ({ supported: true, petEyes: petClosed, chest: { ...chestStatus, enabled: chestEnabled, shown: chestShown(), offset: [...spring.offset], anchor: spring.anchor }, parts: partsStatus, facePatch, emotion, gesture: clipName, armBlend, armSwitch: sw ? { phase: sw.phase, t: sw.t, posedAlpha } : null, switched, haltSet: haltOn(), greetSet: greetSet && haltOn(), guideSet: guideOn(), shySet: shyOn(), clipTime, face: { browY: face.browY, browInner: face.browInner, eyeSY: face.eyeSY, mouthCorner: face.mouthCorner } }),
  }
}
