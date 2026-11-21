import { describe, expect, it } from 'vitest'
import { endSocket, LiveOwners, PAGE_CLOSED, PAGE_RELOADED, replacesPage, type ClosableSocket } from '../src/main/liveOwners'

describe("a page's live sockets (desktop#254)", () => {
  it('a reload or a closed window takes only that page’s sockets', () => {
    const owners = new LiveOwners()
    owners.add(1, 'live-1')
    owners.add(1, 'live-2')
    owners.add(2, 'live-3')
    expect(owners.take(1)).toEqual(['live-1', 'live-2'])
    expect(owners.take(1)).toEqual([])
    expect(owners.take(2)).toEqual(['live-3'])
  })

  it('a socket that ended on its own is not ended again', () => {
    const owners = new LiveOwners()
    owners.add(1, 'live-1')
    owners.add(1, 'live-2')
    owners.remove('live-1')
    owners.remove('live-unknown')
    expect(owners.take(1)).toEqual(['live-2'])
  })

  it('the reloaded page’s own sockets are its, not the old page’s', () => {
    const owners = new LiveOwners()
    owners.add(1, 'live-1')
    expect(owners.take(1)).toEqual(['live-1'])
    owners.add(1, 'live-2')
    expect(owners.take(1)).toEqual(['live-2'])
  })

  it('only a navigation that replaces the main frame’s page counts', () => {
    expect(replacesPage({ isMainFrame: true, isSameDocument: false })).toBe(true)
    // A hash change (the screen window keeps its viewer in its hash) or a page Hermes drew in a frame.
    expect(replacesPage({ isMainFrame: true, isSameDocument: true })).toBe(false)
    expect(replacesPage({ isMainFrame: false, isSameDocument: false })).toBe(false)
  })

  it('a closed window closes cleanly; a reload keeps a takeover by not closing cleanly', () => {
    expect(PAGE_CLOSED.code).toBe(1000)
    expect([1000, 1001]).not.toContain(PAGE_RELOADED.code)
    expect(PAGE_RELOADED.code).toBeGreaterThanOrEqual(4000)
  })
})

describe('ending a socket whose page went', () => {
  const socket = (throws = false) => {
    const closed: unknown[][] = []
    const s: ClosableSocket & { closed: unknown[][] } = {
      onopen: () => {},
      onmessage: () => {},
      onclose: () => {},
      onerror: () => {},
      closed,
      close: (...args: unknown[]) => {
        closed.push(args)
        if (throws && args.length) throw new Error('bad code')
      }
    }
    return s
  }

  it('reaches the page no more, and keeps an error sink for a handshake it aborts', () => {
    const s = socket()
    endSocket(s, PAGE_RELOADED)
    expect(s.onopen).toBeNull()
    expect(s.onmessage).toBeNull()
    expect(s.onclose).toBeNull()
    expect(typeof s.onerror).toBe('function')
    expect(() => (s.onerror as () => void)()).not.toThrow()
    expect(s.closed).toEqual([[PAGE_RELOADED.code, PAGE_RELOADED.reason]])
  })

  it('a close the socket refuses falls back to a plain close', () => {
    const s = socket(true)
    endSocket(s, PAGE_CLOSED)
    expect(s.closed).toEqual([[PAGE_CLOSED.code, PAGE_CLOSED.reason], []])
    expect(typeof s.onerror).toBe('function')
  })
})
