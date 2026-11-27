// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HotkeyName, HotkeyState } from '../src/shared/ipc'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Settings' global shortcut rows over a stubbed main process (desktop#484). */
describe("Settings' global shortcut keys while they are picked", () => {
  let host: HTMLElement
  let root: Root
  let state: HotkeyState
  let asked: HotkeyName = 'quickAsk'
  let render: (which: HotkeyName) => void = () => undefined
  const recording = vi.fn<(on: boolean) => void>()
  const set = vi.fn<(accelerator: string | null) => Promise<HotkeyState & { changed: boolean; takenBy?: HotkeyName }>>()

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
  const click = (label: string) => act(() => button(label)!.click())

  beforeEach(async () => {
    // A .tsx module: imported by a path the node type check doesn't follow, as the other component tests do.
    const path = '../src/renderer/src/components/HotkeySetting'
    const { HotkeySetting } = (await import(/* @vite-ignore */ path)) as { HotkeySetting: (props: { which: HotkeyName }) => unknown }
    render = which => act(() => root.render(createElement('dl', null, createElement(HotkeySetting as never, { which }))))
    state = { accelerator: 'CommandOrControl+Shift+Space', registered: true }
    recording.mockClear()
    set.mockReset()
    ;(window as unknown as { conduit: unknown }).conduit = {
      platform: 'win32',
      hotkey: async (which: HotkeyName) => (which === asked ? state : { accelerator: null, registered: false }),
      setHotkey: (_which: HotkeyName, accelerator: string | null) => set(accelerator),
      setHotkeyRecording: recording
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    asked = 'quickAsk'
    render('quickAsk')
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
  it('reads the line again when the window comes back from another app (desktop#520)', async () => {
    // The saved keys another app had: the line shows until the keys are read again as free.
    state = { ...state, registered: false }
    act(() => void window.dispatchEvent(new Event('focus')))
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Another app is using')
    state = { ...state, registered: true }
    act(() => void window.dispatchEvent(new Event('focus')))
    await settle()
    expect(host.querySelector('[role="alert"]')).toBeNull()

    // Keys just refused: back from the other app, the line is gone, and Change tells again.
    set.mockResolvedValue({ ...state, changed: false })
    click('Change')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })))
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Another app is using')
    act(() => void window.dispatchEvent(new Event('focus')))
    await settle()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it("has Turn Off rather than Reset for the Live call's keys, which are off until picked", async () => {
    state = { accelerator: null, registered: false }
    asked = 'liveCall'
    render('liveCall')
    await settle()
    expect(host.querySelector('dt')?.textContent).toBe('Live Call')
    expect(host.textContent).toContain('Off')
    expect(button('Reset')).toBeUndefined()
    expect(button('Turn Off')).toBeUndefined()

    set.mockImplementation(async accelerator => {
      state = { accelerator, registered: !!accelerator }
      return { ...state, changed: true }
    })
    click('Change')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true, cancelable: true })))
    await settle()
    expect(set).toHaveBeenLastCalledWith('Ctrl+Alt+L')
    expect(host.querySelector('kbd')?.textContent).toBe('Ctrl+Alt+L')
    expect(button('Reset')).toBeUndefined()
    click('Turn Off')
    await settle()
    expect(set).toHaveBeenLastCalledWith(null)
    expect(host.querySelector('kbd')).toBeNull()
  })

  it("names Quick Ask when the keys picked for the Live call are Quick Ask's", async () => {
    state = { accelerator: null, registered: false }
    asked = 'liveCall'
    render('liveCall')
    await settle()
    set.mockResolvedValue({ ...state, changed: false, takenBy: 'quickAsk' })
    click('Change')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', altKey: true, cancelable: true })))
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Quick Ask already uses Alt+Space. Pick a different one.')
  })

  it('listens in one row at a time, and the keys pressed go to the row that listens', async () => {
    const path = '../src/renderer/src/components/HotkeySetting'
    const { HotkeySetting } = (await import(/* @vite-ignore */ path)) as { HotkeySetting: (props: { which: HotkeyName }) => unknown }
    act(() =>
      root.render(createElement('dl', null, createElement(HotkeySetting as never, { which: 'quickAsk' }), createElement(HotkeySetting as never, { which: 'liveCall' })))
    )
    await settle()
    const changes = () => [...host.querySelectorAll('button')].filter(b => b.textContent === 'Change')
    act(() => changes()[0]!.click())
    act(() => changes()[0]!.click())
    await settle()
    // Only the Live Call row listens now; the main process heard listening start twice and never stop.
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(host.querySelectorAll('dd')[1]!.textContent).toContain('Press a shortcut…')
    expect(recording.mock.calls).toEqual([[true], [true]])
    set.mockResolvedValue({ accelerator: 'Ctrl+Alt+L', registered: true, changed: true })
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true, cancelable: true })))
    await settle()
    expect(set).toHaveBeenCalledTimes(1)
    expect(recording.mock.calls.at(-1)).toEqual([false])
  })
})
