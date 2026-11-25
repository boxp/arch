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
  /** storage: 試行の記録を保存できなかった（仕様「倒す向き」1）。 */
  ended?: 'turns' | 'deadline' | 'failures' | 'storage'
}
/** 指定を付けた発言の結果。cancelled（本人の停止など）と unknown（未確認・送る前の失敗）は失敗に数えない。 */
export type Outcome = 'done' | 'failed' | 'cancelled' | 'unknown'
/**
 * 会話から見た試行。どの操作も、試行の記録の保存が終わってから解決する（呼ぶ側は、解決を待ってから外へ作用する）。
 * 保存に失敗した時は、試行そのものが終わる（以後 take は指定を返さない）。drop・settle・reconcile は保存できたかを返すが、
 * 呼ぶ側は false でも止まらない（本人の停止や結果の表示を、試行の記録のために止めない）。
 * take: 回数 +1 と数える資格の追加。保存に失敗したら指定を返さない。
 * drop: 数える資格を外す（本人の停止依頼・なでる反応の自動拒否）。資格を入れる前に呼ばれても、後から資格は入らない。
 * settle: 資格が残っている時だけ結果を数え、資格を外す。
 * reconcile: 再起動の時に 1 度呼ぶ。資格が残っているのに会話が追跡しない発言を、失敗として数えて外す。
 */
export type ModelTrial = {
  id: string
  take(requestId: string): Promise<ModelRoute | undefined>
  drop(requestId: string): Promise<boolean>
  settle(requestId: string, outcome: Outcome): Promise<boolean>
  reconcile(tracked: string[]): Promise<boolean>
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
  write = atomic,
  load: read = (path: string) => load<unknown>(path, null),
}: {
  config: ModelTrialConfig
  now: () => number
  store?: string
  log?: (line: string) => void
  /** 記録の書き込みと読み取り（テストで保存の失敗を起こすために差し替える）。 */
  write?: (path: string, value: unknown) => Promise<void>
  load?: (path: string) => Promise<unknown>
}) {
  const fresh = (): TrialState => ({ id: config.id, turns: 0, failures: 0 })
  // 回数・失敗の回数・終了と、数える資格のある発言の一覧（open）を 1 つの記録として、1 回の書き込みで保存する。
  let state = fresh(),
    open: string[] = [],
    queue: Promise<boolean> = Promise.resolve(true),
    // 直前の書き込みが失敗していて、メモリの状態がまだ保存されていない。
    dirty = false
  // 資格を外した・数え終えた番号。後から資格を入れない（このプロセスの間だけ。再起動後の発言は take を通らない）。
  const closed = new Set<string>()
  // 再起動の時点で資格の一覧に残っていた番号。成功でも失敗の回数を 0 に戻さない。
  const carried = new Set<string>()
  const path = store ? join(store, 'model-trial.json') : undefined
  const set = (next: TrialState) => {
    const endedNow = next.ended && !state.ended
    state = next
    if (endedNow) log(`kohako_model_trial ended id=${state.id} reason=${state.ended} turns=${state.turns}`)
  }
  /**
   * メモリの状態はすぐに変え、その時点の全体を順番に保存する。返す Promise は、その保存が成功したかで解決する。
   * 書き込みに失敗したら試行を終える（倒す向き 1）。失敗の後は、変更が無い呼び出しでも書き込みをやり直す。
   */
  const update = (next: TrialState, nextOpen: string[]): Promise<boolean> => {
    if (next === state && nextOpen === open && !dirty) return queue.then(() => true)
    set(next)
    open = nextOpen
    if (!path) return Promise.resolve(true)
    queue = queue.then(() =>
      // 書き込む直前の全体を保存する（前の書き込みの失敗で付いた終了も含める）。
      write(path, { ...state, open: [...open] }).then(
        () => {
          dirty = false
          return true
        },
        (e) => {
          console.error('model trial save failed', e instanceof Error ? e.message : 'unknown')
          dirty = true
          if (!state.ended) set({ ...state, ended: 'storage' })
          return false
        },
      ),
    )
    return queue
  }
  const without = (requestId: string) => (open.includes(requestId) ? open.filter((x) => x !== requestId) : open)
  const close = (requestId: string) => {
    closed.add(requestId)
    if (closed.size > 400) closed.delete(must(closed.values().next().value))
  }
  const count = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
  return {
    id: config.id,
    async restore() {
      if (!path) return
      const saved = (await read(path)) as (Partial<TrialState> & { open?: unknown }) | null
      // 別の名前の記録・壊れた記録は使わず 0 から数える（資格の一覧も引き継がない）。
      if (
        !saved ||
        typeof saved !== 'object' ||
        saved.id !== config.id ||
        !count(saved.turns) ||
        !count(saved.failures)
      )
        return
      const ended = (['turns', 'deadline', 'failures', 'storage'] as const).find((x) => x === saved.ended)
      state = { id: config.id, turns: saved.turns, failures: saved.failures, ...(ended ? { ended } : {}) }
      open = Array.isArray(saved.open) ? saved.open.filter((x): x is string => typeof x === 'string').slice(-100) : []
      for (const id of open) carried.add(id)
    },
    async take(requestId: string): Promise<ModelRoute | undefined> {
      const taken = takeTurn(config, state, now())
      if (taken.route) log(`kohako_model_trial turn id=${config.id} turn=${taken.state.turns}/${config.maxTurns}`)
      // 先に資格を外された番号（送る準備の間の停止依頼）には、資格を入れない。
      const eligible = taken.route && !closed.has(requestId)
      const saved = await update(taken.state, eligible ? [...without(requestId), requestId] : open)
      if (saved) return taken.route
      // 保存できなければ指定を付けない（保存された回数より多く、指定を付けた run を送らない）。指定の無い run の結果は数えない。
      close(requestId)
      open = without(requestId)
      return undefined
    },
    drop(requestId: string) {
      close(requestId)
      return update(state, without(requestId))
    },
    settle(requestId: string, outcome: Outcome) {
      close(requestId)
      // 資格が無ければ数えない（+1 もしないし、0 にも戻さない）。
      if (!open.includes(requestId)) return update(state, open)
      // 再起動をまたいだ発言の成功では 0 に戻さない（倒す向き 3）。
      const counted = outcome === 'done' && carried.has(requestId) ? 'unknown' : outcome
      return update(settleTurn(state, counted, now()), without(requestId))
    },
    reconcile(tracked: string[]) {
      // 資格が残っているのに会話が追跡しない発言は、結果を確かめられないので失敗として数える（倒す向き 4）。
      let next = state
      const lost = open.filter((id) => !tracked.includes(id))
      for (const id of lost) {
        close(id)
        next = settleTurn(next, 'failed', now())
      }
      return update(next, lost.length ? open.filter((id) => tracked.includes(id)) : open)
    },
    state: (): TrialState => ({ ...state }),
    open: (): string[] => [...open],
    flush: async () => {
      await queue
    },
  }
}
function must<T>(value: T | undefined): T {
  if (value === undefined) throw Error('missing value')
  return value
}
