// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { rpc: vi.fn(), http: (...args: unknown[]) => http(...args) }
}))

afterEach(() => {
  document.body.innerHTML = ''
  http.mockReset()
  vi.useRealTimers()
})

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe("the bots' workstreams read", () => {
  it("keeps a bot's last answer through a failed read, keeps polling while it works, and drops a bot whose reads keep failing", async () => {
    vi.useFakeTimers()
    ;(window as unknown as { conduit: unknown }).conduit = { onEvent: () => () => undefined }
    http.mockResolvedValueOnce({ counts: { working: 1, needs_you: 0 }, work: [], workstream_sessions: ['w1'] })
    const { useWorkSessions, DOING_POLL_MS, STAND_IN_READS } = await import('../src/renderer/src/state/useWork')
    let seen: ReturnType<typeof useWorkSessions> = { sessions: new Set(), byBot: new Map() }
    function Probe() {
      seen = useWorkSessions(['atlas'], true)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe)))
    await act(flush)
    expect(seen.byBot.get('atlas')?.working).toBe(1)
    expect([...seen.sessions]).toEqual(['w1'])

    // The plugin restarts: one read fails. The row keeps its state and the poll goes on.
    http.mockRejectedValueOnce(new Error('502'))
    await act(async () => {
      vi.advanceTimersByTime(DOING_POLL_MS)
      await flush()
    })
    expect(http).toHaveBeenCalledTimes(2)
    expect(seen.byBot.get('atlas')?.working).toBe(1)
    expect([...seen.sessions]).toEqual(['w1'])

    // A plugin that stays gone: after a few failed reads in a row the bot is dropped and the poll stops.
    http.mockRejectedValue(new Error('404'))
    for (let i = 1; i < STAND_IN_READS; i++) {
      await act(async () => {
        vi.advanceTimersByTime(DOING_POLL_MS)
        await flush()
      })
    }
    expect(seen.byBot.has('atlas')).toBe(false)
    expect(seen.sessions.size).toBe(0)
    const calls = http.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(DOING_POLL_MS * 3)
      await flush()
    })
    expect(http.mock.calls.length).toBe(calls)
    act(() => root.unmount())
  })

  it('counts failures in a row only: a good read between them starts over', async () => {
    vi.useFakeTimers()
    ;(window as unknown as { conduit: unknown }).conduit = { onEvent: () => () => undefined }
    const { useWorkSessions, DOING_POLL_MS, STAND_IN_READS } = await import('../src/renderer/src/state/useWork')
    const working = { counts: { working: 1, needs_you: 0 }, work: [] }
    http.mockResolvedValueOnce(working)
    let seen: ReturnType<typeof useWorkSessions> = { sessions: new Set(), byBot: new Map() }
    function Probe() {
      seen = useWorkSessions(['atlas'], true)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Probe)))
    await act(flush)
    const tick = async () =>
      act(async () => {
        vi.advanceTimersByTime(DOING_POLL_MS)
        await flush()
      })
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i < STAND_IN_READS; i++) {
        http.mockRejectedValueOnce(new Error('502'))
        await tick()
      }
      http.mockResolvedValueOnce(working)
      await tick()
      expect(seen.byBot.get('atlas')?.working).toBe(1)
    }
    http.mockResolvedValueOnce({ counts: { working: 0, needs_you: 0 }, work: [] })
    await tick()
    expect(seen.byBot.get('atlas')?.working).toBe(0)
    act(() => root.unmount())
  })
})
