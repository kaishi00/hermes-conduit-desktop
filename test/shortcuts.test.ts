import { describe, expect, it } from 'vitest'
import { glyphs, nextScale, shortcutFor, shortcutForSection, shortcutGroups, SCALES } from '../src/renderer/src/state/shortcuts'

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt
})

describe('shortcutFor', () => {
  it('reads Ctrl on Windows and ⌘ on a Mac', () => {
    expect(shortcutFor(key('n', { ctrl: true }), false)).toBe('new-chat')
    expect(shortcutFor(key('N', { ctrl: true }), false)).toBe('new-chat')
    expect(shortcutFor(key('n', { meta: true }), false)).toBeNull()
    expect(shortcutFor(key('n', { meta: true }), true)).toBe('new-chat')
    expect(shortcutFor(key('n', { ctrl: true }), true)).toBeNull()
  })

  it('maps the sections, text size, Stop, Search and the list', () => {
    expect(shortcutFor(key('1', { ctrl: true }), false)).toBe('go-1')
    expect(shortcutFor(key('6', { ctrl: true }), false)).toBe('go-6')
    expect(shortcutFor(key('7', { ctrl: true }), false)).toBeNull()
    expect(shortcutFor(key('=', { ctrl: true }), false)).toBe('text-bigger')
    expect(shortcutFor(key('+', { ctrl: true }), false)).toBe('text-bigger')
    expect(shortcutFor(key('-', { ctrl: true }), false)).toBe('text-smaller')
    expect(shortcutFor(key('0', { ctrl: true }), false)).toBe('text-normal')
    expect(shortcutFor(key('.', { ctrl: true }), false)).toBe('stop')
    expect(shortcutFor(key('f', { ctrl: true }), false)).toBe('search')
    expect(shortcutFor(key(',', { ctrl: true }), false)).toBe('settings')
    expect(shortcutFor(key('/', { ctrl: true }), false)).toBe('shortcuts')
    expect(shortcutFor(key('\\', { ctrl: true }), false)).toBe('toggle-sidebar')
  })

  it('leaves Alt chords and plain keys alone', () => {
    expect(shortcutFor(key('n', { ctrl: true, alt: true }), false)).toBeNull()
    expect(shortcutFor(key('n'), false)).toBeNull()
    expect(shortcutFor(key('c', { ctrl: true }), false)).toBeNull()
  })
})

describe('glyphs and groups', () => {
  it('shows ⌘ on a Mac and Ctrl+ elsewhere', () => {
    expect(glyphs('new-chat', true)).toBe('⌘N')
    expect(glyphs('new-chat', false)).toBe('Ctrl+N')
    expect(glyphs('text-smaller', true)).toBe('⌘−')
    expect(glyphs('text-bigger', false)).toBe('Ctrl+Plus')
    expect(glyphs('toggle-sidebar', true)).toBe('⌘\\')
    expect(glyphs('toggle-sidebar', false)).toBe('Ctrl+\\')
  })

  it('lists every pinned section in rail order and Settings under Go to', () => {
    const go = shortcutGroups(true)[1]
    expect(go.rows.map(r => [r.title, r.keys[0]])).toEqual([
      ['Bots', '⌘1'],
      ['Chats', '⌘2'],
      ['Tasks', '⌘3'],
      ['Pulse', '⌘4'],
      ['Artifacts', '⌘5'],
      ['Needs you', '⌘6'],
      ['Settings', '⌘,']
    ])

    const custom = shortcutGroups(false, ['chats', 'tasks', 'needs'])[1]
    expect(custom.rows.map(r => [r.title, r.keys[0]])).toEqual([
      ['Chats', 'Ctrl+1'],
      ['Tasks', 'Ctrl+2'],
      ['Needs you', 'Ctrl+3'],
      ['Settings', 'Ctrl+,']
    ])
    expect(shortcutForSection('tasks', ['chats', 'tasks', 'needs'], true)).toBe('⌘2')
    expect(shortcutForSection('pulse', ['chats', 'tasks', 'needs'], true)).toBeNull()
  })
})

describe('nextScale', () => {
  it('steps through the sizes and stops at the ends', () => {
    expect(nextScale(1, 1)).toBe(1.1)
    expect(nextScale(1, -1)).toBe(0.9)
    expect(nextScale(1.35, 0)).toBe(1)
    expect(nextScale(SCALES[0], -1)).toBe(SCALES[0])
    expect(nextScale(SCALES[SCALES.length - 1], 1)).toBe(SCALES[SCALES.length - 1])
  })
})
