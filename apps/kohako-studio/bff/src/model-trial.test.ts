// BOXP-706: 家の会話だけで別のモデルを期限つきで試す。
// 期待値は仕様 Projects/kohako-home/model-trial-spec.md（設定・付ける発言・記録と決まり・例 1〜22）と、
// Lean のモデル contract/model-trial-model/（cases.txt）から取る。実装を読んで写さない。
import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readConfig } from './config.js'
import { createConversation } from './conversation.js'
import { createHermes } from './hermes.js'
import {
  createModelTrial,
  type ModelTrial,
  type Outcome,
  parseModelTrial,
  planSettle,
  planTake,
} from './model-trial.js'
import { atomic } from './storage.js'

const at = (hhmm: string) => Date.parse(`2026-11-26T${hhmm}:00Z`)
const config = { id: 't1', provider: 'openai-codex', model: 'gpt-6.2-sol', until: at('12:00'), maxTurns: 3 }
const many = { ...config, maxTurns: 10 }
const route = { provider: 'openai-codex', model: 'gpt-6.2-sol' }

// 書き込みの失敗・読めない記録は console.error に出る。テストの出力を汚さない。
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

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

/** メモリの上の保存先。書き込みの失敗・止まる書き込み・読めない記録を起こせる。 */
function fakeDisk(initial?: unknown) {
  const d = {
    value: initial,
    /** 次の n 回の書き込みを失敗させる。 */
    failNext: 0,
    /** 書き込みが終わらない。 */
    hang: false,
    /** 読み取りが失敗する（在るのに読めない）。 */
    unreadable: false,
    writes: 0,
  }
  return {
    d,
    write: async (_path: string, value: unknown) => {
      d.writes++
      if (d.hang) return new Promise<void>(() => {})
      if (d.failNext > 0) {
        d.failNext--
        throw Error('EIO')
      }
      d.value = JSON.parse(JSON.stringify(value))
    },
    read: async () => {
      if (d.unreadable) throw new SyntaxError('bad json')
      return d.value === undefined ? undefined : JSON.parse(JSON.stringify(d.value))
    },
  }
}
type Disk = ReturnType<typeof fakeDisk>
const clock = { now: at('10:00') }
beforeEach(() => {
  clock.now = at('10:00')
})
/** BFF の起動（再起動も同じ）: 保存先から記録を読んで部品を作り直す。 */
async function boot(disk: Disk, cfg = config, extra: { log?: (line: string) => void; writeTimeoutMs?: number } = {}) {
  const trial = createModelTrial({
    config: cfg,
    now: () => clock.now,
    store: '/data',
    write: disk.write,
    read: disk.read,
    log: () => {},
    ...extra,
  })
  await trial.restore()
  return trial
}
type Trial = Awaited<ReturnType<typeof boot>>
/** 発言を 1 つ送り、結果を伝える。指定が付いたかを返す。 */
async function turn(trial: Trial, id: string, outcome?: Outcome) {
  const taken = await trial.take(id)
  if (taken) expect(taken).toEqual(route)
  if (outcome) await trial.settle(id, outcome)
  return !!taken
}

