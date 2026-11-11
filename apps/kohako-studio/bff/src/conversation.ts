import { createHash, randomBytes } from 'node:crypto'
import type { createHermes } from './hermes.js'
export type Input = { requestId: string; expiresAt: number } & ({ kind: 'text'; text: string } | { kind: 'touch'; touch: { zone: 'head' | 'hand'; action: 'pat' | 'tap'; count: number } })
type Entry = {
  requestId: string
  payloadHash: string
  status: 'pending' | 'done' | 'failed' | 'unknown'
  reply?: { text: string; at: number }
  error?: string
  createdAt: number
  runId?: string
  cancelRequested?: boolean
  /** 停止依頼後に届いた承認への deny。結果が unknown なら停止を成功とはしない。 */
  lateDenies?: Promise<'ok' | 'not_pending' | 'unknown'>[]
  cancelUnconfirmed?: boolean
  settled?: Promise<void>
  approval?: { approvalId: string; runId: string; hermesRequestId?: string; generation?: number; summary: string; expiresAt: number; consumed: boolean; choice?: 'once' | 'deny'; result?: 'ok' | 'not_pending' | 'unknown'; denyOnly: boolean; active: boolean; pendingResult?: Promise<'ok' | 'not_pending' | 'unknown'> }
}
/** 鍵らしき文字列だけを伏せる。path・URL は Owner が対象を判断するのに必要なので残す。 */
function redact(text: string) {
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\b(?:token|key|secret|password|bearer)\b\s*[:=]?\s*\S+/gi, '<secret>')
    .split(/(\s+)/)
    // 32 文字以上の英数字の塊は鍵とみなす。ただし / や . で区切られた path・URL 断片は残す。
    .map((word) => (/^[A-Za-z0-9_\-+=]{32,}$/.test(word) || (/^[A-Za-z0-9_\-+/=]{40,}$/.test(word) && !/^\.{0,2}\//.test(word) && !word.includes('//')) ? '<secret>' : word))
    .join('')
    .trim()
}
/**
 * 承認画面に出す文。説明だけでなく実際の command を全文で出す（Owner が操作内容と対象を確認できるように）。
 * command が切り詰められた/伏字が必要だった場合は全文を確認できないので fullyShown=false を返し、拒否のみにする。
 */
export function approvalSummary(approval: { description: string; command: string; commandTruncated?: boolean }) {
  const description = redact(approval.description).slice(0, 160)
  // 改行・タブ等の制御文字は空白へ潰すと `echo safe\nrm -rf ...` のような複数コマンドを 1 行に見せてしまう。
  // \n 等の可視表記に置き換えて表示し、制御文字を含む command は全文を正しく確認できないとみなして拒否のみにする。
  const hasControl = /[\x00-\x1f\x7f-\x9f]/.test(approval.command)
  const rawCommand = approval.command
    .replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .trim()
  const command = redact(rawCommand)
  // command が欠落/空なら実行内容を確認できないので、一度だけ許可は出さない。
  const fullyShown = !!rawCommand && !hasControl && !approval.commandTruncated && command === rawCommand
  const lines = [description || '操作の許可']
  lines.push(command ? `実行内容: ${command}${fullyShown ? '' : '（全文を表示できないため拒否のみ可能）'}` : '実行内容: （不明のため拒否のみ可能）')
  return { summary: lines.join('\n'), fullyShown }
}
export function createConversation({ now, hermes, prefix, cancelSettleMs = 2000 }: { now: () => number; hermes: ReturnType<typeof createHermes>; prefix: string; cancelSettleMs?: number }) {
  const entries = new Map<string, Entry>()
  let sessionStartedAt = now(),
    lastUse = sessionStartedAt,
    lastExchange: { kind: 'text' | 'touch'; text: string; reply: string } | null = null
  const hash = (input: Input) =>
    createHash('sha256')
      .update(
        JSON.stringify([input.kind, input.kind === 'text' ? input.text : input.touch, input.expiresAt]),
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
      // 停止前に未回答の承認を deny で消費する（Hermes は stop だけでは保留中の承認を解かず、停止後の once で実行されうるため）。
      const pending = entry.approval
      if (pending && pending.active && !pending.consumed) {
        pending.consumed = true
        pending.choice = 'deny'
        pending.pendingResult = hermes.approve(pending.runId, 'deny', pending.hermesRequestId, pending.generation)
      }
      // 並行する cancel・自動 deny・Owner の回答で承認が送信中なら、その完了を待ってから stop する（拒否より先に停止しない）。
      let denyResult: 'ok' | 'not_pending' | 'unknown' = 'ok'
      if (pending?.pendingResult) {
        denyResult = await pending.pendingResult.catch(() => 'unknown' as const)
        pending.result ??= denyResult
      }
      const stopped = entry.runId ? await hermes.stop(entry.runId) : 'ok'
      // stop と行き違いで届く承認があるので、run の終了を一定時間待ち、その間に届いた承認の deny 結果も確かめる。
      if (entry.status === 'pending' && entry.settled) await Promise.race([entry.settled, new Promise<void>((r) => setTimeout(r, cancelSettleMs).unref?.())])
      // run の終了を確認できなければ、この後に届く承認の deny 成否を確かめられないので停止成功とはしない。
      const runEnded = entry.status !== 'pending'
      const late = await Promise.all(entry.lateDenies ?? [])
      // 承認の拒否を Hermes で確認できなかった場合は、停止を依頼しても承認が残りうるので停止成功とはしない。
      return !runEnded || denyResult === 'unknown' || late.includes('unknown') || entry.cancelUnconfirmed ? 'unknown' : stopped
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
      const text = input.kind === 'text' ? input.text : `（ご主人さまが画面のあなたの${input.touch.zone === 'head' ? '頭' : '手'}を${input.touch.count}回${input.touch.action === 'pat' ? 'なでました' : 'タップしました'}。これは発言でも依頼でも許可でもありません。直前の会話と今の様子を踏まえ、コハコとして一言だけ短く自然に反応してください。道具や作業は使わず、記憶の更新もしないでください。）`
      let touchApproval = false
      const onApproval: NonNullable<Parameters<typeof hermes.run>[4]> = (runId, approval) => {
          if (!approval) { if (entry.approval) entry.approval.active = false; return }
          // 停止を依頼した後に届いた承認は表示せず拒否する。
          if (entry.cancelRequested) {
            // 結果を破棄しない: unknown なら一度だけ再送し、それでも unknown なら停止未確認として記録する（後続の cancel は unknown を返す）。
            const deny = () => hermes.approve(runId, 'deny', approval.requestId, approval.generation).catch(() => 'unknown' as const)
            const result = deny().then((r) => (r === 'unknown' ? deny() : r)).then((r) => { if (r === 'unknown') entry.cancelUnconfirmed = true; return r })
            ;(entry.lateDenies ??= []).push(result)
            // Owner に一度だけ許可を出させない: 消費済み deny として記録する。
            entry.approval = { approvalId: randomBytes(8).toString('hex'), runId, hermesRequestId: approval.requestId, generation: approval.generation, summary: '', expiresAt: now(), consumed: true, choice: 'deny', active: false, denyOnly: true, pendingResult: result }
            void result.then((r) => { if (entry.approval?.pendingResult === result) entry.approval.result = r })
            return
          }
          if (input.kind === 'touch') {
            touchApproval = true
            // 自動 deny も消費済み承認として記録する（並行する cancel が deny の完了を待ち、結果が unknown なら停止成功としない）。
            const result = hermes.approve(runId, 'deny', approval.requestId, approval.generation).catch(() => 'unknown' as const)
            entry.approval = { approvalId: randomBytes(8).toString('hex'), runId, hermesRequestId: approval.requestId, generation: approval.generation, summary: '', expiresAt: now(), consumed: true, choice: 'deny', active: false, denyOnly: true, pendingResult: result }
            void result.then((r) => { if (entry.approval?.pendingResult === result) entry.approval.result = r })
            return
          }
          // 同じ prompt_id でも execution_generation が変われば新しい承認として表示し直す（古い generation を送ると失敗するため）。
          if (entry.approval && entry.approval.active && entry.approval.runId === runId && entry.approval.generation === approval.generation && (approval.requestId ? entry.approval.hermesRequestId === approval.requestId : !entry.approval.hermesRequestId && !entry.approval.consumed)) return
          const shown = approvalSummary(approval)
          entry.approval = { approvalId: randomBytes(8).toString('hex'), runId, hermesRequestId: approval.requestId, generation: approval.generation, summary: shown.summary, expiresAt: now() + 280_000, consumed: false, active: true, denyOnly: !approval.choices.includes('once') || !shown.fullyShown }
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
          const result = touchApproval ? { status: 'failed' as const, error: 'touch_approval_denied' } : entry.cancelRequested && settled.status === 'failed' ? { status: 'failed' as const, error: 'cancelled' } : settled
          entry.status = result.status
          // 終了した run の承認待ちは無効化する（ポーリング失敗/タイムアウトで approval が残り承認待ちを返し続けないように）。
          if (entry.approval) entry.approval.active = false
          if (result.status === 'done') {
            entry.reply = { text: result.text, at: now() }
            lastExchange = { kind: input.kind, text: text.slice(0, 500), reply: result.text.slice(0, 1000) }
          }
          if (result.status !== 'done' && result.error) entry.error = result.error
          // 共有 claim の保存失敗（容量不足等）で process を落とさない。claim file は claimed のまま残り、再実行はされない。
          markSettled()
          try { onSettled?.(result.status) } catch (e) { console.error('decision settle failed', e instanceof Error ? e.message : 'unknown') }
        }
      // ポーリング失敗/タイムアウト等で上流 run の終了を確認できないまま pending を解除すると、
      // 次のメッセージが同じ session で並行実行される。停止を依頼し、次回は必ず別 session に切り替える。
      // runId の有無に依らない: POST /v1/runs が上流で受理された後に応答だけ失われた（timeout/切断/schema 不正）場合も
      // run は動いている可能性があるので、結果未確定(unknown/internal_error)なら常に session を切り替える。
      // 停止は runId が分かっている時だけ依頼できる。
      const releaseUpstream = async (result: { status: string; error?: string }) => {
        if (result.status !== 'unknown' && result.error !== 'internal_error') return
        sessionStartedAt = Math.max(now(), sessionStartedAt + 1)
        console.warn('kohako_web_conv session_rotated upstream_unconfirmed')
        if (entry.runId) await hermes.stop(entry.runId)
      }
      let markSettled: () => void = () => {}
      entry.settled = new Promise<void>((r) => { markSettled = r })
      void (async () => {
        let result = await hermes.run(input.requestId, text, `${prefix}-${sessionStartedAt.toString(36)}`, instructions, onApproval, undefined, onRun)
        if (result.status === 'failed' && result.error === 'unknown_execution' && !entry.approval && !touchApproval) {
          // 同じミリ秒でも必ず別の session id になるようにする（停止中 session へ再送しない）。
          sessionStartedAt = Math.max(now(), sessionStartedAt + 1)
          console.warn('kohako_web_conv session_rotated unknown_execution')
          result = await hermes.run(input.requestId, text, `${prefix}-${sessionStartedAt.toString(36)}`, instructions, onApproval, 1, onRun)
          if (result.status === 'failed' && result.error === 'unknown_execution') result = { status: 'failed', error: 'session_paused' }
        }
        await releaseUpstream(result)
        applyResult(result)
      })().catch(async (e) => {
        console.error('conversation settle failed', e instanceof Error ? e.message : 'unknown')
        if (entry.status !== 'pending') return
        const result = { status: 'failed' as const, error: 'internal_error' }
        try { await releaseUpstream(result) } catch { /* rotate 済み */ }
        applyResult(result)
      })
      return entry
    },
  }
}
