// BOXP-706: 家の会話だけで別のモデルを期限つきで試す。
// 期待値は仕様 Projects/kohako-home/model-trial-spec.md（設定・付ける発言・状態と終わり方・例 1〜6）から取る。
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { readConfig } from './config.js'
import { createConversation } from './conversation.js'
import { createHermes } from './hermes.js'
import {
  createModelTrial,
  type Outcome,
  parseModelTrial,
  settleTurn,
  takeTurn,
  type TrialState,
} from './model-trial.js'

const at = (hhmm: string) => Date.parse(`2026-11-26T${hhmm}:00Z`)
const config = { id: 't1', provider: 'openai-codex', model: 'gpt-6.2-sol', until: at('12:00'), maxTurns: 3 }
const route = { provider: 'openai-codex', model: 'gpt-6.2-sol' }
const fresh: TrialState = { id: 't1', turns: 0, failures: 0 }

/** 仕様の例の書き方: 時刻と結果の並びを流し、発言ごとに指定が付いたかを返す。 */
function play(steps: [string, Outcome?][], state = fresh) {
  const routed: boolean[] = []
  for (const [time, outcome] of steps) {
    const taken = takeTurn(config, state, at(time))
    state = taken.state
    routed.push(!!taken.route)
    if (taken.route) expect(taken.route).toEqual(route)
    if (taken.route && outcome) state = settleTurn(state, outcome, at(time))
  }
  return { routed, state }
}

it('設定の例を読み取り、未設定・空は試行なしにする', () => {
  expect(
    parseModelTrial(
      '{"id":"BOXP-706-m1","provider":"openai-codex","model":"gpt-6.2-sol","until":"2026-11-28T00:00:00Z","maxTurns":30}',
    ),
  ).toEqual({
    id: 'BOXP-706-m1',
    provider: 'openai-codex',
    model: 'gpt-6.2-sol',
    until: Date.parse('2026-11-28T00:00:00Z'),
    maxTurns: 30,
  })
  expect(parseModelTrial(undefined)).toBeUndefined()
  expect(parseModelTrial('')).toBeUndefined()
})
it.each([
  ['JSON でない', 'gpt-6.2-sol'],
  ['配列', '[]'],
  ['id が無い', '{"provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":30}'],
  ['id に空白', '{"id":"a b","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":30}'],
  ['provider が無い', '{"id":"a","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":30}'],
  ['model に改行', '{"id":"a","provider":"openai-codex","model":"m\\nx","until":"2026-11-28T00:00:00Z","maxTurns":30}'],
  ['until に Z が無い', '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00","maxTurns":30}'],
  ['until が日付でない', '{"id":"a","provider":"openai-codex","model":"m","until":"tomorrowZ","maxTurns":30}'],
  ['maxTurns が 0', '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":0}'],
  ['maxTurns が 101', '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":101}'],
  ['maxTurns が小数', '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":1.5}'],
  [
    'maxTurns が文字',
    '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":"30"}',
  ],
])('形が正しくない設定（%s）では起動しない', (_name, raw) => {
  expect(() => parseModelTrial(raw)).toThrow('invalid model trial configuration')
  expect(() => readConfig({ KOHAKO_MODEL_TRIAL: raw })).toThrow('invalid model trial configuration')
})
it('上限 1 と 100 は受け付け、期限が過ぎているだけの設定は読み取れる', () => {
  const raw = (n: number) =>
    `{"id":"a","provider":"openai-codex","model":"m","until":"2020-01-01T00:00:00Z","maxTurns":${n}}`
  expect(parseModelTrial(raw(1))?.maxTurns).toBe(1)
  expect(parseModelTrial(raw(100))?.maxTurns).toBe(100)
  expect(readConfig({ KOHAKO_MODEL_TRIAL: raw(30), KOHAKO_DATA_DIR: '/data' }).modelTrial?.until).toBe(
    Date.parse('2020-01-01T00:00:00Z'),
  )
  expect(readConfig({}).modelTrial).toBeUndefined()
})
it('試行の設定があるのに保存先（KOHAKO_DATA_DIR）が無ければ起動しない', () => {
  // 仕様「設定」: メモリだけで数えると、再起動のたびに回数と失敗の回数が消え、上限を超えて指定が続く。
  const raw = '{"id":"a","provider":"openai-codex","model":"m","until":"2026-11-28T00:00:00Z","maxTurns":30}'
  expect(() => readConfig({ KOHAKO_MODEL_TRIAL: raw })).toThrow('invalid model trial configuration')
  expect(() => readConfig({ KOHAKO_MODEL_TRIAL: raw, KOHAKO_DATA_DIR: '' })).toThrow(
    'invalid model trial configuration',
  )
  expect(readConfig({ KOHAKO_MODEL_TRIAL: raw, KOHAKO_DATA_DIR: '/data' }).modelTrial?.maxTurns).toBe(30)
  expect(readConfig({ KOHAKO_DATA_DIR: '/data' }).modelTrial).toBeUndefined()
})