it('例1: 上限の発言までは付け、その次から付けない（終了・回数）', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk)
  const routed: boolean[] = []
  for (const id of ['r1', 'r2', 'r3', 'r4']) {
    routed.push(await turn(trial, id, 'done'))
    clock.now += 5 * 60_000
  }
  expect(routed).toEqual([true, true, true, false])
  expect(trial.state()).toEqual({ id: 't1', turns: 3, streak: 0, ended: 'turns' })
  expect(disk.d.value).toEqual({ id: 't1', turns: 3, streak: 0, ended: 'turns' })
})
it('例2: 期限ちょうどの発言から付けない（終了・期限）。期限の直前は付ける', async () => {
  const trial = await boot(fakeDisk())
  expect(await turn(trial, 'r1', 'done')).toBe(true)
  clock.now = at('12:00')
  expect(await turn(trial, 'r2', 'done')).toBe(false)
  expect(trial.state()).toMatchObject({ turns: 1, ended: 'deadline' })
  const other = await boot(fakeDisk())
  clock.now = at('12:00') - 1
  expect(await turn(other, 'r1')).toBe(true)
})
it('例3: 指定を付けた発言が 2 回続けて失敗したら終了（終了・失敗）', async () => {
  const trial = await boot(fakeDisk(), many)
  expect(await turn(trial, 'r1', 'failed')).toBe(true)
  expect(trial.state()).toEqual({ id: 't1', turns: 1, streak: 1 })
  expect(await turn(trial, 'r2', 'failed')).toBe(true)
  expect(trial.state()).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
  expect(await turn(trial, 'r3', 'done')).toBe(false)
})
it('例4: 間に成功があれば失敗は数え直す。止めた・不明は失敗に数えず、数えた失敗も消さない', async () => {
  const trial = await boot(fakeDisk(), many)
  await turn(trial, 'r1', 'failed')
  await turn(trial, 'r2', 'done')
  expect(trial.state()).toEqual({ id: 't1', turns: 2, streak: 0 })
  await turn(trial, 'r3', 'failed')
  expect(trial.state()).toEqual({ id: 't1', turns: 3, streak: 1 })
  await turn(trial, 'r4', 'cancelled')
  await turn(trial, 'r5', 'unknown')
  expect(trial.state()).toEqual({ id: 't1', turns: 5, streak: 1 })
  expect(await turn(trial, 'r6', 'failed')).toBe(true)
  expect(trial.state()).toMatchObject({ streak: 2, ended: 'failures' })
})
it('送る前に、回数 +1 と失敗 +1 と inflight を 1 回の書き込みで保存する（決まりの 1 文）', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  expect(await trial.take('r1')).toEqual(route)
  // take が解決した時点で書き込みは終わっている。結果を数える前は、失敗が 1 つ多い。
  expect(disk.d.value).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'r1' })
  expect(disk.d.writes).toBe(1)
  await trial.settle('r1', 'done')
  expect(disk.d.value).toEqual({ id: 't1', turns: 1, streak: 0 })
  expect(disk.d.writes).toBe(2)
})
it('inflight と違う番号の結果では記録を変えず、書き込みもしない', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  await turn(trial, 'r1', 'failed')
  await trial.take('r2')
  const writes = disk.d.writes
  for (const o of ['done', 'failed', 'cancelled', 'unknown'] as const) await trial.settle('r1', o)
  for (const o of ['done', 'failed', 'cancelled', 'unknown'] as const) await trial.settle('visit-1', o)
  expect(disk.d.writes).toBe(writes)
  expect(trial.state()).toEqual({ id: 't1', turns: 2, streak: 2, inflight: 'r2' })
  // 同じ結果を 2 度伝えても、2 度は数えない。
  await trial.settle('r2', 'cancelled')
  await trial.settle('r2', 'failed')
  expect(trial.state()).toEqual({ id: 't1', turns: 2, streak: 1 })
})
it('例6: 回数と終了を保存し、再起動後は続きから数える。名前を変えると 0 から数え直す', async () => {
  const disk = fakeDisk()
  const first = await boot(disk)
  await turn(first, 'r1', 'done')
  await turn(first, 'r2', 'done')
  const second = await boot(disk)
  expect(second.state()).toEqual({ id: 't1', turns: 2, streak: 0 })
  expect(await turn(second, 'r3', 'done')).toBe(true)
  expect(second.state()).toMatchObject({ turns: 3, ended: 'turns' })
  const third = await boot(disk)
  expect(await turn(third, 'r4')).toBe(false)
  const renamed = await boot(disk, { ...config, id: 't2' })
  expect(renamed.state()).toEqual({ id: 't2', turns: 0, streak: 0 })
  expect(await turn(renamed, 'r5')).toBe(true)
  expect(disk.d.value).toEqual({ id: 't2', turns: 1, streak: 1, inflight: 'r5' })
})
it('例7: 結果が出る前に再起動しても、再起動後に分かった失敗を数え、続けて 2 回で終了する', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await before.take('r2')
  const after = await boot(disk, many)
  await after.settle('r2', 'failed')
  expect(after.state()).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
  expect(await turn(after, 'r3')).toBe(false)
})
it.each([
  ['例8・17: なでる反応で許可を断った後に再起動し、成功と分かる', 'done'],
  ['例9: 本人が停止を頼み、再起動後に結果が出る', 'cancelled'],
  ['例15: 結果が出る前に再起動し、成功と分かる', 'done'],
] as const)('%s → 失敗の回数は 1 のまま。次の失敗で終了する', async (_name, outcome) => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await before.take('r2')
  const after = await boot(disk, many)
  await after.settle('r2', outcome)
  expect(after.state()).toEqual({ id: 't1', turns: 2, streak: 1 })
  expect(await turn(after, 'r3', 'failed')).toBe(true)
  expect(after.state()).toMatchObject({ streak: 2, ended: 'failures' })
  expect(await turn(after, 'r4')).toBe(false)
})
it('例9: 本人が停止を頼んだ発言は、再起動が無くても、Hermes の結果に関係なく数えない', async () => {
  const trial = await boot(fakeDisk(), many)
  await turn(trial, 'r1', 'failed')
  await turn(trial, 'r2', 'cancelled')
  expect(trial.state()).toEqual({ id: 't1', turns: 2, streak: 1 })
})
it('例17: なでる反応で許可を断った後に落ち、再起動後に失敗と分かった時は数える（早く終わる側）', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await before.take('r2')
  const after = await boot(disk, many)
  await after.settle('r2', 'failed')
  expect(after.state()).toMatchObject({ streak: 2, ended: 'failures' })
})
it('例10: 回数の保存の後・run を送る前に落ちても、指定を付けた run は上限を超えず、失敗の 1 が残る', async () => {
  const disk = fakeDisk()
  const before = await boot(disk)
  await turn(before, 'r1', 'done')
  await turn(before, 'r2', 'done')
  // 3 回目: 記録を書いた直後に落ちる（run は送られない）。
  await before.take('r3')
  const after = await boot(disk)
  expect(after.state()).toEqual({ id: 't1', turns: 3, streak: 1, inflight: 'r3', ended: 'turns' })
  expect(await turn(after, 'r4')).toBe(false)
})
it('例11: 結果を試行の記録へ保存した後に落ち、再起動後に同じ結果が分かっても、2 度は数えない', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await turn(before, 'r2', 'failed')
  const after = await boot(disk, many)
  await after.settle('r2', 'failed')
  expect(after.state()).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
})
it('例12: 結果を試行の記録へ保存する前に落ちたら、再起動後に 1 度だけ数える', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await before.take('r1')
  const after = await boot(disk, many)
  await after.settle('r1', 'failed')
  await after.settle('r1', 'failed')
  expect(after.state()).toEqual({ id: 't1', turns: 1, streak: 1 })
})
it.each(['done', 'failed', 'cancelled', 'unknown'] as const)(
  '例14: 結果（%s）の書き込みに失敗しても試行は終了せず、記録はメモリの上でも前のまま（失敗が多い側）',
  async (outcome) => {
    const disk = fakeDisk(),
      trial = await boot(disk, many)
    await trial.take('r1')
    disk.d.failNext = 1
    expect(await trial.settle('r1', outcome)).toBe(false)
    // メモリの記録は保存された記録と同じ（送る前に足した 1 と inflight が残る）。
    expect(trial.state()).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'r1' })
    expect(disk.d.value).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'r1' })
    // 次の発言は、書ければ指定あり。r1 の 1 は失敗として残る。
    expect(await turn(trial, 'r2')).toBe(true)
    expect(disk.d.value).toEqual({ id: 't1', turns: 2, streak: 2, inflight: 'r2' })
    await trial.settle('r2', 'failed')
    expect(disk.d.value).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
  },
)
it.each([
  ['発言を送る時', false],
  ['結果が分かった時', true],
])('例23: %sの書き込みに失敗した後は、再起動してもしなくても、記録と次の発言の指定が同じ', async (_name, atSettle) => {
  // 書き込みの失敗で止まり、再起動で再開する、という違いが無いこと（PR gate の指摘の再現）。
  const run = async (restart: boolean) => {
    const disk = fakeDisk()
    let trial = await boot(disk, many)
    await turn(trial, 'r1', 'failed')
    if (atSettle) {
      await trial.take('r2')
      disk.d.failNext = 1
      expect(await trial.settle('r2', 'done')).toBe(false)
    } else {
      disk.d.failNext = 1
      expect(await trial.take('r2')).toBeUndefined()
    }
    expect(trial.state()).toEqual(disk.d.value)
    expect(trial.state().ended).toBeUndefined()
    if (restart) trial = await boot(disk, many)
    const before = trial.state()
    const routed = await turn(trial, 'r3')
    return { before, routed, after: trial.state(), saved: disk.d.value }
  }
  const stayed = await run(false),
    restarted = await run(true)
  expect(restarted).toEqual(stayed)
  expect(stayed.saved).toEqual(stayed.after)
  // 発言の時の失敗: 回数は増えておらず、次は 2 回目として付く。結果の時の失敗: 失敗が 2 のまま残り、次は終了・失敗。
  expect(stayed.routed).toBe(!atSettle)
  expect(stayed.after).toEqual(
    atSettle
      ? { id: 't1', turns: 2, streak: 2, inflight: 'r2', ended: 'failures' }
      : { id: 't1', turns: 2, streak: 2, inflight: 'r3' },
  )
})
it('回数の書き込みに失敗した発言には指定を付けず、保存された回数も増えない。試行は終了せず、書ければ次は付く', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  await turn(trial, 'r1', 'done')
  disk.d.failNext = 1
  expect(await turn(trial, 'r2', 'failed')).toBe(false)
  expect(disk.d.value).toMatchObject({ turns: 1, streak: 0 })
  expect(trial.state()).toEqual({ id: 't1', turns: 1, streak: 0 })
  expect(await turn(trial, 'r3')).toBe(true)
  expect(disk.d.value).toEqual({ id: 't1', turns: 2, streak: 1, inflight: 'r3' })
})
it('例16: 結果の書き込みに失敗して落ちても、送る前に足した 1 が残り、次の発言で終了・失敗になる', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await before.take('r2')
  disk.d.failNext = 1
  await before.settle('r2', 'failed')
  // 会話の結果だけが確定して落ちる: 再起動後、会話は r2 を追跡しない（settle は呼ばれない）。
  const after = await boot(disk, many)
  expect(after.state()).toEqual({ id: 't1', turns: 2, streak: 2, inflight: 'r2' })
  expect(await turn(after, 'r3')).toBe(false)
  expect(after.state()).toMatchObject({ turns: 2, streak: 2, ended: 'failures' })
})
it('残った inflight: 結果を数えられなかった発言の 1 は、次の発言を送る時に失敗として残る', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await before.take('r1')
  const after = await boot(disk, many)
  // r1 は追跡されない。次の発言は付くが、失敗は r1 の分と合わせて 2 から始まる。
  expect(await after.take('r2')).toEqual(route)
  expect(after.state()).toEqual({ id: 't1', turns: 2, streak: 2, inflight: 'r2' })
  // r1 の結果が後から来ても数えない。
  await after.settle('r1', 'done')
  expect(after.state()).toMatchObject({ streak: 2, inflight: 'r2' })
  await after.settle('r2', 'failed')
  expect(after.state()).toMatchObject({ streak: 2, ended: 'failures' })
})
it('例18: 再起動をまたいだ発言の結果が不明なら失敗と同じに扱う。再起動が無ければ不明は数えない', async () => {
  const disk = fakeDisk()
  const before = await boot(disk, many)
  await turn(before, 'r1', 'failed')
  await turn(before, 'r2', 'unknown')
  expect(before.state()).toEqual({ id: 't1', turns: 2, streak: 1 })
  await before.take('r3')
  const after = await boot(disk, many)
  await after.settle('r3', 'unknown')
  expect(after.state()).toEqual({ id: 't1', turns: 3, streak: 2, ended: 'failures' })
})
it.each([
  ['JSON でない（読めない）', undefined, true],
  ['turns が数でない', { id: 't1', turns: 'many', streak: 0 }, false],
  ['streak が負', { id: 't1', turns: 1, streak: -1 }, false],
  ['前の形の記録（streak が無い）', { id: 't1', turns: 1, failures: 0, open: [] }, false],
  ['id が文字でない', { turns: 1, streak: 0 }, false],
  ['配列', [], false],
  ['null', null, false],
  ['知らない終了の理由', { id: 't1', turns: 1, streak: 0, ended: 'later' }, false],
  ['inflight が文字でない', { id: 't1', turns: 1, streak: 0, inflight: 7 }, false],
])('例19: 記録が在るのに使えない（%s）なら終了・保存にし、0 から数え直さない', async (_name, value, unreadable) => {
  const disk = fakeDisk(value)
  disk.d.unreadable = unreadable
  const trial = await boot(disk)
  expect(trial.state()).toMatchObject({ ended: 'storage' })
  expect(await turn(trial, 'r1')).toBe(false)
  // 次の出来事で終了を書く。書けた後は、再起動しても終了のまま。
  expect(disk.d.value).toEqual({ id: 't1', turns: 0, streak: 0, ended: 'storage' })
  disk.d.unreadable = false
  expect(await turn(await boot(disk), 'r2')).toBe(false)
})
it('例19: 実際のファイルでも、壊れた記録は終了・保存。ファイルが無い時と id が違う記録の時だけ 0 から数える', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  const real = async (cfg = config) => {
    const trial = createModelTrial({ config: cfg, now: () => at('10:00'), store: dir, log: () => {} })
    await trial.restore()
    return trial
  }
  try {
    const first = await real()
    expect(first.state()).toEqual({ id: 't1', turns: 0, streak: 0 })
    expect(await first.take('r1')).toEqual(route)
    expect(JSON.parse(await readFile(join(dir, 'model-trial.json'), 'utf8'))).toEqual({
      id: 't1',
      turns: 1,
      streak: 1,
      inflight: 'r1',
    })
    expect((await real({ ...config, id: 't2' })).state()).toEqual({ id: 't2', turns: 0, streak: 0 })
    await writeFile(join(dir, 'model-trial.json'), '{"id":"t1","turns":2,')
    const broken = await real()
    expect(broken.state()).toMatchObject({ ended: 'storage' })
    expect(await broken.take('r2')).toBeUndefined()
    expect(JSON.parse(await readFile(join(dir, 'model-trial.json'), 'utf8'))).toMatchObject({ ended: 'storage' })
    expect(await (await real()).take('r3')).toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('例20: 2 つの発言を同時に送り、1 回目の書き込みだけが失敗したら、2 回目は保存済みの記録から計算して付ける', async () => {
  // 書き込みの失敗は試行を終了しない。2 回目は 1 回目が終わってから記録を見るので、保存された回数と指定の数が合う。
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  disk.d.failNext = 1
  const [a, b] = await Promise.all([trial.take('a'), trial.take('b')])
  expect([a, b]).toEqual([undefined, route])
  expect(trial.state()).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'b' })
  expect(disk.d.value).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'b' })
})
it('操作は 1 つずつ行う: 待たずに続けて呼んでも、前の書き込みが終わってから次の記録を計算する', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  const results = await Promise.all([
    trial.take('r1'),
    trial.settle('r1', 'failed'),
    trial.take('r2'),
    trial.settle('r2', 'failed'),
    trial.take('r3'),
  ])
  expect(results).toEqual([route, true, route, true, undefined])
  expect(disk.d.value).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
})
it('書き込みが終わらない時は打ち切って失敗として扱い、発言を待たせ続けない', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many, { writeTimeoutMs: 20 })
  disk.d.hang = true
  expect(await trial.take('r1')).toBeUndefined()
  expect(trial.state()).toEqual({ id: 't1', turns: 0, streak: 0 })
  // 打ち切った書き込みが終わらない間は、次の書き込みを始めない（例 22）。発言は待たせず、指定も付けない。
  disk.d.hang = false
  expect(await trial.take('r2')).toBeUndefined()
  expect(disk.d.writes).toBe(1)
  expect(disk.d.value).toBeUndefined()
})
it('例 22: 打ち切った書き込みが終わるまで次の書き込みを始めず、後から届いてもメモリの記録を書き直す', async () => {
  // 1 回目の書き込みだけが止まり、後から（release で）古い内容のまま届く保存先。
  let value: unknown,
    writes = 0,
    release = () => {},
    kept: (() => boolean) | undefined
  const write = async (_path: string, next: unknown, keep?: () => boolean) => {
    writes++
    if (writes === 1) kept = keep
    if (writes === 1) await new Promise<void>((resolve) => (release = resolve))
    value = JSON.parse(JSON.stringify(next))
  }
  const trial = createModelTrial({
    config: many,
    now: () => clock.now,
    store: '/data',
    write,
    read: async () => value,
    log: () => {},
    writeTimeoutMs: 20,
  })
  await trial.restore()
  expect(await trial.take('r1')).toBeUndefined()
  expect(trial.state()).toEqual({ id: 't1', turns: 0, streak: 0 })
  // 打ち切った書き込みには「捨てた」と伝わる（既定の書き込みはファイルを置き換えない）。
  expect(kept?.()).toBe(false)
  // 古い書き込みがまだ終わっていない間は、新しい書き込みを始めない（指定も付けない）。
  expect(await trial.take('r2')).toBeUndefined()
  expect(writes).toBe(1)
  // 古い書き込みが届く（回数 1・失敗 1 の内容）→ すぐにメモリの記録（回数 0）が書き直される。
  release()
  await vi.waitFor(() => expect(writes).toBe(2))
  await trial.flush()
  expect(value).toEqual({ id: 't1', turns: 0, streak: 0 })
  expect(trial.state()).toEqual({ id: 't1', turns: 0, streak: 0 })
  // 再起動しても、しなくても、次の発言は 1 回目として付く。
  expect(await trial.take('r3')).toEqual(route)
  expect(value).toEqual({ id: 't1', turns: 1, streak: 1, inflight: 'r3' })
  const again = createModelTrial({
    config: many,
    now: () => clock.now,
    store: '/data',
    write,
    read: async () => value,
    log: () => {},
  })
  await again.restore()
  expect(again.state()).toEqual(trial.state())
})
it('例 22: 捨てた書き込みは、記録のファイルを置き換えない（一時ファイルも残さない）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-trial-'))
  try {
    const path = join(dir, 'model-trial.json')
    await atomic(path, { a: 1 })
    await expect(atomic(path, { a: 2 }, () => false)).rejects.toThrow('abandoned')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 1 })
    expect(await readdir(dir)).toEqual(['model-trial.json'])
    await atomic(path, { a: 3 }, () => true)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 3 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('発言ごとに名前・回数・上限だけを記録し、終了の理由も記録する（本文は出さない）', async () => {
  const log = vi.fn()
  const trial = await boot(fakeDisk(), { ...config, maxTurns: 1 }, { log })
  await trial.take('r1')
  await trial.take('r2')
  expect(log.mock.calls).toEqual([
    ['kohako_model_trial ended id=t1 reason=turns turns=1'],
    ['kohako_model_trial turn id=t1 turn=1/1'],
  ])
  const failing = fakeDisk(),
    stored = vi.fn()
  failing.d.failNext = 1
  await (await boot(failing, config, { log: stored })).take('r1')
  // 書き込みの失敗は終了ではない（終了の記録を出さない）。
  expect(stored.mock.calls).toEqual([])
  const unreadable = fakeDisk(),
    refused = vi.fn()
  unreadable.d.unreadable = true
  await boot(unreadable, config, { log: refused })
  expect(refused.mock.calls).toEqual([['kohako_model_trial ended id=t1 reason=storage turns=0']])
})

