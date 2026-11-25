// BOXP-706: 家の会話の run にだけ、回数と期限つきで別のモデルを指定する。
// 仕様: Obsidian vault の Projects/kohako-home/model-trial-spec.md（spec_feature: kohako-home-model-trial）。
// 決まりのモデル: contract/model-trial-model/（Lean。planTake・planSettle と保存の順序が対応する）。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomic } from './storage.js'

export type ModelTrialConfig = { id: string; provider: string; model: string; until: number; maxTurns: number }
export type ModelRoute = { provider: string; model: string }
/** 保存する記録（`model-trial.json`）。項目はこの 5 つだけ。 */
export type TrialRecord = {
  id: string
  /** 指定を付けて送ると決めた発言の数。 */
  turns: number
  /** 続けて失敗した回数。送る前に、その発言の分を先に 1 足しておく。 */
  streak: number
  /** 指定を付けて送り、まだ結果を数えていない発言の番号（1 つだけ）。 */
  inflight?: string
  /** storage: 起動の時、試行の記録が在るのに読めなかった（書き込みの失敗では終了しない）。 */
  ended?: 'turns' | 'deadline' | 'failures' | 'storage'
}
/** 指定を付けた発言の結果。cancelled（本人の停止・なでる反応で許可を断った）と unknown（未確認・送る前の失敗）は失敗に数えない。 */
export type Outcome = 'done' | 'failed' | 'cancelled' | 'unknown'
/**
 * 会話から見た試行。操作は 2 つだけで、どちらも 1 本の待ち行列で 1 つずつ行う。
 * take: 発言を送る前に呼ぶ。回数 +1・失敗 +1 を書けた時だけ指定を返す。
 * settle: 結果が分かった時に呼ぶ。呼ぶ側は待たなくてよい（本人の停止や結果の表示を、試行の記録のために止めない）。
 */
export type ModelTrial = {
  id: string
  take(requestId: string): Promise<ModelRoute | undefined>
  settle(requestId: string, outcome: Outcome): Promise<boolean>
}

const MAX_STREAK = 2
const ENDED = ['turns', 'deadline', 'failures', 'storage'] as const

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

/**
 * 発言を 1 つ送る時の決まり。終了は戻らない。上限の発言までは指定を付け、期限以降の発言には付けない。
 * 指定を付ける時は、回数 +1 と失敗 +1（先に足す分）と inflight を同じ記録に入れる。呼ぶ側は、これを書けた時だけ指定を付ける。
 * 前の発言の inflight が残っていても（結果を数えられなかった）、その 1 は失敗として残したまま置き換える。
 */
export function planTake(
  config: ModelTrialConfig,
  record: TrialRecord,
  requestId: string,
  now: number,
): { next: TrialRecord; route?: ModelRoute } {
  if (record.ended) return { next: record }
  if (now >= config.until) return { next: { ...record, ended: 'deadline' } }
  if (record.turns >= config.maxTurns) return { next: { ...record, ended: 'turns' } }
  if (record.streak >= MAX_STREAK) return { next: { ...record, ended: 'failures' } }
  const turns = record.turns + 1
  return {
    next: {
      id: record.id,
      turns,
      streak: record.streak + 1,
      inflight: requestId,
      ...(turns >= config.maxTurns ? { ended: 'turns' as const } : {}),
    },
    route: { provider: config.provider, model: config.model },
  }
}

/**
 * 結果が分かった時の決まり。番号が inflight と同じ時だけ記録を変える。
 * 失敗: 先に足した 1 をそのまま残す（2 以上なら終了）。成功: 0 に戻す。止めた・不明: 先に足した 1 を返す。
 * carried（再起動をまたいだ発言）: 成功でも 0 に戻さず 1 を返すだけ。不明は失敗と同じに扱う。
 */
export function planSettle(record: TrialRecord, requestId: string, outcome: Outcome, carried: boolean): TrialRecord {
  if (record.inflight !== requestId) return record
  const { inflight: _, ...rest } = record
  if (outcome === 'failed' || (outcome === 'unknown' && carried))
    return rest.streak >= MAX_STREAK && !rest.ended ? { ...rest, ended: 'failures' } : rest
  if (outcome === 'done' && !carried) return { ...rest, streak: 0 }
  return { ...rest, streak: Math.max(0, rest.streak - 1) }
}

/** 記録のファイルを読む。無ければ undefined。在るのに読めない時は投げる。 */
async function readRecord(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
  return JSON.parse(text) as unknown
}

const count = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
/** 保存された記録の形を確かめる。形が合わなければ undefined。 */
function parseRecord(value: unknown): TrialRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { id, turns, streak, inflight, ended } = value as Record<string, unknown>
  if (typeof id !== 'string' || !count(turns) || !count(streak)) return undefined
  if (inflight !== undefined && (typeof inflight !== 'string' || !inflight || inflight.length > 200)) return undefined
  const reason = ENDED.find((x) => x === ended)
  if (ended !== undefined && !reason) return undefined
  return { id, turns, streak, ...(inflight ? { inflight } : {}), ...(reason ? { ended: reason } : {}) }
}
const same = (a: TrialRecord, b: TrialRecord) =>
  a.id === b.id && a.turns === b.turns && a.streak === b.streak && a.inflight === b.inflight && a.ended === b.ended

