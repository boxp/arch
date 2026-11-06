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
  it('?model で本人モデルの試作だけを選べ、既定と sample 指定は最新の本人モデルになる', () => {
    expect(studioRigModelId('')).toBe('kohako-v17')
    expect(studioRigModelId('?model=kohako')).toBe('kohako')
    expect(studioRigModelId('?model=kohako-v0')).toBe('kohako')
    expect(studioRigModelId('?model=kohako-v2')).toBe('kohako-v2')
    expect(studioRigModelId('?model=kohako-v3')).toBe('kohako-v3')
    expect(studioRigModelId('?model=kohako-v5')).toBe('kohako-v5')
    expect(studioRigModelId('?model=kohako-v6')).toBe('kohako-v6')
    expect(studioRigModelId('?model=kohako-v1&face=rig')).toBe('kohako-v1')
    expect(studioRigModelId('?model=sample')).toBe('kohako-v17')
    expect(studioRigModelId('?model=unknown')).toBe('kohako-v17')
    expect(studioRigModelId('?model=kohako-v11')).toBe('kohako-v11')
    expect(studioRigModelId('?model=kohako-v12')).toBe('kohako-v12')
    expect(studioRigModelId('?model=kohako-v13')).toBe('kohako-v13')
    expect(studioRigModelId('?model=kohako-v14')).toBe('kohako-v14')
    expect(studioRigModelId('?model=kohako-v15')).toBe('kohako-v15')
    expect(studioRigModelId('?model=kohako-v15b')).toBe('kohako-v15b')
    expect(studioRigModelId('?model=kohako-v15c')).toBe('kohako-v15c')
    expect(studioRigModelId('?model=kohako-v16')).toBe('kohako-v16')
    expect(studioRigModelId('?model=kohako-v17')).toBe('kohako-v17')
    expect(studioRigModelId('?model=kohako-v19')).toBe('kohako-v17')
    expect(studioRigModelId('?model=kohako-v20')).toBe('kohako-v17')
    expect(studioRigModelId('?model=kohako-v15e')).toBe('kohako-v15e')
    expect(studioRigModelId('?model=kohako-v14b')).toBe('kohako-v14b')
  })
})

describe('送信の再送', () => {
  it('受理未確認の送信は照会で確定するまで新しい requestId を発行しない', async () => {
    const { newOutgoing, resolveUnconfirmed, EXPIRY_GRACE_MS } = await import('./model')
    const first = newOutgoing('こんにちは', 1000, () => 'id-1')
    expect(first).toEqual({ kind: 'text', text: 'こんにちは', requestId: 'id-1', expiresAt: 301000 })
    // 期限の5秒前でも、受理済み(200)なら再送せず追跡し、未受理(404)なら同じ ID で再送する。
    expect(resolveUnconfirmed(first, 200, 297000)).toBe('attach')
    expect(resolveUnconfirmed(first, 404, 297000)).toBe('resend')
    // 照会できない(通信失敗/5xx)なら期限前後を問わず新しい ID を出さない。
    expect(resolveUnconfirmed(first, null, 297000)).toBe('wait')
    expect(resolveUnconfirmed(first, 502, 10_000_000)).toBe('wait')
    // 期限切れ直後(猶予内)はまだ遅延到着の可能性があるので待つ。
    expect(resolveUnconfirmed(first, 404, 301000)).toBe('wait')
    expect(resolveUnconfirmed(first, 404, 301000 + EXPIRY_GRACE_MS)).toBe('new')
    // 期限切れ後でも受理済みなら追跡する。
    expect(resolveUnconfirmed(first, 200, 10_000_000)).toBe('attach')
  })
  it('通信失敗と 5xx は受理不明として扱う', async () => {
    const { sendOutcomeUnknown } = await import('./model')
    expect(sendOutcomeUnknown(null)).toBe(true)
    expect(sendOutcomeUnknown(502)).toBe(true)
    expect(sendOutcomeUnknown(410)).toBe(false)
    expect(sendOutcomeUnknown(429)).toBe(false)
  })
})
