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
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(
    { platform: 'linux' } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => () => {}) }
  )
})

const row = (id: string, title: string, activeAt = Date.now()) => ({ id, title, activeAt, pinned: false })
const props = (over: Record<string, unknown> = {}) => ({
  rows: [row('a', 'Alpha')],
  error: null,
  selectedId: null,
  runningIds: new Set<string>(),
  onSelect: () => {},
  onNewChat: () => {},
  ...over
})

describe('folded chat-list groups', () => {
  it('reveals the selected chat when the rows arrive after the selection', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    localStorage.setItem('conduit.allProfiles.closedSections', JSON.stringify(['date:today']))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ChatList as never, props({ rows: null, selectedId: 'a' }) as never)))
    expect(host.textContent).not.toContain('Alpha')

    act(() => root.render(createElement(ChatList as never, props({ selectedId: 'a' }) as never)))
    expect(host.textContent).toContain('Alpha')
    expect(JSON.parse(localStorage.getItem('conduit.allProfiles.closedSections') ?? '[]')).toEqual(['date:week', 'date:older'])

    // Folding the open chat's group again holds through the list's next refresh.
    act(() => (host.querySelector('button.sect') as HTMLButtonElement).click())
    expect(host.textContent).not.toContain('Alpha')
    act(() => root.render(createElement(ChatList as never, props({ rows: [row('a', 'Alpha'), row('b', 'Beta')], selectedId: 'a' }) as never)))
    expect(host.textContent).not.toContain('Alpha')
    act(() => root.unmount())
  })

  it('scrolls to the open chat once its folded group is open', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    localStorage.setItem('conduit.allProfiles.closedSections', JSON.stringify(['date:today']))
    const scrolled: string[] = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? '')
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ChatList as never, props({ selectedId: 'a' }) as never)))
    expect(scrolled.some(text => text.includes('Alpha'))).toBe(true)
    act(() => root.unmount())
    Element.prototype.scrollIntoView = was
  })

  it('starts with the two oldest date groups closed, once', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    const day = 86_400_000
    const rows = [row('a', 'Alpha'), row('b', 'Beta', Date.now() - 4 * day), row('c', 'Gamma', Date.now() - 40 * day)]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ChatList as never, props({ rows }) as never)))
    expect(host.textContent).toContain('Alpha')
    expect(host.textContent).not.toContain('Beta')
    expect(host.textContent).not.toContain('Gamma')
    // Opened by hand, they stay open on the next start.
    for (const heading of [...host.querySelectorAll('button.sect')].slice(1)) act(() => (heading as HTMLButtonElement).click())
    expect(host.textContent).toContain('Gamma')
    act(() => root.unmount())
    const again = document.createElement('div')
    document.body.append(again)
    const next = createRoot(again)
    act(() => next.render(createElement(ChatList as never, props({ rows }) as never)))
    expect(again.textContent).toContain('Beta')
    expect(again.textContent).toContain('Gamma')
    act(() => next.unmount())
  })

  it('keeps a folded group open for a Starred lookup, but not for a plain browse', async () => {
    const path = '../src/renderer/src/components/ChatList.tsx'
    const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
    localStorage.setItem('conduit.allProfiles.closedSections', JSON.stringify(['date:today']))
    const marks = { stars: ['default\ta'], seen: {}, baseline: 0, unread: [] }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ChatList as never, props() as never)))
    expect(host.textContent).not.toContain('Alpha')
    act(() => root.unmount())

    // Filter selection is read once when the list mounts, so mount again with Starred on.
    localStorage.setItem('conduit.chatFilters', '["starred"]')
    const lookupHost = document.createElement('div')
    document.body.append(lookupHost)
    const lookup = createRoot(lookupHost)
    act(() => lookup.render(createElement(ChatList as never, props({ marks }) as never)))
    expect(lookupHost.textContent).toContain('Alpha')
    act(() => lookup.unmount())
  })
})
