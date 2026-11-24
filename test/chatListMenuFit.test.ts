// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: async () => ({ ok: true }) },
  GatewayError: class extends Error {}
}))

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.classList?.contains('row-menu') ? 400 : 0
    }
  })
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(
    { platform: 'linux' } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => () => {}) }
  )
})

describe('the chat row menu', () => {
  it('shifts up by its measured height so its last item stays reachable', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ChatList as never, {
          rows: [{ id: 'a', title: 'Alpha', activeAt: Date.now(), pinned: false }],
          error: null,
          selectedId: null,
          runningIds: new Set<string>(),
          onSelect: () => {},
          onNewChat: () => {},
          onPin: () => {},
          onRename: () => {},
          onArchive: async () => true
        } as never)
      )
    )

    const wrap = host.querySelector('.row-wrap') as HTMLElement
    expect(wrap).not.toBeNull()
    act(() => wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 580 })))

    const menu = host.querySelector('.row-menu') as HTMLElement
    expect(menu).not.toBeNull()
    // 580 would put a 400 px menu past a 600 px window; the measured top moves it to 192.
    expect(menu.style.top).toBe('192px')
    act(() => root.unmount())
  })
})
