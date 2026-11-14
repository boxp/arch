// コハコの家の場面（BOXP-499 設計 3.1/3.5）。AI に配置を任せず、状態から決まった表で選ぶ。
import type { State } from '../studio/model'
export type Scene = 'relax' | 'talk' | 'show' | 'work' | 'confirm' | 'offline'
export const scenes: readonly Scene[] = ['relax', 'talk', 'show', 'work', 'confirm', 'offline']
export const WORK_AFTER_MS = 8000,
  IDLE_RELAX_MS = 60_000,
  MIN_SWITCH_MS = 1500
export type SceneInput = {
  state: State
  thinkingMs: number
  cardsOpen: boolean
  idleMs: number
  hasReply: boolean
  netDown: boolean
}
/** いまの状態に合う場面。承認・切断は最優先。 */
export function targetScene(x: SceneInput): Scene {
  if (x.state === 'approval') return 'confirm'
  if (x.netDown || x.state === 'offline' || x.state === 'failed') return 'offline'
  if (x.state === 'thinking' || x.state === 'listening')
    return x.state === 'thinking' && x.thinkingMs > WORK_AFTER_MS ? 'work' : 'talk'
  if (x.cardsOpen) return 'show'
  if (x.state === 'speaking') return 'talk'
  return x.hasReply && x.idleMs < IDLE_RELAX_MS ? 'talk' : 'relax'
}
export const urgent = (s: Scene) => s === 'confirm' || s === 'offline'
/** 場面の切替を間引く係。かくにん・つながらないへの出入りは即時、それ以外は 1.5 秒に 1 回まで・操作中は保留・固定中は止める。 */
export class SceneDirector {
  scene: Scene
  last = -Infinity
  constructor(initial: Scene = 'offline') {
    this.scene = initial
  }
  decide(target: Scene, now: number, opts: { holding: boolean; pinned: boolean; force?: boolean }): Scene {
    if (target === this.scene) return this.scene
    const forced = !!opts.force || urgent(target) || urgent(this.scene)
    if (!forced && (opts.pinned || opts.holding || now - this.last < MIN_SWITCH_MS)) return this.scene
    this.scene = target
    this.last = now
    return this.scene
  }
}

export function messageShown({ scene, touch, notice }: { scene: string; touch: boolean; notice: boolean }): boolean {
  return scene !== 'relax' || touch || notice
}
