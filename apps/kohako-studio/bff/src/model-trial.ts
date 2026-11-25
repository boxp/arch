// BOXP-706: 家の会話の run にだけ、回数と期限つきで別のモデルを指定する。
// 仕様: Obsidian vault の Projects/kohako-home/model-trial-spec.md（spec_feature: kohako-home-model-trial）。
import { join } from 'node:path'
import { atomic, load } from './storage.js'

export type ModelTrialConfig = { id: string; provider: string; model: string; until: number; maxTurns: number }
export type ModelRoute = { provider: string; model: string }
export type TrialState = {
  id: string
  turns: number
  /** 指定を付けた発言が続けて失敗した回数。 */
  failures: number
  ended?: 'turns' | 'deadline' | 'failures'
}
/** 指定を付けた発言の結果。cancelled（本人の停止など）と unknown（未確認・送る前の失敗）は失敗に数えない。 */
export type Outcome = 'done' | 'failed' | 'cancelled' | 'unknown'
/**
 * 会話から見た試行。どの操作も、試行の記録の保存が終わってから解決する（呼ぶ側は、解決を待ってから外へ作用する）。
 * take: 回数 +1 と数える資格の追加。保存に失敗したら指定を返さない。
 * drop: 数える資格を外す（本人の停止依頼・なでる反応の自動拒否）。
 * settle: 資格が残っている時だけ結果を数え、資格を外す。
 */
export type ModelTrial = {
  id: string
  take(requestId: string): Promise<ModelRoute | undefined>
  drop(requestId: string): Promise<void>
  settle(requestId: string, outcome: Outcome): Promise<void>
}

const MAX_FAILURES = 2

/** 未設定・空は試行なし。形が正しくなければ起動させない。期限が過ぎているだけの設定は受け付ける（終了扱いになる）。 */
export function parseModelTrial(raw: string | undefined): ModelTrialConfig | undefined {
  if (!raw) return undefined
  const invalid = Error('invalid model trial configuration')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw invalid
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid
  const { id, provider, model, until, maxTurns } = value as Record<string, unknown>
  const name = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(x)
  if (!name(id) || !name(provider) || !name(model)) throw invalid
  if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(until)) throw invalid
  const deadline = Date.parse(until)
  if (!Number.isFinite(deadline)) throw invalid
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw invalid
  return { id, provider, model, until: deadline, maxTurns }
}

/** 発言を 1 つ送る時の判定。終了は戻らない。上限の発言までは指定を付け、期限以降の発言には付けない。 */
export function takeTurn(
  config: ModelTrialConfig,
  state: TrialState,
  now: number,
): { state: TrialState; route?: ModelRoute } {
  if (state.ended) return { state }
  if (now >= config.until) return { state: { ...state, ended: 'deadline' } }
  if (state.turns >= config.maxTurns) return { state: { ...state, ended: 'turns' } }
  const turns = state.turns + 1
  return {
    state: { ...state, turns, ...(turns >= config.maxTurns ? { ended: 'turns' as const } : {}) },
    route: { provider: config.provider, model: config.model },
  }
}

/** 指定を付けた発言の結果を反映する。続けて 2 回失敗したら終了。先に付いた終了の理由は変えない。 */
export function settleTurn(state: TrialState, outcome: Outcome, _now: number): TrialState {
  if (outcome === 'done') return state.failures === 0 ? state : { ...state, failures: 0 }
  if (outcome !== 'failed') return state
  const failures = state.failures + 1
  return { ...state, failures, ...(failures >= MAX_FAILURES && !state.ended ? { ended: 'failures' as const } : {}) }
}

export function createModelTrial({
  config,
  now,
  store,
  log = (line: string) => console.info(line),
}: {
  config: ModelTrialConfig
  now: () => number
  store?: string
  log?: (line: string) => void
}) {
  const fresh = (): TrialState => ({ id: config.id, turns: 0, failures: 0 })
  // 回数・失敗の回数・終了と、数える資格のある発言の一覧（open）を 1 つの記録として、1 回の書き込みで保存する。
  let state = fresh(),
    open: string[] = [],
    queue: Promise<boolean> = Promise.resolve(true)
  const path = store ? join(store, 'model-trial.json') : undefined
  /** メモリの状態はすぐに変え、その時点の全体を順番に保存する。返す Promise は、その保存が成功したかで解決する。 */
  const update = (next: TrialState, nextOpen: string[]): Promise<boolean> => {
    if (next === state && nextOpen === open) return queue
    const endedNow = next.ended && !state.ended
    state = next
    open = nextOpen
    if (endedNow) log(`kohako_model_trial ended id=${state.id} reason=${state.ended} turns=${state.turns}`)
    if (!path) return queue
    const snapshot = { ...state, open: [...open] }
    queue = queue.then(() =>
      atomic(path, snapshot).then(
        () => true,
        (e) => {
          console.error('model trial save failed', e instanceof Error ? e.message : 'unknown')
          return false
        },
      ),
    )
    return queue
  }
  const without = (requestId: string) => (open.includes(requestId) ? open.filter((x) => x !== requestId) : open)
  const count = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
  return {
    id: config.id,
    async restore() {
      if (!path) return
      const saved = await load<(Partial<TrialState> & { open?: unknown }) | null>(path, null)
      // 別の名前の記録・壊れた記録は使わず 0 から数える（資格の一覧も引き継がない）。
      if (!saved || saved.id !== config.id || !count(saved.turns) || !count(saved.failures)) return
      const ended =
        saved.ended === 'turns' || saved.ended === 'deadline' || saved.ended === 'failures' ? saved.ended : undefined
      state = { id: config.id, turns: saved.turns, failures: saved.failures, ...(ended ? { ended } : {}) }
      open = Array.isArray(saved.open) ? saved.open.filter((x): x is string => typeof x === 'string').slice(-100) : []
    },
    async take(requestId: string): Promise<ModelRoute | undefined> {
      const taken = takeTurn(config, state, now())
      if (taken.route) log(`kohako_model_trial turn id=${config.id} turn=${taken.state.turns}/${config.maxTurns}`)
      const saved = await update(taken.state, taken.route ? [...without(requestId), requestId] : open)
      // 保存できなければ指定を付けない（保存された回数より多く、指定を付けた run を送らない）。
      return saved ? taken.route : undefined
    },
    async drop(requestId: string) {
      await update(state, without(requestId))
    },
    async settle(requestId: string, outcome: Outcome) {
      // 資格が無ければ何もしない（+1 もしないし、0 にも戻さない）。
      if (!open.includes(requestId)) return
      await update(settleTurn(state, outcome, now()), without(requestId))
    },
    state: (): TrialState => ({ ...state }),
    open: (): string[] => [...open],
    flush: async () => {
      await queue
    },
  }
}
