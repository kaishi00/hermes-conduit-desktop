// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCROLLING_CLASS, watchScrolling } from '../src/renderer/src/state/scrollbars'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('scrollbars only while you use them', () => {
  it('marks a scroller while it scrolls and clears it once it stops', () => {
    vi.useFakeTimers()
    const stop = watchScrolling(document, 900)
    const list = document.createElement('div')
    document.body.append(list)
    list.dispatchEvent(new Event('scroll'))
    expect(list.classList.contains(SCROLLING_CLASS)).toBe(true)
    vi.advanceTimersByTime(600)
    list.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(600)
    // Still scrolling: the last scroll restarted the wait.
    expect(list.classList.contains(SCROLLING_CLASS)).toBe(true)
    vi.advanceTimersByTime(400)
    expect(list.classList.contains(SCROLLING_CLASS)).toBe(false)
    stop()
    list.dispatchEvent(new Event('scroll'))
    expect(list.classList.contains(SCROLLING_CLASS)).toBe(false)
  })

  it('redraws a scroller\'s bar as the pointer enters and leaves it, which Chromium skips for :hover', async () => {
    const stop = watchScrolling(document, 900)
    const list = document.createElement('div')
    list.style.overflowY = 'auto'
    Object.defineProperty(list, 'scrollHeight', { value: 2000 })
    Object.defineProperty(list, 'clientHeight', { value: 400 })
    const row = document.createElement('div')
    list.append(row)
    document.body.append(list)
    const seen: string[] = []
    const observer = new MutationObserver(records => records.forEach(r => seen.push(r.oldValue ?? '')))
    observer.observe(list, { attributes: true, attributeOldValue: true, attributeFilter: ['style'] })
    row.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await Promise.resolve()
    // Taken away for one layout, then given back as it was.
    expect(seen.map(v => v.includes('hidden'))).toEqual([false, true])
    // Moving within it redraws nothing.
    row.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await Promise.resolve()
    expect(seen).toHaveLength(2)
    document.body.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await Promise.resolve()
    expect(seen).toHaveLength(4)
    expect(list.style.overflowY).toBe('auto')
    observer.disconnect()
    stop()
  })

  it('draws no thumb at rest, and one on hover or while scrolling (app.css)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/::-webkit-scrollbar-thumb \{[^}]*background: transparent padding-box;/)
    expect(css).toMatch(/:hover::-webkit-scrollbar-thumb,\s*\.scrolling::-webkit-scrollbar-thumb \{/)
  })
})

describe('scrollbars inside the islands', () => {
  it('keep the track off the rounded corners and the thumb off the edge (app.css)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.chatlist ::-webkit-scrollbar-track,[^{]*\{\s*margin-block: calc\(var\(--radius-island\) - 4px\);/)
    expect(css).toMatch(/\.chatlist ::-webkit-scrollbar-thumb,[^{]*\{\s*border-width: 3px 5px 3px 3px;/)
  })
})