it('例1: 上限の発言までは付け、その次から付けない（終了・回数）', () => {
  const { routed, state } = play([
    ['10:00', 'done'],
    ['10:05', 'done'],
    ['10:10', 'done'],
    ['10:15', 'done'],
  ])
  expect(routed).toEqual([true, true, true, false])
  expect(state).toMatchObject({ turns: 3, ended: 'turns' })
})
it('例2: 期限ちょうどの発言から付けない（終了・期限）。期限の直前は付ける', () => {
  const { routed, state } = play([
    ['10:00', 'done'],
    ['12:00', 'done'],
  ])
  expect(routed).toEqual([true, false])
  expect(state).toMatchObject({ turns: 1, ended: 'deadline' })
  expect(takeTurn(config, fresh, at('12:00') - 1).route).toEqual(route)
})
it('例3: 指定を付けた発言が 2 回続けて失敗したら終了（終了・失敗）', () => {
  const { routed, state } = play([
    ['10:00', 'failed'],
    ['10:05', 'failed'],
    ['10:10', 'done'],
  ])
  expect(routed).toEqual([true, true, false])
  expect(state).toMatchObject({ turns: 2, ended: 'failures' })
})
it('例4: 間に成功があれば失敗は数え直す。止めた・不明は失敗に数えず、数えた失敗も消さない', () => {
  expect(
    play([
      ['10:00', 'failed'],
      ['10:05', 'done'],
      ['10:10', 'failed'],
    ]).state,
  ).toMatchObject({ turns: 3, failures: 1 })
  const skipped = play([
    ['10:00', 'failed'],
    ['10:05', 'cancelled'],
    ['10:06', 'unknown'],
  ])
  expect(skipped.state.failures).toBe(1)
  expect(skipped.state.ended).toBe('turns')
  expect(settleTurn(skipped.state, 'failed', at('10:07')).ended).toBe('turns')
})
it('終了は戻らない: 長さ 5 までの出来事の並びを全て試す', () => {
  // 出来事 = 発言（時刻は期限の前か後）と、その結果 4 種。4×2 = 8 通りを 5 段まで（8^5 = 32768 列）。
  const outcomes: Outcome[] = ['done', 'failed', 'cancelled', 'unknown']
  const events = outcomes.flatMap((o) => [
    { time: at('10:00'), o },
    { time: at('13:00'), o },
  ])
  let sequences = 0
  const walk = (state: TrialState, depth: number, routedSoFar: number, consecutive: number, ended: boolean) => {
    if (depth === 5) {
      sequences++
      return
    }
    for (const e of events) {
      const taken = takeTurn(config, state, e.time)
      // 終了後は付けない。回数は上限を超えない。期限の後は付けない。
      if (ended) expect(taken.route).toBeUndefined()
      if (e.time >= config.until) expect(taken.route).toBeUndefined()
      const routed = routedSoFar + (taken.route ? 1 : 0)
      expect(routed).toBeLessThanOrEqual(config.maxTurns)
      expect(taken.state.turns).toBe(routed)
      let next = taken.state,
        run = consecutive
      if (taken.route) {
        next = settleTurn(next, e.o, e.time)
        run = e.o === 'failed' ? consecutive + 1 : e.o === 'done' ? 0 : consecutive
        // 続けて 2 回失敗したら必ず終了している。
        if (run >= 2) expect(next.ended).toBeDefined()
      }
      // 一度付いた終了の理由は変わらない。
      if (state.ended) expect(next.ended).toBe(state.ended)
      walk(next, depth + 1, routed, run, !!next.ended)
    }
  }
  walk(fresh, 0, 0, 0, false)
  expect(sequences).toBe(8 ** 5)
})

function hermesFake(results: ({ status: 'done'; text: string } | { status: 'failed'; error: string })[] = []) {
  const runs: { session: string; route: unknown; attempt: unknown }[] = []
  const hermes = {
    run: vi.fn(async (...args: unknown[]) => {
      runs.push({ session: args[2] as string, attempt: args[5], route: args[8] })
      return results.shift() ?? { status: 'done', text: 'ok' }
    }),
    watch: vi.fn(),
    stop: vi.fn(async () => 'ok'),
    approve: vi.fn(async () => 'ok'),
  } as unknown as ReturnType<typeof createHermes>
  return { hermes, runs }
}
const text = (requestId: string, extra: object = {}) => ({
  requestId,
  kind: 'text' as const,
  text: 'こんにちは',
  expiresAt: 1e15,
  ...extra,
})
async function settled(conv: ReturnType<typeof createConversation>, input: Parameters<typeof conv.submit>[0]) {
  const entry = conv.submit(input, '')
  if ('error' in entry) throw Error(entry.error)
  await entry.settled
  return entry
}