export function createModelTrial({
  config,
  now,
  store,
  log = (line: string) => console.info(line),
  write = atomic,
  read = readRecord,
  writeTimeoutMs = 5000,
}: {
  config: ModelTrialConfig
  now: () => number
  /** 記録の保存先（必須。保存先が無ければ試行を始めない）。 */
  store: string
  log?: (line: string) => void
  /** 記録の書き込みと読み取り（テストで保存の失敗を起こすために差し替える）。read は、無ければ undefined、読めなければ投げる。 */
  /** keep: 置き換える直前に呼び、false なら置き換えない（打ち切った書き込みを捨てる）。 */
  write?: (path: string, value: unknown, keep?: () => boolean) => Promise<void>
  read?: (path: string) => Promise<unknown>
  /** 書き込みをこの時間で打ち切り、失敗として扱う（発言を送るのを、止まった書き込みで待たせ続けない）。 */
  writeTimeoutMs?: number
}) {
  const path = join(store, 'model-trial.json')
  // メモリの記録は、いつも保存済みの記録と同じ（書けた時だけ反映する）。だから再起動しても、しなかった時と同じ記録から続く。
  // 例外は、起動の時に記録を読めなかった時の終了・保存だけ（再起動しても同じく読めず、同じ終了になる）。
  let state: TrialRecord = { id: config.id, turns: 0, streak: 0 },
    // 記録のファイルがメモリと違うかもしれない（読めなかった・打ち切った書き込みが後から届いた）。次の書き込みで必ず書き直す。
    dirty = false,
    // 起動の時に記録に残っていた inflight（再起動をまたいだ発言）。
    carried: string | undefined,
    queue: Promise<unknown> = Promise.resolve(),
    // 打ち切ったのに、まだ終わっていない書き込みがある（その間は次の書き込みを始めない）。
    stale = false
  const end = (reason: NonNullable<TrialRecord['ended']>) => {
    if (state.ended) return
    state = { ...state, ended: reason }
    log(`kohako_model_trial ended id=${state.id} reason=${reason} turns=${state.turns}`)
  }
  /**
   * 記録を書く。書き込みは同時に 1 つだけ。時間で打ち切った書き込みは捨てる（keep が false になり、既定の書き込みはファイルを置き換えない）。
   * それでも終わるまでは stale のままにし、終わったら今のメモリの記録を書き直す（打ち切った内容が後から届いても、ファイルをメモリと同じに戻す）。
   */
  const save = (next: TrialRecord) =>
    new Promise<void>((resolve, reject) => {
      if (stale) return reject(Error('earlier write still running'))
      let abandoned = false
      const timer = setTimeout(() => {
        abandoned = stale = dirty = true
        reject(Error('write timeout'))
      }, writeTimeoutMs)
      Promise.resolve()
        .then(() => write(path, next, () => !abandoned))
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer)
          if (!abandoned) return
          stale = false
          void serial(() => commit(state))
        })
    })
  /**
   * 次の記録を書き、書けた時だけメモリへ反映する。書けなければ、メモリの記録も前のまま（その出来事は記録の上で起きなかった）。
   * 試行は終了しない: メモリだけの終了を作ると、それを書けないまま再起動した時に動きが変わってしまう。
   */
  const commit = async (next: TrialRecord): Promise<boolean> => {
    if (same(next, state) && !dirty) return true
    try {
      await save(next)
    } catch (e) {
      console.error('model trial save failed', e instanceof Error ? e.message : 'unknown')
      return false
    }
    const endedNow = next.ended && !state.ended
    state = next
    dirty = false
    if (endedNow) log(`kohako_model_trial ended id=${state.id} reason=${state.ended} turns=${state.turns}`)
    return true
  }
  /** 操作を 1 つずつ行う。前の操作（書き込みを含む）が終わるまで、次の操作は記録を見ない。 */
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op)
    queue = run.catch(() => undefined)
    return run
  }
  return {
    id: config.id,
    /** 起動の時に 1 度呼ぶ。ファイルが無い・id が違う時だけ 0 から数え、在るのに読めない・形が合わない時は終了にする。 */
    async restore() {
      let value: unknown
      try {
        value = await read(path)
      } catch (e) {
        console.error('model trial load failed', e instanceof Error ? e.message : 'unknown')
        dirty = true
        end('storage')
        return
      }
      if (value === undefined) return
      const saved = parseRecord(value)
      if (!saved) {
        console.error('model trial load failed', 'invalid record')
        dirty = true
        end('storage')
        return
      }
      if (saved.id !== config.id) return
      state = saved
      carried = saved.inflight
    },
    take(requestId: string): Promise<ModelRoute | undefined> {
      return serial(async () => {
        const { next, route } = planTake(config, state, requestId, now())
        // 書けなければ指定を付けない（保存された回数より多く、指定を付けた run を送らない）。
        if (!(await commit(next)) || !route) return undefined
        log(`kohako_model_trial turn id=${config.id} turn=${next.turns}/${config.maxTurns}`)
        return route
      })
    },
    settle(requestId: string, outcome: Outcome): Promise<boolean> {
      return serial(() => commit(planSettle(state, requestId, outcome, carried === requestId)))
    },
    state: (): TrialRecord => ({ ...state }),
    flush: async () => {
      await queue
    },
  }
}
