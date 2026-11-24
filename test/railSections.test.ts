import { describe, expect, it } from 'vitest'
import {
  RAIL_SECTIONS,
  RAIL_STORAGE_KEY,
  canUnpinSection,
  fallbackAfterUnpin,
  isDefaultRailLayout,
  moveRailSection,
  parseRailLayout,
  pinnedSections,
  readRailLayout,
  resetRailLayout,
  resolveInitialSection,
  serializeRailLayout,
  setSectionPinned,
  shownRailSections,
  writeRailLayout
} from '../src/renderer/src/state/railSections'

function memory() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k)
  }
}

describe('railSections layout model', () => {
  it('pins all six sections in canonical order by default', () => {
    const layout = parseRailLayout(undefined)
    expect(pinnedSections(layout)).toEqual(['bots', 'chats', 'tasks', 'pulse', 'artifacts', 'needs'])
    expect(RAIL_SECTIONS).toEqual(['bots', 'chats', 'tasks', 'pulse', 'artifacts', 'needs'])
    expect(isDefaultRailLayout(layout)).toBe(true)
  })

  it('unpins and re-pins sections in place, but never unpins Chats', () => {
    expect(canUnpinSection('chats')).toBe(false)
    expect(canUnpinSection('pulse')).toBe(true)

    const start = parseRailLayout(undefined)
    const withoutPulse = setSectionPinned(start, 'pulse', false)
    expect(pinnedSections(withoutPulse)).toEqual(['bots', 'chats', 'tasks', 'artifacts', 'needs'])
    expect(isDefaultRailLayout(withoutPulse)).toBe(false)

    const triedChats = setSectionPinned(withoutPulse, 'chats', false)
    expect(pinnedSections(triedChats)).toContain('chats')

    const corrupted = parseRailLayout(['-chats', '-bots', 'tasks'])
    expect(pinnedSections(corrupted)).toEqual(['chats', 'tasks', 'pulse', 'artifacts', 'needs'])

    const restored = setSectionPinned(withoutPulse, 'pulse', true)
    expect(pinnedSections(restored)).toEqual(['bots', 'chats', 'tasks', 'pulse', 'artifacts', 'needs'])
    expect(isDefaultRailLayout(restored)).toBe(true)
  })

  it('forgives duplicates, non-strings and missing sections', () => {
    const layout = parseRailLayout(['tasks', '-bots', 'tasks', 'bots', 42, '', '-', null])
    expect(layout.order).toEqual(['tasks', 'bots', 'chats', 'pulse', 'artifacts', 'needs'])
    expect(pinnedSections(layout)).toEqual(['tasks', 'chats', 'pulse', 'artifacts', 'needs'])
  })

  it('preserves unknown tokens from newer builds across edits and moves', () => {
    const layout = parseRailLayout(['future-lead', 'bots', '-future-mid', 'chats', 'tasks', 'pulse', 'artifacts', 'needs'])
    const moved = moveRailSection(setSectionPinned(layout, 'tasks', false), 'bots', 'chats', 'after')
    expect(serializeRailLayout(moved)).toEqual([
      'future-lead',
      'chats',
      'bots',
      '-future-mid',
      '-tasks',
      'pulse',
      'artifacts',
      'needs'
    ])
  })

  it('stands an unpinned section in at its stored slot only while active', () => {
    const layout = parseRailLayout(['bots', 'chats', '-tasks', '-pulse', 'artifacts', 'needs'])
    expect(shownRailSections(layout, 'chats')).toEqual(['bots', 'chats', 'artifacts', 'needs'])
    expect(shownRailSections(layout, 'pulse')).toEqual(['bots', 'chats', 'pulse', 'artifacts', 'needs'])
    expect(shownRailSections(layout, null)).toEqual(['bots', 'chats', 'artifacts', 'needs'])
  })

  it('moves sections before and after targets and ignores no-ops', () => {
    const start = parseRailLayout(undefined)
    expect(moveRailSection(start, 'bots', 'bots', 'after')).toBe(start)
    const afterTasks = moveRailSection(start, 'bots', 'tasks', 'after')
    expect(afterTasks.order).toEqual(['chats', 'tasks', 'bots', 'pulse', 'artifacts', 'needs'])
    const beforeChats = moveRailSection(afterTasks, 'needs', 'chats', 'before')
    expect(beforeChats.order).toEqual(['needs', 'chats', 'tasks', 'bots', 'pulse', 'artifacts'])
  })

  it('falls back to the first pinned section on launch when the launch page is unpinned', () => {
    const layout = parseRailLayout(['-bots', 'tasks', 'chats', 'pulse', 'artifacts', 'needs'])
    expect(resolveInitialSection('bots', layout)).toBe('tasks')
    expect(resolveInitialSection('chats', layout)).toBe('chats')
    expect(resolveInitialSection('settings', layout)).toBe('settings')
  })

  it('navigates away cleanly when the user unpins the section currently on screen', () => {
    const layout = parseRailLayout(['-bots', 'chats', 'tasks', '-pulse', 'artifacts', 'needs'])
    expect(fallbackAfterUnpin('pulse', false, 'pulse', layout)).toEqual({ section: 'chats', botsSide: false })
    expect(fallbackAfterUnpin('room', false, 'bots', layout)).toEqual({ section: 'chats', botsSide: false })
    expect(fallbackAfterUnpin('chats', true, 'bots', layout)).toEqual({ section: 'chats', botsSide: false })
    expect(fallbackAfterUnpin('tasks', false, 'pulse', layout)).toEqual({ section: 'tasks', botsSide: false })
  })

  it('persists custom layouts and clears storage when reset to default', () => {
    const store = memory()
    const custom = setSectionPinned(moveRailSection(parseRailLayout(undefined), 'chats', 'bots', 'before'), 'artifacts', false)
    writeRailLayout(custom, store)
    expect(store.map.has(RAIL_STORAGE_KEY)).toBe(true)
    expect(serializeRailLayout(readRailLayout(store))).toEqual(['chats', 'bots', 'tasks', 'pulse', '-artifacts', 'needs'])

    writeRailLayout(resetRailLayout(), store)
    expect(store.map.has(RAIL_STORAGE_KEY)).toBe(false)
    expect(isDefaultRailLayout(readRailLayout(store))).toBe(true)
  })
})