it('例1・5: 家の会話にだけ付け、現場・通知返信・検証用の会話には付けず、回数も増やさない', async () => {
  let now = at('10:00')
  const trial = createModelTrial({ config, now: () => now })
  const f = hermesFake()
  const owner = createConversation({ now: () => now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: trial }),
    verifier = createConversation({ now: () => now, hermes: f.hermes, prefix: 'kohako-verify' })
  await settled(owner, text('request-visit-1', { visit: true }))
  const reply = owner.submit(text('request-reply-1'), '', undefined, { sessionId: 'notif-1', idempotencyKey: 'k1' })
  if ('error' in reply) throw Error(reply.error)
  await reply.settled
  await settled(verifier, text('request-verify-1'))
  expect(f.runs.map((r) => r.route)).toEqual([undefined, undefined, undefined])
  expect(trial.state()).toMatchObject({ turns: 0 })
  await settled(owner, text('request-home-1'))
  await settled(owner, text('request-home-2', { origin: 'g2' }))
  await settled(owner, {
    requestId: 'request-home-3',
    kind: 'touch',
    touch: { zone: 'head', action: 'pat', count: 1 },
    expiresAt: 1e15,
  })
  now = at('10:15')
  await settled(owner, text('request-home-4'))
  expect(f.runs.slice(3).map((r) => r.route)).toEqual([route, route, route, undefined])
  expect(trial.state()).toMatchObject({ turns: 3, ended: 'turns' })
})
it('同じ発言の受け直しでは回数を増やさず、別 session での送り直しは同じ指定のまま 1 回と数える', async () => {
  const trial = createModelTrial({ config, now: () => at('10:00') })
  const f = hermesFake([
    { status: 'failed', error: 'unknown_execution' },
    { status: 'done', text: 'ok' },
  ])
  const owner = createConversation({
    now: () => at('10:00'),
    hermes: f.hermes,
    prefix: 'kohako-web',
    modelTrial: trial,
  })
  await settled(owner, text('request-home-1'))
  expect(f.runs.map((r) => [r.route, r.attempt])).toEqual([
    [route, undefined],
    [route, 1],
  ])
  expect(f.runs[0].session).not.toBe(f.runs[1].session)
  owner.submit(text('request-home-1'), '')
  expect(f.runs).toHaveLength(2)
  expect(trial.state()).toMatchObject({ turns: 1, failures: 0 })
})
it('例3: 家の会話で 2 回続けて失敗したら、次の発言から付けない。送る前の失敗と本人の停止は数えない', async () => {
  const cfg = { ...config, maxTurns: 10 }
  const trial = createModelTrial({ config: cfg, now: () => at('10:00') })
  const f = hermesFake([
    { status: 'failed', error: 'toolsets_open' },
    { status: 'failed', error: 'hermes_unavailable' },
    { status: 'failed', error: '400' },
    { status: 'done', text: 'ok' },
    { status: 'failed', error: 'failed' },
    { status: 'failed', error: '400' },
  ])
  const owner = createConversation({
    now: () => at('10:00'),
    hermes: f.hermes,
    prefix: 'kohako-web',
    modelTrial: trial,
  })
  for (let i = 1; i <= 4; i++) await settled(owner, text(`request-home-${i}`))
  expect(trial.state()).toMatchObject({ turns: 4, failures: 0 })
  await settled(owner, text('request-home-5'))
  expect(trial.state()).toMatchObject({ turns: 5, failures: 1 })
  await settled(owner, text('request-home-6'))
  expect(trial.state()).toMatchObject({ turns: 6, ended: 'failures' })
  await settled(owner, text('request-home-7'))
  expect(f.runs.map((r) => !!r.route)).toEqual([true, true, true, true, true, true, false])
})
it('本人が止めた発言は失敗に数えない', async () => {
  const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00') })
  let finish: (r: { status: 'failed'; error: string }) => void = () => {}
  const hermes = {
    run: (...args: unknown[]) => {
      ;(args[6] as (id: string) => void)('run1')
      return new Promise((r) => {
        finish = r
      })
    },
    stop: async () => {
      finish({ status: 'failed', error: 'cancelled' })
      return 'ok'
    },
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
  const owner = createConversation({
    now: () => at('10:00'),
    hermes,
    prefix: 'kohako-web',
    modelTrial: trial,
    cancelSettleMs: 20,
  })
  for (const id of ['request-home-1', 'request-home-2']) {
    const entry = owner.submit(text(id), '')
    if ('error' in entry) throw Error(entry.error)
    // run が始まってから止める（始まる前の停止は例13 で確かめる）。
    await vi.waitFor(() => expect(entry.runId).toBe('run1'))
    await owner.cancel(id)
    await entry.settled
  }
  expect(trial.state()).toMatchObject({ turns: 2, failures: 0 })
  expect(trial.state().ended).toBeUndefined()
})
it('なでる反応で許可を断った発言は、Hermes が成功を返しても数えない（前の失敗を消さない）', async () => {
  const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00') })
  const results = [
    { status: 'failed', error: '400' },
    { status: 'done', text: 'ok', approval: true },
    { status: 'failed', error: 'touch', approval: true },
    { status: 'failed', error: '400' },
  ]
  const hermes = {
    run: async (...args: unknown[]) => {
      const { approval, ...result } = results.shift() ?? { status: 'done', text: 'ok', approval: false }
      if (approval)
        (args[4] as (runId: string, a: object) => void)('run1', {
          description: 'd',
          command: 'c',
          requestId: 'a1',
          generation: 1,
        })
      return result
    },
    stop: async () => 'ok',
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
  const owner = createConversation({ now: () => at('10:00'), hermes, prefix: 'kohako-web', modelTrial: trial })
  const touch = (requestId: string) => ({
    requestId,
    kind: 'touch' as const,
    touch: { zone: 'head' as const, action: 'pat' as const, count: 1 },
    expiresAt: 1e15,
  })
  await settled(owner, text('request-home-1'))
  expect(trial.state()).toMatchObject({ turns: 1, failures: 1 })
  await settled(owner, touch('request-home-2'))
  await settled(owner, touch('request-home-3'))
  expect(trial.state()).toMatchObject({ turns: 3, failures: 1 })
  expect(trial.state().ended).toBeUndefined()
  await settled(owner, text('request-home-4'))
  expect(trial.state()).toMatchObject({ turns: 4, ended: 'failures' })
})

it('例6: 回数と終了を保存し、再起動後は続きから数える。名前を変えると 0 から数え直す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    const first = createModelTrial({ config, now: () => at('10:00'), store: dir })
    await first.restore()
    expect(await first.take('r1')).toEqual(route)
    expect(await first.take('r2')).toEqual(route)
    // take が解決した時点で保存は終わっている（flush を待たない）。
    expect(JSON.parse(await readFile(join(dir, 'model-trial.json'), 'utf8'))).toEqual({
      id: 't1',
      turns: 2,
      failures: 0,
      open: ['r1', 'r2'],
    })
    const second = createModelTrial({ config, now: () => at('10:30'), store: dir })
    await second.restore()
    expect(second.open()).toEqual(['r1', 'r2'])
    expect(await second.take('r3')).toEqual(route)
    expect(second.state()).toMatchObject({ turns: 3, ended: 'turns' })
    expect(await second.take('r4')).toBeUndefined()
    expect(second.open()).toEqual(['r1', 'r2', 'r3'])
    const third = createModelTrial({ config, now: () => at('10:40'), store: dir })
    await third.restore()
    expect(await third.take('r5')).toBeUndefined()
    const renamed = createModelTrial({ config: { ...config, id: 't2' }, now: () => at('10:50'), store: dir })
    await renamed.restore()
    expect(renamed.state()).toEqual({ id: 't2', turns: 0, failures: 0 })
    // 名前を変えた試行は、前の試行の発言の資格を引き継がない。
    expect(renamed.open()).toEqual([])
    expect(await renamed.take('r6')).toEqual(route)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('保存した内容が壊れている時は 0 から数え、付ける回数は上限を超えない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    await writeFile(join(dir, 'model-trial.json'), '{"id":"t1","turns":"many","failures":-1}')
    const trial = createModelTrial({ config, now: () => at('10:00'), store: dir })
    await trial.restore()
    expect(trial.state()).toEqual({ id: 't1', turns: 0, failures: 0 })
    const routed: boolean[] = []
    for (const i of [1, 2, 3, 4]) routed.push(!!(await trial.take(`r${i}`)))
    expect(routed).toEqual([true, true, true, false])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('発言ごとに名前・回数・上限だけを記録し、終了の理由も記録する（本文は出さない）', async () => {
  const log = vi.fn()
  const trial = createModelTrial({ config: { ...config, maxTurns: 1 }, now: () => at('10:00'), log })
  await trial.take('r1')
  await trial.take('r2')
  expect(log.mock.calls).toEqual([
    ['kohako_model_trial turn id=t1 turn=1/1'],
    ['kohako_model_trial ended id=t1 reason=turns turns=1'],
  ])
})

it('指定があれば run に provider と model だけを足し、無ければ今までと同じ本文を送る', async () => {
  const bodies: Record<string, unknown>[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/toolsets')) return Response.json({ data: [] })
    if (init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)))
      return Response.json({ run_id: 'run1' }, { status: 202 })
    }
    return Response.json({ status: 'completed', output: 'ok' })
  }) as unknown as typeof fetch
  const hermes = createHermes({ url: 'http://hermes', key: 'k'.repeat(32), fetch: fetcher })
  await hermes.run('r1', 'x', 's1', 'i', undefined, undefined, undefined, undefined, route)
  await hermes.run('r2', 'x', 's1', 'i')
  expect(bodies).toEqual([
    { input: 'x', session_id: 's1', instructions: 'i', provider: 'openai-codex', model: 'gpt-6.2-sol' },
    { input: 'x', session_id: 's1', instructions: 'i' },
  ])
})

