import { describe, expect, it } from 'vitest'
import { CLAIMS_PER_WINDOW, EventRouter } from '../src/main/eventRouting'

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
})
