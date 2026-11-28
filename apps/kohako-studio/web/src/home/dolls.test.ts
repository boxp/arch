import { expect, it } from 'vitest'
import { ago, cardOf, dollImage, dollsKey, dollsView, ticketLink, type DollGroup } from './dolls'
// 期待値は現行仕様 Projects/kohako-home/model-dolls-home-spec.md の 2〜5 章から。
const doll = (key: string, n = 1, plainLabel: string | null = null): DollGroup => ({
  key,
  name: `${key}の人形`,
  version: 1,
  model: key === 'plain' ? null : `m-${key}`,
  plainLabel,
  tickets: Array.from({ length: n }, (_, i) => ({ id: `BOXP-${i + 1}`, assignee: `a-${key}`, model: `m-${key}` })),
})
const status = (dolls: DollGroup[], state = 'ok') => ({ tasks: { state, dolls } })
it('状態: 確認中・作業中・作業なし・古い情報・確認できない（3 章）', () => {
  expect(dollsView(null, false, 'pc')).toMatchObject({ state: 'loading', shown: [] })
  expect(dollsView(status([doll('opus')]), false, 'pc')).toMatchObject({ state: 'working', more: 0 })
  expect(dollsView(status([]), false, 'pc')).toMatchObject({ state: 'none', shown: [] })
  expect(dollsView(status([doll('opus')]), true, 'pc')).toMatchObject({ state: 'stale', shown: [{ key: 'opus' }] })
  expect(dollsView(status([]), true, 'pc')).toMatchObject({ state: 'stale', shown: [] })
  expect(dollsView(null, true, 'pc')).toMatchObject({ state: 'unavailable', shown: [] })
  expect(dollsView(status([], 'unavailable'), false, 'pc')).toMatchObject({ state: 'unavailable', shown: [] })
})
it('PC・横画面は 5 体、スマホ縦は 3 体まで、残りは +N（D5）', () => {
  const six = ['fable', 'opus', 'sonnet', 'terra', 'sol', 'luna'].map((k) => doll(k))
  expect(dollsView(status(six), false, 'pc')).toMatchObject({ more: 1 })
  expect(dollsView(status(six), false, 'pc').shown.map((d) => d.key)).toEqual([
    'fable',
    'opus',
    'sonnet',
    'terra',
    'sol',
  ])
  expect(dollsView(status(six), false, 'landscape').shown).toHaveLength(5)
  expect(dollsView(status(six), false, 'portrait')).toMatchObject({ more: 3 })
  expect(dollsView(status(six.slice(0, 3)), false, 'portrait')).toMatchObject({ more: 0 })
  expect(dollsView(status(six.slice(0, 5)), false, 'pc')).toMatchObject({ more: 0 })
})
it('絵は家の中の決まった場所だけを指し、形の違う鍵は無地にする（D3）', () => {
  // D7・D8: 机で作業する版 2。版 1 は配備の切り替わり中のために残す。
  expect(dollImage('opus', 2)).toBe('./kohako/dolls/opus-v2.webp')
  expect(dollImage('opus', 1)).toBe('./kohako/dolls/opus-v1.webp')
  expect(dollImage('plain', 2)).toBe('./kohako/dolls/plain-v2.webp')
  expect(dollImage('../x', 2)).toBe('./kohako/dolls/plain-v2.webp')
  expect(dollImage('newfamily', 2)).toBe('./kohako/dolls/plain-v2.webp')
  expect(dollImage('opus', 3)).toBe('./kohako/dolls/plain-v2.webp')
  expect(dollImage('opus', 0)).toBe('./kohako/dolls/plain-v2.webp')
})
it('何分前の記録か（T4）', () => {
  const now = Date.parse('2026-11-28T11:00:00Z')
  expect(ago('2026-11-28T10:59:40Z', now)).toBe('1分以内')
  expect(ago('2026-11-28T10:30:00Z', now)).toBe('30分前')
  expect(ago('2026-11-28T08:00:00Z', now)).toBe('3時間前')
  expect(ago('2026-11-25T11:00:00Z', now)).toBe('3日前')
  expect(ago(null, now)).toBe('時刻不明')
  expect(ago('bad', now)).toBe('時刻不明')
})
it('カードの中身: 担当名と実行モデル（見込み）を分け、状況は有るものだけ（T4）', () => {
  const now = Date.parse('2026-11-28T11:00:00Z')
  const d = doll('opus')
  const c = cardOf(
    d,
    d.tickets[0],
    {
      state: 'ok',
      fetchedAt: '2026-11-28T10:59:00Z',
      item: {
        id: 'BOXP-1',
        title: '人形を置く',
        assignee: 'claude-opus',
        status: 'in-progress',
        ticketUpdatedAt: '2026-11-28T10:00:00Z',
        latestNoteAt: '2026-11-28T10:50:00Z',
        latestNoteSource: 'claude-opus',
        progress: '<b>実装中</b>',
        blocker: null,
        decision: '本人の判断待ち',
        readError: null,
      },
    },
    now,
  )
  expect(c).toEqual({
    name: 'opusの人形',
    assignee: '担当 a-opus',
    model: '実行モデル（見込み） m-opus',
    ticket: 'BOXP-1 人形を置く',
    noteHead: '最新の記録 10分前・claude-opus',
    noteBody: '<b>実装中</b>',
    situation: ['判断: 本人の判断待ち'],
    fresh: '取得 1分前',
  })
  const p = doll('plain', 1, 'モデル未確認')
  const none = cardOf(
    p,
    p.tickets[0],
    {
      state: 'ok',
      fetchedAt: '2026-11-28T10:59:00Z',
      item: {
        id: 'BOXP-1',
        title: null,
        assignee: 'x',
        status: null,
        ticketUpdatedAt: null,
        latestNoteAt: null,
        latestNoteSource: null,
        progress: null,
        blocker: '止まり',
        decision: null,
        readError: null,
      },
    },
    now,
  )
  expect(none).toMatchObject({
    model: '実行モデル モデル未確認',
    ticket: 'BOXP-1',
    noteHead: '最新の記録はありません',
    noteBody: '',
    situation: ['止まり: 止まり'],
  })
  expect(cardOf(d, d.tickets[0], null, now)).toMatchObject({
    noteHead: '記録を取得中',
    noteBody: '',
    situation: [],
    fresh: '',
  })
  expect(cardOf(d, d.tickets[0], 'error', now)).toMatchObject({ noteHead: '記録を取得できません', fresh: '' })
})
it('並びの鍵: 件数が同じでも票が入れ替われば作り直す（古い票の ID で開かない）', () => {
  const a = dollsView(status([doll('opus', 2)]), false, 'pc')
  const swapped = doll('opus', 2)
  swapped.tickets = [{ ...swapped.tickets[0], id: 'BOXP-9' }, swapped.tickets[1]]
  expect(dollsKey(dollsView(status([swapped]), false, 'pc'))).not.toBe(dollsKey(a))
  expect(dollsKey(dollsView(status([doll('opus', 2)]), false, 'pc'))).toBe(dollsKey(a))
})

