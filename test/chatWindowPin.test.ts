import { describe, expect, it } from 'vitest'

import { pinDecision } from '../src/renderer/src/state/chatWindowPin'

describe('chatWindowPin', () => {
  it('lets a click through once the window answered', () => {
    expect(pinDecision(false)).toEqual({ on: false, disabled: false, next: true })
    expect(pinDecision(true)).toEqual({ on: true, disabled: false, next: false })
  })

  it('ignores a click before the window answered', () => {
    expect(pinDecision(null)).toEqual({ on: false, disabled: true, next: null })
  })
})
