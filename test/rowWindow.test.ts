// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  heldStart,
  rowKey,
  nearTop,
  olderStart,
  registerRowOpener,
  rowElement,
  rowIndex,
  rowWindow,
  scrollStep,
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

describe('a window when a stored page is read in above the chat (desktop#291)', () => {
  const rows = (...keys: string[]) => keys.map(item)

  it('stays on the rows it drew: it starts where its first row is now', () => {
    const before = rows('c', 'd', 'e')
    expect(heldStart(before, 1, rowKey(before[1]!))).toBe(1)
    // Two rows read in above: every index moved down by two.
    expect(heldStart(rows('a', 'b', 'c', 'd', 'e'), 1, 'd')).toBe(3)
    // A window at the chat's first row holds that row, so the page is above it, not in it.
    expect(heldStart(rows('a', 'b', 'c', 'd', 'e'), 0, 'c')).toBe(2)
  })

  it('finds its first row inside a run the page lengthened', () => {
    const run: Row = { type: 'steps', id: 'older-step', items: [step('older-step'), step('first')], trailing: false }
    expect(heldStart([item('a'), run, item('z')], 0, 'first')).toBe(1)
  })

  it("draws the chat's newest rows when the row is gone (another chat), and leaves an unmoved window alone", () => {
    expect(heldStart(rows('x', 'y'), 1, 'd')).toBeNull()
    expect(heldStart(rows('x', 'y'), null, undefined)).toBeNull()
    expect(heldStart(rows('x', 'y'), 1, undefined)).toBe(1)
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

describe('a jump to a step in a folded run', () => {
  it('opens the run, and leaves an open run alone', async () => {
    ;(window as unknown as { conduit: unknown }).conduit = new Proxy({ platform: 'linux' } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : () => () => {})
    })
    const path = '../src/renderer/src/components/Transcript.tsx'
    const { revealMessage } = (await import(/* @vite-ignore */ path)) as { revealMessage: (el: HTMLElement, key: string) => void }
    const build = (open: boolean) => {
      const container = document.createElement('div')
      const run = document.createElement('div')
      run.className = open ? 'step-run open' : 'step-run'
      run.setAttribute('data-key', 'first')
      run.setAttribute('data-step-keys', 'first second')
      run.scrollIntoView = () => {}
      const head = document.createElement('button')
      head.className = 'step-run-head'
      let presses = 0
      head.addEventListener('click', () => presses++)
      run.append(head)
      container.append(run)
      return { container, presses: () => presses }
    }
    const folded = build(false)
    revealMessage(folded.container, 'second')
    expect(folded.presses()).toBe(1)
    const open = build(true)
    revealMessage(open.container, 'second')
    expect(open.presses()).toBe(0)
    // The run is filed under its first step's key: a jump to that step opens it too.
    const whole = build(false)
    revealMessage(whole.container, 'first')
    expect(whole.presses()).toBe(1)
  })
})

describe("the transcript's scroll listener (desktop#467)", () => {
  const at = { jumping: false, atEnd: false, scrollTop: 5_000, start: 300, count: 900, scrolledUp: true }

  it('follows the end there, and only a window the reader scrolled up gives its rows back', () => {
    expect(scrollStep({ ...at, atEnd: true })).toEqual({ follows: true, start: null })
    // Every frame of a streaming reply scrolls at the end: a window already on the newest rows stays.
    expect(scrollStep({ ...at, atEnd: true, scrolledUp: false, start: 700 })).toEqual({ follows: true })
  })

  it('leaves a reader in the middle of the rows alone', () => {
    expect(scrollStep(at)).toEqual({ follows: false })
  })

  it('takes on the rows above near the top, and asks for the stored page once it holds the first row', () => {
    expect(scrollStep({ ...at, scrollTop: 100 })).toEqual({ follows: false, start: 300 - WINDOW_PAGE })
    expect(scrollStep({ ...at, scrollTop: 100, start: 120 })).toEqual({ follows: false, start: 0 })
    expect(scrollStep({ ...at, scrollTop: 0, start: 0 })).toEqual({ follows: false, older: true })
  })

  it('keeps the window a jump drew until it lands, wherever the scroller is', () => {
    expect(scrollStep({ ...at, jumping: true, atEnd: true })).toEqual({ follows: false })
    expect(scrollStep({ ...at, jumping: true, scrollTop: 0, start: 0 })).toEqual({ follows: false })
  })
})
