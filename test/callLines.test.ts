// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import './hookHarness'

const line = (id: number, text: string) => ({ id, who: 'assistant' as const, text })

describe("a live call's transcript", () => {
  it('follows the newest line, unless the user scrolled up to read', async () => {
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/CallLines.tsx'
    const { CallLines } = (await import(/* @vite-ignore */ path)) as { CallLines: (p: { lines: unknown[] }) => null }
    // happy-dom lays nothing out: the list is 100 px tall, each line adds 40,
    // and scrollTop clamps to the end as a browser's does.
    let height = 0
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => height })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 100 })
    const tops = new WeakMap<Element, number>()
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) { return Math.max(0, Math.min(tops.get(this) ?? 0, height - 100)) },
      set(this: Element, v: number) { tops.set(this, Math.max(0, Math.min(v, height - 100))) }
    })
    const scrollTo = (el: HTMLElement, top: number) => {
      el.scrollTop = top
      act(() => void el.dispatchEvent(new Event('scroll')))
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    const show = (lines: ReturnType<typeof line>[]) => {
      height = lines.length * 40
      act(() => root.render(createElement(CallLines, { lines })))
    }
    const lines = [line(1, 'Checking the forecast.'), line(2, 'Cloudy, fifty-nine degrees.')]
    show(lines)
    lines.push(line(3, 'Rain tomorrow.'), line(4, 'Keep an umbrella handy.'))
    show([...lines])
    const list = host.querySelector('ol')!
    expect(list.scrollTop).toBe(60)
    scrollTo(list, list.scrollTop)

    // The user scrolls up a little, less than a line: a new line leaves them there.
    scrollTo(list, 40)
    lines.push(line(5, 'Anything else?'))
    show([...lines])
    expect(list.scrollTop).toBe(40)

    // Further up, still left alone.
    scrollTo(list, 0)
    lines.push(line(6, 'Or tomorrow?'))
    show([...lines])
    expect(list.scrollTop).toBe(0)

    // Back at the end, it follows again.
    scrollTo(list, height - 100)
    lines.push(line(7, 'Goodbye.'))
    show([...lines])
    expect(list.scrollTop).toBe(height - 100)

    // The panels keep the last few lines: a long line dropped from the front
    // shrinks the list and clamps it higher, which mustn't stop following.
    show(lines.slice(-3))
    expect(list.scrollTop).toBe(20)
    act(() => void list.dispatchEvent(new Event('scroll')))
    show([...lines.slice(-3), line(8, 'See you.')])
    expect(list.scrollTop).toBe(60)

    // Scrolled up a little, then lines leave the front until the browser
    // clamps the list to its new end: it's at the end, so it follows again (desktop#337).
    const kept = [line(10, 'One.'), line(11, 'Two.'), line(12, 'Three.'), line(13, 'Four.'), line(14, 'Five.')]
    show(kept)
    expect(list.scrollTop).toBe(100)
    scrollTo(list, 80)
    show(kept.slice(-4))
    expect(list.scrollTop).toBe(60)
    act(() => void list.dispatchEvent(new Event('scroll')))
    show([...kept.slice(-4), line(15, 'Six.')])
    expect(list.scrollTop).toBe(100)
    act(() => root.unmount())
  })
})
