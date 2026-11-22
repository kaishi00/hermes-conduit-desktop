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

  it("aren't told when the plugin's version can't be read", async () => {
    host(Object.assign(new Error('timed out'), { code: 504 }))
    expect(await askedQuestionsForCall()).toBe('')
  })
})
