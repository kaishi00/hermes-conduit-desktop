// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMarks } from '../src/renderer/src/state/chatMarks'

const testGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

const now = Date.now()
const open = { id: 'open-chat', title: 'Open chat', activeAt: now, pinned: false }
const other = { id: 'other-chat', title: 'Other chat', activeAt: now - 1, pinned: false }
const seen = (): ChatMarks => ({ stars: [], seen: { 'default\topen-chat': now, 'default\tother-chat': now }, baseline: now - 10_000, unread: [] })
let host: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  localStorage.clear()
  const testWindow = window as unknown as { conduit: unknown }
  testWindow.conduit = { platform: 'darwin', httpOutcome: async () => ({ ok: true, result: {} }) }
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
  root ??= createRoot(host)
  act(() => root!.render(createElement(ChatList as never, {
    rows: [open, other],
    error: null,
    selectedId: open.id,
    runningIds: new Set(),
    onSelect: () => {},
    onNewChat: () => {},
    // App always passes Star, which the row menu needs to open.
    onStar: () => {},
    ...props
  } as never)))
}

function row(title: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('.row-wrap')].find(el => el.querySelector('.row-title')?.textContent === title)
  if (!found) throw new Error(`Missing row: ${title}`)
  return found
}

const menuItem = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === label)

function rightClick(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  })
}

describe('marking the open chat unread', () => {
  it('offers Mark as unread on the open chat’s row, as on any other', async () => {
    const toggle = vi.fn()
    await renderList({ marks: seen(), onToggleRead: toggle })
    rightClick(row('Open chat'))
    expect(menuItem('Mark as unread')).toBeDefined()
    act(() => menuItem('Mark as unread')!.click())
    expect(toggle).toHaveBeenCalledWith(open)
  })

  it('shows the open chat’s dot once it is marked unread, and offers Mark as read', async () => {
    const marked = { ...seen(), unread: ['default\topen-chat'] }
    await renderList({ marks: marked, onToggleRead: () => {} })
    expect(row('Open chat').querySelector('.unread-dot')).not.toBeNull()
    rightClick(row('Open chat'))
    expect(menuItem('Mark as read')).toBeDefined()
  })

  it('draws no dot on the open chat for activity alone, which it reads as it goes', async () => {
    const fresh = { ...seen(), seen: {} }
    await renderList({ marks: fresh, onToggleRead: () => {} })
    expect(row('Open chat').querySelector('.unread-dot')).toBeNull()
    expect(row('Other chat').querySelector('.unread-dot')).not.toBeNull()
  })
})
