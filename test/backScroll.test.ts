// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook } from './hookHarness'
import { useBackScroll } from '../src/renderer/src/state/keptScroll'

/** A pane whose page is `height` tall in a 100 px view: scrollTop stops at its end, as a browser's does. */
function pane() {
  const el = document.createElement('div')
  let top = 0
  const box = { height: 2000 }
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => (top = Math.max(0, Math.min(v, box.height - 100)))
  })
  return { el, box, ref: { current: el } }
}

/** Settings scrolled to 900, Voice opened from there, then Back to Settings drawn short (its rows still arriving). */
function backOnShortPage() {
  const p = pane()
  const hook = renderHook(({ view }: { view: string }) => useBackScroll(view, p.ref), { view: 'main' })
  p.el.scrollTop = 900
  act(() => void p.el.dispatchEvent(new Event('scroll')))
  p.box.height = 600
  hook.rerender({ view: 'voice' })
  expect(p.el.scrollTop).toBe(0)
  p.box.height = 300
  hook.rerender({ view: 'main' })
  expect(p.el.scrollTop).toBe(200)
  return { ...p, hook }
}

const press = (el: HTMLElement, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe("useBackScroll's keys (desktop#338)", () => {
  it('keeps a Back restore going through Tab, which walks the rows without scrolling', () => {
    const { el, box, hook } = backOnShortPage()
    press(el, 'Tab')
    box.height = 2000
    hook.rerender({ view: 'main' })
    expect(el.scrollTop).toBe(900)
    hook.unmount()
  })

  it.each(['ArrowDown', 'PageUp', 'End', ' '])('stops a Back restore on %j, which scrolls', key => {
    const { el, box, hook } = backOnShortPage()
    press(el, key)
    box.height = 2000
    hook.rerender({ view: 'main' })
    expect(el.scrollTop).toBe(200)
    hook.unmount()
  })
})
