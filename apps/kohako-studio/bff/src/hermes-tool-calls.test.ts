import { describe, expect, it, vi } from 'vitest'
import { createHermes } from './hermes.js'

describe('toolCalls', () => {
  it('引数だけを取り出し本文や内部思考を返さない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              role: 'assistant',
              content: 'private content',
              reasoning: 'private reasoning',
              tool_calls: JSON.stringify([
                { id: 'one', function: { name: 'terminal', arguments: '{"command":"git status"}' } },
                { call_id: 'two', function: { name: 'read_file', arguments: { path: 'README.md' } } },
              ]),
            },
            { role: 'tool', content: 'output', tool_calls: [{ id: 'ignored' }] },
          ],
        }),
      ),
    )
    const client = createHermes({ url: 'http://hermes', key: 'key', fetch: fetcher })
    expect(await client.toolCalls('session:1')).toEqual([
      { id: 'one', name: 'terminal', args: { command: 'git status' } },
      { id: 'two', name: 'read_file', args: { path: 'README.md' } },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'http://hermes/api/sessions/session%3A1/messages?order=latest&limit=200',
      expect.objectContaining({ headers: { Authorization: 'Bearer key' }, redirect: 'error' }),
    )
  })
  it('不正な ID、過大応答、通信失敗は空にする', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    const client = createHermes({ url: 'http://hermes', key: 'key', fetch: fetcher })
    expect(await client.toolCalls('../bad')).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
    expect(await client.toolCalls('ok')).toEqual([])
    fetcher.mockRejectedValueOnce(Error('network'))
    expect(await client.toolCalls('ok')).toEqual([])
  })
})
