import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayError } from '../src/renderer/src/gateway'
import {
  RestartMonitor,
  latestLine,
  parseGatewayStatus,
  parseUpdateCheck,
  runRestart,
  runUpdate,
  sharedProfiles,
  updateVerdict,
  type Runner
} from '../src/renderer/src/state/hostActions'

function fakeRunner(answers: (method: string, path: string) => unknown): Runner & { clock: number } {
  const run = {
    clock: 0,
    request: async (method: 'GET' | 'POST', path: string) => {
      const a = answers(method, path)
      if (a instanceof Error) throw a
      return a
    },
    sleep: async (ms: number) => {
      run.clock += ms
    },
    now: () => run.clock,
    live: () => true
  }
  return run
}

describe('update check', () => {
  it('reads the check and leaves out an answer that is not one', () => {
    const check = parseUpdateCheck({
      current_version: '0.23.2',
      behind: 3,
      update_available: true,
      can_apply: true,
      commits: [{ sha: 'a', summary: 'Fix' }, { x: 1 }]
    })
    expect(check).toMatchObject({ currentVersion: '0.23.2', behind: 3, canApply: true, commits: [{ sha: 'a', summary: 'Fix' }] })
    expect(parseUpdateCheck({ other: 1 })).toBeNull()
    expect(parseUpdateCheck({ update_available: false })?.behind).toBeUndefined()
  })

  it('settles an update by its line, its own receipt, or its exit code', () => {
    expect(updateVerdict({ running: true, lines: [] }, null, 'x')).toBe('running')
    expect(updateVerdict({ running: false, lines: ['=== hermes-update completed x ==='] }, null, 'x')).toBe('succeeded')
    expect(updateVerdict({ running: false, lines: [] }, { action_id: 'y', outcome: 'success' }, 'x')).toBe('unknown')
    expect(updateVerdict({ running: false, lines: [] }, { action_id: 'x', outcome: 'partial' }, 'x')).toBe('succeeded')
    expect(updateVerdict({ running: false, exitCode: 1, lines: [] }, null, 'x')).toBe('failed')
  })

  it('shows the newest log line, not a banner', () => {
    expect(latestLine({ running: true, lines: ['Pulling', '', '=== hermes-update started ==='] })).toBe('Pulling')
  })

  it('runs an update through the restart and reads the new version', async () => {
    let polls = 0
    const steps: string[] = []
    const run = fakeRunner((method, path) => {
      if (method === 'POST') return { ok: true, name: 'hermes-update', action_id: 'id1' }
      if (path.startsWith('/api/actions/')) {
        polls++
        if (polls === 1) return { running: true, lines: ['Installing'] }
        if (polls === 2) return new GatewayError('down', 502)
        return { running: false, lines: ['=== hermes-update completed id1 ==='] }
      }
      return { current_version: '0.24.0', update_available: false, behind: 0 }
    })
    const outcome = await runUpdate(run, s => steps.push(s.kind === 'updating' ? s.step : s.kind), 'fallback')
    expect(steps).toEqual(['starting', 'updating', 'updating', 'restarting'])
    expect(outcome).toEqual({ kind: 'updated', version: '0.24.0' })
  })

  it('says how to update an install Hermes cannot update itself', async () => {
    const run = fakeRunner(() => ({ ok: false, message: 'Docker install', update_command: 'docker pull' }))
    expect(await runUpdate(run, () => {}, 'fallback')).toEqual({ kind: 'manual', message: 'Docker install', command: 'docker pull' })
  })

  it('takes a missing route as a Hermes without updates', async () => {
    const run = fakeRunner(() => new GatewayError('Not Found', 404))
    expect(await runUpdate(run, () => {}, '')).toEqual({ kind: 'unsupported' })
  })
})

