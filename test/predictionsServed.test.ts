import { afterEach, describe, expect, it, vi } from 'vitest'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: (...args: unknown[]) => http(...args) } }))

// The hook module pulls in React and i18n; the capability asks don't need a DOM.
const load = async () => {
  vi.resetModules()
  const served = await import('../src/renderer/src/state/usePredictions')
  const profile = await import('../src/renderer/src/state/dashboardProfile')
  return { ...served, ...profile }
}

describe('capability asks for predictions (hermes-conduit#2970)', () => {
  afterEach(() => http.mockReset())

  it("doesn't keep an ask that couldn't tell as a plugin too old", async () => {
    const { instructionsServed } = await load()
    http.mockRejectedValueOnce(new Error('timed out'))
    expect(await instructionsServed()).toBe(false)
    http.mockResolvedValueOnce({ version: '0.190.0', capabilities: ['predict', 'predict-custom-instructions'] })
    expect(await instructionsServed()).toBe(true)
    expect(await instructionsServed()).toBe(true)
    expect(http).toHaveBeenCalledTimes(2)
  })

  it("asks another dashboard's plugin again", async () => {
    const { instructionsServed, setDashboardProfilesHost } = await load()
    setDashboardProfilesHost('https://a.example')
    http.mockResolvedValueOnce({ version: '0.190.0', capabilities: ['predict-custom-instructions'] })
    expect(await instructionsServed()).toBe(true)
    setDashboardProfilesHost('https://b.example')
    http.mockResolvedValueOnce({ version: '0.180.0', capabilities: ['predict'] })
    expect(await instructionsServed()).toBe(false)
    expect(http).toHaveBeenCalledTimes(2)
  })
})

describe('capability asks: review leftovers (desktop#274)', () => {
  afterEach(() => {
    http.mockReset()
    vi.useRealTimers()
  })

  it('asks with a short timeout and asks again after a 404', async () => {
    const { predictionsServed } = await load()
    http.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 404 }))
    expect(await predictionsServed()).toBe(false)
    expect(http.mock.calls[0][3]).toBe(8_000)
    http.mockResolvedValueOnce({ version: '0.190.0', capabilities: ['predict'] })
    expect(await predictionsServed()).toBe(true)
    expect(http).toHaveBeenCalledTimes(2)
  })

  it('keeps an answer ten minutes from when it came, not from the ask', async () => {
    vi.useFakeTimers()
    const { predictionsServed } = await load()
    let answer: (value: unknown) => void = () => undefined
    http.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
    const first = predictionsServed()
    vi.advanceTimersByTime(60_000)
    answer({ version: '0.190.0', capabilities: ['predict'] })
    expect(await first).toBe(true)
    vi.advanceTimersByTime(590_000)
    expect(await predictionsServed()).toBe(true)
    expect(http).toHaveBeenCalledTimes(1)
  })
})

describe('capability answers after a plugin update (desktop#274)', () => {
  afterEach(() => http.mockReset())

  it('are asked again', async () => {
    const { predictionsServed, forgetCapabilityAnswers } = await load()
    http.mockResolvedValueOnce({ version: '0.180.0', capabilities: [] })
    expect(await predictionsServed()).toBe(false)
    forgetCapabilityAnswers()
    http.mockResolvedValueOnce({ version: '0.190.0', capabilities: ['predict'] })
    expect(await predictionsServed()).toBe(true)
  })
})
