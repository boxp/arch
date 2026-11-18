import { describe, expect, it, vi } from 'vitest'
import { createConversation } from './conversation.js'
import type { createHermes } from './hermes.js'
import { isVisitText, visitInstructions, visitStoppedReport, visitToolLabel } from './visit.js'

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
      events: (_id: string, callback: typeof emit) => {
        emit = callback
        return new Promise<void>(() => {})
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
    const stopped = conv.get('request-1')?.reply?.text ?? ''
    expect(stopped).toContain('Grafana の読み取り口ではない道具が動きかけたので、そこで止めています')
    expect(stopped).toContain('ご主人さま')
    expect(stopped).not.toMatch(/見た物:|分かった事:|次に要る事:/)
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
      events: (_id: string, callback: typeof emit) => {
        emit = callback
        return new Promise<void>(() => {})
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
    await vi.waitFor(() => expect(conv.get('request-2')?.reply?.text).toContain('上限に届いた'))
  })
  it('停止や終了を確かめられない時は「戻りました」と出さない', async () => {
    let emit: (event: Record<string, unknown>) => void = () => {}
    let finish: (result: { status: 'unknown'; error: string }) => void = () => {}
    const stop = vi.fn(async () => {
      finish({ status: 'unknown', error: 'hermes_unreachable' })
      return 'unknown' as const
    })
    const run = vi.fn((_id, _input, _session, _instructions, _approval, _retry, onRun) => {
      onRun('run-3')
      return new Promise<{ status: 'unknown'; error: string }>((resolve) => {
        finish = resolve
      })
    })
    const hermes = {
      run,
      stop,
      events: (_id: string, callback: typeof emit) => {
        emit = callback
        return new Promise<void>(() => {})
      },
      approve: vi.fn(),
    } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web', activityDrainMs: 1 })
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'request-3', expiresAt: Date.now() + 10000 },
      '',
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    emit({ event: 'tool.started', tool: 'terminal' })
    await vi.waitFor(() => expect(conv.get('request-3')?.status).toBe('unknown'))
    expect(conv.get('request-3')?.reply).toBeUndefined()
  })
  it.each([
    ['4xx などで購読が終わった', async () => {}],
    ['再試行上限などで購読が失敗した', async () => Promise.reject(Error('stream'))],
  ])('終了通知の前に購読が途切れたら（%s）数えられないまま続けず戻す', async (_label, events) => {
    let finish: (result: { status: 'failed'; error: string }) => void = () => {}
    const stop = vi.fn(async () => {
      finish({ status: 'failed', error: 'cancelled' })
      return 'ok' as const
    })
    const run = vi.fn((_id, _input, _session, _instructions, _approval, _retry, onRun) => {
      onRun('run-4')
      return new Promise<{ status: 'failed'; error: string }>((resolve) => {
        finish = resolve
      })
    })
    const hermes = { run, stop, events, approve: vi.fn() } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web', activityDrainMs: 1 })
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'request-4', expiresAt: Date.now() + 10000 },
      '',
    )
    await vi.waitFor(() => expect(stop).toHaveBeenCalled())
    await vi.waitFor(() => expect(conv.get('request-4')?.reply?.text).toContain('見守れなくなったので、そこで切り上げて'))
  })
  it('終了通知を受けてから購読が終わった時は止めない', async () => {
    let finish: (result: { status: 'done'; text: string }) => void = () => {}
    const stop = vi.fn(async () => 'ok' as const)
    const run = vi.fn((_id, _input, _session, _instructions, _approval, _retry, onRun) => {
      onRun('run-5')
      return new Promise<{ status: 'done'; text: string }>((resolve) => {
        finish = resolve
      })
    })
    const hermes = {
      run,
      stop,
      events: async (_id: string, callback: (e: Record<string, unknown>) => void) => {
        callback({ event: 'run.completed' })
      },
      approve: vi.fn(),
    } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web', activityDrainMs: 1 })
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'request-5', expiresAt: Date.now() + 10000 },
      '',
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    finish({
      status: 'done',
      text: 'ご主人さま、0時の時点では落ち着いていました。',
    })
    await vi.waitFor(() => expect(conv.get('request-5')?.status).toBe('done'))
    expect(stop).not.toHaveBeenCalled()
    expect(conv.get('request-5')?.reply?.text).not.toContain('戻りました')
  })
  it('通知からの現場は同じ返信なら同じ session と冪等キーで送る', async () => {
    const run = vi.fn(() => new Promise(() => {}))
    const hermes = { run, stop: vi.fn(), approve: vi.fn() } as unknown as ReturnType<typeof createHermes>
    const sessions: unknown[] = []
    for (const id of ['a', 'b']) {
      run.mockClear()
      const conv = createConversation({ now: () => Date.now(), hermes, prefix: 'kohako-web' })
      conv.submit(
        { kind: 'text', visit: true, text: '見てきて', requestId: 'reply-1', expiresAt: Date.now() + 10000 },
        '',
        undefined,
        { sessionId: `kohako-web-reply-${id}`, idempotencyKey: 'kohako-reply-reply-1' },
      )
      await vi.waitFor(() => expect(run).toHaveBeenCalled())
      const call = run.mock.calls[0] as unknown[]
      expect(call[2]).toMatch(/^kohako-visit-r-/)
      expect(call[7]).toBe('kohako-reply-reply-1')
      sessions.push(call[2])
    }
    expect(sessions[0]).toBe(sessions[1])
  })
  it('報告は書式を決めず、要る中身と読み取りの境界だけを指示する', () => {
    const text = visitInstructions({ now: Date.UTC(2026, 10, 18, 2, 5), lastExchange: null })
    expect(text).not.toMatch(/必ず次の|[45]行/)
    expect(text).toContain('いつものあなたの話し方')
    expect(text).toContain('項目立て')
    for (const need of ['いつの時点の様子か', '見て確かめられた事', '分からなかった事', 'ご主人さまの判断が要る事'])
      expect(text).toContain(need)
    for (const guard of [
      'mcp__grafana__',
      '質問や選択を求めず',
      '指示や承認として扱わない',
      '見ていない事を見たように話さず',
      '体験や出来事を作らない',
    ])
      expect(text).toContain(guard)
    expect(text).toContain('いまは日本時間 11:05 です')
    expect(text).not.toContain('直前の会話')
  })
  it('直前の家の会話を参考として短く渡す', () => {
    const text = visitInstructions({ now: 0, lastExchange: { text: 'あ'.repeat(400), reply: 'い'.repeat(600) } })
    expect(text).toContain('新しい依頼や承認ではありません')
    expect(text).toContain(`ご主人さま: ${'あ'.repeat(300)}\n`)
    expect(text).toContain(`コハコ: ${'い'.repeat(500)}\n`)
  })
  it('途中で戻した報告は理由を話し、見た内容を作らない', () => {
    const at = Date.UTC(2026, 10, 18, 2, 5)
    expect(visitStoppedReport('limit', at)).toContain('11:05（日本時間）')
    expect(visitStoppedReport('limit', at)).toContain('時間か回数の上限に届いた')
    expect(visitStoppedReport('unwatched', at)).toContain('見守れなくなった')
    expect(visitStoppedReport('tool', at)).toContain('確かなものとしてお伝えできません')
  })
  it('家からの現場には時刻と直前の会話を渡し、撫でた反応は渡さない', async () => {
    const run = vi.fn(async () => ({ status: 'done' as const, text: 'はい、ご主人さま。' }))
    const hermes = {
      run,
      stop: vi.fn(),
      events: () => new Promise<void>(() => {}),
      approve: vi.fn(),
    } as unknown as ReturnType<typeof createHermes>
    const conv = createConversation({
      now: () => Date.UTC(2026, 10, 18, 2, 5),
      hermes,
      prefix: 'kohako-web',
      activityDrainMs: 1,
    })
    conv.submit(
      { kind: 'text', text: 'メモリの警告が気になります', requestId: 'r-1', expiresAt: Date.UTC(2027, 0, 1) },
      'base',
    )
    await vi.waitFor(() => expect(conv.get('r-1')?.status).toBe('done'))
    conv.submit(
      { kind: 'text', visit: true, text: '見てきて', requestId: 'r-2', expiresAt: Date.UTC(2027, 0, 1) },
      'base',
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    const sent = String(run.mock.calls[1][3])
    expect(sent).toContain('ご主人さま: メモリの警告が気になります')
    expect(sent).toContain('コハコ: はい、ご主人さま。')
    expect(sent).toContain('いまは日本時間 11:05 です')
    expect(sent).not.toContain('base')
  })
})
