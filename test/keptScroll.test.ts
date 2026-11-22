import { describe, expect, it } from 'vitest'
import { KeptScroll } from '../src/renderer/src/state/keptScroll'

/** A list as tall as its rows: scrollTop stops at its end, as a browser's does. */
function list(height: number, view = 100) {
  let top = 0
  return {
    height,
    get scrollTop() {
      return top
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.height - view))
    }
  }
}

describe('KeptScroll', () => {
  it('opens a list drawn again where the last one was', () => {
    const kept = new KeptScroll()
    const first = list(1000)
    kept.opened()
    kept.drew(first)
    first.scrollTop = 420
    kept.scrolled(first)

    const next = list(1000)
    kept.opened()
    kept.drew(next)
    expect(next.scrollTop).toBe(420)
  })

  it('keeps trying while the new list is still short', () => {
    const kept = new KeptScroll()
    const first = list(1000)
    first.scrollTop = 600
    kept.scrolled(first)

    const next = list(300)
    kept.opened()
    kept.drew(next)
    kept.scrolled(next) // the browser reports the clamped spot
    expect(next.scrollTop).toBe(200)
    next.height = 1000 // the other dashboard's rooms arrived
    kept.drew(next)
    expect(next.scrollTop).toBe(600)
  })

  it('stops restoring once you scroll yourself', () => {
    const kept = new KeptScroll()
    const first = list(1000)
    first.scrollTop = 600
    kept.scrolled(first)

    const next = list(300)
    kept.opened()
    kept.drew(next)
    kept.touched()
    next.scrollTop = 50
    kept.scrolled(next)
    next.height = 1000
    kept.drew(next)
    expect(next.scrollTop).toBe(50)
  })

  it('leaves a list at the top when nothing was scrolled', () => {
    const kept = new KeptScroll()
    const next = list(1000)
    kept.opened()
    kept.drew(next)
    expect(next.scrollTop).toBe(0)
  })
  it('puts a kept list shown again back at the top when the other list scrolled up', () => {
    const kept = new KeptScroll()
    const side = list(1000)
    kept.opened()
    kept.drew(side)
    side.scrollTop = 600
    kept.scrolled(side)

    // A group chat's page draws its own list at the spot, then you scroll it to the top.
    const page = list(1000)
    kept.opened()
    kept.drew(page)
    kept.touched()
    page.scrollTop = 0
    kept.scrolled(page)

    // A bot's chat shows the kept side list again, still at 600 underneath.
    kept.opened()
    kept.drew(side)
    expect(side.scrollTop).toBe(0)
  })
})
