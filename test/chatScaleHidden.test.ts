// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { chatScaleNow, drawChatScale, keepPlaceOnScale, rescaledTop, settleOwed } from '../src/renderer/src/state/chatScale'

/** A scroller happy-dom can't lay out: its sizes are whatever the test says. */
function scroller(view: number, height: number, top: number) {
  const el = document.createElement('div')
  const size = { view, height, top }
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.view })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => size.height })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => size.top, set: (v: number) => (size.top = v) })
  return { el, size }
}

afterEach(() => document.documentElement.style.removeProperty('--chat-scale'))

describe('a text size change a hidden or parked chat missed (#641)', () => {
  it('moves a covered pane by the sizes it missed once it shows again', () => {
    const { el, size } = scroller(0, 4000, 1000)
    const off = keepPlaceOnScale(el)
    drawChatScale(1.5)
    drawChatScale(2)
    expect(size.top).toBe(1000)
    settleOwed(el)
    expect(size.top).toBe(1000)
    // Shown again (the docked chat closed): 100% to 200%.
    size.view = 500
    settleOwed(el)
    expect(size.top).toBe(2000)
    // Owed once.
    settleOwed(el)
    expect(size.top).toBe(2000)
    off()
  })

  it('leaves a covered pane at its end to follow the chat', () => {
    const { el, size } = scroller(0, 4000, 3500)
    const off = keepPlaceOnScale(el)
    drawChatScale(1.25)
    size.view = 500
    settleOwed(el)
    expect(size.top).toBe(3500)
    off()
  })

  it('scales a parked tab’s place to the size it comes back at', () => {
    expect(chatScaleNow()).toBe(1)
    drawChatScale(1.5)
    expect(chatScaleNow()).toBe(1.5)
    expect(rescaledTop(900, 1, 1.5)).toBe(1350)
    expect(rescaledTop(900, 1.5, 1.5)).toBe(900)
    expect(rescaledTop(900, undefined, 2)).toBe(900)
  })
})