it('決まりの関数: 終了の理由は先に付いたものを変えない。順は 終了 → 期限 → 回数 → 失敗', () => {
  const base = { id: 't1', turns: 0, streak: 0 }
  expect(planTake(config, { ...base, ended: 'failures' }, 'r', at('13:00')).next.ended).toBe('failures')
  expect(planTake(config, { ...base, turns: 3, streak: 2 }, 'r', at('13:00')).next.ended).toBe('deadline')
  expect(planTake(config, { ...base, turns: 3, streak: 2 }, 'r', at('10:00')).next.ended).toBe('turns')
  expect(planTake(config, { ...base, turns: 2, streak: 2 }, 'r', at('10:00'))).toEqual({
    next: { ...base, turns: 2, streak: 2, ended: 'failures' },
  })
  expect(planSettle({ ...base, turns: 3, streak: 2, inflight: 'r', ended: 'turns' }, 'r', 'failed', false).ended).toBe(
    'turns',
  )
  // 先に足した 1 が無い記録（外から書き換えられた）でも、負にしない。
  expect(planSettle({ ...base, inflight: 'r' }, 'r', 'cancelled', false).streak).toBe(0)
})

/**
 * モデルとの照合: Lean のモデルが出した出来事の並び（cases.txt）を実装に流し、並びの後の
 * 「指定を付けたか・保存された記録」がモデルと同じで、メモリの記録が保存された記録と同じであることを確かめる。
 * T=発言 Tx=発言（書き込み失敗） Tl=発言（期限の後） F/D/C/U=結果（失敗・成功・停止・不明） Fx/Dx=結果（書き込み失敗）
 * R=再起動（最後の発言を追跡し直す） L=再起動（追跡しない）
 */
