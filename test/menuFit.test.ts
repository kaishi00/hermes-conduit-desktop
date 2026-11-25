import { describe, expect, it } from 'vitest'
import { fitMenu } from '../src/renderer/src/state/menuFit'

const view = { width: 1000, height: 800 }

describe('fitMenu', () => {
  it('opens at the point when the menu fits', () => {
    expect(fitMenu({ x: 100, y: 100 }, { width: 220, height: 300 }, view)).toEqual({ left: 100, top: 100 })
  })

  it('moves up by the menu’s real height near the bottom edge', () => {
    expect(fitMenu({ x: 100, y: 700 }, { width: 220, height: 340 }, view)).toEqual({ left: 100, top: 452 })
  })

  it('moves left near the right edge', () => {
    expect(fitMenu({ x: 950, y: 100 }, { width: 220, height: 100 }, view)).toEqual({ left: 772, top: 100 })
  })

  it('never goes past the top-left corner when the menu is taller than the window', () => {
    expect(fitMenu({ x: 50, y: 400 }, { width: 220, height: 900 }, view)).toEqual({ left: 50, top: 8 })
  })
})
