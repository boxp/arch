// ふれあい（頭をなでる・手をタップ）の判定と頻度制御（BOXP-499 設計 5）。端末内だけで完結し、通信・記憶・数値の保存をしない。
import type { Emotion, Gesture } from '../live2d/acting'
export type Point = { x: number; y: number; time: number }
export type Zone = 'head' | 'hand'
export type TouchKind = 'tap' | 'pat'
/** 指の軌跡を tap / pat / 対象外 に分ける。長押し・縦の大きな移動は対象外。 */
export function classifyTouch(points: readonly Point[], zone: Zone): TouchKind | null {
  if (!points.length) return null
  const first = points[0], last = points[points.length - 1], duration = last.time - first.time
  const dx = Math.max(...points.map(p => Math.abs(p.x - first.x))), dy = Math.max(...points.map(p => Math.abs(p.y - first.y)))
  if (dy >= 40 && dy > dx) return null
  if (duration < 300 && dx < 10 && dy < 10) return 'tap'
  if (zone !== 'head' || duration < 400) return null
  let previous = 0, reversals = 0
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].x - points[i - 1].x, direction = Math.abs(delta) >= 3 ? Math.sign(delta) : 0
    if (direction && previous && direction !== previous) reversals++
    if (direction) previous = direction
  }
  return reversals >= 2 && dx >= 12 ? 'pat' : null
}
export type Reaction = 'patSmile' | 'patShy' | 'nod' | 'smile' | 'highFive' | 'wave' | 'tickle' | 'quiet'
export const acts: Record<Reaction, { emotion: Emotion; gesture: Gesture; subtleGesture: Gesture }> = {
  patSmile: { emotion: 'smile', gesture: 'nod', subtleGesture: 'nod' }, patShy: { emotion: 'shy', gesture: 'shyHand', subtleGesture: 'none' },
  nod: { emotion: 'smile', gesture: 'nod', subtleGesture: 'nod' }, smile: { emotion: 'smile', gesture: 'none', subtleGesture: 'none' },
  highFive: { emotion: 'smile', gesture: 'greet', subtleGesture: 'nod' }, wave: { emotion: 'smile', gesture: 'joy', subtleGesture: 'nod' },
  tickle: { emotion: 'troubled', gesture: 'tilt', subtleGesture: 'none' }, quiet: { emotion: 'smile', gesture: 'none', subtleGesture: 'none' },
}
// 口調の最低参照: 一人称「わたし」、boxp を「ご主人さま」、柔らかい丁寧なです・ます。台詞は仮。
export const phrases: Partial<Record<Reaction, string>> = {
  patSmile: 'えへへ…ありがとうございます、ご主人さま。', patShy: 'そんなになでられると、照れてしまいます…',
  nod: 'はい、わたしはここにいますよ、ご主人さま。', highFive: 'はい、ハイタッチです！', wave: 'ご主人さまの手、あたたかいです。',
  tickle: 'くすぐったいです…', smile: 'なにかお手伝いできることはありますか？',
}
export const LINE_EVERY_MS = 20_000, BURST_WINDOW_MS = 30_000, BURST_LIMIT = 6, SUBDUED_MS = 60_000, CONTINUE_PAT_MS = 10_000
/** 反応の選び方と頻度の制御。状態はメモリにだけ置き、保存しない。 */
export class TouchLimiter {
  private times: number[] = []; private lastLine = -Infinity; private subduedUntil = -Infinity; private last: Reaction | null = null; private lastPat = -Infinity
  react(kind: TouchKind, zone: Zone, now: number, opts: { lines: boolean; quietOnly: boolean }): { reaction: Reaction; line: string | null } {
    this.times = this.times.filter(t => now - t < BURST_WINDOW_MS); this.times.push(now)
    if (opts.quietOnly) return this.finish('quiet', null)
    if (now < this.subduedUntil) return this.finish('quiet', null)
    if (this.times.length > BURST_LIMIT) { this.subduedUntil = now + SUBDUED_MS; return this.finish('tickle', opts.lines ? phrases.tickle! : null, now) }
    let reaction: Reaction = zone === 'hand' ? 'highFive' : kind === 'pat' ? (now - this.lastPat < CONTINUE_PAT_MS ? 'patShy' : 'patSmile') : 'nod'
    if (kind === 'pat') this.lastPat = now
    if (reaction === this.last) reaction = ({ patSmile: 'patShy', patShy: 'patSmile', nod: 'smile', highFive: 'wave' } as Partial<Record<Reaction, Reaction>>)[reaction] ?? reaction
    const line = opts.lines && now - this.lastLine >= LINE_EVERY_MS ? phrases[reaction] ?? null : null
    return this.finish(reaction, line, line ? now : undefined)
  }
  subdued(now: number) { return now < this.subduedUntil }
  private finish(reaction: Reaction, line: string | null, lineAt?: number) { if (lineAt !== undefined && line) this.lastLine = lineAt; this.last = reaction; return { reaction, line } }
}
export type Rect = { x: number; y: number; w: number; h: number }
export type Layout = { scale: number; left: number; top: number }
/** モデル座標の範囲（[minX,minY,maxX,maxY]）を、キャンバス左上基準の CSS px の矩形へ。指で 44px 以上になるよう広げる。 */
export function toScreenRect(box: readonly [number, number, number, number], layout: Layout, margin = 8, min = 44): Rect {
  let x = box[0] * layout.scale + layout.left - margin, y = box[1] * layout.scale + layout.top - margin
  let w = (box[2] - box[0]) * layout.scale + margin * 2, h = (box[3] - box[1]) * layout.scale + margin * 2
  if (w < min) { x -= (min - w) / 2; w = min }
  if (h < min) { y -= (min - h) / 2; h = min }
  return { x, y, w, h }
}
export function bboxOf(vertices: ArrayLike<number>, into?: [number, number, number, number]): [number, number, number, number] {
  const b: [number, number, number, number] = into ?? [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 1 < vertices.length; i += 2) { const x = vertices[i], y = vertices[i + 1]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y }
  return b
}
export const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
/** 頭は前髪・顔、手は手袋だけ（腕・胴・顔の部品には判定を置かない）。 */
export const HEAD_MESHES = ['ArtMeshFrontHair', 'ArtMeshFrontHairL', 'ArtMeshFrontHairR', 'ArtMeshFace'], HAND_MESHES = ['ArtMeshHandwearL', 'ArtMeshHandwearR']
