import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: (...args: unknown[]) => http(...args) } }))
const { askedQuestionsForCall } = await import('../src/renderer/src/state/askedForCalls')

const WAITING = {
  ok: true,
  questions: [{ id: 'P7', kind: 'proposal', status: 'open', text: 'Which branch?', at: 1, session_ids: ['s1'], choices: ['main', 'release'], actions: ['answer'] }]
}

/** The plugin answering its capabilities with `status` (or failing), and the waiting list. */
function host(status: Record<string, unknown> | Error) {
  http.mockImplementation((_method: unknown, path: unknown) => {
    if (typeof path !== 'string') return new Promise(() => {})
    if (path.includes('/capabilities')) return status instanceof Error ? Promise.reject(status) : Promise.resolve(status)
    if (path.includes('/waiting')) return Promise.resolve(WAITING)
    return new Promise(() => {})
  })
}

describe("a live call's waiting questions (hermes-conduit issue 2985)", () => {
  beforeEach(() => {
    http.mockReset()
  })

  it('are told by a plugin that records a spoken answer, 0.191.0 or newer', async () => {
    host({ ok: true, version: '0.191.0', loaded_version: '0.191.0', capabilities: ['waiting-list'] })
    const block = await askedQuestionsForCall('work')
    expect(block).toContain('- P7: «Which branch?»')
    expect(block).toContain('My answer to P7')
  })

  it("aren't told by an older plugin, which lists them but can't record the answer", async () => {
    host({ ok: true, version: '0.190.1', loaded_version: '0.190.1', capabilities: ['waiting-list'] })
    expect(await askedQuestionsForCall('work')).toBe('')
  })

  it("aren't told when the plugin's version can't be read, asked twice", async () => {
    host(Object.assign(new Error('timed out'), { code: 504 }))
    expect(await askedQuestionsForCall()).toBe('')
    expect(http.mock.calls.filter(([, path]) => String(path).includes('/capabilities'))).toHaveLength(2)
  })

  it('are told when the second ask reads the version after a transient failure', async () => {
    let asked = 0
    http.mockImplementation((_method: unknown, path: unknown) => {
      if (String(path).includes('/capabilities')) {
        asked += 1
        return asked === 1
          ? Promise.reject(Object.assign(new Error('timed out'), { code: 504 }))
          : Promise.resolve({ ok: true, version: '0.191.1', loaded_version: '0.191.1', capabilities: ['waiting-list'] })
      }
      if (String(path).includes('/waiting')) return Promise.resolve(WAITING)
      return new Promise(() => {})
    })
    expect(await askedQuestionsForCall('work')).toContain('- P7: «Which branch?»')
  })

  it("aren't told while a new enough plugin waits for its restart, the older one still running", async () => {
    host({ ok: true, version: '0.191.0', loaded_version: null, restart_needed: true, capabilities: ['waiting-list'] })
    expect(await askedQuestionsForCall('work')).toBe('')
  })

  it("ask the call's own profile for its plugin's version", async () => {
    host({ ok: true, version: '0.191.0', loaded_version: '0.191.0', capabilities: ['waiting-list'] })
    await askedQuestionsForCall('work')
    const asked = http.mock.calls.map(([, path]) => String(path)).filter(path => path.includes('/capabilities'))
    expect(asked).toEqual([expect.stringContaining('profile=work')])
    http.mockClear()
    await askedQuestionsForCall()
    expect(http.mock.calls.map(([, path]) => String(path)).filter(path => path.includes('/capabilities'))[0]).not.toContain('profile=')
  })
})
