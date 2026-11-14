import { expect, it } from 'vitest'
import { createStatus, parseBoard, parseQuota } from './status.js'
const now = 1794381474000
const metrics = `# HELP x test
ai_subscription_source_up{provider="claude"} 1
ai_subscription_generated_timestamp_seconds 1794381474
ai_subscription_window_present{provider="claude",limit="five_hour",name="shared_5h"} 0
ai_subscription_window_present{provider="claude",limit="seven_day",name="shared_7d"} 1
ai_subscription_window_used_percent{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 67
ai_subscription_window_observed_timestamp_seconds{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 1794380285
ai_subscription_window_resets_at_seconds{provider="claude",limit="seven_day",name="shared_7d",window="7d"} 1794614400
ai_subscription_window_used_percent{provider="codex",limit="primary",name="primary",window="7d"} 59
ai_subscription_window_status{provider="codex",limit="primary",name="primary",window="7d",status="allowed"} 1
other_metric 123`
const board = (items: object[], truncated = false) => ({
  schema: 'kohako-board/v1',
  generatedAt: new Date(now).toISOString(),
  boardUpdatedAt: new Date(now).toISOString(),
  total: items.length,
  limit: 30,
  truncated,
  items,
})
it('parses real exposition, absent present series, and fixed pools', () => {
  const q = parseQuota(metrics, now)
  expect(q.pools.map((p) => p.id)).toEqual(['claude_shared', 'claude_fable', 'claude_opus', 'codex_shared', 'localllm'])
  expect(q.pools[0].windows[0].state).toBe('not_provided')
  expect(q.pools[0].windows[0].usedPercent).toBeNull()
  expect(q.pools[0].windows[1]).toMatchObject({ state: 'ok', usedPercent: 67 })
  expect(q.pools[3].windows[0]).toMatchObject({ state: 'freshness_unknown', usedPercent: 59, observedAt: null })
})
it('classifies stale, expired, rejected and ignores invalid enum labels', () => {
  const w = (suffix: string, at = now) => parseQuota(metrics + '\n' + suffix, at).pools[3].windows[0]
  expect(w('', now + 90000000).state).toBe('freshness_unknown') // no observation timestamp: never shown as ok
  expect(
    w(
      'ai_subscription_window_observed_timestamp_seconds{provider="codex",limit="primary",name="primary",window="7d"} 1794000000',
    ).state,
  ).toBe('stale')
  expect(w('ai_subscription_window_expired{provider="codex",limit="primary",name="primary",window="7d"} 1').state).toBe(
    'expired',
  )
  expect(
    w('ai_subscription_window_status{provider="codex",limit="primary",name="primary",window="7d",status="rejected"} 1')
      .state,
  ).toBe('freshness_unknown') // first active status is allowed, but observation time is missing
  expect(parseQuota(metrics.replace('status="allowed"', 'status="rejected"'), now).pools[3].windows[0].state).toBe(
    'exhausted',
  )
  expect(
    parseQuota(metrics.replace('window="7d"} 59', 'window="bad"} 59'), now).pools[3].windows[0].usedPercent,
  ).toBeNull()
})
it('deduplicates lane IDs, conflicts, mismatch and truncated lower bounds', () => {
  const item = (id: string, assignee: string, lane = 'In Progress', laneStatusMismatch = false) => ({
    id,
    assignee,
    lane,
    laneStatusMismatch,
  })
  const r = parseBoard(
    board(
      [
        item('BOXP-1', 'a'),
        item('BOXP-1', 'b', 'In Progress', true),
        item('BOXP-2', 'a'),
        item('BOXP-3', 'x', 'Ready'),
        item('BOXP-4', 'x', 'Blocked'),
        item('bad', 'x'),
      ],
      true,
    ),
    now,
  )
  expect(r.inProgress).toEqual({
    total: 2,
    complete: true,
    byAgent: [
      { agent: 'a', count: 1 },
      { agent: 'unknown', count: 1 },
    ],
    conflicts: ['BOXP-1'],
    laneStatusMismatch: 1,
  })
  expect(r.inProgress.total).toBe(r.inProgress.byAgent.reduce((n, x) => n + x.count, 0))
  expect(parseBoard(board([item('BOXP-1', 'a')], true), now).inProgress.complete).toBe(false)
  expect(() => parseBoard({ schema: 'bad' }, now)).toThrow()
})
it('caches independently, shares in-flight requests and retries failures after 15 seconds', async () => {
  let clock = now,
    calls = 0
  const fetcher = (async (url: string | URL | Request) => {
    calls++
    await Promise.resolve()
    return String(url) === 'quota' ? new Response('bad') : new Response(JSON.stringify(board([])))
  }) as typeof fetch
  const status = createStatus({ fetch: fetcher, now: () => clock, quotaUrl: 'quota', boardUrl: 'board' })
  const [a, b] = await Promise.all([status.get(), status.get()])
  expect(calls).toBe(2)
  expect(a).toEqual(b)
  expect(a.quota.state).toBe('unavailable')
  expect(a.quota.pools[0].windows[0]).toMatchObject({ state: 'unavailable', usedPercent: null })
  expect(a.tasks.state).toBe('ok')
  clock += 15001
  await status.get()
  expect(calls).toBe(3)
  clock += 45000
  await status.get()
  expect(calls).toBe(5)
})
it('treats a missing subscription file and a failed board as unknown, not 0', async () => {
  expect(() =>
    parseQuota('ai_subscription_metrics_file_present 0\nai_subscription_metrics_file_age_seconds -1', now),
  ).toThrow()
  const fetcher = (async () => new Response('down', { status: 503 })) as typeof fetch
  const s = await createStatus({ fetch: fetcher, now: () => now, quotaUrl: 'quota', boardUrl: 'board' }).get()
  expect(s.tasks.state).toBe('unavailable')
  expect(s.tasks.inProgress.total).toBeNull()
  expect(
    s.quota.pools.flatMap((p) => p.windows).every((w) => w.usedPercent === null && w.state === 'unavailable'),
  ).toBe(true)
})
