import { describe, expect, it } from 'vitest'
import { CASCADE_STEP, cascade, placeOnScreen, readPlace, restoreFix, steadyPlace } from '../src/shared/windowPlaces'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }
const min = { width: 760, height: 520 }

describe('window places (Eric, 2026-11-27)', () => {
  it('reads only a whole stored place', () => {
    expect(readPlace({ x: 10, y: 20, width: 800, height: 600, maximized: true })).toEqual({ x: 10, y: 20, width: 800, height: 600, maximized: true })
    expect(readPlace({ x: 10, y: 20, width: 800 })).toBeNull()
    expect(readPlace({ x: 10, y: 20, width: 0, height: 600 })).toBeNull()
    expect(readPlace('nope')).toBeNull()
  })

  it('opens where it was, on the second screen too', () => {
    expect(placeOnScreen({ x: 100, y: 80, width: 1200, height: 800 }, [primary, right], min)).toEqual({ x: 100, y: 80, width: 1200, height: 800 })
    expect(placeOnScreen({ x: 2200, y: 200, width: 1400, height: 900 }, [primary, right], min)).toEqual({ x: 2200, y: 200, width: 1400, height: 900 })
  })

  it('comes back to the primary screen, centered, when its screen is gone', () => {
    expect(placeOnScreen({ x: 2200, y: 200, width: 1400, height: 900 }, [primary], min)).toEqual({ x: 260, y: 70, width: 1400, height: 900 })
  })

  it('fits a window bigger than the screen it is on now', () => {
    expect(placeOnScreen({ x: 2000, y: 50, width: 2400, height: 1350 }, [{ x: 0, y: 0, width: 1366, height: 728 }, { x: 1366, y: 0, width: 1920, height: 1040 }], min)).toEqual({ x: 1366, y: 0, width: 1920, height: 1040 })
  })

  it('grows a saved place smaller than the window allows back to its minimum', () => {
    expect(placeOnScreen({ x: 10, y: 10, width: 300, height: 200 }, [primary], min)).toEqual({ x: 10, y: 10, width: 760, height: 520 })
  })

  it('nudges a window hanging off the edge back in, and keeps one whose title bar is off the top out of reach', () => {
    expect(placeOnScreen({ x: 1500, y: 600, width: 1000, height: 700 }, [primary], min)).toEqual({ x: 920, y: 340, width: 1000, height: 700 })
    // Only the bottom showing: the title bar can't be grabbed, so it is centered.
    expect(placeOnScreen({ x: 100, y: -600, width: 1000, height: 700 }, [primary], min)).toEqual({ x: 460, y: 170, width: 1000, height: 700 })
  })

  it('opens a second window of a kind beside the first', () => {
    const place = { x: 100, y: 100, width: 640, height: 780 }
    expect(cascade(place, [{ x: 100, y: 100 }])).toEqual({ ...place, x: 100 + CASCADE_STEP, y: 100 + CASCADE_STEP })
    expect(cascade(place, [{ x: 100, y: 100 }, { x: 128, y: 128 }])).toEqual({ ...place, x: 156, y: 156 })
    expect(cascade(place, [{ x: 500, y: 500 }])).toEqual(place)
    // Running off the screen wraps to its top left.
    expect(cascade({ ...place, y: 250 }, [{ x: 100, y: 250 }], primary)).toEqual({ ...place, x: 0, y: 0 })
  })

  it('puts the size back only when unmaximizing lost it', () => {
    const normal = { x: 300, y: 200, width: 1000, height: 700 }
    expect(restoreFix({ x: 320, y: 110, width: 1280, height: 820 }, normal)).toEqual(normal)
    expect(restoreFix({ x: 500, y: 10, width: 1000, height: 700 }, normal)).toBeNull()
    expect(restoreFix({ x: 0, y: 0, width: 1280, height: 820 }, null)).toBeNull()
  })

  it('keeps the opened place while the window is only a few pixels off it, so 150% scaling does not grow it each launch', () => {
    const opened = { x: 200, y: 120, width: 1001, height: 651 }
    expect(steadyPlace({ x: 200, y: 120, width: 1004, height: 652 }, opened)).toEqual(opened)
    expect(steadyPlace({ x: 200, y: 120, width: 1200, height: 652 }, opened)).toEqual({ ...opened, width: 1200 })
    expect(steadyPlace({ x: 600, y: 120, width: 1004, height: 651 }, opened)).toEqual({ ...opened, x: 600 })
    expect(steadyPlace({ x: 1, y: 2, width: 3, height: 4 }, null)).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })
})
