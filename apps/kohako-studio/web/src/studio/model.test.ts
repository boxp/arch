import { describe, expect, it } from 'vitest'
import { interpretRequest, presentation, pcm16, rigStateOf, studioRigModelId, wantsRig } from './model'

describe('Studio の状態', () => {
  it('応答・承認・停止を表示状態に変換する', () => {
    expect(interpretRequest({ status: 'done', reply: { text: 'こんにちは' } })).toEqual({ state: 'done', text: 'こんにちは' })
    expect(interpretRequest({ status: 'approval', approval: { approvalId: '123', summary: '操作', expiresAt: 100 } })).toEqual({ state: 'approval', approval: { approvalId: '123', summary: '操作', expiresAt: 100 } })
    expect(interpretRequest({ status: 'failed', error: 'cancelled' })).toEqual({ state: 'stopped' })
    expect(interpretRequest({ status: 'pending' })).toEqual({ state: 'thinking' })
    expect(interpretRequest({ status: 'unknown' })).toEqual({ state: 'failed' })
    expect(presentation.speaking).toEqual({ label: '話しています', face: 'guiding' })
  })
  it('音声を 16kHz の PCM16LE に変換する', () => {
    const result = pcm16(new Float32Array([1, 1, -1, -1]), 32000)
    expect([...result]).toEqual([255, 127, 0, 128])
  })
  it('表示状態を Web リグの状態に写し、?face=static で静止表情に戻せる', () => {
    expect(rigStateOf.speaking).toBe('speaking')
    expect(rigStateOf.approval).toBe('approval')
    expect(rigStateOf.done).toBe('idle')
    expect(rigStateOf.stopped).toBe('idle')
    expect(rigStateOf.offline).toBe('failed')
    expect(wantsRig('')).toBe(true)
    expect(wantsRig('?face=static')).toBe(false)
  })
  it('?model で本人モデルの試作だけを選べ、既定と sample 指定はコハコ v0 になる', () => {
    expect(studioRigModelId('')).toBe('kohako')
    expect(studioRigModelId('?model=kohako-v2')).toBe('kohako')
    expect(studioRigModelId('?model=kohako-v3')).toBe('kohako')
    expect(studioRigModelId('?model=kohako-v5')).toBe('kohako-v5')
    expect(studioRigModelId('?model=kohako-v6')).toBe('kohako-v6')
    expect(studioRigModelId('?model=kohako-v1&face=rig')).toBe('kohako')
    expect(studioRigModelId('?model=sample')).toBe('kohako')
  })
})

describe('送信の再送', () => {
  it('受理未確認の送信は期限内なら同じ requestId とペイロードで再送する', async () => {
    const { outgoingMessage } = await import('./model')
    let n = 0; const id = () => `id-${++n}`
    const first = outgoingMessage(null, 'こんにちは', 1000, id)
    expect(first).toEqual({ kind: 'text', text: 'こんにちは', requestId: 'id-1', expiresAt: 301000 })
    expect(outgoingMessage(first, 'こんにちは', 2000, id)).toBe(first)
    expect(outgoingMessage(first, '別の文', 2000, id)).toBe(first)
    const expired = outgoingMessage(first, 'こんにちは', 299000, id)
    expect(expired.requestId).toBe('id-2')
  })
})
