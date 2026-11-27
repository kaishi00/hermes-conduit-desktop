import { describe, expect, it } from 'vitest'

import { rebuildMenu } from '../src/main/menuGate'

describe('the Mac menu while keys are recorded', () => {
  it('rebuilds on Mac only when no window is recording', () => {
    expect(rebuildMenu(true, false)).toBe(true)
    expect(rebuildMenu(true, true)).toBe(false)
    expect(rebuildMenu(false, false)).toBe(false)
    expect(rebuildMenu(false, true)).toBe(false)
  })
})
