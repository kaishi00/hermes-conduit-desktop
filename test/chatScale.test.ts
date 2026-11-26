import { describe, expect, it } from 'vitest'
import { placeOf, type ScaleScroller } from '../src/renderer/src/state/chatScale'

/**
 * A scroller of `count` rows of `height` px each, drawn at `zoom`, its view `view` px tall at the
 * page's top. Rows' boxes follow the scroll and the zoom, as a zoomed `.transcript-inner`'s do.
 */
function fakeScroller(count: number, height: number, view: number) {
  const s = {
    zoom: 1,
    scrollTop: 0,
    get scrollHeight() {
      return count * height * s.zoom
    },
    clientHeight: view,
    box: () => ({ top: 0, height: view }),
    rows: () =>
      Array.from({ length: count }, (_, i) => ({
        box: () => ({ top: i * height * s.zoom - s.scrollTop, height: height * s.zoom })
      }))
  }
  return s satisfies ScaleScroller
}

/** The row at the top of the view, and how far into it, as a share of the row. */
function atTop(s: ReturnType<typeof fakeScroller>, height: number) {
  const at = s.scrollTop / (height * s.zoom)
  return { row: Math.floor(at), share: +(at - Math.floor(at)).toFixed(3) }
}

describe('chat text size keeps the reading place', () => {
  // Eric, 2026-11-26: Ctrl+scroll zoomed the text and took the chat far up, to the same place each time.
  it('keeps the row a reader scrolled up to at the top of the view', () => {
    const s = fakeScroller(300, 40, 600)
    s.scrollTop = 150 * 40 + 10
    const before = atTop(s, 40)
    for (const zoom of [1.1, 1.3, 1.7, 0.8, 1]) {
      const put = placeOf(s)
      s.zoom = zoom
      put?.()
      expect(atTop(s, 40)).toEqual(before)
    }
  })

  it('keeps a reader at the newest message at the end', () => {
    const s = fakeScroller(300, 40, 600)
    s.scrollTop = s.scrollHeight - s.clientHeight
    for (const zoom of [1.2, 1.7, 0.8]) {
      const put = placeOf(s)
      s.zoom = zoom
      put?.()
      // A real scroller stops at its end; the fake one is set to its full height.
      expect(s.scrollTop).toBe(s.scrollHeight)
    }
  })

  it('leaves a hidden pane alone', () => {
    const s = fakeScroller(10, 40, 0)
    expect(placeOf(s)).toBeNull()
  })
})
