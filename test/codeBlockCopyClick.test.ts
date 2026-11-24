// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { settle } from './hookHarness'

const copies: string[] = []
const rest = { icon: 'copy', label: 'Copy', announced: '' }
const done = { icon: 'check', label: 'Copy', announced: 'Copied' }

beforeAll(() => {
  Object.assign(window, {
    conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) })
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => write(text) }
  })
})

/** The clipboard's answer to the next writes; a test swaps it for a refusal or a slow one. */
let write: (text: string) => Promise<void> = async text => void copies.push(text)

beforeEach(() => {
  copies.length = 0
  write = async text => void copies.push(text)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
const markdown = '../src/renderer/src/components/Markdown.tsx'

async function mount(text: string) {
  const { Markdown } = (await import(/* @vite-ignore */ markdown)) as { Markdown: (p: { text: string }) => null }
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(Markdown, { text })))
  return {
    button: () => host.querySelector('.code-copy') as HTMLButtonElement,
    // What shows (the icon) and what a screen reader hears announced.
    state: () => ({
      icon: host.querySelector('.code-copy svg')?.getAttribute('data-icon'),
      label: host.querySelector('.code-copy')?.getAttribute('aria-label'),
      announced: host.querySelector('.code-block [aria-live]')?.textContent
    }),
    render: (next: string) => act(() => root.render(createElement(Markdown, { text: next }))),
    unmount: () => act(() => root.unmount())
  }
}

describe("a code block's Copy button", () => {
  it('copies the code, shows the check and announces Copied for 1.5 s, and a second click restarts that', async () => {
    const view = await mount('Send this:\n\n```\nHi Tom,\n\nThanks\n```')
    expect(view.state()).toEqual(rest)

    act(() => view.button().click())
    await settle()
    expect(copies).toEqual(['Hi Tom,\n\nThanks'])
    expect(view.state()).toEqual(done)

    act(() => vi.advanceTimersByTime(1000))
    act(() => view.button().click())
    await settle()
    act(() => vi.advanceTimersByTime(1000))
    // 2 s after the first click, but only 1 s after the second.
    expect(view.state()).toEqual(done)

    act(() => vi.advanceTimersByTime(500))
    expect(view.state()).toEqual(rest)
    expect(copies).toHaveLength(2)
    view.unmount()
  })

  it('keeps Copied while the block holds the same code, and drops it when the text shown is swapped', async () => {
    const view = await mount('```\nfirst card\n```')
    act(() => view.button().click())
    await settle()
    expect(view.state()).toEqual(done)

    // More of the reply arrives after the block: the block, and its Copied, stay.
    view.render('```\nfirst card\n```\n\nAnd more.')
    expect(view.state()).toEqual(done)

    // The surface now shows another card's text in the same place: nothing there was copied.
    view.render('```\nsecond card\n```')
    expect(view.state()).toEqual(rest)
    view.unmount()
  })

  it("says it couldn't copy for 1.5 s when the clipboard refuses, and copies on the next try (#421)", async () => {
    write = async () => {
      throw new Error('denied')
    }
    const view = await mount('```\nls -la\n```')
    act(() => view.button().click())
    await settle()
    expect(view.state()).toEqual({ icon: 'close', label: 'Copy', announced: "Couldn't copy" })
    expect(view.button().className).toBe('code-copy failed')

    act(() => vi.advanceTimersByTime(1500))
    expect(view.state()).toEqual(rest)

    write = async text => void copies.push(text)
    act(() => view.button().click())
    await settle()
    expect(view.state()).toEqual(done)
    expect(copies).toEqual(['ls -la'])
    view.unmount()
  })

  it('changes nothing when the write lands after the block has gone', async () => {
    let land!: () => void
    write = () =>
      new Promise<void>(resolve => {
        land = resolve
      })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = await mount('```\nls -la\n```')
    act(() => view.button().click())
    view.unmount()
    await act(async () => land())
    await settle()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
