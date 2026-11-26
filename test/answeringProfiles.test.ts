// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { rpc: (...args: unknown[]) => rpc(...args), http: (...args: unknown[]) => http(...args) }
}))

afterEach(() => {
  document.body.innerHTML = ''
  rpc.mockReset()
  http.mockReset()
  vi.useRealTimers()
})

describe('bots answering in any chat, and what they are doing there', () => {
  it('takes the ids of chats working or streaming, not waiting, idle or starting', async () => {
    const { answeringIds } = await import('../src/renderer/src/state/liveStatus')
    expect(answeringIds({ sessions: [{ id: 'rt1', session_key: 'k1', status: 'working' }, { id: 'rt2', status: 'idle' }] })).toEqual(['rt1', 'k1'])
    expect(answeringIds({ sessions: [{ id: 'rt3', status: 'streaming' }] })).toEqual(['rt3'])
    expect(answeringIds({ sessions: [{ id: 'a', status: 'waiting' }, { id: 'b', status: 'starting' }] })).toEqual([])
    expect(answeringIds(null)).toEqual([])
  })

  it("picks the newest step among a bot's answering chats, and only theirs", async () => {
    const { stepOf } = await import('../src/renderer/src/state/liveStatus')
    const answer = {
      steps: {
        rt1: { phase: 'tool', tool: 'terminal', since: 5 },
        k2: { phase: 'thinking', tool: null, since: 9 },
        gone: { phase: 'tool', tool: 'web', since: 50 }
      }
    }
    expect(stepOf(answer, ['rt1', 'k2'])).toEqual({ phase: 'thinking', tool: null, since: 9 })
    expect(stepOf(answer, ['rt1'])).toEqual({ phase: 'tool', tool: 'terminal', since: 5 })
    expect(stepOf(answer, ['none'])).toBeNull()
    expect(stepOf({ detail: 'Not Found' }, ['rt1'])).toBeNull()
  })

  it('names each step the way the open chat does', async () => {
    const { stepTitle } = await import('../src/renderer/src/state/liveDoing')
    expect(stepTitle({ phase: 'tool', tool: 'terminal' })).toBe('Running a command')
    expect(stepTitle({ phase: 'tool', tool: 'files' })).toBe('Working with files')
    expect(stepTitle({ phase: 'tool', tool: 'connector' })).toBe('Using a tool')
    expect(stepTitle({ phase: 'thinking' })).toBe('Thinking…')
    expect(stepTitle({ phase: 'approval' })).toBe('Needs approval')
    expect(stepTitle({ phase: 'input' })).toBe('Waiting for your answer')
    expect(stepTitle({ phase: 'later' })).toBeNull()
  })

  it("reads each bot's registry, then the steps of the bots answering, the default profile without a profile", async () => {
    vi.useFakeTimers()
    rpc.mockImplementation((_method: string, params: { profile?: string }) =>
      Promise.resolve({ sessions: [{ id: `rt-${params.profile ?? 'default'}`, status: params.profile ? 'working' : 'idle' }] })
    )
    http.mockImplementation((_method: string, path: string) =>
      path.endsWith('profile=furina')
        ? Promise.resolve({ ok: true, steps: { 'rt-furina': { phase: 'tool', tool: 'terminal', since: 1 } } })
        : Promise.reject(new Error('404 Not Found'))
    )
    const { useAnsweringBots } = await import('../src/renderer/src/state/liveStatus')
    const { stepTitle } = await import('../src/renderer/src/state/liveDoing')
    let seen: ReadonlyMap<string, string | null> = new Map()
    function Probe() {
      seen = useAnsweringBots(true, ['default', 'furina', 'raiden'], 0, stepTitle)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe)))
    await act(async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    expect(rpc).toHaveBeenCalledWith('session.active_list', {})
    expect(rpc).toHaveBeenCalledWith('session.active_list', { profile: 'furina' })
    // Only the bots answering are asked for steps; an older plugin's refusal is just no step.
    expect(http.mock.calls.map(call => call[1])).toEqual([
      '/api/plugins/conduit_push/live-steps?profile=furina',
      '/api/plugins/conduit_push/live-steps?profile=raiden'
    ])
    expect([...seen]).toEqual([
      ['furina', 'Running a command'],
      ['raiden', null]
    ])
    rpc.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(4_000)
      await Promise.resolve()
    })
    expect(rpc).toHaveBeenCalledTimes(3)
    act(() => root.unmount())
  })

  it('feeds them into the running set the Bots list and rail faces draw, with their steps (App.tsx)', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(/const answering = useAnsweringBots\(connected, answeringNames, turnsDone, stepTitle\)/)
    expect(app).toMatch(/const names = new Set<string>\(answering\.keys\(\)\)/)
  })
})
