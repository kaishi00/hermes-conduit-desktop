import { describe, expect, it } from 'vitest'
import { doneIds, donePath, isDone, parseDone, settingDone } from '../src/renderer/src/state/chatDone'
import { filterRows, loadMarks } from '../src/renderer/src/state/chatMarks'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({ id, title: id, pinned: false, ...extra })

describe('Done chats', () => {
  it('reads the route and finds a mark by any of the chat’s ids', () => {
    const done = parseDone({ done: [{ ids: ['root', 'tip'], at: 1000, by: 'agent' }, { ids: [], at: 1 }, { ids: ['x'] }] })
    expect(done).toEqual([{ ids: ['root', 'tip'], at: 1_000_000, byAgent: true }])
    expect(parseDone({ error: 'nope' })).toBeNull()
    const marks = { default: done! }
    expect(isDone(marks, row('tip'))).toBe(true)
    expect(isDone(marks, row('newer', { lineageRoot: 'root' }))).toBe(true)
    expect(isDone(marks, row('tip', { profile: 'work' }))).toBe(false)
    expect(isDone(null, row('tip'))).toBe(false)
  })

  it('marks before the plugin answers, one mark per chat', () => {
    const compacted = row('chat-2', { lineageRoot: 'chat-1', profile: 'Work' })
    expect(doneIds(compacted)).toEqual(['chat-1', 'chat-2'])
    let marks = settingDone(null, compacted, true, 5)
    expect(marks).toEqual({ work: [{ ids: ['chat-1', 'chat-2'], at: 5, byAgent: false }] })
    marks = settingDone(marks, row('chat-1', { profile: 'work' }), true, 6)
    expect(marks!.work).toHaveLength(1)
    marks = settingDone(marks, compacted, false)
    expect(isDone(marks, compacted)).toBe(false)
  })

  it('asks a named profile’s plugin by name and the default without one', () => {
    expect(donePath('default')).toBe('/api/plugins/conduit_push/chats/done')
    expect(donePath('my bot')).toBe('/api/plugins/conduit_push/chats/done?profile=my%20bot')
  })

  it('filters In progress and Done', () => {
    const rows = [row('a'), row('b'), row('c')]
    const done = (r: ChatRow) => r.id === 'b'
    const m = loadMarks('test-host')
    expect(filterRows(rows, 'done', m, new Set(), new Set(), done).map(r => r.id)).toEqual(['b'])
    expect(filterRows(rows, 'inprogress', m, new Set(), new Set(), done).map(r => r.id)).toEqual(['a', 'c'])
  })
})
