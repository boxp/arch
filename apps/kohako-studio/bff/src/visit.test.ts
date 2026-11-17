import { describe, expect, it, vi } from 'vitest'
import { createConversation } from './conversation.js'
import type { createHermes } from './hermes.js'
import { isVisitText, visitToolLabel } from './visit.js'

describe('現場の入口と表示', () => {
  it('合言葉だけを受け付ける', () => {
    for (const value of [
      'プラグイン',
      'ﾌﾟﾗｸﾞｲﾝして！',
      '見てきて。',
      '現場を見てきて',
      '自宅クラスタを見てきて',
      'クラスタを見てきて',
    ])
      expect(isVisitText(value)).toBe(true)
    for (const value of ['見てきてください', '現場を見てきて、その後教えて', '']) expect(isVisitText(value)).toBe(false)
  })
  it('道具を短い表示にする', () => {
    expect(visitToolLabel('mcp__grafana__list_alert_rules')).toBe('警告の一覧を見ています')
    expect(visitToolLabel('mcp__grafana__prometheus_query')).toBe('指標を見ています')
    expect(visitToolLabel('mcp__grafana__loki_query')).toBe('記録を見ています')
    expect(visitToolLabel('mcp__grafana__dashboard')).toBe('ダッシュボードを見ています')
    expect(visitToolLabel('mcp__grafana__search')).toBe('探しています')
    expect(visitToolLabel('mcp__grafana__datasource')).toBe('データの出どころを確かめています')
    expect(visitToolLabel('mcp__grafana__annotations')).toBe('注記を見ています')
    expect(visitToolLabel('other')).toBe('調べています')
  })
  it('専用セッションを使い、範囲外の開始で止めて報告する', async () => {
    let emit: (event: Record<string, unknown>) => void = () => {}
    let finish: (result: { status: 'failed'; error: string }) => void = () => {}
    const stop = vi.fn(async () => {
      finish({ status: 'failed', error: 'cancelled' })
      return 'ok' as const
    })
    const run = vi.fn((_id, _input, _session, _instructions, _approval, _retry, onRun) => {
      onRun('run-1')
      return new Promise<{ status: 'failed'; error: string }>((resolve) => {
        finish = resolve
      })
    })
    const hermes = {
      run,
      stop,
      events: async (_id: string, callback: typeof emit) => {
        emit = callback
      },
      approve: vi.fn(),
    } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web', activityDrainMs: 1 })
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'request-1', expiresAt: Date.now() + 10000 },
      '',
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0][2]).toMatch(/^kohako-visit-/)
    expect(conv.transcript().items[0]).toMatchObject({ text: '現場へ：自宅クラスタ', visit: { place: 'home-cluster' } })
    emit({ event: 'tool.started', tool: 'terminal' })
    await vi.waitFor(() => expect(stop).toHaveBeenCalled())
    await vi.waitFor(() => expect(conv.get('request-1')?.status).toBe('done'))
    expect(conv.get('request-1')?.reply?.text).toContain('決まりの外の道具が動きかけたので戻しました。')
  })
  it('同じ開始通知は数えず、21回目の開始を止める', async () => {
    let emit: (event: Record<string, unknown>) => void = () => {}
    let finish: (result: { status: 'failed'; error: string }) => void = () => {}
    const stop = vi.fn(async () => {
      finish({ status: 'failed', error: 'cancelled' })
      return 'ok' as const
    })
    const run = vi.fn((_id, _input, _session, _instructions, _approval, _retry, onRun) => {
      onRun('run-1')
      return new Promise<{ status: 'failed'; error: string }>((resolve) => {
        finish = resolve
      })
    })
    const hermes = {
      run,
      stop,
      events: async (_id: string, callback: typeof emit) => {
        emit = callback
      },
      approve: vi.fn(),
    } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web' })
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'request-2', expiresAt: Date.now() + 10000 },
      '',
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    for (let i = 0; i < 20; i++) emit({ event: 'tool.started', tool: 'mcp__grafana__search', tool_call_id: String(i) })
    emit({ event: 'tool.started', tool: 'mcp__grafana__search', tool_call_id: '0' })
    expect(stop).not.toHaveBeenCalled()
    emit({ event: 'tool.started', tool: 'mcp__grafana__search', tool_call_id: '20' })
    await vi.waitFor(() => expect(stop).toHaveBeenCalled())
    await vi.waitFor(() => expect(conv.get('request-2')?.reply?.text).toContain('上限に達した'))
  })
})
