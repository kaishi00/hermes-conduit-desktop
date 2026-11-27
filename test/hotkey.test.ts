import { describe, expect, it, vi } from 'vitest'

/** The keys some other app already has, and the ones Conduit holds. */
const taken = new Set<string>()
const held = new Set<string>()
const actions = new Map<string, () => void>()
vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, action: () => void) => {
      if (taken.has(accelerator)) return false
      held.add(accelerator)
      actions.set(accelerator, action)
      return true
    },
    unregister: (accelerator: string) => void held.delete(accelerator)
  }
}))

const { GlobalHotkey } = await import('../src/main/hotkey')

describe('a global shortcut picked in Settings', () => {
  it('moves to other keys, and lets go of the ones before', () => {
    const quick = new GlobalHotkey(() => undefined)
    expect(quick.register('Alt+Space')).toBe(true)
    expect(quick.change('Ctrl+Shift+K')).toBe(true)
    expect([...held]).toEqual(['Ctrl+Shift+K'])
    expect(quick.accelerator).toBe('Ctrl+Shift+K')
    expect(quick.registered).toBe(true)
    quick.unregister()
  })

  it('keeps the keys before when another app has the new ones', () => {
    const quick = new GlobalHotkey(() => undefined)
    quick.register('Alt+Space')
    taken.add('Ctrl+Space')
    expect(quick.change('Ctrl+Space')).toBe(false)
    expect([...held]).toEqual(['Alt+Space'])
    expect(quick.accelerator).toBe('Alt+Space')
    expect(quick.registered).toBe(true)
    quick.unregister()
    taken.clear()
  })

  it('takes the saved keys back on a refused change, when another app had them at launch and let go since', () => {
    const quick = new GlobalHotkey(() => undefined)
    taken.add('Alt+Space')
    expect(quick.register('Alt+Space')).toBe(false)
    taken.clear()
    taken.add('Ctrl+Space')
    expect(quick.change('Ctrl+Space')).toBe(false)
    expect(quick.accelerator).toBe('Alt+Space')
    expect(quick.registered).toBe(true)
    expect([...held]).toEqual(['Alt+Space'])
    quick.unregister()
    taken.clear()
  })

  it('lets go of its keys while Settings listens for new ones, and takes them back', () => {
    const quick = new GlobalHotkey(() => undefined)
    quick.register('Alt+Space')
    quick.suspend()
    expect(held.size).toBe(0)
    expect(quick.accelerator).toBe('Alt+Space')
    quick.resume()
    expect([...held]).toEqual(['Alt+Space'])
    // Picking the same keys while they're let go takes them again.
    quick.suspend()
    expect(quick.change('Alt+Space')).toBe(true)
    expect(quick.registered).toBe(true)
    quick.resume()
    expect([...held]).toEqual(['Alt+Space'])
    quick.unregister()
  })

  it('turns off, and says so when the saved keys were taken at launch', () => {
    const quick = new GlobalHotkey(() => undefined)
    quick.register('Alt+Space')
    expect(quick.change(null)).toBe(true)
    expect(held.size).toBe(0)
    expect(quick.accelerator).toBeNull()
    taken.add('Alt+Space')
    expect(quick.register('Alt+Space')).toBe(false)
    expect(quick.accelerator).toBe('Alt+Space')
    expect(quick.registered).toBe(false)
    // The other app let go of them: asking for the same keys again takes them.
    taken.clear()
    expect(quick.change('Alt+Space')).toBe(true)
    expect(quick.registered).toBe(true)
    quick.unregister()
  })

  it('shows only the keys it holds beside a menu item', () => {
    const keys = new GlobalHotkey(() => undefined)
    expect(keys.held).toBeNull()
    taken.add('Ctrl+Alt+L')
    keys.register('Ctrl+Alt+L')
    expect(keys.held).toBeNull()
    taken.clear()
    keys.register('Ctrl+Alt+L')
    expect(keys.held).toBe('Ctrl+Alt+L')
    keys.unregister()
  })

  it('runs its action when its keys are pressed', () => {
    const pressed = vi.fn()
    const keys = new GlobalHotkey(pressed)
    keys.register('Ctrl+Alt+L')
    actions.get('Ctrl+Alt+L')?.()
    expect(pressed).toHaveBeenCalledTimes(1)
    keys.unregister()
  })
})
