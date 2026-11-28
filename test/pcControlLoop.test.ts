// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { usePcControl } from '../src/renderer/src/state/pcControl'

const results: unknown[] = []
let served = false
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: {
    http: async (method: string, path: string, body?: unknown) => {
      if (path.includes('/capabilities')) return { capabilities: ['pc-control'] }
      if (method === 'GET' && path.includes('/pc/next')) {
        // One action, then the poll stays open.
        if (served) return new Promise(() => {})
        served = true
        return { requests: [{ id: 'r1', session: 's1', chat: 'c1', action: 'type', args: { text: 'hi' }, needs_ok: needsOk }] }
      }
      if (method === 'POST' && path.includes('/pc/result')) results.push(body)
      return {}
    }
  },
  GatewayError: class extends Error {}
}))

let finishRun: (result: Record<string, unknown>) => void = () => {}
let needsOk = false
const dialogs = new Map<string, (answer: 'allowed' | 'denied' | 'closed') => void>()
let runs = 0
beforeEach(() => {
  results.length = 0
  served = false
  needsOk = false
  dialogs.clear()
  runs = 0
  ;(window as unknown as { conduit: unknown }).conduit = {
    pcControl: {
      state: async () => ({ stops: 0 }),
      run: () => {
        runs++
        return new Promise(resolve => {
          finishRun = resolve
        })
      },
      ask: (request: { session: string }) => new Promise(resolve => dialogs.set(request.session, resolve)),
      closeAsk: (session: string) => dialogs.get(session)?.('closed'),
      set: async () => ({ bots: [] }),
      stoppedElsewhere: () => {},
      onStopped: () => () => {}
    }
  }
})

const state = (host: string) =>
  ({ on: true, driver: 'ready', bots: [`${host}\ndefault`], id: 'pc1', shownName: 'PC', platform: 'mac', stops: 0 }) as never
const bots = [{ name: 'default', title: 'Bot' }]

describe('Control from Hermes, an action running as the dashboard changes', () => {
  it('sends the result to the dashboard that asked', async () => {
    const hook = renderHook((p: { host: string }) => usePcControl(true, p.host, p.host, bots, state(p.host)), { host: 'h1' })
    for (let i = 0; i < 6; i++) await settle()
    expect(runs).toBe(1)
    finishRun({ ok: true })
    for (let i = 0; i < 3; i++) await settle()
    expect(results).toEqual([{ computer: 'pc1', id: 'r1', result: { ok: true } }])
    hook.unmount()
  })

  it('still answers when the same dashboard is picked up again while it ran', async () => {
    const hook = renderHook(
      (p: { name: string }) => usePcControl(true, 'h1', 'h1', bots, { ...(state('h1') as object), shownName: p.name } as never),
      { name: 'PC' }
    )
    for (let i = 0; i < 6; i++) await settle()
    expect(runs).toBe(1)
    hook.rerender({ name: 'Desk' })
    finishRun({ ok: true })
    for (let i = 0; i < 3; i++) await settle()
    expect(results).toEqual([{ computer: 'pc1', id: 'r1', result: { ok: true } }])
    hook.unmount()
  })

  it('tells the same dashboard picked up again that its ask was stopped (desktop#759 review)', async () => {
    needsOk = true
    const hook = renderHook(
      (p: { name: string }) => usePcControl(true, 'h1', 'h1', bots, { ...(state('h1') as object), shownName: p.name } as never),
      { name: 'PC' }
    )
    for (let i = 0; i < 6; i++) await settle()
    expect(dialogs.has('s1')).toBe(true)
    hook.rerender({ name: 'Desk' })
    for (let i = 0; i < 3; i++) await settle()
    expect(runs).toBe(0)
    expect(results).toEqual([{ computer: 'pc1', id: 'r1', result: { ok: false, code: 'stopped' } }])
    hook.unmount()
  })

  it('tells another dashboard nothing when you leave while it asks', async () => {
    needsOk = true
    const hook = renderHook((p: { host: string }) => usePcControl(true, p.host, p.host, bots, state(p.host)), { host: 'h1' })
    for (let i = 0; i < 6; i++) await settle()
    expect(dialogs.has('s1')).toBe(true)
    hook.rerender({ host: 'h2' })
    for (let i = 0; i < 3; i++) await settle()
    expect(results).toEqual([])
    hook.unmount()
  })

  it('sends no result once you’ve left that dashboard while it ran', async () => {
    const hook = renderHook((p: { host: string }) => usePcControl(true, p.host, p.host, bots, state(p.host)), { host: 'h1' })
    for (let i = 0; i < 6; i++) await settle()
    expect(runs).toBe(1)
    hook.rerender({ host: 'h2' })
    finishRun({ ok: true, text: 'output from h1' })
    for (let i = 0; i < 3; i++) await settle()
    expect(results).toEqual([])
    hook.unmount()
  })
})
