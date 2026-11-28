import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: () => Promise.reject(new Error('no gateway in tests')) },
  keptGateway: () => ({ http: () => Promise.reject(new Error('no kept gateway in tests')) })
}))
const { dismissHostUpdate, forgetHostPluginRows, hostPluginRow, hostUpdateRunning, readHostPlugin, runHostUpdate } = await import(
  '../src/renderer/src/state/otherHostsPluginUpdate'
)
const { currentUpdate, setUpdate } = await import('../src/renderer/src/state/pluginUpdate')
const { keptWritable } = await import('../src/main/keptHosts')
import type { UpdateHttp } from '../src/renderer/src/state/pluginUpdate'

const A = 'https://a.example'
const B = 'https://b.example'
const report = (version: string, restartNeeded = false) => ({
  version,
  loaded_version: restartNeeded ? '0.1.0' : version,
  restart_needed: restartNeeded,
  capabilities: ['self-update']
})

/** A host whose update job goes from downloading to done, and whose plugin then reports `after`. */
function hostUpdating(after: string): UpdateHttp {
  let reads = 0
  let done = false
  return async (method, path) => {
    if (path.includes('/capabilities')) return report(done ? after : '0.1.0')
    if (method === 'POST') return { job: { id: 'j1', step: 'downloading' } }
    reads += 1
    if (reads >= 2) done = true
    return { job: { id: 'j1', step: done ? 'done' : 'restarting_gateway', version: after } }
  }
}

afterEach(() => {
  forgetHostPluginRows([])
  setUpdate({ phase: 'idle' })
})

describe("another combined dashboard's plugin update (Eric, 2026-11-28)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs on its own row, leaves this dashboard\'s row alone, and reads the plugin again when it ends', async () => {
    const run = runHostUpdate(A, false, '0.2.0', hostUpdating('0.2.0'))
    expect(hostPluginRow(A).update).toMatchObject({ phase: 'updating' })
    expect(hostUpdateRunning(A)).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    await run
    expect(hostPluginRow(A).update).toEqual({ phase: 'updated', version: '0.2.0' })
    expect(hostPluginRow(A).status).toMatchObject({ state: 'reported', version: '0.2.0' })
    expect(hostUpdateRunning(A)).toBe(false)
    expect(currentUpdate().phase).toBe('idle')
  })

  it('runs several dashboards at once, each on its own row', async () => {
    const a = runHostUpdate(A, false, '0.2.0', hostUpdating('0.2.0'))
    const b = runHostUpdate(B, false, '0.2.0', async method => (method === 'POST' ? Promise.reject(Object.assign(new Error('Busy'), { code: 409 })) : report('0.1.0')))
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([a, b])
    expect(hostPluginRow(A).update.phase).toBe('updated')
    expect(hostPluginRow(B).update).toEqual({ phase: 'failed', detail: 'Busy' })
  })

  it('starts one run per dashboard', async () => {
    const http = vi.fn<UpdateHttp>(hostUpdating('0.2.0'))
    const first = runHostUpdate(A, false, '0.2.0', http)
    void runHostUpdate(A, false, '0.2.0', http)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    expect(http.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1)
  })

  it('sends Update Anyway with force, for that dashboard only', async () => {
    const http = vi.fn<UpdateHttp>(hostUpdating('0.2.0'))
    const run = runHostUpdate(A, true, '0.2.0', http)
    await vi.advanceTimersByTimeAsync(10_000)
    await run
    expect(http).toHaveBeenCalledWith('POST', '/api/plugins/conduit_push/self/update?force=true')
  })

  it('keeps a running row when its dashboard leaves the list, and dismisses only a finished one', async () => {
    void runHostUpdate(A, false, '0.2.0', async method => (method === 'POST' ? { job: { id: 'j1', step: 'downloading' } } : { job: { id: 'j1', step: 'downloading' } }))
    await vi.advanceTimersByTimeAsync(1_000)
    forgetHostPluginRows([])
    dismissHostUpdate(A)
    expect(hostPluginRow(A).update.phase).toBe('updating')
  })
})

describe("another dashboard's plugin status", () => {
  it('keeps what it said before when a read cannot tell', async () => {
    await readHostPlugin(A, async () => report('0.2.0'))
    await readHostPlugin(A, async () => {
      throw new Error('offline')
    })
    expect(hostPluginRow(A).status).toMatchObject({ state: 'reported', version: '0.2.0' })
    expect(hostPluginRow(A).checking).toBe(false)
  })
})

describe('what another dashboard takes as a change', () => {
  it('takes its plugin update, Update Anyway included, and nothing else of the plugin', () => {
    expect(keptWritable('/api/plugins/conduit_push/self/update')).toBe(true)
    expect(keptWritable('/api/plugins/conduit_push/self/update?force=true')).toBe(true)
    expect(keptWritable('/api/plugins/conduit_push/self/restart')).toBe(false)
    expect(keptWritable('/api/plugins/conduit_push/self/update/../restart')).toBe(false)
  })
})
