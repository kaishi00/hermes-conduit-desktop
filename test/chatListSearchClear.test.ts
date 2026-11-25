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

const row = (id: string, title: string) => ({ id, title, activeAt: Date.now(), pinned: false })
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

  it('keeps the field focused after the clear control unmounts', async () => {
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
    type(input, 'Al')

    const clear = host.querySelector('.chatlist-search-clear') as HTMLButtonElement
    // A press lands on the button, so it holds focus the moment its click handler runs.
    clear.focus()
    expect(document.activeElement).toBe(clear)

    act(() => clear.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // Without the refocus the button's removal drops focus to the body, which is the bug.
    expect(document.activeElement).toBe(input)
    act(() => root.unmount())
  })

  it('focuses the field from the wrapper, its magnifier and its padding, but not from the control', async () => {
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

    const wrapper = host.querySelector('.chatlist-search') as HTMLDivElement
    const input = wrapper.querySelector('input') as HTMLInputElement
    const magnifier = wrapper.querySelector('svg') as SVGSVGElement
    // Cancelable, as a real press is: only then does the handler's preventDefault mean anything.
    const press = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      act(() => target.dispatchEvent(event))
      return event
    }

    // The wrapper itself (its padding) focuses the field and cancels the press, as a label does.
    const onPadding = press(wrapper)
    expect(document.activeElement).toBe(input)
    expect(onPadding.defaultPrevented).toBe(true)

    // The magnifier is part of the field's face, so it focuses the field too.
    input.blur()
    press(magnifier)
    expect(document.activeElement).toBe(input)

    // The field itself is left alone: no cancel, so its own text and caret behave as ever.
    const onField = press(input)
    expect(onField.defaultPrevented).toBe(false)

    // The clear control keeps its own press: the wrapper must not swallow or cancel it.
    type(input, 'Al')
    const clear = wrapper.querySelector('.chatlist-search-clear') as HTMLButtonElement
    const onClear = press(clear)
    expect(onClear.defaultPrevented).toBe(false)

    act(() => root.unmount())
  })
})
