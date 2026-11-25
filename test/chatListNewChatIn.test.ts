// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newChatProfiles } from '../src/renderer/src/state/profileGroups'

vi.mock('../src/renderer/src/gateway', () => ({
  gateway: { http: async () => ({ ok: true }) },
  GatewayError: class extends Error {}
}))

const bot = (name: string, isDefault = false) => ({ name, title: name[0].toUpperCase() + name.slice(1), isDefault, pinned: false, hidden: false, hasAvatar: false, face: 0 })

describe('newChatProfiles', () => {
  it('offers the profiles All lists, the main profile first', () => {
    const bots = [bot('furina'), bot('default', true), bot('yelan')]
    expect(newChatProfiles(bots, []).map(b => b.name)).toEqual(['default', 'furina', 'yelan'])
  })

  it('leaves out the profiles left out of All', () => {
    const bots = [bot('default', true), bot('furina'), bot('yelan')]
    expect(newChatProfiles(bots, ['Furina']).map(b => b.name)).toEqual(['default', 'yelan'])
  })

  it('offers every profile when every one is left out, as All lists them all', () => {
    const bots = [bot('default', true), bot('furina')]
    expect(newChatProfiles(bots, ['default', 'furina']).map(b => b.name)).toEqual(['default', 'furina'])
  })
})

beforeEach(() => {
  localStorage.clear()
  ;(window as unknown as { conduit: unknown }).conduit = new Proxy(
    { platform: 'linux' } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : () => () => {}) }
  )
})

async function renderList(props: Record<string, unknown>) {
  const path = '../src/renderer/src/components/ChatList.tsx'
  const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(ChatList as never, {
        rows: [],
        error: null,
        selectedId: null,
        runningIds: new Set<string>(),
        onSelect: () => {},
        ...props
      } as never)
    )
  )
  return { host, root }
}

const plus = (host: HTMLElement) => host.querySelector('button[aria-label="New chat"]') as HTMLButtonElement

describe('New Chat under All (issue 394)', () => {
  it('asks which profile, and starts the chat in the one picked', async () => {
    const onNewChat = vi.fn()
    const { host, root } = await renderList({ bots: [bot('default', true), bot('furina')], profile: null, onNewChat })
    act(() => plus(host).click())
    expect(onNewChat).not.toHaveBeenCalled()
    const menu = host.querySelector('.header-menu') as HTMLElement
    expect(menu.querySelector('.menu-title')?.textContent).toBe('New chat in')
    const lines = [...menu.querySelectorAll('button[role="menuitem"]')] as HTMLButtonElement[]
    expect(lines.map(b => b.textContent)).toEqual(['Default', 'Furina'])
    act(() => lines[1].click())
    expect(onNewChat).toHaveBeenCalledWith('furina')
    act(() => root.unmount())
  })

  it('lists the profiles in the column’s order, the main one first', async () => {
    const bots = [bot('default', true), bot('furina'), bot('yelan')]
    const tiles = [bots[2], bots[1], bots[0]].map(b => ({ key: b.name, host: 'h', bot: b, own: true }))
    const { host, root } = await renderList({ bots, profileTiles: tiles, profile: null, onNewChat: () => {} })
    act(() => plus(host).click())
    const lines = [...host.querySelectorAll('.header-menu button[role="menuitem"]')].map(b => b.textContent)
    expect(lines).toEqual(['Default', 'Yelan', 'Furina'])
    act(() => root.unmount())
  })

  it('starts straight away in a profile chosen in the column', async () => {
    const onNewChat = vi.fn()
    const { host, root } = await renderList({ bots: [bot('default', true), bot('furina')], profile: 'furina', onNewChat })
    act(() => plus(host).click())
    expect(host.querySelector('.header-menu')).toBeNull()
    expect(onNewChat).toHaveBeenCalledWith(undefined)
    act(() => root.unmount())
  })

  it('starts in the only profile All lists without asking', async () => {
    localStorage.setItem('conduit.allProfiles.leftOut', JSON.stringify(['default']))
    const onNewChat = vi.fn()
    const { host, root } = await renderList({ bots: [bot('default', true), bot('furina')], profile: null, onNewChat })
    act(() => plus(host).click())
    expect(host.querySelector('.header-menu')).toBeNull()
    expect(onNewChat).toHaveBeenCalledWith('furina')
    act(() => root.unmount())
  })
})
