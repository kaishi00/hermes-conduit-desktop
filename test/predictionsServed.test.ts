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