it('カードに非公式の添え書きを出さない (BOXP-766 TD-02)', () => {
  const d = doll('opus', 1)
  const c = cardOf(d, d.tickets[0], null, Date.parse('2026-11-28T11:00:00Z'))
  expect(JSON.stringify(c)).not.toContain('非公式')
})

it('家に置く絵は 9 体とも版 1・版 2 がそろっている（D7・D8）', async () => {
  const { existsSync } = await import('node:fs')
  for (const key of ['fable', 'opus', 'sonnet', 'terra', 'sol', 'luna', 'astra', 'neon', 'plain'])
    for (const v of [1, 2])
      expect(existsSync(new URL(`../../public/kohako/dolls/${key}-v${v}.webp`, import.meta.url))).toBe(true)
})

it('Obsidianで開く: 選んだ票の詳細が取れた時だけ、BOXP vault の票を開くリンク（T7, BOXP-766 TD-04）', () => {
  const ok = (id: string) => ({
    state: 'ok' as const,
    fetchedAt: '2026-11-28T00:00:00Z',
    item: { id } as unknown as import('./dolls').TicketDetail,
  })
  expect(ticketLink('BOXP-766', ok('BOXP-766'))).toEqual({
    id: 'BOXP-766',
    href: 'obsidian://open?vault=BOXP&file=Tickets%2FBOXP-766.md',
  })
  expect(ticketLink('BOXP-1', ok('BOXP-1'))?.href).toBe('obsidian://open?vault=BOXP&file=Tickets%2FBOXP-1.md')
  // 取得中・失敗・別の票の結果（切り替え直後）では出さない
  expect(ticketLink('BOXP-762', null)).toBeNull()
  expect(ticketLink('BOXP-762', 'error')).toBeNull()
  expect(ticketLink('BOXP-762', ok('BOXP-766'))).toBeNull()
  // 不正な番号では出さない
  for (const bad of ['BOXP-07', 'BOXP-0', 'BOXP-1234567', 'BOXP-1/../x', '../Boards', 'boxp-1', 'BOXP-1 ', ''])
    expect(ticketLink(bad, ok(bad))).toBeNull()
})
