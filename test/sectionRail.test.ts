// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRailLayout, pinnedSections, serializeRailLayout } from '../src/renderer/src/state/railSections'
import type { RailLayout, RailSection } from '../src/renderer/src/state/railSections'

beforeEach(() => {
  ;(window as unknown as { conduit: unknown }).conduit = {
    platform: 'darwin'
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function loadComponent() {
  const path = '../src/renderer/src/components/SectionRail.tsx'
  const mod = (await import(/* @vite-ignore */ path)) as { SectionRail: unknown }
  return mod.SectionRail
}

describe('SectionRail context menu and customization', () => {
  it('opens a VS Code-style checklist on right-click anywhere in the rail and pins/unpins items', async () => {
    const SectionRail = await loadComponent()
    let latest: RailLayout = parseRailLayout(undefined)
    const onChangeLayout = vi.fn((next: RailLayout) => {
      latest = next
    })
    const onSelect = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    const render = (layout: RailLayout, active: RailSection | 'settings' = 'chats') => {
      act(() => {
        root.render(
          createElement(SectionRail as never, {
            layout,
            activeSection: active === 'settings' ? null : active,
            settingsSelected: active === 'settings',
            showSidebarButton: false,
            onShowSidebar: () => {},
            pulseUnseen: 3,
            needsCount: 1,
            connected: true,
            hostLabel: 'Home',
            onSelect,
            onSettings: () => {},
            onChangeLayout
          } as never)
        )
      })
    }

    render(latest)
    const nav = host.querySelector('nav.rail') as HTMLElement
    expect(nav).not.toBeNull()
    expect([...nav.querySelectorAll('.rail-sections .railbtn')].map(b => b.getAttribute('title'))).toEqual([
      'Bots (⌘1)',
      'Chats (⌘2)',
      'Tasks (⌘3)',
      'Pulse (⌘4)',
      'Artifacts (⌘5)',
      'Needs you (⌘6)'
    ])

    // Right-click empty rail space -> checklist with checkmarks & shortcuts, no Reset yet.
    act(() => {
      nav.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 300 }))
    })
    const menu = host.querySelector('[role="menu"]') as HTMLElement
    expect(menu).not.toBeNull()
    const checks = [...menu.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLButtonElement[]
    expect(checks.map(c => [c.querySelector('.rail-menu-label')?.textContent, c.getAttribute('aria-checked'), c.disabled])).toEqual([
      ['Bots', 'true', false],
      ['Chats', 'true', true],
      ['Tasks', 'true', false],
      ['Pulse', 'true', false],
      ['Artifacts', 'true', false],
      ['Needs you', 'true', false],
      ['Settings', 'true', true]
    ])
    expect(menu.textContent).not.toContain('Reset Sections')

    // Click Pulse in checklist -> unpins Pulse.
    const pulseItem = checks.find(c => c.textContent?.includes('Pulse'))!
    act(() => {
      pulseItem.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChangeLayout).toHaveBeenCalledTimes(1)
    expect(pinnedSections(latest)).toEqual(['bots', 'chats', 'tasks', 'artifacts', 'needs'])

    // Re-render with updated layout -> Pulse icon hidden, Needs you becomes ⌘5.
    render(latest)
    expect([...host.querySelectorAll('.rail-sections .railbtn')].map(b => b.getAttribute('title'))).toEqual([
      'Bots (⌘1)',
      'Chats (⌘2)',
      'Tasks (⌘3)',
      'Artifacts (⌘4)',
      'Needs you (⌘5)'
    ])

    act(() => root.unmount())
  })

  it('offers quick Unpin/Pin on icon right-click, stands in an active unpinned section, and resets', async () => {
    const SectionRail = await loadComponent()
    let latest = parseRailLayout(['bots', 'chats', 'tasks', '-pulse', 'artifacts', 'needs'])
    const onChangeLayout = vi.fn((next: RailLayout) => {
      latest = next
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    // Pulse is unpinned, but currently active -> stands in the rail without a ⌘ shortcut.
    act(() => {
      root.render(
        createElement(SectionRail as never, {
          layout: latest,
          activeSection: 'pulse',
          settingsSelected: false,
          showSidebarButton: false,
          onShowSidebar: () => {},
          pulseUnseen: 0,
          needsCount: 0,
          connected: true,
          onSelect: () => {},
          onSettings: () => {},
          onChangeLayout
        } as never)
      )
    })

    const pulseBtn = host.querySelector('.rail-sections .railbtn[aria-current="page"]') as HTMLButtonElement
    expect(pulseBtn.getAttribute('title')).toBe('Pulse')

    // Right-click the standing-in Pulse icon -> offers 'Pin Pulse' at top + 'Reset Sections' at bottom.
    act(() => {
      pulseBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 120 }))
    })
    const menu = host.querySelector('[role="menu"]') as HTMLElement
    const topItem = menu.querySelector('[role="menuitem"]') as HTMLButtonElement
    expect(topItem.textContent).toBe('Pin Pulse')
    expect(menu.textContent).toContain('Reset Sections')

    const resetBtn = [...menu.querySelectorAll('[role="menuitem"]')].find(b => b.textContent === 'Reset Sections')!
    act(() => {
      resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(pinnedSections(latest)).toEqual(['bots', 'chats', 'tasks', 'pulse', 'artifacts', 'needs'])

    act(() => root.unmount())
  })

  it('reorders sections when dragged and dropped on another rail icon', async () => {
    const SectionRail = await loadComponent()
    let latest = parseRailLayout(undefined)
    const onChangeLayout = vi.fn((next: RailLayout) => {
      latest = next
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        createElement(SectionRail as never, {
          layout: latest,
          activeSection: 'chats',
          settingsSelected: false,
          showSidebarButton: false,
          onShowSidebar: () => {},
          pulseUnseen: 0,
          needsCount: 0,
          connected: true,
          onSelect: () => {},
          onSettings: () => {},
          onChangeLayout
        } as never)
      )
    })

    const buttons = [...host.querySelectorAll('.rail-sections .railbtn')] as HTMLButtonElement[]
    const botsBtn = buttons[0]!
    const chatsBtn = buttons[1]!
    botsBtn.getBoundingClientRect = () => ({ top: 10, bottom: 54, height: 44, left: 0, right: 44, width: 44, x: 0, y: 10, toJSON: () => ({}) })

    const carried = new Map<string, string>()
    act(() => {
      const start = new Event('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(start, 'dataTransfer', {
        value: { effectAllowed: 'none', dropEffect: 'none', setData: (type: string, value: string) => void carried.set(type, value) }
      })
      chatsBtn.dispatchEvent(start)
    })
    expect([...carried.keys()]).toEqual(['application/x-conduit-rail-move'])
    expect(carried.get('application/x-conduit-rail-move')).toBe('chats')
    act(() => {
      const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 16 })
      botsBtn.dispatchEvent(over)
    })
    act(() => {
      const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 16 })
      botsBtn.dispatchEvent(drop)
    })

    expect(serializeRailLayout(latest)).toEqual(['chats', 'bots', 'tasks', 'pulse', 'artifacts', 'needs'])
    act(() => root.unmount())
  })
})
