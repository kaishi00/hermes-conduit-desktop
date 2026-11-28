import { describe, expect, it } from 'vitest'
import { currentBack, isBackButton, nearestBack, SAME_PRESS_MS, samePress } from '../src/renderer/src/state/mouseBack'
import { isBackCommand } from '../src/main/backCommand'

interface Fake {
  name: string
  parentElement: Fake | null
}
const node = (name: string, parentElement: Fake | null = null): Fake => ({ name, parentElement })

describe("the mouse's back button", () => {
  it('is button 3, and nothing answers it with no page open', () => {
    expect(isBackButton({ button: 3 })).toBe(true)
    expect(isBackButton({ button: 4 })).toBe(false)
    expect(isBackButton({ button: 0 })).toBe(false)
    expect(currentBack()).toBeUndefined()
  })

  it('presses the Back nearest the pointer', () => {
    const root = node('root')
    const settings = node('settings', root)
    const settingsBack = node('settings back', node('head', settings))
    const files = node('files', root)
    const filesBack = node('files back', node('viewer head', files))
    const inFiles = node('file text', node('viewer', files))
    expect(nearestBack([settingsBack, filesBack], inFiles)?.name).toBe('files back')
    expect(nearestBack([settingsBack, filesBack], node('row', settings))?.name).toBe('settings back')
  })

  it('takes the last Back on a tie or with no pointer, and none when there are none', () => {
    const root = node('root')
    const a = node('a', root)
    const b = node('b', root)
    expect(nearestBack([a, b], null)?.name).toBe('b')
    expect(nearestBack([a, b], node('elsewhere', root))?.name).toBe('b')
    expect(nearestBack([], root)).toBeUndefined()
  })
})

describe('one Back press arriving two ways', () => {
  it('goes back once when the button and the window command come together', () => {
    expect(samePress({ source: 'button', at: 1000 }, 'window', 1000 + SAME_PRESS_MS - 1)).toBe(true)
    expect(samePress({ source: 'window', at: 1000 }, 'button', 1100)).toBe(true)
  })

  it('counts presses by the same path, by the keyboard, or far apart as their own', () => {
    expect(samePress(null, 'button', 0)).toBe(false)
    expect(samePress({ source: 'button', at: 1000 }, 'button', 1100)).toBe(false)
    expect(samePress({ source: 'key', at: 1000 }, 'window', 1100)).toBe(false)
    expect(samePress({ source: 'button', at: 1000 }, 'key', 1100)).toBe(false)
    expect(samePress({ source: 'button', at: 1000 }, 'window', 1000 + SAME_PRESS_MS)).toBe(false)
  })
})

describe('a Back from the window', () => {
  it("is Windows' browser-backward command or a Mac's swipe back", () => {
    expect(isBackCommand('app-command', 'browser-backward')).toBe(true)
    expect(isBackCommand('app-command', 'browser-forward')).toBe(false)
    expect(isBackCommand('swipe', 'left')).toBe(true)
    expect(isBackCommand('swipe', 'right')).toBe(false)
  })
})
