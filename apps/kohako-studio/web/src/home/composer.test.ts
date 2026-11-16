import { describe, expect, it } from 'vitest'
import { submitAction } from './composer'
describe('submitAction', () => {
  it.each([
    [false, false, false, 'send'],
    [false, true, true, 'enqueue'],
    [true, false, false, 'enqueue-and-confirm'],
    [true, true, false, 'enqueue-and-confirm'],
    [true, true, true, 'enqueue'],
    [true, false, true, 'enqueue'],
  ] as const)(
    'unconfirmed=%s queueing=%s blocked=%s gives %s',
    (hasUnconfirmed, queueing, confirmingBlocked, expected) => {
      expect(submitAction({ hasUnconfirmed, queueing, confirmingBlocked })).toBe(expected)
    },
  )
})
