// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { useChatList } from '../src/renderer/src/state/useChatList'

type Listener = (event: { type: string }) => void
let pages: unknown[] = []
let listeners: Listener[] = []

beforeEach(() => {
  vi.useFakeTimers()
  pages = []
  listeners = []
  localStorage.clear()
  ;(window as unknown as { conduit: unknown }).conduit = {
    httpOutcome: async (_method: string, path: string) =>
      path.includes('archived=only') ? { ok: true, result: { sessions: [] } } : { ok: true, result: pages.shift() ?? { sessions: [] } },
    onEvent: (listener: Listener) => {
      listeners.push(listener)
      return () => (listeners = listeners.filter(l => l !== listener))
    }
  }
})
afterEach(() => vi.useRealTimers())

const page = (...titles: string[]) => ({ sessions: titles.map((title, i) => ({ id: `s${i}`, title, last_active: 100 - i, message_count: 2 })) })

async function changed() {
  act(() => listeners.forEach(l => l({ type: 'sessions.changed' })))
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  await settle()
}

describe("the chat list's refresh (desktop#218)", () => {
  it('keeps the list and its saved copy when nothing changed', async () => {
    pages.push(page('One', 'Two'))
    const hook = renderHook(({ connected }: { connected: boolean }) => useChatList(connected, 'https://h'), { connected: true })
    await settle()
    const first = hook.result().rows
    expect(first?.map(r => r.title)).toEqual(['One', 'Two'])
    const save = vi.spyOn(localStorage, 'setItem')

    pages.push(page('One', 'Two'))
    await changed()
    expect(hook.result().rows).toBe(first)
    expect(save).not.toHaveBeenCalled()

    pages.push(page('One', 'Renamed'))
    await changed()
    expect(hook.result().rows?.map(r => r.title)).toEqual(['One', 'Renamed'])
    expect(save).toHaveBeenCalledTimes(1)
    hook.unmount()
  })
})
