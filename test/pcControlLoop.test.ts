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
        return { requests: [{ id: 'r1', session: 's1', chat: 'c1', action: 'type', args: { text: 'hi' }, needs_ok: false }] }
      }
      if (method === 'POST' && path.includes('/pc/result')) results.push(body)
      return {}
    }
  },
  GatewayError: class extends Error {}
}))

let finishRun: (result: Record<string, unknown>) => void = () => {}
let runs = 0
beforeEach(() => {
  results.length = 0
  served = false
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
      ask: async () => 'allowed',
      closeAsk: () => {},
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
