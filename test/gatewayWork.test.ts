import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: () => Promise.reject(new Error('no gateway in tests')) } }))
const {
  FORCE_RESTART_PATH,
  RESTART_NOW_PATH,
  failureFor,
  parseGatewayWork,
  resetRestartNow,
  restartNow,
  restartNowSteps,
  restartingNow,
  runRestartNow,
  workLines
} = await import('../src/renderer/src/state/gatewayWork')
import type { GatewayWork, RestartNowHost, RestartNowSteps } from '../src/renderer/src/state/gatewayWork'

const chat = { kind: 'chat', bot: 'Furina', title: 'Trip plan', session_id: 's1', profile: 'furina', elapsed_s: 600 }

describe("what a restart waits on, as the plugin names it (the phone's GatewayWork)", () => {
  it('reads each unit, how many, and when the gateway restarts anyway', () => {
    const now = 1_000_000_000
    const work = parseGatewayWork({ units: [chat, { kind: 'cron', job_id: 'j9' }], count: 1, draining: true, restarts_by: 1_000_600 }, now)!
    expect(work.count).toBe(2)
    expect(work.draining).toBe(true)
    expect(work.restartsBy).toBe(1_000_600_000)
    expect(work.units[0]).toMatchObject({ kind: 'chat', sessionId: 's1', profile: 'furina', startedAt: now - 600_000 })
    expect(workLines(work, now)).toEqual(['Furina: Trip plan, running 10 min', 'Scheduled job j9'])
  })

  it('says when Hermes counts work it does not name, and reads nothing from an older plugin', () => {
    expect(workLines({ units: [], count: 2, draining: true })).toEqual(["Hermes doesn't say what's running."])
    expect(parseGatewayWork({ ok: true })).toBeNull()
  })
})

const work = (count: number, units: GatewayWork['units'] = []): GatewayWork => ({ units, count, draining: true })

function scripted(reads: (GatewayWork | null)[], overrides: Partial<RestartNowSteps> = {}) {
  const calls: string[] = []
  const steps: RestartNowSteps = {
    endWait: async () => (calls.push('endWait'), null),
    readWork: async () => (calls.push('read'), reads.length > 1 ? reads.shift()! : reads[0]),
    stop: async unit => void calls.push(`stop ${unit.sessionId}`),
    force: async () => (calls.push('force'), null),
    pause: async () => undefined,
    ...overrides
  }
  return { steps, calls }
}

describe('Restart Now', () => {
  afterEach(() => resetRestartNow())

  it('ends the wait, stops the chats it can, and skips the force once nothing runs', async () => {
    const { steps, calls } = scripted([work(2, [{ kind: 'chat', sessionId: 's1' }, { kind: 'cron', jobId: 'j' }]), work(1), work(0)])
    expect(await restartNow(steps)).toBeNull()
    expect(calls).toEqual(['endWait', 'read', 'stop s1', 'read', 'read'])
  })

  it('forces a restart when work still runs after its reads, and a failed read proves nothing', async () => {
    const { steps, calls } = scripted([work(1), null])
    expect(await restartNow(steps)).toBeNull()
    expect(calls.filter(c => c === 'read')).toHaveLength(6)
    expect(calls.at(-1)).toBe('force')
  })

  it("stops at a refused end of the wait, with the dashboard's words", async () => {
    const { steps, calls } = scripted([work(1)], { endWait: async () => 'Not found' })
    expect(await restartNow(steps)).toBe('Not found')
    expect(calls).toEqual([])
  })

  it('calls the plugin and the chat on its own profile; a force that got no answer counts as sent', async () => {
    const sent: string[] = []
    const host: RestartNowHost = {
      http: async (method, path) => {
        sent.push(`${method} ${path}`)
        if (path === FORCE_RESTART_PATH) throw new Error('connection lost')
        return method === 'GET' ? { units: [chat], count: 1 } : { ok: true }
      },
      rpc: async (method, params) => void sent.push(`${method} ${JSON.stringify(params)}`)
    }
    expect(await restartNow({ ...restartNowSteps(host), pause: async () => undefined })).toBeNull()
    expect(sent[0]).toBe(`POST ${RESTART_NOW_PATH}`)
    expect(sent).toContain('session.interrupt {"session_id":"s1","profile":"furina"}')
    expect(sent.at(-1)).toBe(`POST ${FORCE_RESTART_PATH}`)
  })

  it('a force the dashboard refused fails, and off systemd says what to run', async () => {
    const refusing = (code: number): RestartNowHost => ({
      http: async (method, path) => {
        if (path === FORCE_RESTART_PATH) throw Object.assign(new Error('Forbidden'), { code })
        return method === 'GET' ? { units: [], count: 1 } : { ok: true }
      },
      rpc: async () => undefined
    })
    const steps = (code: number) => ({ ...restartNowSteps(refusing(code)), pause: async () => undefined })
    expect(await restartNow(steps(403))).toBe('Forbidden')
    expect(await restartNow(steps(501))).toMatch(/systemd/)
  })

  it('waits for a running Hermes update, and keeps a failure on its own dashboard', async () => {
    const connection: RestartNowHost = { http: async () => ({}), rpc: async () => undefined }
    await runRestartNow('a', connection, () => 'a', true)
    expect(failureFor('a')).toBe('Wait for the Hermes update to finish.')
    expect(failureFor('b')).toBeNull()

    const { steps } = scripted([work(0)], { endWait: async () => 'Refused' })
    const run = runRestartNow('a', connection, () => 'a', false, () => steps)
    expect(restartingNow('a')).toBe(true)
    expect(failureFor('a')).toBeNull()
    await run
    expect(restartingNow('a')).toBe(false)
    expect(failureFor('a')).toBe('Refused')

    // Switched away meanwhile: the failure stays with the run.
    resetRestartNow()
    await runRestartNow('a', connection, () => 'b', false, () => steps)
    expect(failureFor('a')).toBeNull()
  })
})