describe('gateway restart', () => {
  it('reads the gateway and who shares it', () => {
    expect(parseGatewayStatus({ gateway_running: true, gateway_state: 'running', gateway_pid: 4 })).toEqual({
      running: true,
      state: 'running',
      pid: 4,
      sharedProfiles: []
    })
    expect(sharedProfiles(['b', 'default', 'a', 'a'])).toEqual(['default', 'a', 'b'])
    expect(sharedProfiles(['only'])).toEqual([])
  })

  it('waits for the gateway to go down or change, then come back serving', () => {
    const monitor = new RestartMonitor({ running: true, pid: 1, sharedProfiles: [] })
    expect(monitor.observe(null, { running: true, pid: 1, sharedProfiles: [] }, 2)).toEqual({ kind: 'waiting', stage: 'stopping' })
    expect(monitor.observe(null, { running: true, state: 'draining', pid: 1, sharedProfiles: [] }, 4)).toEqual({ kind: 'waiting', stage: 'draining' })
    expect(monitor.observe(null, { running: false, sharedProfiles: [] }, 6)).toEqual({ kind: 'waiting', stage: 'starting' })
    expect(monitor.observe(null, { running: true, pid: 2, sharedProfiles: [] }, 8).kind).toBe('back')
  })

  it('fails on the restart child failing, and gives up after its window', () => {
    expect(new RestartMonitor(null).observe({ running: false, exitCode: 2, lines: ['boom'] }, null, 1)).toEqual({ kind: 'failed', detail: 'boom' })
    const monitor = new RestartMonitor(null)
    monitor.observe({ running: false, exitCode: 0, lines: [] }, { running: false, sharedProfiles: [] }, 1)
    expect(monitor.observe(null, { running: true, state: 'startup_failed', sharedProfiles: [] }, 95)).toEqual({ kind: 'failedToStart' })
  })

  it('runs a restart until the gateway is back', async () => {
    let up = true
    let polls = 0
    const run = fakeRunner((method, path) => {
      if (method === 'POST') {
        up = false
        return {}
      }
      if (path === '/api/status') {
        if (!up && ++polls > 1) up = true
        return { gateway_running: up, gateway_shared_with: ['default', 'nahida'] }
      }
      return new GatewayError('Not Found', 404)
    })
    expect(await runRestart(run, () => {})).toEqual({ kind: 'restarted', sharedProfiles: ['default', 'nahida'] })
  })
})

describe("a finished update's outcome in the store", () => {
  it('stops speaking for the banner once Hermes is reachable, and dismisses', async () => {
    const { startUpdate, hostReachable, dismissUpdate, hostActionsNow, updateBanner } = await import('../src/renderer/src/state/hostActions')
    await startUpdate('https://a.example', () => Promise.reject(new Error('refused')), 'fallback', () => {}, () => 'https://a.example')
    expect(hostActionsNow().update.kind).toBe('failed')
    expect(updateBanner(hostActionsNow().update)).toBe('failed')
    hostReachable('https://other.example')
    expect(updateBanner(hostActionsNow().update)).toBe('failed')
    hostReachable('https://a.example')
    expect(hostActionsNow().update).toMatchObject({ kind: 'failed', back: true })
    expect(updateBanner(hostActionsNow().update)).toBeNull()
    dismissUpdate('https://a.example')
    expect(hostActionsNow().update.kind).toBe('idle')
  })

  it('keeps the version from the last check when a dismissed row clears it', async () => {
    const { startCheck, dismissUpdate, hostActionsNow } = await import('../src/renderer/src/state/hostActions')
    const onB = () => 'https://b.example'
    await startCheck('https://b.example', async () => ({ current_version: '0.23.4', update_available: false, behind: 0 }), false, onB)
    expect(hostActionsNow().version).toBe('0.23.4')
    await startCheck('https://b.example', () => Promise.reject(new Error('timed out')), true, onB)
    expect(hostActionsNow().update.kind).toBe('checkFailed')
    dismissUpdate('https://b.example')
    expect(hostActionsNow()).toMatchObject({ update: { kind: 'idle' }, version: '0.23.4' })
  })
})

