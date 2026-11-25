// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook } from './hookHarness'
import { isUnread, type ChatMarks } from '../src/renderer/src/state/chatMarks'
import { useOpenChatRead } from '../src/renderer/src/state/openChatRead'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, activeAt: number, unread = false): ChatRow => ({ id, title: id, activeAt, pinned: false, unread })

interface Props {
  openId: string | null
  openRow: ChatRow | undefined
}

/** The hook as App drives it: marks kept here, Hermes' flag writes recorded. */
function mount(start: Props) {
  let marks: ChatMarks = { stars: [], seen: {}, baseline: 1000, unread: [] }
  const writes: [string, boolean][] = []
  const updateMarks = (change: (current: ChatMarks) => ChatMarks) => {
    marks = change(marks)
  }
  const writeUnread = (r: ChatRow, unread: boolean) => void writes.push([r.id, unread])
  const hook = renderHook((p: Props) => useOpenChatRead(p.openId, p.openRow, marks, updateMarks, writeUnread), start)
  // App renders again with the marks a change saved; so does this.
  let shown = start
  const show = (next: Props) => {
    shown = next
    hook.rerender(next)
  }
  show(start)
  const toggle = (r: ChatRow) => {
    act(() => hook.result()(r))
    show(shown)
  }
  return { show, toggle, unmount: hook.unmount, marks: () => marks, writes }
}

describe('the open chat’s read state', () => {
  it('reads the open chat as read, its new activity too', () => {
    const t = mount({ openId: 'a', openRow: row('a', 2000) })
    expect(isUnread(t.marks(), row('a', 2000))).toBe(false)
    t.show({ openId: 'a', openRow: row('a', 3000, true) })
    expect(isUnread(t.marks(), row('a', 3000, true))).toBe(false)
    expect(t.writes).toEqual([['a', false]])
    t.unmount()
  })

  it('keeps the open chat unread once marked, through Hermes’ flag and new activity, until another chat opens', () => {
    const t = mount({ openId: 'a', openRow: row('a', 2000) })
    t.toggle(row('a', 2000))
    expect(t.writes).toEqual([['a', true]])
    expect(isUnread(t.marks(), row('a', 2000))).toBe(true)

    // Hermes' flag comes back on the next list read, then a new reply lands: still unread, nothing cleared.
    t.show({ openId: 'a', openRow: row('a', 2000, true) })
    t.show({ openId: 'a', openRow: row('a', 3000, true) })
    expect(isUnread(t.marks(), row('a', 3000, true))).toBe(true)
    expect(t.writes).toEqual([['a', true]])

    // Leaving keeps it unread; opening it again reads it.
    t.show({ openId: 'b', openRow: row('b', 900) })
    expect(isUnread(t.marks(), row('a', 3000, true))).toBe(true)
    t.show({ openId: 'a', openRow: row('a', 3000, true) })
    expect(isUnread(t.marks(), row('a', 3000, true))).toBe(false)
    expect(t.writes).toEqual([['a', true], ['a', false]])
    t.unmount()
  })

  it('keeps the mark through a list read that briefly lacks the open chat’s row', () => {
    const t = mount({ openId: 'a', openRow: row('a', 2000) })
    t.toggle(row('a', 2000))
    t.show({ openId: 'a', openRow: undefined })
    t.show({ openId: 'a', openRow: row('a', 2000, true) })
    expect(isUnread(t.marks(), row('a', 2000, true))).toBe(true)
    expect(t.writes).toEqual([['a', true]])
    t.unmount()
  })

  it('reads the open chat again when it is marked read by hand', () => {
    const t = mount({ openId: 'a', openRow: row('a', 2000) })
    t.toggle(row('a', 2000))
    t.show({ openId: 'a', openRow: row('a', 2000, true) })
    t.toggle(row('a', 2000, true))
    expect(isUnread(t.marks(), row('a', 2000, true))).toBe(false)
    expect(t.writes).toEqual([['a', true], ['a', false]])
    // And reads as it goes again, as before the mark.
    t.show({ openId: 'a', openRow: row('a', 3000) })
    expect(isUnread(t.marks(), row('a', 3000))).toBe(false)
    t.unmount()
  })

  it('leaves the open chat’s own read state alone when another chat is marked', () => {
    const t = mount({ openId: 'a', openRow: row('a', 2000) })
    t.toggle(row('b', 900))
    expect(isUnread(t.marks(), row('b', 900))).toBe(true)
    t.show({ openId: 'a', openRow: row('a', 3000) })
    expect(isUnread(t.marks(), row('a', 3000))).toBe(false)
    t.unmount()
  })
})
