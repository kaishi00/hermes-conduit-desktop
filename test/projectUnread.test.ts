// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { loadMarks, markUnread, projectChatUnread, saveMarks, type ChatMarks } from '../src/renderer/src/state/chatMarks'
import type { ChatRow } from '../src/renderer/src/state/chats'
import type { ProjectChat } from '../src/renderer/src/state/projects'

const marks = (extra: Partial<ChatMarks> = {}): ChatMarks => ({ stars: [], seen: {}, baseline: 1000, unread: [], ...extra })
const row = (id: string, activeAt: number, unread = false): ChatRow => ({ id, title: `listed ${id}`, activeAt, pinned: false, unread })
const chat = (id: string, lastActive?: number): ProjectChat => ({ id, title: `project ${id}`, lastActive })

describe('a project chat’s unread dot (issue 527)', () => {
  it('uses the list’s copy when there is one, and the project’s own fields when there is not', () => {
    const m = marks()
    // The list's row is newer and carries Hermes' flag; the project's stale copy would miss both.
    expect(projectChatUnread(m, chat('a', 900), [row('a', 2000, true)], null)).toBe(true)
    expect(projectChatUnread(m, chat('a', 900), [], null)).toBe(false)
    expect(projectChatUnread(marks({ unread: ['default\ta'] }), chat('a', 2000), [], null)).toBe(true)
  })

  it('hides the dot for an open chat unless it was marked unread by hand, including while docked', () => {
    const m = marks()
    // Hermes' flag says unread, but an open chat reads as it goes unless marked by hand.
    expect(projectChatUnread(m, chat('a', 2000), [row('a', 2000, true)], 'a')).toBe(false)
    const kept = markUnread(m, row('a', 2000, true))
    expect(projectChatUnread(kept, chat('a', 2000), [row('a', 2000, true)], 'a')).toBe(true)
    // Docked: no chat is the open one in this list, so the mark shows on the project tile.
    expect(projectChatUnread(kept, chat('a', 2000), [], null)).toBe(true)
  })
})

describe('saved marks', () => {
  it('caps hand-marked unread keys as it caps seen times', () => {
    const many = marks({
      seen: Object.fromEntries(Array.from({ length: 2_100 }, (_, i) => [`default\t${i}`, 1000 + i])),
      unread: Array.from({ length: 2_100 }, (_, i) => `default\t${i}`)
    })
    saveMarks('host.example', many)
    const loaded = loadMarks('host.example')
    expect(Object.keys(loaded.seen)).toHaveLength(2_000)
    // The newest hand marks survive, as with seen times (mutation: slice(0) would fail).
    expect(loaded.unread).toEqual(Array.from({ length: 2_000 }, (_, i) => `default\t${i + 100}`))
  })
})
