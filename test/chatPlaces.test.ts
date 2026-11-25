import { describe, expect, it } from 'vitest'
import { CHAT_PLACES_KEPT, ChatPlaces } from '../src/renderer/src/state/chatPlaces'
import { opensInTab } from '../src/renderer/src/state/workspaceTabs'

describe('a tab’s place in its chat', () => {
  it('gives back the place a chat was left at, once', () => {
    const places = new ChatPlaces()
    places.keep('a', { start: 40, anchor: 'row-40', top: 320 })
    expect(places.take('a')).toEqual({ start: 40, anchor: 'row-40', top: 320 })
    expect(places.take('a')).toBeUndefined()
  })

  it('forgets the place of a chat left at its end', () => {
    const places = new ChatPlaces()
    places.keep('a', { start: 0, top: 10 })
    places.keep('a', null)
    expect(places.take('a')).toBeUndefined()
  })

  it('keeps the newest places only', () => {
    const places = new ChatPlaces()
    for (let i = 0; i <= CHAT_PLACES_KEPT; i++) places.keep(`c${i}`, { start: 0, top: i })
    expect(places.take('c0')).toBeUndefined()
    expect(places.take(`c${CHAT_PLACES_KEPT}`)?.top).toBe(CHAT_PLACES_KEPT)
  })
})

describe('a row opened in a tab', () => {
  const click = (button: number, mods: { meta?: boolean; ctrl?: boolean } = {}) => ({ button, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl })
  it('opens with a middle click, or ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(opensInTab(click(1), true)).toBe(true)
    expect(opensInTab(click(0, { meta: true }), true)).toBe(true)
    expect(opensInTab(click(0, { ctrl: true }), true)).toBe(false)
    expect(opensInTab(click(0, { ctrl: true }), false)).toBe(true)
    expect(opensInTab(click(0), false)).toBe(false)
  })
})
