import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FrameMeter, LATEST_MODEL_ID, clipIdFor, clipName, micMouth, modelFor, modelStatus, poseFor, lostPrototypes, rigModels, rigStates, speechMouth } from './model'

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
    expect(modelFor('').id).toBe(LATEST_MODEL_ID)
    expect(LATEST_MODEL_ID).toBe('kohako-v23')
    expect(modelFor('?model=unknown').id).toBe(LATEST_MODEL_ID)
    expect(modelFor('?model=sample').id).toBe('sample')
    expect(modelFor('?model=kohako').id).toBe('kohako')
    expect(modelFor('?model=kohako-v0').id).toBe('kohako')
    expect(modelFor('?model=kohako-v1').id).toBe('kohako-v1')
    expect(modelFor('?model=kohako-v2').id).toBe('kohako-v2')
    expect(modelStatus(modelFor(''))).toContain('最新の試作')
    expect(modelStatus(modelFor('?model=kohako-v0'))).toContain('旧版')
    for (const m of rigModels) expect(existsSync(resolve('public/kohako/live2d/sample', m.rig))).toBe(true)
    for (const p of lostPrototypes) for (const image of p.images) expect(existsSync(resolve('public', image))).toBe(true)
    expect(lostPrototypes.map(p => p.id)).toEqual(['kohako-v4', 'kohako-v7', 'kohako-v8', 'kohako-v9', 'kohako-v10', 'kohako-v18', 'kohako-v19', 'kohako-v20', 'kohako-v21', 'kohako-v22'])
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
  it('selects v17 and preserves v16 for comparison', () => {
    const v13 = modelFor('?model=kohako-v13')
    expect(v13.rig).toBe('../kohako/kohako-v13.p2lrt')
    expect(v13.status).toBe('old')
    const v14 = modelFor('?model=kohako-v14')
    expect(v14.status).toBe('old')
    expect(modelFor('?model=kohako-v14b').status).toBe('rejected')
    expect(modelFor('?model=kohako-v15').status).toBe('old')
    expect(modelFor('?model=kohako-v16').status).toBe('rejected')
    expect(lostPrototypes.find(p => p.id === 'kohako-v19')?.images).toContain('./kohako/live2d/compare/kohako-v19-trial2-mouth.jpg')
    expect(lostPrototypes.find(p => p.id === 'kohako-v21')?.images).toContain('./kohako/live2d/compare/kohako-v21-material.jpg')
    expect(lostPrototypes.find(p => p.id === 'kohako-v22')?.images).toContain('./kohako/live2d/compare/kohako-v22-compare-mouth.jpg')
    expect(lostPrototypes.find(p => p.id === 'kohako-v20')?.images).toContain('./kohako/live2d/compare/kohako-v20-material.jpg')
    expect(modelFor('?model=kohako-v17').status).toBe('previous-latest')
    expect(modelFor('?model=kohako-v23').status).toBe('latest')
    expect(modelFor('?model=kohako-v17').rig).toBe('../kohako/kohako-v17.p2lrt')
    expect(modelFor('?model=kohako-v16').rig).toBe('../kohako/kohako-v16.p2lrt')
    expect(modelFor('?model=kohako-v15b').status).toBe('rejected')
    expect(modelFor('?model=kohako-v15c').status).toBe('rejected')
    expect(modelFor('?model=kohako-v15e').status).toBe('rejected')
    expect(modelFor('?model=kohako-v15').rig).toBe('../kohako/kohako-v15.p2lrt')
    expect(v14.rig).toBe('../kohako/kohako-v14.p2lrt')
    expect(v14.evaluation).toContain('担当評価: 不採用・本人確認用')
    expect(Object.values(v14.clipNames ?? {})).toEqual(['Shake', 'Idle', 'Blink', 'Talk'])
    expect(v13.evaluation).toContain('本人確認用')
    expect(modelFor('?model=kohako-v12').status).toBe('rejected')
    expect(Object.values(v13.clipNames ?? {})).toEqual(['Shake', 'Idle', 'Blink', 'Talk'])
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
    expect(mouthLevel(modelFor('?model=kohako-v17'), 0.4)).toBe(0.4)
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
    for (const id of ['?model=kohako-v0', '?model=kohako-v5', '?model=sample']) {
      const m = modelFor(id)
      expect(mouthLevel(m, 0.1)).toBeCloseTo(0.1)
      expect(mouthLevel(m, 0.12)).toBeCloseTo(0.12)
      expect(mouthLevel(m, 1.5)).toBe(1)
      expect(mouthLevel(m, Number.NaN)).toBe(0)
    }
  })
})

describe('lookFor', () => {
  it('本人モデルは首振りを抑え、サンプルは原寸のまま', async () => {
    const { lookFor, KOHAKO_LOOK_SCALE } = await import('./model')
    const [x, y] = lookFor(modelFor('?model=kohako-v13'), 0.6, 0.5)
    expect(x).toBeCloseTo(0.6 * KOHAKO_LOOK_SCALE); expect(y).toBeCloseTo(0.5 * KOHAKO_LOOK_SCALE)
    expect(Math.abs(x)).toBeLessThan(0.25)
    expect(lookFor(modelFor('?model=sample'), 0.6, 0.5)).toEqual([0.6, 0.5])
  })
})
