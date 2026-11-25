// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceTab, WorkspaceTabs } from '../src/renderer/src/state/workspaceTabs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tabs: WorkspaceTabs = {
  tabs: [
    { kind: 'chat', key: 'k1', chat: { id: 'a', profile: 'coder' } },
    { kind: 'chat', key: 'k2', chat: { id: 'b', profile: 'writer' } }
  ],
  active: 'k1'
}

describe('the tab strip over the chat column', () => {
  it('shows each chat by name and bot, and picks, closes and opens tabs', async () => {
    // A .tsx module, read as the other component tests read theirs (the tests' tsconfig has no JSX).
    const path = '../src/renderer/src/components/WorkspaceTabStrip.tsx'
    const { WorkspaceTabStrip } = (await import(/* @vite-ignore */ path)) as { WorkspaceTabStrip: never }
    const onPick = vi.fn()
    const onClose = vi.fn()
    const onNewTab = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(WorkspaceTabStrip, {
          tabs,
          showBots: true,
          label: (tab: WorkspaceTab) => (tab.chat.id === 'a' ? { title: 'Fix the build', bot: 'Coder', running: true } : { title: 'Blog post', bot: 'Writer', waits: true }),
          onPick,
          onClose,
          onNewTab
        })
      )
    )
    const shown = [...host.querySelectorAll('[role="tab"]')]
    expect(shown.map(tab => tab.textContent)).toEqual(['Fix the buildCoder', 'Blog postWriter'])
    expect(shown.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(shown[0]!.getAttribute('title')).toBe('Fix the build · Coder · Running')
    expect(host.querySelector('.ws-tab-dot.waits')).not.toBeNull()

    act(() => (shown[1] as HTMLElement).click())
    expect(onPick).toHaveBeenCalledWith(tabs.tabs[1])
    act(() => shown[1]!.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true })))
    expect(onClose).toHaveBeenCalledWith(tabs.tabs[1])
    act(() => host.querySelector<HTMLElement>('.ws-tab-close')!.click())
    expect(onClose).toHaveBeenCalledWith(tabs.tabs[0])
    act(() => host.querySelector<HTMLElement>('.ws-tab-new')!.click())
    expect(onNewTab).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
