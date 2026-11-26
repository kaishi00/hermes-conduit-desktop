// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

const now = Date.now()
const coder = { id: 'coder-chat', title: 'Coder chat', activeAt: now, pinned: true, profile: 'coder' }
const writer = { id: 'writer-chat', title: 'Writer chat', activeAt: now - 1, pinned: false, profile: 'writer' }
const far = { id: 'far-chat', title: 'Far chat', activeAt: now - 2, pinned: false, profile: 'ops', host: 'https://far.example' }
const marks = { stars: [], seen: {}, baseline: now - 10_000, unread: [] }
let host: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  localStorage.clear()
  const testWindow = window as unknown as { conduit: unknown }
  testWindow.conduit = {
    platform: 'linux',
    httpOutcome: async () => ({ ok: true, result: {} })
  }
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host.remove()
})

async function renderList(props: Record<string, unknown>) {
  // The node typecheck cannot follow renderer JSX and aliases; Vite resolves this renderer boundary.
  const path = '../src/renderer/src/components/ChatList.tsx'
  const { ChatList } = (await import(/* @vite-ignore */ path)) as { ChatList: unknown }
  root = createRoot(host)
  act(() => root!.render(createElement(ChatList as never, {
    rows: [coder, writer],
    error: null,
    selectedId: null,
    runningIds: new Set(),
    onSelect: () => {},
    onNewChat: () => {},
    ...props
  } as never)))
}

function row(title: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('.row-wrap')].find(el => el.querySelector('.row-title')?.textContent === title)
  if (!found) throw new Error(`Missing row: ${title}`)
  return found
}

function menuItem(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === label)
}

function rightClick(element: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
  act(() => {
    element.dispatchEvent(event)
  })
  return event
}

