import { describe, expect, it, vi } from 'vitest'

/** The keys some other app already has, and the ones Conduit holds. */
const taken = new Set<string>()
const held = new Set<string>()
vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string) => {
      if (taken.has(accelerator)) return false
      held.add(accelerator)
      return true
    },
    unregister: (accelerator: string) => void held.delete(accelerator)
  }
}))

const { QuickAsk, quickAskHeight } = await import('../src/main/quickAsk')

describe('the quick ask window', () => {
  it('is the field alone, the full height for a reply, or as tall as staged files need', () => {
    expect(quickAskHeight(false)).toBe(128)
    expect(quickAskHeight(true)).toBe(460)
    expect(quickAskHeight(190.2)).toBe(191)
    expect(quickAskHeight(40)).toBe(128)
    expect(quickAskHeight(900)).toBe(460)
    expect(quickAskHeight(Number.NaN)).toBe(128)
  })
})

describe("quick ask's shortcut", () => {
  it('moves to other keys, and lets go of the ones before', () => {
    const quick = new QuickAsk()
    expect(quick.register('Alt+Space')).toBe(true)
    expect(quick.change('Ctrl+Shift+K')).toBe(true)
    expect([...held]).toEqual(['Ctrl+Shift+K'])
    expect(quick.accelerator).toBe('Ctrl+Shift+K')
    expect(quick.registered).toBe(true)
    quick.unregister()
  })

  it('keeps the keys before when another app has the new ones', () => {
    const quick = new QuickAsk()
    quick.register('Alt+Space')
    taken.add('Ctrl+Space')
    expect(quick.change('Ctrl+Space')).toBe(false)
    expect([...held]).toEqual(['Alt+Space'])
    expect(quick.accelerator).toBe('Alt+Space')
    expect(quick.registered).toBe(true)
    quick.unregister()
    taken.clear()
  })

  it('turns off, and says so when the saved keys were taken at launch', () => {
    const quick = new QuickAsk()
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
})
