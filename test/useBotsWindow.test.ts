// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useBots } from '../src/renderer/src/state/useBots'
import { keptRosters } from '../src/renderer/src/state/bots'

type Event = { type: string }
let listeners: ((event: Event) => void)[] = []
let asks: unknown[] = []

beforeEach(() => {
  vi.useFakeTimers()
  listeners = []
  asks = []
  keptRosters.clear()
  ;(window as unknown as { conduit: unknown }).conduit = {
    rpcOutcome: (_method: string, params: unknown) => {
      asks.push(params)
      return Promise.resolve({ ok: true, result: { profiles: [{ name: 'default', is_default: true }] } })
    },
    onEvent: (listener: (event: Event) => void) => {
      listeners.push(listener)
      return () => (listeners = listeners.filter(l => l !== listener))
    }
  }
})
afterEach(() => vi.useRealTimers())

describe("a pop-out chat window's roster (desktop#292)", () => {
  it('reads the bots without their chats, again only when profiles change, and keeps nothing for the dashboard', async () => {
    const hook = renderHook(() => useBots(true, 'h1', { withSessions: false }), undefined)
    await settle()
    expect(asks).toEqual([{}])
    expect(hook.result().bots?.map(b => b.name)).toEqual(['default'])
    listeners.forEach(l => l({ type: 'message.complete' }))
    listeners.forEach(l => l({ type: 'sessions.changed' }))
    vi.advanceTimersByTime(1500)
    await settle()
    expect(asks).toHaveLength(1)
    listeners.forEach(l => l({ type: 'profiles.changed' }))
    vi.advanceTimersByTime(1500)
    await settle()
    expect(asks).toHaveLength(2)
    expect(keptRosters.has('h1')).toBe(false)
    hook.unmount()
  })
})
