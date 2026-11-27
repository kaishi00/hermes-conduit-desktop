import { describe, expect, it } from 'vitest'
import { categoryFiler, categoryNamed, categoryNamesOf, categoryOf, categoryPatch, categorySections, cleanRoomCategories, editCategoryPatch, movingCategory, OTHER_KEY, refilingRooms, renamingCategory } from '../src/renderer/src/state/botCategories'
import { rosterFromProfiles } from '../src/renderer/src/state/bots'
import { mergedMeta } from '../src/renderer/src/state/botEditor'

describe('bot categories', () => {
  it("reads Hermes Desktop's section fields, both or none", () => {
    expect(categoryOf({ sectionId: 'sec-1', sectionName: '  Home ' })).toEqual({ id: 'sec-1', name: 'Home' })
    expect(categoryOf({ sectionId: 'sec-2' })).toBeUndefined()
    expect(categoryOf({})).toBeUndefined()
    const roster = rosterFromProfiles({
      profiles: [{ name: 'butler', ui_meta: { 'hermes-bots': { sectionId: 'sec-1', sectionName: 'Home' } } }, { name: 'coder' }]
    })
    expect(roster.bots.find(b => b.name === 'butler')?.category).toEqual({ id: 'sec-1', name: 'Home' })
    expect(roster.bots.find(b => b.name === 'coder')?.category).toBeUndefined()
  })

  it('writes both fields and takes them out again, keeping the rest', () => {
    const meta = { color: '#fff', sectionId: 'old', sectionName: 'Old' }
    expect(mergedMeta(meta, categoryPatch({ id: 'sec-9', name: 'Business' }))).toMatchObject({ color: '#fff', sectionId: 'sec-9', sectionName: 'Business' })
    const removed = mergedMeta(meta, categoryPatch(null))
    expect(removed.sectionId).toBeUndefined()
    expect(removed.sectionName).toBeUndefined()
    expect(removed.color).toBe('#fff')
  })

  it("reuses the host's id for the same name in any case", () => {
    const among = [{ category: { id: 'sec-home', name: 'Home' } }, {}]
    expect(categoryNamed('home', among)).toEqual({ id: 'sec-home', name: 'home' })
    const fresh = categoryNamed('Business', among)
    expect(fresh.id).toMatch(/^sec-/)
    expect(fresh.id).not.toBe('sec-home')
    expect(categoryNamed('HOME', [], { id: 'mine', name: 'Home' })).toEqual({ id: 'mine', name: 'HOME' })
  })

  it('groups by name in the order, then first appearance, with Other last', () => {
    const items = [
      { n: 'coder' },
      { n: 'ledger', c: 'Business' },
      { n: 'butler', c: 'Home' },
      { n: 'scout', c: 'business' }
    ]
    const sections = categorySections(items, [], i => i.c)!
    expect(sections.map(s => s.name)).toEqual(['Business', 'Home', null])
    expect(sections[0]!.items.map(i => i.n)).toEqual(['ledger', 'scout'])
    expect(sections[2]!.key).toBe(OTHER_KEY)
    expect(categorySections(items, ['home'], i => i.c)!.map(s => s.name)).toEqual(['Home', 'Business', null])
    expect(categorySections([{ n: 'a', c: undefined as string | undefined }], [], i => i.c)).toBeNull()
  })

  it('moves a heading one place and keeps a renamed one in its place', () => {
    const shown = ['Home', 'Business', 'Clients']
    expect(movingCategory([], 'Clients', -1, shown)).toEqual(['Home', 'Clients', 'Business'])
    expect(movingCategory([], 'Home', 1, shown)).toEqual(['Business', 'Home', 'Clients'])
    expect(movingCategory([], 'Home', -1, shown)).toEqual([])
    expect(renamingCategory(shown, 'business', 'Work')).toEqual(['Home', 'Work', 'Clients'])
    expect(renamingCategory(['Business', 'Home'], 'Personal', 'business')).toEqual(['Business', 'Home'])
  })

  it("writes Edit Bot's Category only when it changed, keeping a host's id", () => {
    const home = { id: 'sec-home', name: 'Home' }
    const among = [{ category: home }, { category: { id: 'sec-biz', name: 'Business' } }]
    expect(editCategoryPatch(home, ' Home ', among)).toBeNull()
    expect(editCategoryPatch(undefined, '', among)).toBeNull()
    expect(editCategoryPatch(home, '', among)).toEqual({ sectionId: undefined, sectionName: undefined })
    expect(editCategoryPatch(home, 'HOME', among)).toEqual({ sectionId: 'sec-home', sectionName: 'HOME' })
    expect(editCategoryPatch(home, 'business', among)).toEqual({ sectionId: 'sec-biz', sectionName: 'business' })
    expect(categoryNamesOf(among, ['business'])).toEqual(['Business', 'Home'])
  })

  it('files group chats by room id, and a category only rooms are in keeps its heading', () => {
    expect(cleanRoomCategories({ r1: ' Home ', r2: '  ', r3: 4 })).toEqual({ r1: 'Home' })
    expect(cleanRoomCategories(['x'])).toEqual({})
    const rooms = { r1: 'Home', r2: 'business' }
    expect(refilingRooms(rooms, 'HOME', 'House')).toEqual({ r1: 'House', r2: 'business' })
    expect(refilingRooms(rooms, 'Business', null)).toEqual({ r1: 'Home' })
    const sections = categorySections([{ n: 'a', c: undefined as string | undefined }], [], i => i.c, ['Clients'])!
    expect(sections.map(s => s.name)).toEqual(['Clients', null])
    expect(sections[0]!.items).toEqual([])
  })

  it('gives every bot a rename files on one host the same id', () => {
    const file = categoryFiler()
    const a = file('', 'Clients', [], { id: 'w', name: 'Work' })
    const b = file('', 'Clients', [], { id: 'w', name: 'Work' })
    const far = file('https://far', 'Clients', [], { id: 'x', name: 'Work' })
    expect(b.id).toBe(a.id)
    expect(far.id).not.toBe(a.id)
    expect(file('https://far', 'clients', [], undefined).id).toBe(far.id)
  })
})
