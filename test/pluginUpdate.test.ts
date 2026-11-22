import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: () => Promise.reject(new Error('no gateway in tests')) } }))
const { guardUpdateRow, currentUpdate, setUpdate, runUpdate } = await import('../src/renderer/src/state/pluginUpdate')
const { setDashboardProfilesHost } = await import('../src/renderer/src/state/dashboardProfile')
import type { UpdateHttp } from '../src/renderer/src/state/pluginUpdate'

const job = { id: 'j1', step: 'downloading' }

describe("the update's run: only the host's answers count as word from it (desktop#300)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    setUpdate({ phase: 'idle' })
  })

  it('reads that keep failing go quiet, so the watchdog ends the run', async () => {
    const http: UpdateHttp = async method => {
      if (method === 'POST') return { job }
      throw new Error('dashboard restarting')
    }
    let done = false
    void runUpdate(() => (done = true), false, null, http)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(currentUpdate().phase).toBe('updating')
    await vi.advanceTimersByTimeAsync(100_000)
    expect(done).toBe(true)
    expect(currentUpdate()).toMatchObject({ phase: 'failed' })
  })

  it('reads that answer keep it going, even on the same step', async () => {
    let done = false
    void runUpdate(() => (done = true), false, null, async () => ({ job }))
    await vi.advanceTimersByTimeAsync(400_000)
    expect(done).toBe(false)
    expect(currentUpdate()).toMatchObject({ phase: 'updating', step: 'downloading' })
    // Past the follow's own limit it's left to the host.
    await vi.advanceTimersByTimeAsync(600_000)
    expect(done).toBe(true)
    expect(currentUpdate().phase).toBe('runningOnHost')
  })
})

describe('the update row on opening the page (desktop#289)', () => {
  // Runs an update on `host` that ends as `job` says, so the row is that dashboard's.
  const rowFrom = async (host: string, ended: Record<string, unknown>) => {
    setDashboardProfilesHost(host)
    await runUpdate(() => undefined, false, null, async method => (method === 'POST' ? { job: { id: 'j1', ...ended } } : { job: { id: 'j1', ...ended } }))
  }
  afterEach(() => setUpdate({ phase: 'idle' }))

  it.each([
    ['updated', { step: 'done', version: '1.0.0' }],
    ['needsDashboardRestart', { step: 'failed', code: 'restart_needed' }],
    ['scanHeld', { step: 'failed', code: 'scan_blocked', scan_verdict: 'caution' }]
  ])("clears another dashboard's %s row without asking", async (phase, ended) => {
    await rowFrom('https://a.example', ended)
    expect(currentUpdate().phase).toBe(phase)
    const http = vi.fn<UpdateHttp>()
    await guardUpdateRow('https://b.example', http)
    expect(currentUpdate().phase).toBe('idle')
    expect(http).not.toHaveBeenCalled()
  })

  const held = { step: 'failed', code: 'scan_blocked', scan_verdict: 'caution' }

  it('keeps a held scan whose job is still the one it held', async () => {
    await rowFrom('https://a.example', held)
    await guardUpdateRow('https://a.example', async () => ({ job: { id: 'j1' } }))
    expect(currentUpdate().phase).toBe('scanHeld')
  })

  it('clears a held scan once the host follows another job', async () => {
    await rowFrom('https://a.example', held)
    await guardUpdateRow('https://a.example', async () => ({ job: { id: 'j2' } }))
    expect(currentUpdate().phase).toBe('idle')
  })

  it('keeps a held scan when the host cannot be read', async () => {
    await rowFrom('https://a.example', held)
    await guardUpdateRow('https://a.example', async () => {
      throw new Error('offline')
    })
    expect(currentUpdate().phase).toBe('scanHeld')
  })
})

describe('a dashboard switch while the update runs (desktop#315 review)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    setUpdate({ phase: 'idle' })
  })

  it("stops following, leaves the row to its host, and another dashboard's page clears it", async () => {
    setDashboardProfilesHost('https://a.example')
    const http = vi.fn<UpdateHttp>(async () => ({ job }))
    let done = false
    void runUpdate(() => (done = true), false, null, http)
    await vi.advanceTimersByTimeAsync(5_000)
    setDashboardProfilesHost('https://b.example')
    const asked = http.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(done).toBe(true)
    expect(http.mock.calls.length - asked).toBeLessThanOrEqual(1)
    expect(currentUpdate().phase).toBe('runningOnHost')
    await guardUpdateRow('https://b.example', http)
    expect(currentUpdate().phase).toBe('idle')
  })
})
