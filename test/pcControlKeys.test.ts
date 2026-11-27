import { describe, expect, it, vi } from 'vitest'

import { STOP_KEYS, claimStopKeys, releaseStopKeys } from '../src/main/pcControlKeys'

const shortcut = (over: Partial<Parameters<typeof claimStopKeys>[0]> = {}) => ({
  isRegistered: vi.fn(() => false),
  register: vi.fn(() => true),
  unregister: vi.fn(),
  ...over
})

describe('the Control from Hermes bar Stop keys', () => {
  it('takes free keys, shows the action and gives them back on hide', () => {
    const keys = shortcut()
    const stop = vi.fn()
    expect(claimStopKeys(keys, false, stop)).toBe(true)
    expect(keys.register).toHaveBeenCalledWith(STOP_KEYS, stop)
    expect(claimStopKeys(keys, true, stop)).toBe(true)
    expect(keys.register).toHaveBeenCalledTimes(1)
    releaseStopKeys(keys, true)
    expect(keys.unregister).toHaveBeenCalledWith(STOP_KEYS)
  })

  it('leaves keys another shortcut holds alone', () => {
    const keys = shortcut({ isRegistered: vi.fn(() => true) })
    expect(claimStopKeys(keys, false, () => undefined)).toBe(false)
    expect(keys.register).not.toHaveBeenCalled()
    releaseStopKeys(keys, false)
    expect(keys.unregister).not.toHaveBeenCalled()
  })

  it('keeps the keys unowned when registering throws', () => {
    const keys = shortcut({ register: vi.fn(() => { throw new Error('in use') }) })
    expect(claimStopKeys(keys, false, () => undefined)).toBe(false)
  })
})
