import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createApp, instructions, ownerTaskInstructions, studioInstructions } from './app.js'
import type { createHermes } from './hermes.js'
import { LOCATION_FRESH_MS, locationInstructions, locationLogLine, parseLocation } from './location.js'

// 架空の位置（実在の本人位置ではない）: 東京駅付近。
const NOW = Date.UTC(2026, 10, 21, 3, 0, 0)
const ok = { status: 'ok', lat: 35.68123, lon: 139.76712, accuracy: 25, capturedAt: NOW - 90_000 }

describe('parseLocation', () => {
  it('accepts a fresh fix and the miss reasons', () => {
    expect(parseLocation(ok, NOW)).toEqual(ok)
    for (const status of ['off', 'denied', 'unavailable', 'timeout', 'unsupported', 'stale'])
      expect(parseLocation({ status }, NOW)).toEqual({ status })
  })
  it('turns an old fix into stale instead of current', () => {
    expect(parseLocation({ ...ok, capturedAt: NOW - LOCATION_FRESH_MS - 1 }, NOW)).toEqual({ status: 'stale' })
    expect(parseLocation({ ...ok, capturedAt: NOW - LOCATION_FRESH_MS }, NOW)).toEqual({
      ...ok,
      capturedAt: NOW - LOCATION_FRESH_MS,
    })
  })
  it('rejects malformed or out-of-range values', () => {
    for (const bad of [
      null,
      'ok',
      {},
      { status: 'nope' },
      { status: 'off', lat: 1 },
      { ...ok, lat: 91 },
      { ...ok, lon: -181 },
      { ...ok, lat: '35' },
      { ...ok, accuracy: -1 },
      { ...ok, accuracy: Number.NaN },
      { ...ok, capturedAt: NOW + 3 * 60_000 },
      { ...ok, extra: 1 },
      { status: 'ok', lat: 1, lon: 1, accuracy: 1 },
    ])
      expect(parseLocation(bad, NOW)).toBeNull()
  })
})

describe('locationInstructions', () => {
  it('passes rounded coordinates, accuracy and capture time with handling limits', () => {
    const text = locationInstructions(parseLocation(ok, NOW) ?? undefined, NOW)
    expect(text).toContain('緯度35.6812 経度139.7671')
    expect(text).not.toContain('35.68123')
    expect(text).toContain('精度 約25m')
    expect(text).toContain('11/21 11:58 取得・1分前')
    expect(text).toContain('この発言だけの参考情報')
    expect(text).toContain('記憶・vault・ナビログ')
    expect(text).not.toContain('おおまか')
  })
  it('marks coarse fixes as approximate', () => {
    expect(locationInstructions({ ...ok, status: 'ok', accuracy: 3000 }, NOW)).toContain('「付近」として扱い')
  })
  it('tells Hermes not to assume a location when none is valid', () => {
    for (const status of ['off', 'denied', 'unavailable', 'timeout', 'unsupported', 'stale'] as const) {
      const text = locationInstructions({ status }, NOW)
      expect(text).toContain('有効な現在地がありません')
      expect(text).toContain('今いる場所と断定しないでください')
      expect(text).toContain('会話履歴には残りません')
      expect(text).toContain('だけを理由にその返答を「根拠がない」「誤り」として訂正・謝罪せず')
      expect(text).not.toMatch(/緯度|経度/)
    }
    expect(locationInstructions(undefined, NOW)).toBe(locationInstructions({ status: 'off' }, NOW))
  })
  it('TD-01: does not ask to turn sharing on when it is on but the fix failed', () => {
    for (const status of ['timeout', 'unavailable', 'stale'] as const) {
      const text = locationInstructions({ status }, NOW)
      expect(text).toContain('共有の設定はONのまま')
      expect(text).toContain('設定のON確認は求めず')
      expect(text).not.toContain('ONにするか')
    }
    expect(locationInstructions({ status: 'off' }, NOW)).toContain('ONにするか場所を教えて')
    expect(locationInstructions({ status: 'denied' }, NOW)).toContain('位置情報を許可するか')
    expect(locationInstructions(parseLocation(ok, NOW) ?? undefined, NOW)).toContain('この発言には届いています')
  })
  it('TD-01: logs only the non-secret status', () => {
    const line = locationLogLine('owner', true, parseLocation(ok, NOW) ?? undefined, NOW)
    expect(line).toBe('kohako_web_location principal=owner sent=yes status=ok age_min=1 coarse=false')
    expect(locationLogLine('owner', true, { status: 'timeout' }, NOW)).toBe(
      'kohako_web_location principal=owner sent=yes status=timeout',
    )
    expect(locationLogLine('verifier', false, undefined, NOW)).toContain('sent=none status=off')
  })
})

