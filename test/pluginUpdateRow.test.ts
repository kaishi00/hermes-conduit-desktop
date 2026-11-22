// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from './hookHarness'

vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: () => Promise.reject(new Error('no gateway in tests')) } }))
const { currentUpdate, setUpdate, runUpdate, useUpdateRow } = await import('../src/renderer/src/state/pluginUpdate')
const { setDashboardProfilesHost } = await import('../src/renderer/src/state/dashboardProfile')
import type { UpdateHttp } from '../src/renderer/src/state/pluginUpdate'

describe('the plugin page opened just after a switch (desktop#318)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    setUpdate({ phase: 'idle' })
  })

  it("drops the old dashboard's row once its run lets go, while the page stays open", async () => {
    setDashboardProfilesHost('https://a.example')
    const http = vi.fn<UpdateHttp>(async () => ({ job: { id: 'j1', step: 'downloading' } }))
    void runUpdate(() => undefined, false, null, http)
    await vi.advanceTimersByTimeAsync(5_000)
    setDashboardProfilesHost('https://b.example')
    // The page opens on B before the run has noticed: the run is still going, so the row stays for now.
    const page = renderHook(() => useUpdateRow(http), undefined)
    expect(page.result().phase).toBe('updating')
    // The run stops and leaves A's row ("Still updating on the host"); B's open page drops it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(currentUpdate().phase).toBe('idle')
    expect(page.result().phase).toBe('idle')
    page.unmount()
  })
})
