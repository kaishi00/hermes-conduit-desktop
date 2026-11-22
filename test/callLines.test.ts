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
    // happy-dom lays nothing out: the list is 100 px tall, each line adds 40.
    let height = 0
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => height })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 100 })
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
    expect(list.scrollTop).toBe(160)

    // The user scrolls up to read: a new line leaves them there.
    list.scrollTop = 0
    act(() => void list.dispatchEvent(new Event('scroll')))
    lines.push(line(5, 'Anything else?'))
    show([...lines])
    expect(list.scrollTop).toBe(0)

    // Back at the end, it follows again.
    list.scrollTop = height - 100
    act(() => void list.dispatchEvent(new Event('scroll')))
    lines.push(line(6, 'Goodbye.'))
    show([...lines])
    expect(list.scrollTop).toBe(height)
    act(() => root.unmount())
  })
})