it('モデルの並び（上限 3 で長さ 5 まで、上限 1 で長さ 4 まで）と実装が一致する', async () => {
  const lines = readFileSync(new URL('../contract/model-trial-model/cases.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
  expect(lines.length).toBeGreaterThan(8000)
  const outcomes: Record<string, Outcome> = { F: 'failed', D: 'done', C: 'cancelled', U: 'unknown' }
  for (const line of lines) {
    const [max, names, routed, turns, streak, inflight, diskEnded] = line.split(' ')
    const cfg = { ...config, maxTurns: Number(max) }
    const disk = fakeDisk()
    let trial = await boot(disk, cfg),
      next = 0,
      pending: string | undefined,
      last = false
    for (const name of names.split('.')) {
      last = false
      disk.d.failNext = name.endsWith('x') ? 1 : 0
      if (name[0] === 'T') {
        clock.now = name === 'Tl' ? at('13:00') : at('10:00')
        pending = `r${next++}`
        last = !!(await trial.take(pending))
      } else if (name === 'R' || name === 'L') {
        trial = await boot(disk, cfg)
        pending = name === 'R' && next > 0 ? `r${next - 1}` : undefined
      } else {
        if (!pending) throw Error(`no pending request in ${names}`)
        await trial.settle(pending, outcomes[name[0]])
        pending = undefined
      }
      // 失敗させるつもりの書き込みが起きなかった時は、次の出来事へ持ち越さない。
      disk.d.failNext = 0
    }
    const saved = (disk.d.value ?? { turns: 0, streak: 0 }) as Record<string, unknown>
    expect(
      [
        last ? '1' : '0',
        saved.turns,
        saved.streak,
        saved.inflight ? String(saved.inflight).slice(1) : '-',
        saved.ended ? '1' : '0',
      ].join(' '),
      line,
    ).toBe([routed, turns, streak, inflight, diskEnded].join(' '))
    // メモリの記録は、いつも保存された記録と同じ（メモリだけにある終了は無い）。
    expect(trial.state(), line).toEqual(disk.d.value ?? { id: 't1', turns: 0, streak: 0 })
  }
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

const touch = (requestId: string) => ({
  requestId,
  kind: 'touch' as const,
  touch: { zone: 'head' as const, action: 'pat' as const, count: 1 },
  expiresAt: 1e15,
})
/** 会話の結果の確定は試行の記録を待たないので、記録を見る前に待つ。 */
async function recorded(trial: Trial) {
  await trial.flush()
  return trial.state()
}
it('例1・5: 家の会話にだけ付け、現場・通知返信・検証用の会話には付けず、回数も増やさない', async () => {
  const trial = await boot(fakeDisk())
  const f = hermesFake()
  const owner = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: trial }),
    verifier = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-verify' })
  await settled(owner, text('request-visit-1', { visit: true }))
  const reply = owner.submit(text('request-reply-1'), '', undefined, { sessionId: 'notif-1', idempotencyKey: 'k1' })
  if ('error' in reply) throw Error(reply.error)
  await reply.settled
  await settled(verifier, text('request-verify-1'))
  expect(f.runs.map((r) => r.route)).toEqual([undefined, undefined, undefined])
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 0, streak: 0 })
  await settled(owner, text('request-home-1'))
  await settled(owner, text('request-home-2', { origin: 'g2' }))
  await settled(owner, touch('request-home-3'))
  clock.now = at('10:15')
  await settled(owner, text('request-home-4'))
  expect(f.runs.slice(3).map((r) => r.route)).toEqual([route, route, route, undefined])
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 3, streak: 0, ended: 'turns' })
})
it('同じ発言の受け直しでは回数を増やさず、別 session での送り直しは同じ指定のまま 1 回と数える', async () => {
  const trial = await boot(fakeDisk())
  const f = hermesFake([
    { status: 'failed', error: 'unknown_execution' },
    { status: 'done', text: 'ok' },
  ])
  const owner = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: trial })
  await settled(owner, text('request-home-1'))
  expect(f.runs.map((r) => [r.route, r.attempt])).toEqual([
    [route, undefined],
    [route, 1],
  ])
  expect(f.runs[0].session).not.toBe(f.runs[1].session)
  owner.submit(text('request-home-1'), '')
  expect(f.runs).toHaveLength(2)
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 1, streak: 0 })
})
it('例3: 家の会話で 2 回続けて失敗したら、次の発言から付けない。送る前の失敗は数えない', async () => {
  const trial = await boot(fakeDisk(), many)
  const f = hermesFake([
    { status: 'failed', error: 'toolsets_open' },
    { status: 'failed', error: 'hermes_unavailable' },
    { status: 'failed', error: '400' },
    { status: 'done', text: 'ok' },
    { status: 'failed', error: 'failed' },
    { status: 'failed', error: '400' },
  ])
  const owner = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: trial })
  for (let i = 1; i <= 2; i++) await settled(owner, text(`request-home-${i}`))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 2, streak: 0 })
  await settled(owner, text('request-home-3'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 3, streak: 1 })
  await settled(owner, text('request-home-4'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 4, streak: 0 })
  await settled(owner, text('request-home-5'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 5, streak: 1 })
  await settled(owner, text('request-home-6'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 6, streak: 2, ended: 'failures' })
  await settled(owner, text('request-home-7'))
  expect(f.runs.map((r) => !!r.route)).toEqual([true, true, true, true, true, true, false])
})
/** run の番号を返した後、止められるまで結果を返さない Hermes。止めた時の結果を選べる。 */
function stoppableHermes(onStop: { status: 'failed'; error: string } | { status: 'done'; text: string }) {
  let finish: (r: unknown) => void = () => {}
  const stop = vi.fn(async () => {
    finish(onStop)
    return 'ok'
  })
  const hermes = {
    run: (...args: unknown[]) => {
      ;(args[6] as (id: string) => void)('run1')
      return new Promise((r) => {
        finish = r
      })
    },
    stop,
    approve: async () => 'ok',
  } as unknown as ReturnType<typeof createHermes>
  return { hermes, stop }
}
it.each([
  ['失敗', { status: 'failed' as const, error: 'cancelled' }],
  ['成功', { status: 'done' as const, text: 'ok' }],
])('例9: 本人が止めた発言は、Hermes が%sを返しても数えない（前の失敗を消さず、足しもしない）', async (_n, onStop) => {
  const trial = await boot(fakeDisk(), many)
  await turn(trial, 'r1', 'failed')
  const { hermes } = stoppableHermes(onStop)
  const owner = createConversation({
    now: () => clock.now,
    hermes,
    prefix: 'kohako-web',
    modelTrial: trial,
    cancelSettleMs: 20,
  })
  for (const id of ['request-home-1', 'request-home-2']) {
    const entry = owner.submit(text(id), '')
    if ('error' in entry) throw Error(entry.error)
    await vi.waitFor(() => expect(entry.runId).toBe('run1'))
    await owner.cancel(id)
    await entry.settled
  }
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 3, streak: 1 })
})
it('例13: 発言を送る準備の間に本人が停止を頼んだ発言は、後から指定つきで送られて失敗しても数えない', async () => {
  const trial = await boot(fakeDisk(), many)
  await turn(trial, 'r1', 'failed')
  const f = hermesFake([{ status: 'failed', error: '400' }])
  const owner = createConversation({
    now: () => clock.now,
    hermes: f.hermes,
    prefix: 'kohako-web',
    modelTrial: trial,
    cancelSettleMs: 20,
  })
  const entry = owner.submit(text('request-home-2'), '')
  if ('error' in entry) throw Error(entry.error)
  // まだ回数の書き込みも終わっていない。
  expect(f.runs).toHaveLength(0)
  void owner.cancel('request-home-2')
  await entry.settled
  expect(f.runs.map((r) => r.route)).toEqual([route])
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 2, streak: 1 })
})
it('なでる反応で許可を断った発言は、Hermes が成功を返しても失敗を返しても数えない（前の失敗を消さない）', async () => {
  const trial = await boot(fakeDisk(), many)
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
  const owner = createConversation({ now: () => clock.now, hermes, prefix: 'kohako-web', modelTrial: trial })
  await settled(owner, text('request-home-1'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 1, streak: 1 })
  await settled(owner, touch('request-home-2'))
  // 成功でも 0 に戻さない。
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 2, streak: 1 })
  await settled(owner, touch('request-home-3'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 3, streak: 1 })
  await settled(owner, text('request-home-4'))
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 4, streak: 2, ended: 'failures' })
})
it('回数の書き込みに失敗したら、その発言は指定を付けずに送る（会話は止めない）。試行は終了しない', async () => {
  const disk = fakeDisk(),
    trial = await boot(disk, many)
  const f = hermesFake()
  const owner = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: trial })
  disk.d.failNext = 1
  const first = await settled(owner, text('request-home-1'))
  expect(first.status).toBe('done')
  await settled(owner, text('request-home-2'))
  expect(f.runs.map((r) => r.route)).toEqual([undefined, route])
  expect(await recorded(trial)).toEqual({ id: 't1', turns: 1, streak: 0 })
  expect(disk.d.value).toEqual({ id: 't1', turns: 1, streak: 0 })
})
it('例21: 試行の記録の書き込みが止まっていても、会話の結果は確定し、本人の停止と拒否は Hermes へ送られる', async () => {
  // 結果を伝える呼び出し（settle）が終わらない試行。発言を送る前の書き込み（take）だけは終わる。
  const stuck: ModelTrial = { id: 't1', take: async () => route, settle: () => new Promise<boolean>(() => {}) }
  const f = hermesFake()
  const done = createConversation({ now: () => clock.now, hermes: f.hermes, prefix: 'kohako-web', modelTrial: stuck })
  expect((await settled(done, text('request-home-1'))).status).toBe('done')
  const { hermes, stop } = stoppableHermes({ status: 'failed', error: 'cancelled' })
  const owner = createConversation({
    now: () => clock.now,
    hermes,
    prefix: 'kohako-web',
    modelTrial: stuck,
    cancelSettleMs: 20,
  })
  const entry = owner.submit(text('request-home-2'), '')
  if ('error' in entry) throw Error(entry.error)
  await vi.waitFor(() => expect(entry.runId).toBe('run1'))
  await owner.cancel('request-home-2')
  expect(stop).toHaveBeenCalledWith('run1')
  await entry.settled
  expect(entry.status).not.toBe('pending')
})

