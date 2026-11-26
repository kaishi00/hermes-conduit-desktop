import { describe, expect, it, vi } from 'vitest'
import { DockPresence, type DockTimers } from '../src/main/dockPresence'

function setup(open = false) {
  const state = { open, visible: true }
  const dock = {
    hide: vi.fn(() => {
      state.visible = false
    }),
    show: vi.fn(async () => {
      state.visible = true
    }),
    isVisible: () => state.visible
  }
  let run: (() => void) | null = null
  const timers: DockTimers = {
    setTimeout: fn => {
      run = fn
      return 1
    },
    clearTimeout: () => {
      run = null
    }
  }
  const presence = new DockPresence(dock, () => state.open, timers)
  const fire = () => {
    const next = run
    run = null
    next?.()
  }
  return { state, dock, presence, fire, pending: () => run !== null }
}

describe('DockPresence (desktop#586)', () => {
  it('leaves the Dock alone while the setting is off', () => {
    const { dock, presence, pending } = setup(false)
    presence.update()
    expect(pending()).toBe(false)
    expect(dock.hide).not.toHaveBeenCalled()
  })

  it('hides the icon a moment after the last window closes', () => {
    const { state, dock, presence, fire } = setup(true)
    presence.setEnabled(true)
    expect(dock.hide).not.toHaveBeenCalled()
    state.open = false
    presence.update()
    expect(dock.hide).not.toHaveBeenCalled()
    fire()
    expect(dock.hide).toHaveBeenCalledTimes(1)
  })

  it("doesn't flicker when a window steps aside and comes straight back", () => {
    const { state, dock, presence, pending } = setup(true)
    presence.setEnabled(true)
    state.open = false
    presence.update()
    expect(pending()).toBe(true)
    state.open = true
    presence.update()
    expect(pending()).toBe(false)
    expect(dock.hide).not.toHaveBeenCalled()
  })

  it('brings the icon back when a window opens, then lets the window come forward', async () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    expect(state.visible).toBe(false)
    state.open = true
    const shown = vi.fn()
    presence.update(shown)
    expect(dock.show).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(shown).toHaveBeenCalledTimes(1)
  })

  it('brings the icon back when the setting is turned off', () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    expect(state.visible).toBe(false)
    presence.setEnabled(false)
    expect(dock.show).toHaveBeenCalledTimes(1)
  })

  it("doesn't hide if the setting went off before the moment passed", () => {
    const { dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    presence.setEnabled(false)
    fire()
    expect(dock.hide).not.toHaveBeenCalled()
  })
})

describe('DockPresence leftovers (desktop#598 reviews)', () => {
  it('hides again when the window closes while the icon is still coming back', async () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    state.open = true
    presence.update()
    state.open = false
    presence.update()
    await Promise.resolve()
    await Promise.resolve()
    expect(state.visible).toBe(true)
    fire()
    expect(dock.hide).toHaveBeenCalledTimes(2)
  })

  it('keeps the icon while a window steps aside, however long it takes', () => {
    const { state, dock, presence, fire, pending } = setup(true)
    presence.setEnabled(true)
    presence.hold()
    state.open = false
    presence.update()
    expect(pending()).toBe(false)
    state.open = true
    presence.release()
    fire()
    expect(dock.hide).not.toHaveBeenCalled()
  })

  it('starts one show at a time', () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    state.open = true
    presence.update()
    presence.update()
    expect(dock.show).toHaveBeenCalledTimes(1)
  })
})

describe('DockPresence: two windows during one show (desktop#603 review)', () => {
  it('brings every window forward that showed while the icon came back', async () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    state.open = true
    const first = vi.fn()
    const second = vi.fn()
    presence.update(first)
    presence.update(second)
    expect(dock.show).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('DockPresence: a hold with the icon hidden (desktop#603 review)', () => {
  it("doesn't bring the icon back for Quick Ask's screenshot", () => {
    const { state, dock, presence, fire } = setup(false)
    presence.setEnabled(true)
    fire()
    expect(state.visible).toBe(false)
    presence.hold()
    presence.update()
    presence.release()
    expect(dock.show).not.toHaveBeenCalled()
  })
})
