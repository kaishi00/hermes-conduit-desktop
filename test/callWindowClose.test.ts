import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALL_CLOSE_CAP_MS, CALL_SAVE_GRACE_MS, CallWindowClose } from '../src/main/callWindowClose'

describe('the Live call window closed mid-call', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('goes a moment after its call ended, once', () => {
    const destroy = vi.fn()
    const close = new CallWindowClose(destroy)
    expect(close.start()).toBe(true)
    expect(close.start()).toBe(false)
    close.callEnded()
    vi.advanceTimersByTime(CALL_SAVE_GRACE_MS - 1)
    expect(destroy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CALL_CLOSE_CAP_MS)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(close.closing).toBe(false)
  })

  it('goes after the cap when the call never says it ended', () => {
    const destroy = vi.fn()
    const close = new CallWindowClose(destroy)
    close.start()
    vi.advanceTimersByTime(CALL_CLOSE_CAP_MS)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('stays when the shortcut asks for it again, even after its call ended, and can close again later', () => {
    const destroy = vi.fn()
    const close = new CallWindowClose(destroy)
    close.start()
    close.callEnded()
    close.cancel()
    expect(close.closing).toBe(false)
    vi.advanceTimersByTime(CALL_CLOSE_CAP_MS * 2)
    expect(destroy).not.toHaveBeenCalled()
    // The ended call's late word changes nothing; a later close starts afresh.
    close.callEnded()
    vi.advanceTimersByTime(CALL_CLOSE_CAP_MS)
    expect(destroy).not.toHaveBeenCalled()
    expect(close.start()).toBe(true)
    vi.advanceTimersByTime(CALL_CLOSE_CAP_MS)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
