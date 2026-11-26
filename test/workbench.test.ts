import { beforeEach, describe, expect, it } from 'vitest'
import { BENCH_COLUMN, CHAT_BESIDE_BENCH, DRAWER_DEFAULT, readBenchOpen, readDrawer, shownBenchWidth, shownView, writeBenchOpen, writeDrawer } from '../src/renderer/src/state/workbench'
import { RAIL_WIDTH } from '../src/renderer/src/state/columnWidths'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

describe('workbench', () => {
  it('takes its share of the room, always leaving the chat its column', () => {
    const room = 1600 - RAIL_WIDTH - 300
    expect(shownBenchWidth(null, 1600, 300)).toBe(Math.round(room * 0.6))
    expect(shownBenchWidth(5000, 1600, 300)).toBe(room - CHAT_BESIDE_BENCH)
    expect(shownBenchWidth(500, 1600, 300)).toBe(500)
    // A narrow window: the chat keeps its column, and the bench gives up its least width for it.
    expect(shownBenchWidth(null, 900, 0)).toBe(900 - RAIL_WIDTH - CHAT_BESIDE_BENCH)
    expect(shownBenchWidth(null, 700, 0)).toBeLessThan(BENCH_COLUMN.min)
  })

  it('remembers whether it was open', () => {
    expect(readBenchOpen()).toBe(false)
    writeBenchOpen(true)
    expect(readBenchOpen()).toBe(true)
  })

  it('remembers the drawer, within bounds', () => {
    expect(readDrawer()).toEqual(DRAWER_DEFAULT)
    writeDrawer({ height: 50, folded: true })
    expect(readDrawer()).toEqual({ height: 120, folded: true })
    store.set('conduit.benchDrawer', 'not json')
    expect(readDrawer()).toEqual(DRAWER_DEFAULT)
  })
})

describe('the view the bench shows', () => {
  it('falls back to Changes for a Browser tab the strip doesn’t have', () => {
    const pages = [{ id: 'a', url: null, nav: 0 }]
    expect(shownView('page:a', pages)).toBe('page:a')
    expect(shownView('page:b', pages)).toBe('changes')
    expect(shownView('files', [])).toBe('files')
  })
})