describe('chat archive menus', () => {
  it('offers Archive from More and right-click, passing each local row and its profile unchanged', async () => {
    const archive = vi.fn(async (_row: unknown) => false)
    const order = JSON.stringify({ byProfile: { coder: [coder.id] }, mixed: [`coder\u001f${coder.id}`] })
    localStorage.setItem('conduit.pinnedChatOrder.', order)
    await renderList({ onArchive: archive })

    const more = row('Writer chat').querySelector<HTMLButtonElement>('.row-more')!
    expect(more.getAttribute('aria-label')).toBe('More')
    act(() => more.click())
    expect(menuItem('Archive')).toBeDefined()
    act(() => menuItem('Archive')!.click())
    expect(archive).toHaveBeenCalledTimes(1)
    expect(archive.mock.calls[0]![0]).toBe(writer)
    expect(host.querySelector('.row-menu')).toBeNull()

    expect(rightClick(row('Coder chat')).defaultPrevented).toBe(true)
    expect(menuItem('Archive')).toBeDefined()
    act(() => menuItem('Archive')!.click())
    expect(archive).toHaveBeenCalledTimes(2)
    expect(archive.mock.calls[1]![0]).toBe(coder)
    expect(host.querySelector('.row-menu')).toBeNull()
    // A failed archive leaves the pinned order alone.
    expect(localStorage.getItem('conduit.pinnedChatOrder.')).toBe(order)
  })

  it.each([false, true])('drops a pinned chat from its order only after archive succeeds (%s)', async success => {
    let finish!: (result: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    const archive = vi.fn((_row: unknown) => pending)
    const order = JSON.stringify({ byProfile: { coder: [coder.id] }, mixed: [`coder\u001f${coder.id}`] })
    localStorage.setItem('conduit.pinnedChatOrder.', order)
    await renderList({ onArchive: archive })

    rightClick(row('Coder chat'))
    act(() => menuItem('Archive')!.click())
    expect(archive).toHaveBeenCalledWith(coder)
    expect(host.querySelector('.row-menu')).toBeNull()
    expect(localStorage.getItem('conduit.pinnedChatOrder.')).toBe(order)
    await act(async () => {
      finish(success)
      await pending
    })
    expect(JSON.parse(localStorage.getItem('conduit.pinnedChatOrder.')!)).toEqual(
      success ? { byProfile: { coder: [] }, mixed: [] } : JSON.parse(order)
    )
  })

  it('drops from the latest pinned order when another pin changes during the archive', async () => {
    const second = { id: 'second-chat', title: 'Second chat', activeAt: now - 1, pinned: true, profile: 'coder' }
    let finish!: (result: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    localStorage.setItem('conduit.pinnedChatOrder.', JSON.stringify({
      byProfile: { coder: [coder.id, second.id] },
      mixed: [`coder\u001f${coder.id}`, `coder\u001f${second.id}`]
    }))
    await renderList({ rows: [coder, second], onArchive: () => pending, onPin: async () => true })

    rightClick(row('Coder chat'))
    act(() => menuItem('Archive')!.click())
    rightClick(row('Second chat'))
    await act(async () => menuItem('Unpin')!.click())
    expect(JSON.parse(localStorage.getItem('conduit.pinnedChatOrder.')!)).toEqual({
      byProfile: { coder: [coder.id] },
      mixed: [`coder\u001f${coder.id}`]
    })
    await act(async () => {
      finish(true)
      await pending
    })
    expect(JSON.parse(localStorage.getItem('conduit.pinnedChatOrder.')!)).toEqual({ byProfile: { coder: [] }, mixed: [] })
  })

  it.each([true, false])('drops an unpinned row from the latest order only once the unpin is taken (%s, desktop#520)', async taken => {
    const second = { id: 'second-chat', title: 'Second chat', activeAt: now - 1, pinned: true, profile: 'coder' }
    let finish!: (result: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    const order = JSON.stringify({ byProfile: { coder: [coder.id, second.id] }, mixed: [`coder\u001f${coder.id}`, `coder\u001f${second.id}`] })
    localStorage.setItem('conduit.pinnedChatOrder.', order)
    await renderList({ rows: [coder, second], onPin: () => pending })

    rightClick(row('Coder chat'))
    act(() => menuItem('Unpin')!.click())
    expect(host.querySelector('.row-menu')).toBeNull()
    expect(localStorage.getItem('conduit.pinnedChatOrder.')).toBe(order)
    await act(async () => {
      finish(taken)
      await pending
    })
    expect(JSON.parse(localStorage.getItem('conduit.pinnedChatOrder.')!)).toEqual(
      taken ? { byProfile: { coder: [second.id] }, mixed: [`coder\u001f${second.id}`] } : JSON.parse(order)
    )
  })

  it('does not offer Archive without its callback', async () => {
    await renderList({ onDelete: () => {} })
    act(() => row('Writer chat').querySelector<HTMLButtonElement>('.row-more')!.click())
    expect(menuItem('Delete')).toBeDefined()
    expect(menuItem('Archive')).toBeUndefined()
  })

  it.each([null, { host: far.host, name: far.profile }])('never offers Archive on a combined dashboard row (%s)', async otherProfile => {
    const archive = vi.fn(async () => true)
    await renderList({
      otherRows: [far],
      otherProfile,
      onArchive: archive,
      onArchived: () => {},
      onOpenInWindow: () => {},
      marks
    })
    const farRow = row('Far chat')
    expect(farRow.querySelector('.row-more')).toBeNull()
    expect(!!host.querySelector('.filter-button')).toBe(!otherProfile)
    expect(rightClick(farRow).defaultPrevented).toBe(true)
    expect(menuItem('Open in New Window')).toBeDefined()
    expect(menuItem('Archive')).toBeUndefined()
    expect(archive).not.toHaveBeenCalled()
  })

  it('does not open a remote row menu when only Archive is available locally', async () => {
    const archive = vi.fn(async () => true)
    await renderList({ otherRows: [far], onArchive: archive })
    const farRow = row('Far chat')
    expect(farRow.querySelector('.row-more')).toBeNull()
    expect(rightClick(farRow).defaultPrevented).toBe(false)
    expect(host.querySelector('.row-menu')).toBeNull()
    expect(archive).not.toHaveBeenCalled()
  })

  it('opens Archived from Filter and closes the menu', async () => {
    const archived = vi.fn()
    await renderList({ marks, onArchived: archived })
    const filter = host.querySelector<HTMLButtonElement>('.filter-button')!
    expect(filter.getAttribute('aria-expanded')).toBe('false')
    act(() => filter.click())
    expect(filter.getAttribute('aria-expanded')).toBe('true')
    expect(menuItem('Archived')).toBeDefined()
    act(() => menuItem('Archived')!.click())
    expect(archived).toHaveBeenCalledTimes(1)
    expect(filter.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('.filter-menu')).toBeNull()
  })

  it('leaves Archived out of Filter without its callback', async () => {
    await renderList({ marks })
    act(() => host.querySelector<HTMLButtonElement>('.filter-button')!.click())
    expect(host.querySelector('.filter-menu')).not.toBeNull()
    expect(menuItem('Archived')).toBeUndefined()
  })
})