/** run の番号を返した後、結果を返さないまま止まる Hermes（BFF が結果の前に落ちる場面）。 */
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
const realTrial = async (dir: string, cfg: typeof config) => {
  const trial = createModelTrial({ config: cfg, now: () => clock.now, store: dir, log: () => {} })
  await trial.restore()
  return trial
}
/** 指定を付けた発言を 1 つ送り、結果が出る前に BFF が落ちた時の保存データ（会話と試行の両方）を作る。 */
async function crashMidRun(dir: string, cfg: typeof config, requestId: string, input: object = {}) {
  const trial = await realTrial(dir, cfg)
  const conv = createConversation({
    now: () => clock.now,
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
  return recorded(trial)
}
/** 再起動: 会話が追跡を再開し、Hermes が結果を返す。 */
async function restart(dir: string, cfg: typeof config, result: object) {
  const trial = await realTrial(dir, cfg)
  const watch = vi.fn(async () => result)
  const hermes = { run: vi.fn(), watch, stop: async () => 'ok', approve: async () => 'ok' } as unknown as ReturnType<
    typeof createHermes
  >
  const conv = createConversation({
    now: () => clock.now,
    hermes,
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
  return { trial, conv, watch, hermes }
}
it('例7（会話とのつなぎ）: 再起動後に追跡して分かった失敗を数え、指定は付け直さず、回数も増やさない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    expect(await crashMidRun(dir, many, 'request-home-1')).toEqual({
      id: 't1',
      turns: 1,
      streak: 1,
      inflight: 'request-home-1',
    })
    const first = await restart(dir, many, { status: 'failed', error: '400' })
    expect(first.watch).toHaveBeenCalledTimes(1)
    expect(first.hermes.run).not.toHaveBeenCalled()
    expect(first.trial.state()).toEqual({ id: 't1', turns: 1, streak: 1 })
    expect(await crashMidRun(dir, many, 'request-home-2')).toMatchObject({ turns: 2, streak: 2 })
    const second = await restart(dir, many, { status: 'failed', error: '400' })
    expect(second.trial.state()).toEqual({ id: 't1', turns: 2, streak: 2, ended: 'failures' })
    const f = hermesFake()
    const after = createConversation({
      now: () => clock.now,
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
it('例15・18（会話とのつなぎ）: 再起動後の成功は 0 に戻さず、確かめられない結果は失敗と同じに扱う', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    await crashMidRun(dir, many, 'request-home-1')
    await restart(dir, many, { status: 'failed', error: '400' })
    await crashMidRun(dir, many, 'request-home-2')
    const done = await restart(dir, many, { status: 'done', text: 'ok' })
    expect(done.trial.state()).toEqual({ id: 't1', turns: 2, streak: 1 })
    await crashMidRun(dir, many, 'request-home-3')
    const lost = await restart(dir, many, { status: 'failed', error: 'hermes_unavailable' })
    expect(lost.trial.state()).toEqual({ id: 't1', turns: 3, streak: 2, ended: 'failures' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('再起動後、別の名前の試行の発言と、指定を付けていない発言（現場）の結果は数えない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kohako-trial-'))
  try {
    await crashMidRun(dir, many, 'request-home-1')
    const renamed = await restart(dir, { ...many, id: 't2' }, { status: 'failed', error: '400' })
    expect(renamed.watch).toHaveBeenCalledTimes(1)
    expect(renamed.trial.state()).toEqual({ id: 't2', turns: 0, streak: 0 })
    expect(await crashMidRun(dir, { ...many, id: 't2' }, 'request-visit-1', { visit: true })).toEqual({
      id: 't2',
      turns: 0,
      streak: 0,
    })
    const visit = await restart(dir, { ...many, id: 't2' }, { status: 'failed', error: '400' })
    expect(visit.trial.state()).toEqual({ id: 't2', turns: 0, streak: 0 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
