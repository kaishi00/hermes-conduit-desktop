import { describe, expect, it } from 'vitest'
import { categoryNamed, categoryOf, categoryPatch, categorySections, movingCategory, OTHER_KEY, renamingCategory } from '../src/renderer/src/state/botCategories'
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
  })
})
