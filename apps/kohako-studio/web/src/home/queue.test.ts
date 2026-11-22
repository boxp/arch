import { must } from '../must'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { addErrorText, holdLabel, MessageQueue, noticeHold, QUEUE_MAX_CHARS, QUEUE_MAX_ITEMS } from './queue'

describe('送信待ち（BOXP-508）', () => {
  it('FIFO で 1 件ずつ取り出し、同じ項目を 2 回取り出さない', () => {
    const q = new MessageQueue()
    q.add('一つ目', 1)
    q.add('  二つ目  ', 2)
    q.add('A', 3)
    expect(q.list().map((x) => x.text)).toEqual(['一つ目', '二つ目', 'A'])
    expect(q.take()?.text).toBe('一つ目')
    expect(q.take()?.text).toBe('二つ目')
    expect(q.take()?.text).toBe('A')
    expect(q.take()).toBeNull()
  })
  it('空・長すぎ・上限超過は積まない（本文は呼び出し側に残る）', () => {
    const q = new MessageQueue()
    expect(q.add('   ', 0)).toEqual({ ok: false, error: 'empty' })
    expect(q.add('あ'.repeat(QUEUE_MAX_CHARS + 1), 0)).toEqual({ ok: false, error: 'too_long' })
    for (let i = 0; i < QUEUE_MAX_ITEMS; i++) expect(q.add(`m${i}`, i).ok).toBe(true)
    expect(q.add('溢れ', 9)).toEqual({ ok: false, error: 'full' })
    expect(q.size).toBe(QUEUE_MAX_ITEMS)
  })
  it('取消は待機中の項目だけを消し、順序を保つ', () => {
    const q = new MessageQueue()
    const a = q.add('a', 0),
      b = q.add('b', 0),
      c = q.add('c', 0)
    if (!a.ok || !b.ok || !c.ok) throw new Error('add')
    expect(q.remove(b.item.id)).toBe(true)
    expect(q.remove(b.item.id)).toBe(false)
    expect(q.list().map((x) => x.text)).toEqual(['a', 'c'])
    const taken = must(q.take())
    expect(q.remove(taken.id)).toBe(false) // 送り出し済みは取り消せない
  })
  it('保留中は取り出さず、再開で先頭から続ける。受理されなかった項目は先頭へ戻る', () => {
    const q = new MessageQueue()
    q.add('a', 0)
    q.add('b', 0)
    const a = must(q.take())
    q.putBack(a)
    q.putBack(a)
    expect(q.list().map((x) => x.text)).toEqual(['a', 'b'])
    expect(q.hold('failed')).toBe(true)
    expect(q.take()).toBeNull()
    q.resume()
    expect(q.take()?.text).toBe('a')
  })
  it('空のキューは保留にせず、全部取り消すと保留も解ける', () => {
    const q = new MessageQueue()
    expect(q.hold('stopped')).toBe(false)
    q.add('x', 0)
    q.hold('auth')
    q.clear()
    expect(q.held).toBeNull()
  })
  it('送信待ちの本文を storage に保存しない', () => {
    const src =
      readFileSync(new URL('./queue.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/(local|tab)\.set\([^)]*queue/i)
    expect(readFileSync(new URL('./queue.ts', import.meta.url), 'utf8')).not.toMatch(
      /(localStorage|sessionStorage)\.|console\./,
    )
  })
})

describe('通知返信の送信待ち（BOXP-658）', () => {
  const notice = (eventId = 'event-123456', value = 'A') => ({
    eventId,
    ticketId: 'BOXP-1',
    source: 'task-board-report',
    title: '題',
    kind: 'choice' as const,
    value,
    replyId: 'reply-123456',
  })
  it('通常の発言と同じ FIFO・同じ上限に、返信先つきで積む', () => {
    const q = new MessageQueue()
    q.add('先の発言', 1)
    const added = q.addNotice(notice(), 2)
    q.add('後の発言', 3)
    expect(added.ok).toBe(true)
    expect(q.list().map((x) => x.text)).toEqual(['先の発言', '通知「題」（BOXP-1）への選択: A', '後の発言'])
    expect(q.list()[1].notice).toMatchObject({ eventId: 'event-123456', replyId: 'reply-123456', value: 'A' })
    expect(q.take()?.notice).toBeUndefined()
    expect(q.take()?.notice?.eventId).toBe('event-123456')
    for (let i = 0; i < QUEUE_MAX_ITEMS - 1; i++) q.add(`m${i}`, i)
    expect(q.addNotice(notice('event-999999'), 9)).toEqual({ ok: false, error: 'full' })
  })
  it('同じ通知への返信は 1 件まで・空や長すぎは積まない', () => {
    const q = new MessageQueue()
    expect(q.addNotice(notice(), 1).ok).toBe(true)
    expect(q.addNotice({ ...notice(), value: 'B' }, 2)).toEqual({ ok: false, error: 'duplicate' })
    expect(q.addNotice({ ...notice('event-2222222'), kind: 'text', value: '  ' }, 3)).toEqual({
      ok: false,
      error: 'empty',
    })
    expect(
      q.addNotice({ ...notice('event-2222222'), kind: 'text', value: 'あ'.repeat(QUEUE_MAX_CHARS + 1) }, 3),
    ).toEqual({ ok: false, error: 'too_long' })
    const text = q.addNotice(
      { ...notice('event-2222222'), kind: 'text', value: '  了解です  ', ticketId: undefined },
      4,
    )
    expect(text.ok && text.item.text).toBe('通知「題」への返信: 了解です')
    expect(q.noticeFor('event-2222222')?.notice?.value).toBe('了解です')
    expect(q.noticeFor('event-none')).toBeNull()
  })
  it('送信中の通知へは結果が出るまで別の返信を積まない（同じ replyId の既存返信として失われるのを防ぐ）', () => {
    const q = new MessageQueue()
    const a = q.addNotice(notice(), 1)
    const taken = must(q.take())
    expect(taken.id).toBe(must(a.ok ? a.item : null).id)
    expect(q.addNotice({ ...notice(), value: 'B' }, 2)).toEqual({ ok: false, error: 'sending' })
    expect(q.addNotice(notice('event-3333333'), 3).ok).toBe(true)
    // 受理されず先頭へ戻したら、待機中の重複として扱う。
    q.putBack(taken)
    expect(q.addNotice({ ...notice(), value: 'B' }, 4)).toEqual({ ok: false, error: 'duplicate' })
    // 送信が終わった（settle）後は積める。
    const again = must(q.take())
    q.settle(again.id)
    expect(q.addNotice({ ...notice(), value: 'B' }, 5).ok).toBe(true)
    expect(addErrorText.sending).toContain('送信中')
  })
  it('通知固有の保留は先頭の返信を取り消すと解け、他の保留は残る', () => {
    const q = new MessageQueue()
    const a = q.addNotice(notice(), 1)
    q.add('次', 2)
    q.hold('notice_replied')
    expect(noticeHold(q.held)).toBe(true)
    expect(q.take()).toBeNull()
    q.remove(must(a.ok ? a.item : null).id)
    expect(q.held).toBeNull()
    expect(q.take()?.text).toBe('次')
    const b = q.addNotice(notice(), 3)
    q.add('次', 4)
    q.hold('unknown')
    q.remove(must(b.ok ? b.item : null).id)
    expect(q.held).toBe('unknown')
  })
  it('保留理由の文言がすべてある', () => {
    for (const r of ['busy', 'notice_replied', 'notice_gone', 'notice_invalid'] as const)
      expect(holdLabel[r]).toBeTruthy()
    expect(addErrorText.duplicate).toContain('送信待ち')
  })
})
