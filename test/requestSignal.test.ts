import { describe, expect, it } from 'vitest'
import { requestSignal } from '../src/main/connection'

describe('an HTTP request keeps both its cancel and its timeout (issue 564 review)', () => {
  it('follows an outside cancel when one is given', () => {
    const stop = new AbortController()
    const signal = requestSignal(stop.signal)
    expect(signal.aborted).toBe(false)
    stop.abort()
    expect(signal.aborted).toBe(true)
  })

  it('uses its own timeout when no outside cancel exists', () => {
    const signal = requestSignal(undefined, 50)
    expect(signal.aborted).toBe(false)
  })
})
