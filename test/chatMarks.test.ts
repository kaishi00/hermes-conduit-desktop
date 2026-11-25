import { describe, expect, it } from 'vitest'
import { facetOf, filterRows, isStarred, isUnread, markRead, markUnread, parseSelection, selectRows, settingFilter, showsUnread, toggleStar, type ChatFilterKey, type ChatMarks } from '../src/renderer/src/state/chatMarks'

const marks = (): ChatMarks => ({ stars: [], seen: {}, baseline: 1000, unread: [] })
const row = (id: string, activeAt: number, profile?: string) => ({ id, title: id, activeAt, profile, pinned: false })

describe('stars and read state', () => {
  it('counts chats from before the first look as read, and later activity as unread until opened', () => {
    let m = marks()
    expect(isUnread(m, row('old', 900))).toBe(false)
    expect(isUnread(m, row('new', 2000))).toBe(true)
    m = markRead(m, row('new', 2000))
    expect(isUnread(m, row('new', 2000))).toBe(false)
    expect(isUnread(m, row('new', 3000))).toBe(true)
    expect(markRead(m, row('old', 900))).toBe(m)
  })

  it('marks one chat unread by hand without touching the others', () => {
    let m = markUnread(marks(), row('old', 900))
    expect(isUnread(m, row('old', 900))).toBe(true)
    expect(isUnread(m, row('other', 950))).toBe(false)
    m = markRead(m, row('old', 900))
    expect(isUnread(m, row('old', 900))).toBe(false)
  })

  it('honors Hermes’ read flag until the chat is seen here', () => {
    const flagged = { ...row('old', 900), unread: true }
    let m = marks()
    expect(isUnread(m, flagged)).toBe(true)
    m = markRead(m, flagged)
    expect(isUnread(m, flagged)).toBe(false)
  })

  it('stars a chat in its profile, and filters by star, unread and running', () => {
    let m = toggleStar(marks(), row('a', 900, 'work'))
    expect(isStarred(m, row('a', 900, 'work'))).toBe(true)
    expect(isStarred(m, row('a', 900))).toBe(false)
    const rows = [row('a', 900, 'work'), row('b', 2000), row('c', 900)]
    expect(filterRows(rows, 'starred', m, new Set()).map(r => r.id)).toEqual(['a'])
    expect(filterRows(rows, 'unread', m, new Set()).map(r => r.id)).toEqual(['b'])
    expect(filterRows(rows, 'running', m, new Set(['c'])).map(r => r.id)).toEqual(['c'])
    m = toggleStar(m, row('a', 900, 'work'))
    expect(m.stars).toEqual([])
  })
})

describe('the open chat’s dot', () => {
  const marks: ChatMarks = { stars: [], seen: {}, baseline: 1000, unread: [] }
  const chat = { id: 'a', title: 'a', pinned: false, activeAt: 2000 }

  it('draws none on the open chat for activity alone, and one once it is marked unread by hand', () => {
    expect(showsUnread(marks, chat, false)).toBe(true)
    expect(showsUnread(marks, chat, true)).toBe(false)
    expect(showsUnread(markUnread(marks, chat), chat, true)).toBe(true)
    expect(showsUnread(markRead(markUnread(marks, chat), chat), chat, true)).toBe(false)
  })
})

describe('the Filter menu', () => {
  const m = (): ChatMarks => ({ stars: ['default\tb', 'default\tc'], seen: {}, baseline: 1000, unread: [] })
  const rows = [
    { ...row('a', 2000), sourceKind: 'telegram' as const },
    { ...row('b', 2000) },
    { ...row('c', 900) },
    { ...row('d', 900), sourceKind: 'telegram' as const }
  ]
  const ctx = {
    marks: m(),
    running: new Set(['c']),
    waiting: new Set(['d']),
    done: (r: { id: string }) => r.id === 'b',
    underSource: (r: { sourceKind?: string }, s: string) => (r.sourceKind ?? 'chat') === s
  }
  const ids = (sel: ChatFilterKey[]) => selectRows(rows, sel, ctx).map(r => r.id)

  it('lists everything with nothing chosen', () => {
    expect(ids([])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lists a chat with any chosen status, and narrows by Starred and by source', () => {
    expect(ids(['unread', 'running'])).toEqual(['a', 'b', 'c'])
    expect(ids(['unread', 'running', 'starred'])).toEqual(['b', 'c'])
    expect(ids(['source:telegram'])).toEqual(['a', 'd'])
    expect(ids(['source:telegram', 'waiting'])).toEqual(['d'])
    expect(ids(['source:telegram', 'source:chat', 'inprogress'])).toEqual(['a', 'c', 'd'])
  })

  it('counts each choice beside the other groups, alone in its own', () => {
    expect(facetOf(['unread', 'source:telegram'], 'running')).toEqual(['source:telegram', 'running'])
    expect(facetOf(['unread'], 'source:chat')).toEqual(['unread', 'source:chat'])
    expect(facetOf(['unread'], 'starred')).toEqual(['unread', 'starred'])
  })

  it('reads back only what the menu holds', () => {
    expect(parseSelection(['unread', 'bogus', 'source:telegram', 'unread', 3])).toEqual(['unread', 'source:telegram'])
    expect(parseSelection('x')).toEqual([])
    expect(settingFilter(['unread'], 'running', true)).toEqual(['unread', 'running'])
    expect(settingFilter(['unread', 'running'], 'unread', false)).toEqual(['running'])
  })
})
