// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickAskShortcut } from '../src/shared/ipc'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Settings > Quick Ask's row over a stubbed main process (desktop#484). */
describe("Settings' Quick Ask keys while they are picked", () => {
  let host: HTMLElement
  let root: Root
  let state: QuickAskShortcut
  const recording = vi.fn<(on: boolean) => void>()
  const set = vi.fn<(accelerator: string | null) => Promise<QuickAskShortcut & { changed: boolean }>>()

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
  const click = (label: string) => act(() => button(label)!.click())

  beforeEach(async () => {
    // A .tsx module: imported by a path the node type check doesn't follow, as the other component tests do.
    const path = '../src/renderer/src/components/QuickAskShortcut'
    const { QuickAskShortcutSetting } = (await import(/* @vite-ignore */ path)) as { QuickAskShortcutSetting: () => unknown }
    state = { accelerator: 'CommandOrControl+Shift+Space', registered: true }
    recording.mockClear()
    set.mockReset()
    ;(window as unknown as { conduit: unknown }).conduit = {
      platform: 'win32',
      quickAskShortcut: async () => state,
      setQuickAskShortcut: set,
      setQuickAskRecording: recording
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(createElement('dl', null, createElement(QuickAskShortcutSetting as never))))
    await settle()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('stops listening when the window is left, tells the main process, and draws the keys as they are then', async () => {
    click('Change')
    expect(recording.mock.calls).toEqual([[true]])
    expect(host.textContent).toContain('Press a shortcut…')
    // Another app took the keys while this one listened: the read made as listening ends says so.
    state = { ...state, registered: false }
    act(() => void window.dispatchEvent(new Event('blur')))
    await settle()
    expect(recording.mock.calls).toEqual([[true], [false]])
    expect(host.textContent).not.toContain('Press a shortcut…')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Another app is using')
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the keys on Esc, and says so when the ones pressed are another app’s', async () => {
    click('Change')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    await settle()
    expect(set).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')).toBeNull()

    set.mockResolvedValue({ ...state, changed: false })
    click('Change')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })))
    await settle()
    expect(set).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Another app is using')
    // The line is about the keys just refused: the next Change starts clean.
    click('Change')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
