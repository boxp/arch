import { describe, expect, it } from 'vitest'
import { FrameMeter, clipIdFor, clipName, micMouth, modelFor, poseFor, rigModels, rigStates, speechMouth } from './model'

const expressions = ['angry', 'gloom', 'sad', 'shy', 'sleepy', 'smile', 'surprised']
const clips = ['Blink', 'Idle', 'Nod', 'Shake', 'Talk']

describe('poseFor', () => {
  it('resolves names case-insensitively to what the model has', () => {
    expect(poseFor('listening', expressions, clips)).toEqual({ expression: 'smile', clip: 'Nod', look: [0, 0.1] })
    expect(poseFor('failed', expressions, clips)).toEqual({ expression: 'sad', clip: 'Shake', look: [0, -0.3] })
    expect(poseFor('idle', expressions, clips).expression).toBeNull()
  })
  it('falls back and leaves missing names unset', () => {
    expect(poseFor('thinking', ['gloom'], ['Idle']).expression).toBe('gloom')
    for (const state of rigStates) expect(poseFor(state, [], [])).toMatchObject({ expression: null, clip: null })
  })
})

describe('mouth', () => {
  it('keeps speech mouth within 0..1 and moving', () => {
    const values = Array.from({ length: 60 }, (_, i) => speechMouth(i / 60))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5)
  })
  it('opens on loud mic input and closes on silence', () => {
    let level = 0
    for (let i = 0; i < 5; i++) level = micMouth(new Float32Array(256).fill(0.2), level)
    expect(level).toBeGreaterThan(0.9)
    for (let i = 0; i < 20; i++) level = micMouth(new Float32Array(256), level)
    expect(level).toBeLessThan(0.01)
  })
})

describe('FrameMeter', () => {
  it('counts frames per second in its window', () => {
    const meter = new FrameMeter(1000)
    for (let t = 0; t <= 3000; t += 20) meter.tick(t)
    expect(meter.fps()).toBeCloseTo(50, 0)
  })
})

describe('modelFor', () => {
  it('defaults to the Kohako model and keeps the sample selectable', () => {
    expect(modelFor('').id).toBe('kohako')
    expect(modelFor('?model=unknown').id).toBe('kohako')
    expect(modelFor('?model=sample').id).toBe('sample')
    expect(modelFor('?model=kohako-v1').id).toBe('kohako')
    expect(modelFor('?model=kohako-v2').id).toBe('kohako')
    expect(rigModels.map(m => m.id)).toEqual(['kohako', 'kohako-v5', 'kohako-v6', 'sample'])
  })
})

describe('clip names', () => {
  it('maps internal clip ids of the Kohako model to names and back', () => {
    const kohako = modelFor('?model=kohako'), ids = Object.keys(kohako.clipNames ?? {})
    const names = ids.map(id => clipName(kohako, id))
    expect(names).toEqual(['Idle', 'Blink', 'Nod', 'Shake', 'Talk'])
    expect(poseFor('listening', ['smile'], names).clip).toBe('Nod')
    expect(clipIdFor(kohako, ids, 'Nod')).toBe('modifier:m25:6d6f74696f6e')
    expect(clipIdFor(kohako, ids, null)).toBeNull()
  })
  it('maps the v5 clip ids, which have no Nod clip', () => {
    const v5 = modelFor('?model=kohako-v5'), ids = Object.keys(v5.clipNames ?? {})
    expect(v5.rig).toBe('../kohako/kohako-v5.p2lrt')
    expect(ids.map(id => clipName(v5, id))).toEqual(['Shake', 'Idle', 'Blink', 'Talk'])
    expect(clipIdFor(v5, ids, 'Nod')).toBeNull()
  })
  it('selects v6 and its clips', () => {
    const v6 = modelFor('?model=kohako-v6'), ids = Object.keys(v6.clipNames ?? {})
    expect(v6.id).toBe('kohako-v6')
    expect(v6.rig).toBe('../kohako/kohako-v6.p2lrt')
    expect(ids.map(id => clipName(v6, id))).toEqual(['Shake', 'Idle', 'Blink', 'Talk'])
  })
  it('keeps the sample clip ids as they are', () => {
    const sample = modelFor('?model=sample')
    expect(clipName(sample, 'Nod')).toBe('Nod')
    expect(clipIdFor(sample, ['Idle', 'Nod'], 'Nod')).toBe('Nod')
  })
})

describe('mouthLevel', () => {
  it('v6 だけ小開度の二重線帯を飛ばし、閉口か 0.35 以上の開口にする', async () => {
    const { mouthLevel, modelFor } = await import('./model')
    const v6 = modelFor('?model=kohako-v6')
    expect(mouthLevel(v6, 0)).toBe(0)
    expect(mouthLevel(v6, 0.1)).toBe(0)
    expect(mouthLevel(v6, Number.NaN)).toBe(0)
    expect(mouthLevel(v6, 0.12)).toBeCloseTo(0.428)
    expect(mouthLevel(v6, 1)).toBe(1)
    for (let v = 0.12; v <= 1; v += 0.01) expect(mouthLevel(v6, v)).toBeGreaterThanOrEqual(0.35)
  })
  it('v6 以外のモデルは細かな口開度をそのまま保つ', async () => {
    const { mouthLevel, modelFor } = await import('./model')
    for (const id of ['', '?model=kohako-v5', '?model=sample']) {
      const m = modelFor(id)
      expect(mouthLevel(m, 0.1)).toBeCloseTo(0.1)
      expect(mouthLevel(m, 0.12)).toBeCloseTo(0.12)
      expect(mouthLevel(m, 1.5)).toBe(1)
      expect(mouthLevel(m, Number.NaN)).toBe(0)
    }
  })
})
