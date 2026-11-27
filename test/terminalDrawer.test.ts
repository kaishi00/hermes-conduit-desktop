// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: (...args: unknown[]) => http(...args) },
  GatewayError: class extends Error {}
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon() {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData() {
      return { dispose() {} }
    }
    onResize() {
      return { dispose() {} }
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

let opened: string[] = []
let closed: string[] = []
beforeEach(() => {
  http.mockReset()
  opened = []
  closed = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  ;(window as unknown as { conduit: unknown }).conduit = {
    liveOpen: async (_kind: string, query: string) => {
      opened.push(query)
      return { ok: true, id: `socket-${opened.length}` }
    },
    liveClose: (id: string) => closed.push(id),
    liveSend: () => {},
    onLive: () => () => {}
  }
})

const row = (id: string) => ({ id, root: '/r', title: id, end: 0 })
const list = (...ids: string[]) => ({ available: true, terminals: ids.map(row) })

async function mount() {
  const path = '../src/renderer/src/components/TerminalDrawer.tsx'
  const { TerminalDrawer } = (await import(/* @vite-ignore */ path)) as { TerminalDrawer: (props: unknown) => null }
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(TerminalDrawer as never, { root: '/r', onFold: () => {}, folded: false, shells: true, steps: [], at: null, botTurn: 0 })))
  await settle()
  return { host, root }
}

const tabs = (host: HTMLElement) => host.querySelectorAll('.xterm-host, [data-terminal]').length
const buttons = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].filter(b => b.textContent === label)

describe('the terminal drawer when a list read fails (issue 681)', () => {
  it('keeps the terminals it has, says so, and reads again on Try Again', async () => {
    http.mockImplementation(async (method: string) => (method === 'GET' ? list('a', 'b', 'c') : {}))
    const { host, root } = await mount()
    const views = () => host.querySelectorAll('.bench-drawer-body > :not(.bench-note):not(.bench-empty)').length
    const before = views()
    expect(opened.length).toBe(3)
    // Closing one tab reads the list again, and that read fails (the dashboard restarting).
    http.mockImplementation(async (method: string) => {
      if (method === 'GET') throw new Error('connection lost')
      return {}
    })
    const close = host.querySelectorAll('[aria-label^="Close"]')
    act(() => (close[close.length - 1] as HTMLElement).click())
    await settle()
    expect(views()).toBe(before - 1) // only the closed one went
    expect(closed).toEqual(['socket-3'])
    expect(host.textContent).toContain('connection lost')
    http.mockImplementation(async () => list('a', 'b'))
    act(() => buttons(host, 'Try Again')[0]!.click())
    await settle()
    expect(host.textContent).not.toContain('connection lost')
    expect(closed).toEqual(['socket-3'])
    act(() => root.unmount())
    expect(tabs(host)).toBe(0)
  })

  it('reads again by itself after a failed first read, but not for an older plugin', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      http.mockRejectedValueOnce(new Error('timed out'))
      const { root } = await mount()
      expect(opened.length).toBe(0)
      http.mockResolvedValue(list('a'))
      act(() => vi.advanceTimersByTime(10_000))
      await settle()
      expect(opened.length).toBe(1)
      act(() => root.unmount())

      http.mockReset()
      http.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }))
      const old = await mount()
      const calls = http.mock.calls.length
      act(() => vi.advanceTimersByTime(30_000))
      await settle()
      expect(http.mock.calls.length).toBe(calls)
      act(() => old.root.unmount())
    } finally {
      vi.useRealTimers()
    }
  })
})
