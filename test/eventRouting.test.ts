import { describe, expect, it } from 'vitest'
import { CLAIMS_PER_WINDOW, EventRouter } from '../src/main/eventRouting'
import { chatWindowFor } from '../src/main/chatWindowSet'
import { chatIdsOf, type WaitingRow } from '../src/renderer/src/state/needsYou'
import { frameStays, navigatesToBrowser, opensExternally } from '../src/main/linkPolicy'

describe('which windows a gateway event goes to', () => {
  it('a window gets the sessions it opened, the ones nobody opened, and those with no session', () => {
    const router = new EventRouter()
    router.noteOpened(1, 'session.resume', { session_id: 'stored-a' }, { session_id: 'live-a', stored_session_id: 'stored-a' })
    router.noteOpened(2, 'session.create', {}, { session_id: 'live-b' })
    expect(router.wants(2, 'live-b')).toBe(true)
    expect(router.wants(2, 'live-a')).toBe(false)
    expect(router.wants(2, 'stored-a')).toBe(false)
    expect(router.wants(2, 'compacted-new')).toBe(true)
    expect(router.wants(2, undefined)).toBe(true)
    expect(router.wants(3, 'live-a')).toBe(false)
  })

  it('two windows on one chat both get it', () => {
    const router = new EventRouter()
    router.noteOpened(1, 'session.resume', { session_id: 's' }, { session_id: 'live' })
    router.noteOpened(2, 'session.resume', { session_id: 's' }, { session_id: 'live' })
    expect(router.wants(1, 'live')).toBe(true)
    expect(router.wants(2, 'live')).toBe(true)
  })

  it('notes only calls that open a session, and lets a closed window or another dashboard go', () => {
    const router = new EventRouter()
    router.noteOpened(1, 'prompt.submit', { session_id: 'x' }, { session_id: 'x' })
    expect(router.wants(2, 'x')).toBe(true)
    router.noteOpened(1, 'session.create', {}, { session_id: 'y' })
    expect(router.wants(2, 'y')).toBe(false)
    router.forget(1)
    expect(router.wants(2, 'y')).toBe(true)
    router.noteOpened(1, 'session.create', {}, { session_id: 'z' })
    router.clear()
    expect(router.wants(2, 'z')).toBe(true)
  })

  it("keeps only a window's last few sessions (desktop#218)", () => {
    const router = new EventRouter()
    router.noteOpened(1, 'session.resume', { session_id: 'first' }, {})
    for (let i = 0; i < CLAIMS_PER_WINDOW - 1; i++) router.noteOpened(1, 'session.resume', { session_id: `s${i}` }, {})
    // Opened again: it's one of the newest now.
    router.noteOpened(1, 'session.resume', { session_id: 'first' }, {})
    router.noteOpened(1, 'session.resume', { session_id: 'newest' }, {})
    expect(router.wants(2, 'first')).toBe(false)
    expect(router.wants(2, 'newest')).toBe(false)
    expect(router.wants(2, 's0')).toBe(true)
    expect(router.wants(2, 's1')).toBe(false)
  })

  it('names the windows that opened a session, so a notification finds its chat window', () => {
    const router = new EventRouter()
    router.noteOpened(1, 'session.resume', { session_id: 'stored' }, { session_id: 'live' })
    router.noteOpened(2, 'session.resume', { session_id: 'stored' }, { session_id: 'live' })
    expect(router.openers('live')).toEqual([1, 2])
    expect(router.openers('stored')).toEqual([1, 2])
    expect(router.openers('other')).toEqual([])
    router.forget(1)
    expect(router.openers('live')).toEqual([2])
  })

  it("keeps the claims of the windows still open on their dashboard across a switch", () => {
    const router = new EventRouter()
    router.noteOpened(1, 'session.resume', { session_id: 'a' }, {})
    router.noteOpened(2, 'session.resume', { session_id: 'b' }, {})
    router.clear([2])
    expect(router.openers('a')).toEqual([])
    expect(router.openers('b')).toEqual([2])
    expect(router.wants(3, 'b')).toBe(false)
  })
})

describe('which chat window a notification belongs to (desktop#268)', () => {
  const windows = [{ contentsId: 5 }, { contentsId: 6 }]
  const byStored = (map: Record<string, { contentsId: number }>) => (id: string) => map[id]

  it('a window that opened the session wins over one found by stored id', () => {
    expect(chatWindowFor('live', ['stored'], [6], windows, byStored({ stored: windows[0] }))).toBe(windows[1])
  })

  it('a window still opening its session is found by the ids the chat goes by', () => {
    expect(chatWindowFor('live', ['other', 'stored'], [], windows, byStored({ stored: windows[0] }))).toBe(windows[0])
  })

  it('an event that names the chat by its stored id finds its window', () => {
    expect(chatWindowFor('stored', [], [], windows, byStored({ stored: windows[1] }))).toBe(windows[1])
  })

  it('no window, or only the main window opened it', () => {
    expect(chatWindowFor('live', ['stored'], [1], windows, byStored({}))).toBeUndefined()
  })
})

describe('the ids a chat goes by, for its window', () => {
  const row = (id: string, sessionIds: string[]): WaitingRow => ({ id, kind: 'approval', sessionIds, title: 'A chat', summary: '', questions: 0, at: 0 })

  it('the stored id this window knows, then a waiting row’s other ids', () => {
    expect(chatIdsOf('live-a', 'stored-a', [row('w1', ['stored-a', 'live-a']), row('w2', ['stored-b', 'live-b'])])).toEqual(['stored-a'])
    expect(chatIdsOf('live-b', undefined, [row('w1', ['stored-a', 'live-a']), row('w2', ['stored-b', 'live-b'])])).toEqual(['stored-b'])
    expect(chatIdsOf('live-c', null, [row('w1', ['stored-a', 'live-a'])])).toEqual([])
  })
})

describe('the link policy every window shares (desktop#268)', () => {
  it('a page opens web, mail, phone and message links; Maps and Calendar only on a Mac', () => {
    for (const url of ['https://x.example', 'http://x.example', 'mailto:a@b.example', 'tel:+15551234', 'sms:+15551234', 'MAILTO:a@b.example'])
      expect(opensExternally(url, false)).toBe(true)
    expect(opensExternally('maps:?q=Paris', false)).toBe(false)
    expect(opensExternally('maps:?q=Paris', true)).toBe(true)
    expect(opensExternally('calshow:1', true)).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'conduit-page://x', 'ftp://x.example']) expect(opensExternally(url, true)).toBe(false)
  })

  it('a refused navigation goes to the browser only for a web page', () => {
    expect(navigatesToBrowser('https://x.example')).toBe(true)
    expect(navigatesToBrowser('mailto:a@b.example')).toBe(false)
    expect(navigatesToBrowser('file:///x')).toBe(false)
  })

  it('a frame stays on the window’s page or a page Hermes drew', () => {
    expect(frameStays(true, false)).toBe(true)
    expect(frameStays(false, true)).toBe(true)
    expect(frameStays(false, false)).toBe(false)
  })
})