/** run の番号を返した後、結果を返さないまま止まる Hermes（BFF が結果の前に落ちる場面）と、再起動後に結果を返す Hermes。 */
function hangingHermes(runId: string) {
  return {
    run: (...args: unknown[]) => {
      ;(args[6] as (id: string) => void)(runId)
      return new Promise(() => {})
    },
    stop: async () => 'ok',
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
}
function watchingHermes(result: { status: 'done'; text: string } | { status: 'failed'; error: string }) {
  const watch = vi.fn(async () => result)
  return {
    watch,
    hermes: { run: vi.fn(), watch, stop: async () => 'ok', approve: async () => 'ok' } as unknown as ReturnType<
      typeof createHermes
    >,
  }
}
/** 指定を付けた発言を 1 つ送り、結果が出る前に BFF が落ちた時の保存データを作る。 */
async function crashMidRun(dir: string, cfg: typeof config, requestId: string, input: object = {}) {
  const trial = createModelTrial({ config: cfg, now: () => at('10:05'), store: dir })
  await trial.restore()
  const conv = createConversation({
    now: () => at('10:05'),
    hermes: hangingHermes(`run-${requestId}`),
    prefix: 'kohako-web',
    store: dir,
    modelTrial: trial,
    sweepMs: 0,
  })
  await conv.restore()
  const entry = conv.submit(text(requestId, input), '')
  if ('error' in entry) throw Error(entry.error)
  await vi.waitFor(() => expect(entry.runId).toBe(`run-${requestId}`))
  await conv.flush()
  await trial.flush()
  return trial.state()
}
async function restart(
  dir: string,
  cfg: typeof config,
  result: { status: 'done'; text: string } | { status: 'failed'; error: string },
) {
  const trial = createModelTrial({ config: cfg, now: () => at('10:06'), store: dir })
  await trial.restore()
  const w = watchingHermes(result)
  const conv = createConversation({
    now: () => at('10:06'),
    hermes: w.hermes,
    prefix: 'kohako-web',
    store: dir,
    modelTrial: trial,
    sweepMs: 0,
    activityDrainMs: 0,
  })
  await conv.restore()
  await vi.waitFor(() => expect(conv.transcript().active).toBeNull())
  await conv.flush()
  await trial.flush()
  return { trial, conv, ...w }
}
it('例7: 結果が出る前に再起動しても、再起動後に分かった失敗を数え、続けて 2 回で終了する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    expect(await crashMidRun(dir, cfg, 'request-home-1')).toMatchObject({ turns: 1, failures: 0 })
    const first = await restart(dir, cfg, { status: 'failed', error: '400' })
    expect(first.watch).toHaveBeenCalledTimes(1)
    // 指定は付け直さず、回数も増やさない。
    expect(first.hermes.run).not.toHaveBeenCalled()
    expect(first.trial.state()).toMatchObject({ turns: 1, failures: 1 })
    expect(first.trial.state().ended).toBeUndefined()
    expect(await crashMidRun(dir, cfg, 'request-home-2')).toMatchObject({ turns: 2, failures: 1 })
    const second = await restart(dir, cfg, { status: 'failed', error: '400' })
    expect(second.trial.state()).toMatchObject({ turns: 2, failures: 2, ended: 'failures' })
    const f = hermesFake()
    const after = createConversation({
      now: () => at('10:10'),
      hermes: f.hermes,
      prefix: 'kohako-web',
      modelTrial: second.trial,
      sweepMs: 0,
    })
    await settled(after, text('request-home-3'))
    expect(f.runs.map((r) => r.route)).toEqual([undefined])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('再起動後、別の名前の試行の発言と、指定を付けていない発言（現場）の結果は数えない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    await crashMidRun(dir, cfg, 'request-home-1')
    const renamed = await restart(dir, { ...cfg, id: 't2' }, { status: 'failed', error: '400' })
    expect(renamed.watch).toHaveBeenCalledTimes(1)
    expect(renamed.trial.state()).toEqual({ id: 't2', turns: 0, failures: 0 })
    expect(await crashMidRun(dir, { ...cfg, id: 't2' }, 'request-visit-1', { visit: true })).toMatchObject({ turns: 0 })
    const visit = await restart(dir, { ...cfg, id: 't2' }, { status: 'failed', error: '400' })
    expect(visit.watch).toHaveBeenCalledTimes(1)
    expect(visit.trial.state()).toEqual({ id: 't2', turns: 0, failures: 0 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// 仕様「数える資格（1 つの印で決める）」と例 8・9: 印を消す出来事（なでる反応の自動拒否・本人の停止依頼）が起きた発言は、
// Hermes の結果が成功でも失敗でも、再起動の前でも後でも数えない。出来事 × 結果 × 再起動の有無を全て試す。
const voidCases = (['touch-deny', 'cancel'] as const).flatMap((event) =>
  (['done', 'failed'] as const).flatMap((status) =>
    ([false, true] as const).map((restarted) => ({ event, status, restarted })),
  ),
)
it.each(voidCases)(
  '印を消した発言は数えない: $event, 結果 $status, 再起動 $restarted',
  async ({ event, status, restarted }) => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
    const cfg = { ...config, maxTurns: 10 }
    const outcome = status === 'done' ? { status, text: 'ok' } : { status, error: '400' }
    const failed = { status: 'failed', error: '400' }
    const approval = { description: 'd', command: 'c', requestId: 'a1', generation: 1 }
    const second =
      event === 'touch-deny'
        ? {
            requestId: 'request-home-2',
            kind: 'touch' as const,
            touch: { zone: 'head' as const, action: 'pat' as const, count: 1 },
            expiresAt: 1e15,
          }
        : text('request-home-2')
    try {
      let calls = 0,
        finish: (r: object) => void = () => {}
      const trial = createModelTrial({ config: cfg, now: () => at('10:00'), store: dir })
      const hermes = {
        run: (...args: unknown[]) => {
          if (++calls !== 2) return Promise.resolve(failed)
          ;(args[6] as (id: string) => void)('run2')
          if (event === 'touch-deny') (args[4] as (runId: string, a: object) => void)('run2', approval)
          if (event === 'touch-deny' && !restarted) return Promise.resolve(outcome)
          return new Promise((r) => {
            finish = r
          })
        },
        stop: async () => {
          if (!restarted) finish(outcome)
          return 'ok'
        },
        approve: async () => 'ok',
      } as unknown as ReturnType<typeof createHermes>
      let conv = createConversation({
        now: () => at('10:00'),
        hermes,
        prefix: 'kohako-web',
        store: dir,
        modelTrial: trial,
        sweepMs: 0,
        activityDrainMs: 0,
        cancelSettleMs: 20,
      })
      await settled(conv, text('request-home-1'))
      expect(trial.state()).toMatchObject({ turns: 1, failures: 1 })
      const entry = conv.submit(second, '')
      if ('error' in entry) throw Error(entry.error)
      await vi.waitFor(() => expect(entry.runId).toBe('run2'))
      if (event === 'cancel') await conv.cancel('request-home-2')
      if (!restarted) await entry.settled
      await conv.flush()
      await trial.flush()
      let current = trial
      if (restarted) {
        current = createModelTrial({ config: cfg, now: () => at('10:06'), store: dir })
        await current.restore()
        conv = createConversation({
          now: () => at('10:06'),
          hermes: {
            run: async () => failed,
            watch: async () => outcome,
            stop: async () => 'ok',
            approve: async () => 'ok',
          } as unknown as ReturnType<typeof createHermes>,
          prefix: 'kohako-web',
          store: dir,
          modelTrial: current,
          sweepMs: 0,
          activityDrainMs: 0,
        })
        await conv.restore()
        const restoredConv = conv
        await vi.waitFor(() => expect(restoredConv.transcript().active).toBeNull())
        // なでる反応は transcript の active に出ないので、発言そのものの確定を待つ。
        await vi.waitFor(() => expect((restoredConv.check(second) as { status?: string })?.status).not.toBe('pending'))
      }
      expect(current.state()).toMatchObject({ turns: 2, failures: 1 })
      expect(current.state().ended).toBeUndefined()
      await settled(conv, text('request-home-3'))
      expect(current.state()).toMatchObject({ turns: 3, failures: 2, ended: 'failures' })
      await conv.flush()
      await current.flush()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
it('数える資格は試行の記録だけが持つ: 資格の無い発言は成功でも失敗でも数えず、1 度数えたら資格は消える', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00'), store: dir })
    const f = hermesFake([{ status: 'failed', error: '400' }])
    const conv = createConversation({
      now: () => at('10:00'),
      hermes: f.hermes,
      prefix: 'kohako-web',
      store: dir,
      modelTrial: trial,
      sweepMs: 0,
    })
    await settled(conv, text('request-home-1'))
    await conv.flush()
    expect(trial.state()).toMatchObject({ turns: 1, failures: 1 })
    expect(trial.open()).toEqual([])
    // 会話の保存データは試行の印を持たない。
    const saved = JSON.parse(await readFile(join(dir, 'conversations-kohako-web.json'), 'utf8'))
    expect(saved.entries.map((e: { trial?: string }) => e.trial)).toEqual([undefined])
    // 資格の無い番号（数えた後・外した後・知らない番号）は、成功でも失敗でも状態を変えない。
    await trial.settle('request-home-1', 'failed')
    await trial.settle('request-unknown', 'done')
    expect(trial.state()).toMatchObject({ turns: 1, failures: 1 })
    expect(await trial.take('request-x')).toEqual(route)
    await trial.drop('request-x')
    await trial.settle('request-x', 'failed')
    await trial.settle('request-x', 'done')
    expect(trial.state()).toMatchObject({ turns: 2, failures: 1 })
    expect(trialFile(dir)).toEqual({ id: 't1', turns: 2, failures: 1, open: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// 仕様「保存と順序」と例 10〜12: 試行の記録は 1 つのファイルで、保存が終わってから外へ作用する。
// 期待値は仕様から取る（落ちる時点ごとの保存データを作り、そこから起動し直して確かめる）。
const trialFile = (dir: string) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'model-trial.json'), 'utf8')) as TrialState & { open?: string[] }
  } catch {
    return undefined
  }
}
it.each([true, false])(
  '例10: 回数と資格を保存し終えてから指定つきの run を送る（会話の保存あり: %s）',
  async (convStore) => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
    try {
      const trial = createModelTrial({ config, now: () => at('10:00'), store: dir })
      await trial.restore()
      const seen: unknown[] = []
      const hermes = {
        run: async (...args: unknown[]) => {
          const saved = trialFile(dir)
          seen.push([!!args[8], saved?.turns, saved?.open?.includes(args[0] as string)])
          return { status: 'done', text: 'ok' }
        },
        stop: async () => 'ok',
        approve: async () => 'ok',
      } as unknown as ReturnType<typeof createHermes>
      const conv = createConversation({
        now: () => at('10:00'),
        hermes,
        prefix: 'kohako-web',
        ...(convStore ? { store: dir } : {}),
        modelTrial: trial,
        sweepMs: 0,
      })
      for (let i = 1; i <= 4; i++) await settled(conv, text(`request-home-${i}`))
      // 送る時点で、保存された回数はその発言を含み、その発言は数える資格の一覧に入っている。4 回目は指定なし。
      expect(seen).toEqual([
        [true, 1, true],
        [true, 2, true],
        [true, 3, true],
        [false, 3, false],
      ])
      await conv.flush()
      await trial.flush()
      // 例10: 3 回目の保存の後・送る前に落ちた形（回数 3 の記録だけがある）から起動すると、次の発言は指定なし。
      const again = createModelTrial({ config, now: () => at('10:20'), store: dir })
      await again.restore()
      expect(again.state()).toMatchObject({ turns: 3, ended: 'turns' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
it('回数の保存に失敗したら指定を付けずに送る（保存された回数より多く指定つきの run を送らない）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    // 保存先がファイルで、その下に記録を作れない。
    await writeFile(join(dir, 'not-a-dir'), '')
    const trial = createModelTrial({ config, now: () => at('10:00'), store: join(dir, 'not-a-dir') })
    await trial.restore().catch(() => {})
    const f = hermesFake()
    const conv = createConversation({
      now: () => at('10:00'),
      hermes: f.hermes,
      prefix: 'kohako-web',
      modelTrial: trial,
    })
    await settled(conv, text('request-home-1'))
    expect(f.runs.map((r) => r.route)).toEqual([undefined])
  } finally {
    quiet.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})
it.each(['failed', 'done'] as const)(
  '例11: 結果を試行の記録へ保存した後・会話の保存の前に落ちても、再起動後に同じ結果を 2 度数えない（%s）',
  async (status) => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
    const cfg = { ...config, maxTurns: 10 }
    const convFile = join(dir, 'conversations-kohako-web.json')
    const failed = { status: 'failed' as const, error: '400' }
    try {
      const f = hermesFake([failed])
      const trial = createModelTrial({ config: cfg, now: () => at('10:00'), store: dir })
      const conv = createConversation({
        now: () => at('10:00'),
        hermes: f.hermes,
        prefix: 'kohako-web',
        store: dir,
        modelTrial: trial,
        sweepMs: 0,
      })
      await settled(conv, text('request-home-1'))
      await conv.flush()
      await trial.flush()
      // 2 つ目の発言が追跡中のまま落ちた時の会話の保存データを取っておく。
      expect(await crashMidRun(dir, cfg, 'request-home-2')).toMatchObject({ turns: 2, failures: 1 })
      const pendingConversation = await readFile(convFile, 'utf8')
      const outcome = status === 'done' ? { status, text: 'ok' } : failed
      const first = await restart(dir, cfg, outcome)
      // 再起動をまたいだ発言の成功は 0 に戻さない（仕様「倒す向き」3）。
      expect(first.trial.state()).toMatchObject({ turns: 2, failures: status === 'done' ? 1 : 2 })
      // 試行の記録は保存済み、会話の保存データは「追跡中」のまま、という落ち方を作って起動し直す。
      await writeFile(convFile, pendingConversation)
      const second = await restart(dir, cfg, outcome)
      expect(second.watch).toHaveBeenCalledTimes(1)
      expect(second.trial.state()).toMatchObject(
        status === 'done' ? { turns: 2, failures: 1 } : { turns: 2, failures: 2, ended: 'failures' },
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
it('例12: 結果を試行の記録へ保存する前に落ちたら、再起動後に 1 度だけ数える', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    expect(await crashMidRun(dir, cfg, 'request-home-1')).toMatchObject({ turns: 1, failures: 0 })
    expect(trialFile(dir)).toMatchObject({ turns: 1, failures: 0, open: ['request-home-1'] })
    const first = await restart(dir, cfg, { status: 'failed', error: '400' })
    expect(first.trial.state()).toMatchObject({ turns: 1, failures: 1 })
    expect(trialFile(dir)).toMatchObject({ turns: 1, failures: 1, open: [] })
    // 会話の保存データも確定しているので、もう一度起動しても追跡も計上もしない。
    const second = await restart(dir, cfg, { status: 'failed', error: '400' })
    expect(second.watch).not.toHaveBeenCalled()
    expect(second.trial.state()).toMatchObject({ turns: 1, failures: 1 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it.each(['touch-deny', 'cancel'] as const)(
  '資格を外したことを保存し終えてから、拒否・停止を Hermes へ送る（%s）',
  async (event) => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
    const approval = { description: 'd', command: 'c', requestId: 'a1', generation: 1 }
    try {
      const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00'), store: dir })
      const openAt: Record<string, unknown> = {}
      let finish: (r: object) => void = () => {}
      const hermes = {
        run: (...args: unknown[]) => {
          openAt.run = trialFile(dir)?.open
          ;(args[6] as (id: string) => void)('run1')
          if (event === 'touch-deny') (args[4] as (runId: string, a: object) => void)('run1', approval)
          return new Promise((r) => {
            finish = r
          })
        },
        stop: async () => {
          openAt.stop = trialFile(dir)?.open
          finish({ status: 'failed', error: 'cancelled' })
          return 'ok'
        },
        approve: async () => {
          openAt.approve = trialFile(dir)?.open
          finish({ status: 'done', text: 'ok' })
          return 'ok'
        },
      } as unknown as ReturnType<typeof createHermes>
      const conv = createConversation({
        now: () => at('10:00'),
        hermes,
        prefix: 'kohako-web',
        store: dir,
        modelTrial: trial,
        sweepMs: 0,
        activityDrainMs: 0,
        cancelSettleMs: 20,
      })
      const entry = conv.submit(
        event === 'cancel'
          ? text('request-home-1')
          : {
              requestId: 'request-home-1',
              kind: 'touch',
              touch: { zone: 'head', action: 'pat', count: 1 },
              expiresAt: 1e15,
            },
        '',
      )
      if ('error' in entry) throw Error(entry.error)
      if (event === 'cancel') {
        await vi.waitFor(() => expect(entry.runId).toBe('run1'))
        await conv.cancel('request-home-1')
      }
      await entry.settled
      await conv.flush()
      await trial.flush()
      expect(openAt).toEqual(
        event === 'cancel' ? { run: ['request-home-1'], stop: [] } : { run: ['request-home-1'], approve: [] },
      )
      expect(trial.state()).toMatchObject({ turns: 1, failures: 0 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
it('結果を試行の記録へ保存し終えるまで、会話の結果を確定しない', async () => {
  const real = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00') })
  let saved = false
  const order: string[] = []
  // 保存に時間がかかる試行（結果の保存が終わるまで 30ms）。
  const slow = {
    id: real.id,
    take: (id: string) => real.take(id),
    drop: (id: string) => real.drop(id),
    reconcile: (tracked: string[]) => real.reconcile(tracked),
    settle: async (id: string, outcome: Outcome) => {
      const ok = await real.settle(id, outcome)
      await new Promise((r) => setTimeout(r, 30))
      saved = true
      order.push('trial-saved')
      return ok
    },
  }
  const f = hermesFake([{ status: 'failed', error: '400' }])
  const conv = createConversation({ now: () => at('10:00'), hermes: f.hermes, prefix: 'kohako-web', modelTrial: slow })
  const entry = conv.submit(text('request-home-1'), '', () => order.push(`conversation-settled saved=${saved}`))
  if ('error' in entry) throw Error(entry.error)
  await vi.waitFor(() => expect(f.runs).toHaveLength(1), { interval: 1 })
  await new Promise((r) => setTimeout(r, 5))
  expect(entry.status).toBe('pending')
  await entry.settled
  expect(entry.status).toBe('failed')
  expect(order).toEqual(['trial-saved', 'conversation-settled saved=true'])
})

// 仕様「倒す向き」と例 13〜17: 落ちる・保存に失敗する・順番が入れ替わる場面では、試行を早く終える側・失敗を多めに数える側へ倒す。
// 期待値は仕様から取る。保存の失敗は、試行に渡す書き込みの関数を差し替えて起こす。
const failingWrites = () => {
  const disk = { broken: false, value: undefined as unknown }
  const write = async (_path: string, value: unknown) => {
    if (disk.broken) throw Error('EIO')
    disk.value = JSON.parse(JSON.stringify(value))
  }
  return { disk, write }
}
it('例13: 発言を送る準備の間に本人が停止を頼んだ発言は、後から指定つきで送られて失敗しても数えない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00'), store: dir })
    const failed = { status: 'failed' as const, error: '400' }
    const f = hermesFake([failed, failed])
    const conv = createConversation({
      now: () => at('10:00'),
      hermes: f.hermes,
      prefix: 'kohako-web',
      store: dir,
      modelTrial: trial,
      sweepMs: 0,
      activityDrainMs: 0,
      cancelSettleMs: 20,
    })
    await settled(conv, text('request-home-1'))
    expect(trial.state()).toMatchObject({ turns: 1, failures: 1 })
    // 会話の保存を待っている間（資格を入れる前）に停止を頼む。
    const entry = conv.submit(text('request-home-2'), '')
    if ('error' in entry) throw Error(entry.error)
    expect(trial.open()).toEqual([])
    void conv.cancel('request-home-2')
    await entry.settled
    await conv.flush()
    await trial.flush()
    expect(trial.state()).toMatchObject({ turns: 2, failures: 1 })
    expect(trial.state().ended).toBeUndefined()
    expect(trialFile(dir)).toMatchObject({ turns: 2, failures: 1, open: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it.each(['settle-done', 'settle-failed', 'drop'] as const)(
  '例14: 試行の記録の書き込みに失敗したら試行を終え、次の出来事で書き込みをやり直す（%s）',
  async (event) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { disk, write } = failingWrites()
      const trial = createModelTrial({
        config: { ...config, maxTurns: 10 },
        now: () => at('10:00'),
        store: '/x',
        write,
      })
      expect(await trial.take('r1')).toEqual(route)
      disk.broken = true
      const saved =
        event === 'drop'
          ? await trial.drop('r1')
          : await trial.settle('r1', event === 'settle-done' ? 'done' : 'failed')
      // 保存できなかったことは呼ぶ側へ伝わり、試行は終わる。
      expect(saved).toBe(false)
      expect(trial.state()).toMatchObject({ turns: 1, ended: 'storage' })
      expect(await trial.take('r2')).toBeUndefined()
      // 書き込みが直ると、次の出来事（指定なしの発言）で終了が保存される。資格も残らない。
      disk.broken = false
      expect(await trial.take('r3')).toBeUndefined()
      expect(disk.value).toMatchObject({ turns: 1, ended: 'storage', open: [] })
      // 起動し直しても終了のまま。
      const again = createModelTrial({
        config: { ...config, maxTurns: 10 },
        now: () => at('10:10'),
        store: '/x',
        write,
        load: async () => disk.value,
      })
      await again.restore()
      expect(await again.take('r4')).toBeUndefined()
    } finally {
      quiet.mockRestore()
    }
  },
)
it('回数の書き込みに失敗した発言は指定を付けず、数える資格も入れない（結果は数えない）', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const { disk, write } = failingWrites()
    const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00'), store: '/x', write })
    disk.broken = true
    expect(await trial.take('r1')).toBeUndefined()
    expect(trial.open()).toEqual([])
    expect(trial.state()).toMatchObject({ ended: 'storage' })
    disk.broken = false
    await trial.settle('r1', 'failed')
    expect(trial.state()).toMatchObject({ failures: 0, ended: 'storage' })
  } finally {
    quiet.mockRestore()
  }
})
// 例 15〜17 と同じ種類を全て試す: 古い記録（失敗 1・発言 x の資格あり）から起動する。
// x を会話が追跡するか × 再起動後の結果。どの組でも失敗の回数は 1 より減らない。追跡しない・失敗なら 2 で終了する。
it.each(
  ([true, false] as const).flatMap((tracked) =>
    (['done', 'failed', 'cancelled', 'unknown'] as const).map((outcome) => ({ tracked, outcome })),
  ),
)('再起動をまたいだ発言は失敗の回数を 0 に戻さない: 追跡 $tracked, 結果 $outcome', async ({ tracked, outcome }) => {
  const { disk, write } = failingWrites()
  const load = async () => ({ id: 't1', turns: 2, failures: 1, open: ['x'] })
  const trial = createModelTrial({
    config: { ...config, maxTurns: 10 },
    now: () => at('10:06'),
    store: '/x',
    write,
    load,
  })
  await trial.restore()
  await trial.reconcile(tracked ? ['x'] : [])
  if (tracked) await trial.settle('x', outcome)
  // 追跡していない発言の結果が後から届いても、もう数えない。
  else await trial.settle('x', 'failed')
  const counted = !tracked || outcome === 'failed'
  expect(trial.state()).toMatchObject(
    counted ? { turns: 2, failures: 2, ended: 'failures' } : { turns: 2, failures: 1 },
  )
  if (!counted) expect(trial.state().ended).toBeUndefined()
  expect(trial.open()).toEqual([])
  expect(disk.value).toMatchObject({ failures: counted ? 2 : 1, open: [] })
  // 再起動の後に送った発言の成功は、今までどおり 0 に戻す。
  if (!counted) {
    expect(await trial.take('y')).toEqual(route)
    await trial.settle('y', 'done')
    expect(trial.state()).toMatchObject({ turns: 3, failures: 0 })
  }
})
it('例15: 再起動後に分かった成功は前の失敗を 0 に戻さず、次の失敗で終了する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    await crashMidRun(dir, cfg, 'request-home-1')
    expect((await restart(dir, cfg, { status: 'failed', error: '400' })).trial.state()).toMatchObject({ failures: 1 })
    await crashMidRun(dir, cfg, 'request-home-2')
    expect((await restart(dir, cfg, { status: 'done', text: 'ok' })).trial.state()).toMatchObject({
      turns: 2,
      failures: 1,
    })
    await crashMidRun(dir, cfg, 'request-home-3')
    expect((await restart(dir, cfg, { status: 'failed', error: '400' })).trial.state()).toMatchObject({
      turns: 3,
      failures: 2,
      ended: 'failures',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
const editEntries = async (dir: string, edit: (entry: Record<string, unknown>) => void) => {
  const file = join(dir, 'conversations-kohako-web.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  for (const entry of saved.entries) edit(entry)
  await writeFile(file, JSON.stringify(saved))
}
it('例16: 結果を数えた保存が失われ会話だけが確定していても、再起動の時に失敗として数える', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    await crashMidRun(dir, cfg, 'request-home-1')
    await restart(dir, cfg, { status: 'failed', error: '400' })
    await crashMidRun(dir, cfg, 'request-home-2')
    // 古い記録（失敗 1・2 つ目の資格あり）を残し、会話は 2 つ目の結果を確定済みにする。
    expect(trialFile(dir)).toMatchObject({ turns: 2, failures: 1, open: ['request-home-2'] })
    await editEntries(dir, (entry) => {
      if (entry.requestId === 'request-home-2') Object.assign(entry, { status: 'failed', error: '400' })
    })
    const after = await restart(dir, cfg, { status: 'failed', error: '400' })
    expect(after.watch).not.toHaveBeenCalled()
    expect(after.trial.state()).toMatchObject({ turns: 2, failures: 2, ended: 'failures' })
    expect(trialFile(dir)).toMatchObject({ failures: 2, ended: 'failures', open: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('例10: 回数の保存の後・run の番号を保存する前に落ちた発言は、再起動の時に失敗として数える', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    await crashMidRun(dir, cfg, 'request-home-1')
    await editEntries(dir, (entry) => {
      delete entry.runId
    })
    const after = await restart(dir, cfg, { status: 'done', text: 'ok' })
    expect(after.watch).not.toHaveBeenCalled()
    expect(after.trial.state()).toMatchObject({ turns: 1, failures: 1 })
    expect(trialFile(dir)).toMatchObject({ turns: 1, failures: 1, open: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it.each(['done', 'failed'] as const)(
  '資格を外す保存が失われても、本人が停止を頼んだ発言の再起動後の結果は数えない（%s）',
  async (status) => {
    const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
    const cfg = { ...config, maxTurns: 10 }
    try {
      await crashMidRun(dir, cfg, 'request-home-1')
      await restart(dir, cfg, { status: 'failed', error: '400' })
      await crashMidRun(dir, cfg, 'request-home-2')
      // 停止を頼んだことは会話の保存データに残り、試行の記録は古いまま（資格あり）。
      await editEntries(dir, (entry) => {
        if (entry.requestId === 'request-home-2') entry.cancelRequested = true
      })
      const after = await restart(dir, cfg, status === 'done' ? { status, text: 'ok' } : { status, error: 'cancelled' })
      expect(after.trial.state()).toMatchObject({ turns: 2, failures: 1 })
      expect(after.trial.state().ended).toBeUndefined()
      expect(trialFile(dir)).toMatchObject({ failures: 1, open: [] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
it('先に資格を外された番号には、後から資格を入れない（指定は付き、回数は数える）', async () => {
  const trial = createModelTrial({ config: { ...config, maxTurns: 10 }, now: () => at('10:00') })
  expect(await trial.drop('r1')).toBe(true)
  expect(await trial.take('r1')).toEqual(route)
  expect(trial.open()).toEqual([])
  await trial.settle('r1', 'failed')
  expect(trial.state()).toMatchObject({ turns: 1, failures: 0 })
})
