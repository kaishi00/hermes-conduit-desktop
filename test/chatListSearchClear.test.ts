// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: async () => ({ ok: true }) },
  GatewayError: class extends Error {}
}))

beforeEach(() => {
  // The window's API, as the app's preload gives it: the components read `platform` and call the rest.
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(
    { platform: 'linux' } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => () => {}) }
  )
})

const row = (id: string, title: string) => ({ id, title, activeAt: 1_000, pinned: false })
const type = (input: HTMLInputElement, text: string) => {
  // React reads the value through its own listener: set the DOM value the way a keystroke would.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the chat list search field', () => {
  it('offers a clear control only while there is a query, and empties the field with it', async () => {
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(ChatList as never, {
          rows: [row('a', 'Alpha'), row('b', 'Beta')],
          error: null,
          selectedId: null,
          runningIds: new Set(),
          onSelect: () => {},
          onNewChat: () => {}
        } as never)
      )
    )

    const input = host.querySelector('.chatlist-search input') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBe('Search chats')
    expect(host.querySelector('.chatlist-search-clear')).toBeNull()

    type(input, 'Al')
    expect(host.textContent).toContain('Alpha')
    expect(host.textContent).not.toContain('Beta')

    const clear = host.querySelector('.chatlist-search-clear') as HTMLButtonElement
    expect(clear).not.toBeNull()
    expect(clear.getAttribute('aria-label')).toBe('Clear search')
    act(() => clear.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(input.value).toBe('')
    expect(host.querySelector('.chatlist-search-clear')).toBeNull()
    expect(host.textContent).toContain('Beta')
    act(() => root.unmount())
  })
})
