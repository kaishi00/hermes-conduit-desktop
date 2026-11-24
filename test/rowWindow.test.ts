// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  nearTop,
  olderStart,
  registerRowOpener,
  rowElement,
  rowIndex,
  rowWindow,
  scrollWindow,
  startAt,
  WINDOW_PAGE,
  WINDOW_ROWS
} from '../src/renderer/src/state/rowWindow'
import type { Row } from '../src/renderer/src/state/runs'
import type { ToolItem, TranscriptItem } from '../src/renderer/src/state/transcript'

const item = (key: string): Row => ({ type: 'item', item: { key, kind: 'user', text: key } as TranscriptItem })
const step = (key: string): ToolItem => ({ key, kind: 'tool', toolId: key, name: 'read', status: 'done' })

describe('a windowed transcript (desktop#291)', () => {
  it('draws a short chat whole, and a long one its newest rows', () => {
    expect(rowWindow(12, null)).toEqual({ start: 0, end: 12 })
    expect(rowWindow(WINDOW_ROWS, null)).toEqual({ start: 0, end: WINDOW_ROWS })
    expect(rowWindow(1_018, null)).toEqual({ start: 1_018 - WINDOW_ROWS, end: 1_018 })
  })

  it('takes on the rows above as the reader scrolls up, and gives them up at its start', () => {
    expect(olderStart(null, 1_018)).toBe(1_018 - WINDOW_ROWS - WINDOW_PAGE)
    expect(rowWindow(1_018, olderStart(null, 1_018))).toEqual({ start: 1_018 - (WINDOW_ROWS + WINDOW_PAGE), end: 1_018 })
    expect(olderStart(100, 1_018)).toBe(0)
    expect(olderStart(0, 1_018)).toBe(0)
  })

  it('keeps a start the reader gave up when another chunk of rows arrives below it', () => {
    // Streamed rows grow the end; the window the reader scrolled to stays where it was.
    expect(rowWindow(600, 200)).toEqual({ start: 200, end: 600 })
    expect(rowWindow(700, 200)).toEqual({ start: 200, end: 700 })
  })

  it('draws its newest rows when the start is above what the chat now has, never nothing', () => {
    // An undo left 10 rows where the reader had scrolled to row 500.
    expect(rowWindow(10, 500)).toEqual({ start: 0, end: 10 })
    expect(rowWindow(0, 300)).toEqual({ start: 0, end: 0 })
    expect(rowWindow(1_018, -5)).toEqual({ start: 0, end: 1_018 })
  })

  it('asks for the rows above only near the top of what is drawn', () => {
    expect(nearTop(0)).toBe(true)
    expect(nearTop(400)).toBe(true)
    expect(nearTop(1_200)).toBe(false)
  })

  it('finds the row an item is drawn in, its own or the run it joined', () => {
    const rows: Row[] = [item('a'), { type: 'steps', id: 'steps-1', items: [step('s1'), step('s2')], trailing: false }, item('b')]
    expect(rowIndex(rows, 'a')).toBe(0)
    expect(rowIndex(rows, 's2')).toBe(1)
    expect(rowIndex(rows, 'b')).toBe(2)
    expect(rowIndex(rows, 'gone')).toBe(-1)
  })

  it('draws a row a jump asks for in the middle of its window, or the newest rows when it is near them', () => {
    expect(startAt(500, 1_018)).toBe(500 - Math.floor(WINDOW_ROWS / 2))
    expect(startAt(1_017, 1_018)).toBe(1_018 - WINDOW_ROWS)
    expect(startAt(3, 1_018)).toBe(0)
    expect(rowWindow(1_018, startAt(1_017, 1_018)).end).toBe(1_018)
  })
})

describe('a jump to a row a window left out (desktop#291)', () => {
  it('draws it through the transcript registered for the scroller, and finds it after', () => {
    const container = document.createElement('div')
    const scroller = document.createElement('div')
    container.append(scroller)
    const row = document.createElement('div')
    let asked: string[] = []
    const off = registerRowOpener(scroller, key => {
      asked.push(key)
      if (key !== 'kept') return false
      // What the transcript does with flushSync: the row is drawn by the time it answers.
      scroller.append(row)
      row.setAttribute('data-key', key)
      return true
    })
    expect(rowElement(container, 'kept')).toBe(row)
    expect(asked).toEqual(['kept'])
    off()

    // Unregistered: a chat that has no such row asks nobody, and answers nothing.
    row.remove()
    expect(rowElement(container, 'kept')).toBeNull()
    expect(asked).toEqual(['kept'])
  })

  it('finds a row that is already drawn without asking, and a missing one answers null', () => {
    const container = document.createElement('div')
    const drawn = document.createElement('div')
    drawn.setAttribute('data-key', 'a')
    container.append(drawn)
    const asked: string[] = []
    const off = registerRowOpener(container, key => {
      asked.push(key)
      return false
    })
    expect(rowElement(container, 'a')).toBe(drawn)
    expect(rowElement(container, 'b')).toBeNull()
    expect(asked).toEqual(['b'])
    off()
  })
})

describe('the scroll paging rule', () => {
  it('gives rows back only when a scrolled-up window reaches the bottom', () => {
    expect(scrollWindow({ end: true, scrolledUp: true, scrollTop: 500, from: 200, count: 1000 }))
      .toEqual({ reset: true, olderFrom: null })
    // A streaming reply's every frame is a bottom scroll too, but must not redraw the chat.
    expect(scrollWindow({ end: true, scrolledUp: false, scrollTop: 500, from: null as unknown as number, count: 1000 }))
      .toEqual({ reset: false, olderFrom: null })
  })

  it('takes a page only near the top and only when rows above are left to take', () => {
    expect(scrollWindow({ end: false, scrolledUp: true, scrollTop: 100, from: 600, count: 1000 }))
      .toEqual({ reset: false, olderFrom: 400 })
    expect(scrollWindow({ end: false, scrolledUp: true, scrollTop: 1_200, from: 600, count: 1000 }))
      .toEqual({ reset: false, olderFrom: null })
    expect(scrollWindow({ end: false, scrolledUp: true, scrollTop: 100, from: 0, count: 1000 }))
      .toEqual({ reset: false, olderFrom: null })
  })
})

describe('a jump to a step inside a run', () => {
  it('finds the run that carries the step key', () => {
    const container = document.createElement('div')
    const run = document.createElement('div')
    run.setAttribute('data-key', 'run-first')
    run.setAttribute('data-step-keys', 'run-first run-second')
    container.append(run)
    expect(rowElement(container, 'run-second')).toBe(run)
    expect(rowElement(container, 'not-there')).toBeNull()
  })

  it('finds a lone step that carries its own key', () => {
    const container = document.createElement('div')
    const step = document.createElement('div')
    step.setAttribute('data-key', 'lone-tool')
    container.append(step)
    expect(rowElement(container, 'lone-tool')).toBe(step)
  })
})
