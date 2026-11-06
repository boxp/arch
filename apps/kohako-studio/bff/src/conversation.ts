import { createHash, randomBytes } from 'node:crypto'
import type { createHermes } from './hermes.js'
export type Input = {
  requestId: string
  kind: 'text'
  text: string
  expiresAt: number
}
type Entry = {
  requestId: string
  payloadHash: string
  status: 'pending' | 'done' | 'failed' | 'unknown'
  reply?: { text: string; at: number }
  error?: string
  createdAt: number
  runId?: string
  cancelRequested?: boolean
  approval?: { approvalId: string; runId: string; hermesRequestId?: string; generation?: number; summary: string; expiresAt: number; consumed: boolean; choice?: 'once' | 'deny'; result?: 'ok' | 'not_pending' | 'unknown'; denyOnly: boolean; active: boolean; pendingResult?: Promise<'ok' | 'not_pending' | 'unknown'> }
}
/**
 * 承認画面に出す文。Owner が何を許可するのか分かるよう path・URL は残し（伏せると判断できない）、
 * 鍵らしき文字列だけを伏せる（Hermes 側でも伏字済み）。Hermes の gate は全文が収まる操作だけを承認に回す。
 */
export function approvalSummary(text: string) {
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\b(?:token|key|secret|password|bearer)\b\s*[:=]?\s*\S+/gi, '<secret>')
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, '<secret>')
    .trim()
    .slice(0, 160)
}
export function createConversation({ now, hermes, prefix }: { now: () => number; hermes: ReturnType<typeof createHermes>; prefix: string }) {
  const entries = new Map<string, Entry>()
  let sessionStartedAt = now(),
    lastUse = sessionStartedAt,
    lastExchange: { text: string; reply: string } | null = null
  const hash = (input: Input) =>
    createHash('sha256')
      .update(
        JSON.stringify([input.kind, input.text, input.expiresAt]),
      )
      .digest('hex')
  function clean() {
    for (const [id, e] of entries) if (e.status !== 'pending' && now() - e.createdAt > 86_400_000) entries.delete(id)
  }
  return {
    get sessionStartedAt() {
      return sessionStartedAt
    },
    get lastExchange() {
      return lastExchange
    },
    get(id: string) {
      clean()
      return entries.get(id)
    },
    check(input: Input) {
      clean()
      const entry = entries.get(input.requestId)
      return entry ? (entry.payloadHash === hash(input) ? entry : { error: 'request_conflict' as const }) : undefined
    },
    async approve(requestId: string, approvalId: string, choice: 'once' | 'deny') {
      const entry = entries.get(requestId)
      if (!entry) return 'unknown_request' as const
      const approval = entry.approval
      if (!approval || approval.approvalId !== approvalId) return 'approval_stale' as const
      if (approval.consumed) {
        if (approval.choice !== choice) return 'approval_conflict' as const
        return approval.result ?? await approval.pendingResult ?? 'unknown'
      }
      if (!approval.active) return 'approval_stale' as const
      if (now() >= approval.expiresAt) return 'approval_expired' as const
      if (approval.denyOnly && choice === 'once') return 'approval_stale' as const
      approval.consumed = true
      approval.choice = choice
      approval.pendingResult = hermes.approve(approval.runId, choice, approval.hermesRequestId, approval.generation)
      approval.result = await approval.pendingResult
      return approval.result
    },
    /** 実行中の run を止める。run id がまだ無ければ判明した時点で止める。止めた結果は failed/cancelled になる。 */
    async cancel(requestId: string): Promise<'ok' | 'not_pending' | 'unknown'> {
      const entry = entries.get(requestId)
      if (!entry || entry.status !== 'pending') return 'not_pending'
      entry.cancelRequested = true
      return entry.runId ? hermes.stop(entry.runId) : 'ok'
    },
    submit(input: Input, instructions: string, onSettled?: (status: 'done' | 'failed' | 'unknown') => void): Entry | { error: 'request_conflict' | 'busy' } {
      const existing = this.check(input)
      if (existing) return existing
      if ([...entries.values()].some((e) => e.status === 'pending')) return { error: 'busy' }
      while (entries.size >= 200) entries.delete(entries.keys().next().value!)
      if (now() - lastUse > 6 * 3600_000) {
        sessionStartedAt = now()
        lastExchange = null
      }
      lastUse = now()
      const entry: Entry = { requestId: input.requestId, payloadHash: hash(input), status: 'pending', createdAt: now() }
      entries.set(input.requestId, entry)
      const onApproval: NonNullable<Parameters<typeof hermes.run>[4]> = (runId, approval) => {
          if (!approval) { if (entry.approval) entry.approval.active = false; return }
          if (entry.approval && entry.approval.active && entry.approval.runId === runId && (approval.requestId ? entry.approval.hermesRequestId === approval.requestId : !entry.approval.hermesRequestId && !entry.approval.consumed)) return
          entry.approval = { approvalId: randomBytes(8).toString('hex'), runId, hermesRequestId: approval.requestId, generation: approval.generation, summary: approvalSummary(approval.description || approval.command || '操作の許可'), expiresAt: now() + 280_000, consumed: false, active: true, denyOnly: !approval.choices.includes('once') }
          // 放置は拒否: 期限で一度だけ deny を中継する（Hermes 側の timeout を待たずに会話を空ける）。
          const pending = entry.approval
          if (pending.denyOnly) {
            pending.consumed = true
            pending.choice = 'deny'
            pending.pendingResult = hermes.approve(pending.runId, 'deny', pending.hermesRequestId, pending.generation)
            void pending.pendingResult.then((result) => { pending.result = result })
            return
          }
          setTimeout(() => {
            if (entry.approval !== pending || pending.consumed || !pending.active) return
            pending.consumed = true
            pending.choice = 'deny'
            pending.pendingResult = hermes.approve(pending.runId, 'deny', pending.hermesRequestId, pending.generation)
            void pending.pendingResult.then((result) => { pending.result = result })
          }, 280_000).unref?.()
        }
      const onRun = (runId: string) => { entry.runId = runId; if (entry.cancelRequested) void hermes.stop(runId) }
      const applyResult = (settled: Awaited<ReturnType<typeof hermes.run>>) => {
          const result = entry.cancelRequested && settled.status === 'failed' ? { status: 'failed' as const, error: 'cancelled' } : settled
          entry.status = result.status
          if (result.status === 'done') {
            entry.reply = { text: result.text, at: now() }
            lastExchange = { text: input.text.slice(0, 500), reply: result.text.slice(0, 1000) }
          }
          if (result.status !== 'done' && result.error) entry.error = result.error
          // 共有 claim の保存失敗（容量不足等）で process を落とさない。claim file は claimed のまま残り、再実行はされない。
          try { onSettled?.(result.status) } catch (e) { console.error('decision settle failed', e instanceof Error ? e.message : 'unknown') }
        }
      void (async () => {
        let result = await hermes.run(input.requestId, input.text, `${prefix}-${sessionStartedAt.toString(36)}`, instructions, onApproval, undefined, onRun)
        if (result.status === 'failed' && result.error === 'unknown_execution' && !entry.approval) {
          // 同じミリ秒でも必ず別の session id になるようにする（停止中 session へ再送しない）。
          sessionStartedAt = Math.max(now(), sessionStartedAt + 1)
          console.warn('kohako_web_conv session_rotated unknown_execution')
          result = await hermes.run(input.requestId, input.text, `${prefix}-${sessionStartedAt.toString(36)}`, instructions, onApproval, 1, onRun)
          if (result.status === 'failed' && result.error === 'unknown_execution') result = { status: 'failed', error: 'session_paused' }
        }
        applyResult(result)
      })().catch((e) => { console.error('conversation settle failed', e instanceof Error ? e.message : 'unknown') })
      return entry
    },
  }
}
