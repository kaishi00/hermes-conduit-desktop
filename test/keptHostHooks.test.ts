// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { keptWorkKey, useKeptRooms, useKeptWork, type OtherBot } from '../src/renderer/src/state/keptHosts'
import { COPIES_PATH } from '../src/renderer/src/state/roomCopies'
import { PREFS_PATH } from '../src/renderer/src/state/pinnedOrder'
import { useShownAgain } from '../src/renderer/src/state/keptScroll'
import type { KeptHost } from '../src/shared/ipc'

const HOST = 'https://far.example'
type Outcome = { ok: true; result: unknown } | { ok: false; error: string }
let prefs: Outcome = { ok: true, result: { values: {} } }
let paths: string[] = []

beforeEach(() => {
  localStorage.clear()
  paths = []
  prefs = { ok: true, result: { values: {} } }
  ;(window as unknown as { conduit: unknown }).conduit = {
    keptRpc: async (_url: string, method: string) => (method === 'groups.list' ? { ok: true, result: { rooms: [] } } : { ok: false, error: 'no' }),
    keptHttp: async (_url: string, path: string): Promise<Outcome> => {
      paths.push(path)
      if (path === COPIES_PATH) return { ok: true, result: { copies: [] } }
      if (path === PREFS_PATH) return prefs
      if (path.startsWith('/api/plugins/conduit_push/workstreams')) return { ok: true, result: { counts: { working: 1, needs_you: 0 } } }
      return { ok: false, error: 'not served' }
    }
  }
})
afterEach(() => vi.useRealTimers())

const live: KeptHost[] = [{ url: HOST, state: 'live' }]
const order = () => localStorage.getItem(`conduit.groupRoomOrder.${HOST}`)

describe("a kept host's synced room order (desktop#248)", () => {
  it('is saved, cleaned, from its prefs on each read', async () => {
    prefs = { ok: true, result: { values: { 'groups.order': { value: ['r2', '', 'r1', 'r2', 7] } } } }
    const hook = renderHook(({ kept }: { kept: KeptHost[] }) => useKeptRooms(kept, true), { kept: live })
    await settle()
    expect(JSON.parse(order() ?? 'null')).toEqual(['r2', 'r1'])
    hook.unmount()
  })

  it('a value that is not a list, or a failed read, leaves the saved order as it was', async () => {
    localStorage.setItem(`conduit.groupRoomOrder.${HOST}`, JSON.stringify(['kept']))
    prefs = { ok: true, result: { values: { 'groups.order': { value: 'r1' } } } }
    const first = renderHook(({ kept }: { kept: KeptHost[] }) => useKeptRooms(kept, true), { kept: live })
    await settle()
    expect(order()).toBe(JSON.stringify(['kept']))
    first.unmount()

    prefs = { ok: false, error: 'offline' }
    const second = renderHook(({ kept }: { kept: KeptHost[] }) => useKeptRooms(kept, true), { kept: live })
    await settle()
    expect(order()).toBe(JSON.stringify(['kept']))
    second.unmount()
  })
})

describe("another host's bot renamed only in case (desktop#249)", () => {
  it('is read under its new spelling, and keeps its entry', async () => {
    const bot = (name: string): OtherBot[] => [{ host: HOST, bot: { name, hasAvatar: false } as OtherBot['bot'] }]
    const hook = renderHook(({ others }: { others: OtherBot[] }) => useKeptWork(others, true), { others: bot('Mira') })
    await settle()
    expect(paths.filter(p => p.includes('workstreams'))).toEqual(['/api/plugins/conduit_push/workstreams?profile=Mira'])
    expect(hook.result().get(keptWorkKey(HOST, 'Mira'))).toEqual({ working: 1, needsYou: 0 })

    paths = []
    hook.rerender({ others: bot('mira') })
    await settle()
    expect(paths.filter(p => p.includes('workstreams'))).toEqual(['/api/plugins/conduit_push/workstreams?profile=mira'])
    expect(keptWorkKey(HOST, 'mira')).toBe(keptWorkKey(HOST, 'Mira'))
    expect(hook.result().get(keptWorkKey(HOST, 'mira'))).toEqual({ working: 1, needsYou: 0 })
    hook.unmount()
  })
})

describe('a kept pane shown again (desktop#256)', () => {
  it('calls onShown only as it comes back from away, in that render', () => {
    const shown = vi.fn()
    const hook = renderHook(({ away }: { away: boolean }) => useShownAgain(away, shown), { away: false })
    hook.rerender({ away: false })
    expect(shown).not.toHaveBeenCalled()
    hook.rerender({ away: true })
    expect(shown).not.toHaveBeenCalled()
    hook.rerender({ away: false })
    expect(shown).toHaveBeenCalledTimes(1)
    hook.rerender({ away: false })
    expect(shown).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it("runs before the children's layout effects, where the Bots list restores its scroll", () => {
    const log: string[] = []
    const Child = () => {
      useLayoutEffect(() => void log.push('child drew'))
      return null
    }
    const Pane = ({ away }: { away: boolean }) => {
      useShownAgain(away, () => log.push('shown'))
      return createElement(Child)
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Pane, { away: true })))
    log.length = 0
    act(() => root.render(createElement(Pane, { away: false })))
    expect(log).toEqual(['shown', 'child drew'])
    act(() => root.unmount())
  })
})
