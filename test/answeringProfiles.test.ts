// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({ gateway: { rpc: (...args: unknown[]) => rpc(...args) } }))

afterEach(() => {
  document.body.innerHTML = ''
  rpc.mockReset()
  vi.useRealTimers()
})

describe('bots answering in any chat', () => {
  it('counts a working or streaming chat, not one waiting, idle or starting', async () => {
    const { anyAnswering } = await import('../src/renderer/src/state/liveStatus')
    expect(anyAnswering({ sessions: [{ status: 'idle' }, { status: 'working' }] })).toBe(true)
    expect(anyAnswering({ sessions: [{ status: 'streaming' }] })).toBe(true)
    expect(anyAnswering({ sessions: [{ status: 'waiting' }, { status: 'starting' }, { status: 'idle' }] })).toBe(false)
    expect(anyAnswering(null)).toBe(false)
  })

  it("reads each bot's registry and names the ones answering, the default profile without a profile", async () => {
    vi.useFakeTimers()
    rpc.mockImplementation((_method: string, params: { profile?: string }) =>
      Promise.resolve({ sessions: [{ status: params.profile === 'furina' ? 'working' : 'idle' }] })
    )
    const { useAnsweringProfiles } = await import('../src/renderer/src/state/liveStatus')
    let seen: ReadonlySet<string> = new Set()
    function Probe() {
      seen = useAnsweringProfiles(true, ['default', 'furina', 'raiden'], 0)
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(createElement(Probe)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(rpc).toHaveBeenCalledWith('session.active_list', {})
    expect(rpc).toHaveBeenCalledWith('session.active_list', { profile: 'furina' })
    expect([...seen]).toEqual(['furina'])
    // Read again at the fast pace while one answers.
    rpc.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(4_000)
      await Promise.resolve()
    })
    expect(rpc).toHaveBeenCalledTimes(3)
    act(() => root.unmount())
  })

  it('feeds them into the running set the Bots list and rail faces draw (App.tsx)', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toMatch(/const answering = useAnsweringProfiles\(connected, answeringNames, turnsDone\)/)
    expect(app).toMatch(/const names = new Set<string>\(answering\)/)
  })
})
