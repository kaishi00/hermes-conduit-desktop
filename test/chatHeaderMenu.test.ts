// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

interface Item {
  label: string
  danger?: boolean
  onClick?: () => void
  items?: () => Item[] | Promise<Item[]>
}
let chatMenuItems: (row: { pinned?: boolean }, steps: Record<string, unknown>) => Item[]
let host: HTMLDivElement
let root: Root | undefined

beforeEach(async () => {
  // The node typecheck cannot follow renderer JSX and aliases; Vite resolves this renderer boundary.
  const path = '../src/renderer/src/state/chatMenu.ts'
  ;({ chatMenuItems } = (await import(/* @vite-ignore */ path)) as { chatMenuItems: typeof chatMenuItems })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host.remove()
})

async function renderHeader(props: Record<string, unknown>) {
  // The node typecheck cannot follow renderer JSX and aliases; Vite resolves this renderer boundary.
  const path = '../src/renderer/src/components/ChatHeader.tsx'
  const { ChatHeader } = (await import(/* @vite-ignore */ path)) as { ChatHeader: unknown }
  root = createRoot(host)
  act(() => root!.render(createElement(ChatHeader as never, { title: 'Trip plan', ...props } as never)))
}

const more = () => host.querySelector<HTMLButtonElement>('button[aria-label="More"]')
const labels = () => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(el => el.textContent?.trim())
const item = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === label)
const click = (el: Element | null | undefined) => act(() => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the open chat’s menu items', () => {
  it('lists the row’s steps in the list’s order, each only where it is offered', () => {
    const all = chatMenuItems(
      { pinned: true },
      {
        archive: () => {},
        pin: () => {},
        star: { on: false, toggle: () => {} },
        done: { on: true, toggle: () => {} },
        mute: { now: null, set: () => {} },
        rename: () => {},
        move: { targets: async () => [], to: () => {} },
        remove: () => {}
      }
    )
    expect(all.map(i => i.label)).toEqual(['Archive', 'Unpin', 'Star', 'Mark as Not Done', 'Mute Notifications', 'Rename', 'Move to Project', 'Delete'])
    expect(all.at(-1)?.danger).toBe(true)
    expect(chatMenuItems({ pinned: false }, { rename: () => {}, remove: () => {} }).map(i => i.label)).toEqual(['Rename', 'Delete'])
  })

  it('offers a muted chat its unmute, and an unmuted one the durations', async () => {
    const set = vi.fn()
    const muted = chatMenuItems({ pinned: false }, { mute: { now: { ids: ['a'], until: null }, set } })
    expect(muted.map(i => i.label)).toEqual(['Unmute Notifications'])
    muted[0]!.onClick!()
    expect(set).toHaveBeenLastCalledWith(0)
    const open = chatMenuItems({ pinned: false }, { mute: { now: null, set } })
    const choices = await open[0]!.items!()
    expect(choices.map(i => i.label)).toEqual(['For 15 Minutes', 'For 1 Hour', 'For 1 Day', 'Until I Unmute'])
    choices[1]!.onClick!()
    expect(set).toHaveBeenLastCalledWith(3600)
    choices[3]!.onClick!()
    expect(set).toHaveBeenLastCalledWith(null)
  })
})

describe('the chat header’s menu', () => {
  it('draws no button without a menu', async () => {
    await renderHeader({})
    expect(more()).toBeNull()
    act(() => root!.unmount())
    root = undefined
    await renderHeader({ menu: [] })
    expect(more()).toBeNull()
  })

  it('opens on the button, runs a step and closes', async () => {
    const rename = vi.fn()
    await renderHeader({ menu: chatMenuItems({ pinned: false }, { pin: () => {}, rename, remove: () => {} }) })
    expect(labels()).toEqual([])
    click(more())
    expect(labels()).toEqual(['Pin', 'Rename', 'Delete'])
    expect(more()?.getAttribute('aria-expanded')).toBe('true')
    click(item('Rename'))
    expect(rename).toHaveBeenCalledTimes(1)
    expect(labels()).toEqual([])
  })

  it('closes on a second press, on Escape and on a click elsewhere', async () => {
    await renderHeader({ menu: chatMenuItems({ pinned: false }, { rename: () => {} }) })
    click(more())
    click(more())
    expect(labels()).toEqual([])
    click(more())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(labels()).toEqual([])
    click(more())
    click(document.body)
    expect(labels()).toEqual([])
  })

  it('closes with its chat: the menu taken away and given back stays shut', async () => {
    const path = '../src/renderer/src/components/ChatHeader.tsx'
    const { ChatHeader } = (await import(/* @vite-ignore */ path)) as { ChatHeader: unknown }
    const menu = chatMenuItems({ pinned: false }, { rename: () => {} })
    await renderHeader({ menu })
    click(more())
    expect(labels()).toEqual(['Rename'])
    act(() => root!.render(createElement(ChatHeader as never, { title: 'Trip plan' } as never)))
    expect(labels()).toEqual([])
    act(() => root!.render(createElement(ChatHeader as never, { title: 'Trip plan', menu } as never)))
    expect(labels()).toEqual([])
  })

  it('opens on a right-click of the title', async () => {
    await renderHeader({ menu: chatMenuItems({ pinned: false }, { rename: () => {} }) })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 20 })
    act(() => host.querySelector('.chat-title')!.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(labels()).toEqual(['Rename'])
  })

  it('shows a step’s own lines in the menu’s place, and the way back', async () => {
    const set = vi.fn()
    await renderHeader({ menu: chatMenuItems({ pinned: false }, { mute: { now: null, set }, rename: () => {} }) })
    click(more())
    click(item('Mute Notifications ›'))
    await settle()
    expect(labels()).toEqual(['‹ Mute Notifications', 'For 15 Minutes', 'For 1 Hour', 'For 1 Day', 'Until I Unmute'])
    click(item('‹ Mute Notifications'))
    expect(labels()).toEqual(['Mute Notifications ›', 'Rename'])
    click(item('Mute Notifications ›'))
    await settle()
    click(item('For 1 Day'))
    expect(set).toHaveBeenCalledWith(86400)
    expect(labels()).toEqual([])
  })

  it('says while projects load, and when there are none', async () => {
    let answer: (targets: { id: string; title: string; path: string }[]) => void = () => {}
    const to = vi.fn()
    const targets = () => new Promise<{ id: string; title: string; path: string }[]>(resolve => (answer = resolve))
    await renderHeader({ menu: chatMenuItems({ pinned: false }, { move: { targets, to } }) })
    click(more())
    click(item('Move to Project ›'))
    await settle()
    expect(host.querySelector('.menu-note')?.textContent).toBe('Loading projects…')
    await act(async () => answer([{ id: 'p1', title: 'Garden', path: '/garden' }]))
    await settle()
    expect(host.querySelector('.menu-note')).toBeNull()
    click(item('Garden'))
    expect(to).toHaveBeenCalledWith({ id: 'p1', title: 'Garden', path: '/garden' })
    click(more())
    click(item('Move to Project ›'))
    await settle()
    await act(async () => answer([]))
    await settle()
    expect(host.querySelector('.menu-note')?.textContent).toBe('No Projects')
  })
})
