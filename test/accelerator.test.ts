import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, acceleratorLabel, validAccelerator } from '../src/shared/accelerator'

const press = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('a global shortcut from a key press', () => {
  it('reads the modifiers and the key', () => {
    expect(acceleratorFromEvent(press(' ', 'Space', { altKey: true }), false)).toBe('Alt+Space')
    expect(acceleratorFromEvent(press('K', 'KeyK', { ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+K')
    expect(acceleratorFromEvent(press('h', 'KeyH', { metaKey: true, shiftKey: true }), true)).toBe('Shift+Cmd+H')
    expect(acceleratorFromEvent(press('h', 'KeyH', { metaKey: true }), false)).toBe('Super+H')
    expect(acceleratorFromEvent(press('ArrowUp', 'ArrowUp', { ctrlKey: true, altKey: true }), false)).toBe('Ctrl+Alt+Up')
    expect(acceleratorFromEvent(press('F8', 'F8'), false)).toBe('F8')
  })

  it('takes the key by its place when Option types a symbol, and by its letter otherwise', () => {
    // Option+K types ˚ on a Mac.
    expect(acceleratorFromEvent(press('˚', 'KeyK', { altKey: true }), true)).toBe('Alt+K')
    // Z on a QWERTZ keyboard sits where QWERTY has Y.
    expect(acceleratorFromEvent(press('z', 'KeyY', { ctrlKey: true }), false)).toBe('Ctrl+Z')
    expect(acceleratorFromEvent(press('+', 'Equal', { ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+=')
  })

  it('waits while only modifiers are down, and refuses keys typing would set off', () => {
    expect(acceleratorFromEvent(press('Alt', 'AltLeft', { altKey: true }), false)).toBeNull()
    expect(acceleratorFromEvent(press('k', 'KeyK'), false)).toBeNull()
    expect(acceleratorFromEvent(press('K', 'KeyK', { shiftKey: true }), false)).toBeNull()
    expect(acceleratorFromEvent(press('Escape', 'Escape', { ctrlKey: true }), false)).toBeNull()
  })
})

describe('validAccelerator', () => {
  it('takes what a key press makes and nothing else', () => {
    expect(validAccelerator('Alt+Space')).toBe(true)
    expect(validAccelerator('Ctrl+Shift+K')).toBe(true)
    expect(validAccelerator('F8')).toBe(true)
    expect(validAccelerator('Shift+F8')).toBe(true)
    expect(validAccelerator('K')).toBe(false)
    expect(validAccelerator('Shift+K')).toBe(false)
    expect(validAccelerator('Ctrl+Ctrl+K')).toBe(false)
    expect(validAccelerator('Hyper+K')).toBe(false)
    expect(validAccelerator('Ctrl+')).toBe(false)
    expect(validAccelerator('Ctrl+Nope')).toBe(false)
    expect(validAccelerator('')).toBe(false)
    expect(validAccelerator(null)).toBe(false)
    expect(validAccelerator(7)).toBe(false)
  })
})

describe('acceleratorLabel', () => {
  it('writes the keys as each system does', () => {
    expect(acceleratorLabel('Alt+Space', 'darwin')).toBe('⌥Space')
    expect(acceleratorLabel('Ctrl+Shift+Cmd+K', 'darwin')).toBe('⌃⇧⌘K')
    expect(acceleratorLabel('Alt+Space', 'win32')).toBe('Alt+Space')
    expect(acceleratorLabel('Super+H', 'win32')).toBe('Win+H')
    expect(acceleratorLabel('Super+H', 'linux')).toBe('Super+H')
    expect(acceleratorLabel('Ctrl+Return', 'win32')).toBe('Ctrl+Enter')
  })
})