describe('messages with location', () => {
  const setup = async (principal: 'owner' | 'verifier') => {
    const seen: { input: unknown; session: string; ins: string }[] = []
    const hermes = {
      run: async (_i: string, input: unknown, session: string, ins: string) => {
        seen.push({ input, session, ins })
        return { status: 'done', text: 'ok' }
      },
    } as unknown as ReturnType<typeof createHermes>
    const server = createServer(createApp({ authenticate: async () => principal, hermes, now: () => NOW }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/kohako/api/v1/`
    const post = (body: object) =>
      fetch(`${base}messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresAt: NOW + 60000, ...body }),
      })
    const settle = () => new Promise((r) => setTimeout(r, 10))
    const close = async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    return { seen, post, settle, close, base }
  }

  it('puts the shared location only into that turn instructions, never into the input or transcript', async () => {
    const t = await setup('owner')
    try {
      const r = await t.post({
        requestId: 'loc-ok-1',
        kind: 'text',
        text: '近くのカフェは？',
        views: true,
        location: ok,
      })
      expect(r.status).toBe(202)
      await t.settle()
      const first = t.seen.at(-1)
      expect(first?.input).toBe('近くのカフェは？')
      expect(first?.ins).toBe(
        instructions + locationInstructions(parseLocation(ok, NOW) ?? undefined, NOW) + ownerTaskInstructions,
      )
      const transcript = await (await fetch(`${t.base}conversation/transcript`)).text()
      expect(transcript).not.toMatch(/35\.68|139\.76/)
      const view = await (await fetch(`${t.base}requests/loc-ok-1`)).text()
      expect(view).not.toMatch(/35\.68|139\.76/)

      // 共有停止後の次の発言には座標を渡さず、以前の位置を現在地と断定しないよう伝える（同じ session）。
      await t.post({
        requestId: 'loc-off-1',
        kind: 'text',
        text: 'いまどこ？',
        views: true,
        location: { status: 'off' },
      })
      await t.settle()
      const second = t.seen.at(-1)
      expect(second?.session).toBe(first?.session)
      expect(second?.ins).not.toMatch(/35\.68|139\.76/)
      expect(second?.ins).toContain('位置の共有をOFFにしています')

      // 拒否・取得失敗・古い位置も現在地として渡さない。
      for (const [id, location, reason] of [
        ['loc-deny-1', { status: 'denied' }, 'ブラウザで許可されていません'],
        ['loc-fail-1', { status: 'unavailable' }, '取得できませんでした'],
        ['loc-old-1', { ...ok, capturedAt: NOW - LOCATION_FRESH_MS - 1000 }, '古いため'],
      ] as const) {
        await t.post({ requestId: id, kind: 'text', text: 'ここから駅まで？', views: true, location })
        await t.settle()
        expect(t.seen.at(-1)?.ins).toContain(reason)
        expect(t.seen.at(-1)?.ins).not.toMatch(/緯度|経度/)
      }
    } finally {
      await t.close()
    }
  })

  it('rejects location on touch, Studio turns and malformed values', async () => {
    const t = await setup('owner')
    try {
      expect(
        (
          await t.post({
            requestId: 'loc-touch-1',
            kind: 'touch',
            touch: { zone: 'head', action: 'pat', count: 1 },
            location: ok,
          })
        ).status,
      ).toBe(400)
      expect((await t.post({ requestId: 'loc-studio-1', kind: 'text', text: 'x', location: ok })).status).toBe(400)
      expect(
        (await t.post({ requestId: 'loc-bad-1', kind: 'text', text: 'x', views: true, location: { ...ok, lat: 200 } }))
          .status,
      ).toBe(400)
      expect(t.seen).toHaveLength(0)
      // Studio は従来どおり位置の指示を付けない。
      await t.post({ requestId: 'loc-studio-2', kind: 'text', text: 'x' })
      await t.settle()
      expect(t.seen.at(-1)?.ins).toBe(studioInstructions + ownerTaskInstructions)
    } finally {
      await t.close()
    }
  })

  it('never passes the location to a typed or resent visit request', async () => {
    const t = await setup('owner')
    try {
      for (const id of ['loc-visit-1', 'loc-visit-1']) {
        const r = await t.post({ requestId: id, kind: 'text', text: '見てきて', views: true, location: ok })
        expect([200, 202]).toContain(r.status)
        await t.settle()
      }
      expect(t.seen.length).toBeGreaterThan(0)
      for (const x of t.seen) {
        expect(x.session).toMatch(/^kohako-visit-/)
        expect(x.ins).not.toMatch(/35\.68|139\.76|緯度|経度/)
      }
    } finally {
      await t.close()
    }
  })

  it('keeps the verifier location in the separate verify session', async () => {
    const owner = await setup('owner'),
      verifier = await setup('verifier')
    try {
      await owner.post({ requestId: 'loc-own-1', kind: 'text', text: 'a', views: true, location: { status: 'off' } })
      await verifier.post({ requestId: 'loc-ver-1', kind: 'text', text: 'b', views: true, location: ok })
      await owner.settle()
      expect(owner.seen.at(-1)?.session).toMatch(/^kohako-web-/)
      expect(owner.seen.at(-1)?.ins).not.toMatch(/緯度/)
      expect(verifier.seen.at(-1)?.session).toMatch(/^kohako-verify-/)
      expect(verifier.seen.at(-1)?.ins).toContain('緯度35.6812')
    } finally {
      await owner.close()
      await verifier.close()
    }
  })
})