describe('a dashboard switch while an action runs (#391)', () => {
  const A = 'https://a.example'
  const B = 'https://b.example'
  afterEach(() => vi.useRealTimers())

  it("stops Restart Gateway: the other dashboard's answers never settle this host's row", async () => {
    vi.useFakeTimers()
    const { startRestart, hostActionsNow, hostBusy } = await import('../src/renderer/src/state/hostActions')
    let screen = A
    const asked: string[] = []
    // Dashboard B's gateway: up, another process, nothing restarting — what would read as "back".
    const request = async (method: 'GET' | 'POST', path: string) => {
      asked.push(`${screen} ${method} ${path}`)
      if (method === 'POST') return {}
      if (path === '/api/status') return screen === A ? { gateway_running: true, gateway_pid: 100 } : { gateway_running: true, gateway_pid: 999 }
      return { running: true, lines: ['Draining'] }
    }
    const run = startRestart(A, request, () => screen)
    await vi.advanceTimersByTimeAsync(1600)
    expect(hostActionsNow()).toMatchObject({ host: A, restart: { kind: 'restarting' } })
    const before = asked.length

    screen = B
    await vi.advanceTimersByTimeAsync(10_000)
    await run
    // Nothing was asked of B, and A's row cleared instead of saying it restarted.
    expect(asked.slice(before)).toEqual([])
    expect(asked.every(line => line.startsWith(A))).toBe(true)
    expect(hostActionsNow()).toMatchObject({ host: A, restart: { kind: 'idle' } })
    expect(hostBusy(A)).toBe(false)
  })

  it('stops Update Hermes without reading the new version from the other dashboard', async () => {
    vi.useFakeTimers()
    const { startUpdate, hostActionsNow } = await import('../src/renderer/src/state/hostActions')
    let screen = A
    const updated = vi.fn()
    const request = async (method: 'GET' | 'POST', path: string) => {
      if (screen !== A) throw new Error(`asked ${path} of ${screen}`)
      if (method === 'POST') return { ok: true, name: 'hermes-update', action_id: 'id1' }
      return { running: true, lines: ['Installing'] }
    }
    const run = startUpdate(A, request, 'fallback', updated, () => screen)
    await vi.advanceTimersByTimeAsync(1600)
    expect(hostActionsNow()).toMatchObject({ host: A, update: { kind: 'updating' } })
    screen = B
    await vi.advanceTimersByTimeAsync(5_000)
    await run
    expect(hostActionsNow()).toMatchObject({ host: A, update: { kind: 'idle' } })
    expect(updated).not.toHaveBeenCalled()
  })

  it("clears a check the switch cut short, and leaves another host's newer run alone", async () => {
    const { startCheck, hostActionsNow } = await import('../src/renderer/src/state/hostActions')
    let screen = A
    let answer!: (value: unknown) => void
    const slow = () => new Promise<unknown>(resolve => (answer = resolve))
    const run = startCheck(A, slow, false, () => screen)
    expect(hostActionsNow()).toMatchObject({ host: A, update: { kind: 'checking' } })
    screen = B
    answer({ current_version: '0.23.4', update_available: false, behind: 0 })
    await run
    expect(hostActionsNow()).toMatchObject({ host: A, update: { kind: 'idle' } })

    // A run B started meanwhile owns the store: the stopped one changes nothing of it.
    screen = A
    const again = startCheck(A, slow, false, () => screen)
    const first = answer
    screen = B
    await startCheck(B, async () => ({ current_version: '0.24.0', update_available: false, behind: 0 }), false, () => screen)
    first({ current_version: '0.23.4', update_available: false, behind: 0 })
    await again
    expect(hostActionsNow()).toMatchObject({ host: B, update: { kind: 'checked' }, version: '0.24.0' })
  })
})
