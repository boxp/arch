// BOXP-706: 家の会話だけで別のモデルを期限つきで試す。
// 期待値は仕様 Projects/kohako-home/model-trial-spec.md（設定・付ける発言・状態と終わり方・例 1〜6）から取る。
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
  expect(readConfig({ KOHAKO_MODEL_TRIAL: raw(30) }).modelTrial?.until).toBe(Date.parse('2020-01-01T00:00:00Z'))
  expect(readConfig({}).modelTrial).toBeUndefined()
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
    expect(first.take()).toEqual(route)
    expect(first.take()).toEqual(route)
    await first.flush()
    expect(JSON.parse(await readFile(join(dir, 'model-trial.json'), 'utf8'))).toMatchObject({ id: 't1', turns: 2 })
    const second = createModelTrial({ config, now: () => at('10:30'), store: dir })
    await second.restore()
    expect(second.take()).toEqual(route)
    expect(second.state()).toMatchObject({ turns: 3, ended: 'turns' })
    expect(second.take()).toBeUndefined()
    await second.flush()
    const third = createModelTrial({ config, now: () => at('10:40'), store: dir })
    await third.restore()
    expect(third.take()).toBeUndefined()
    const renamed = createModelTrial({ config: { ...config, id: 't2' }, now: () => at('10:50'), store: dir })
    await renamed.restore()
    expect(renamed.state()).toEqual({ id: 't2', turns: 0, failures: 0 })
    expect(renamed.take()).toEqual(route)
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
    expect([1, 2, 3, 4].map(() => !!trial.take())).toEqual([true, true, true, false])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('発言ごとに名前・回数・上限だけを記録し、終了の理由も記録する（本文は出さない）', () => {
  const log = vi.fn()
  const trial = createModelTrial({ config: { ...config, maxTurns: 1 }, now: () => at('10:00'), log })
  trial.take()
  trial.take()
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
it('再起動後に分かった成功は、前の失敗を 0 に戻す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const cfg = { ...config, maxTurns: 10 }
  try {
    await crashMidRun(dir, cfg, 'request-home-1')
    expect((await restart(dir, cfg, { status: 'failed', error: '400' })).trial.state()).toMatchObject({ failures: 1 })
    await crashMidRun(dir, cfg, 'request-home-2')
    expect((await restart(dir, cfg, { status: 'done', text: 'ok' })).trial.state()).toMatchObject({
      turns: 2,
      failures: 0,
    })
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
