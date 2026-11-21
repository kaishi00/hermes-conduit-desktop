import { describe, expect, it } from 'vitest'
import { LiveOwners, PAGE_CLOSED, PAGE_RELOADED, replacesPage } from '../src/main/liveOwners'

describe("a page's live sockets (desktop#254)", () => {
  it('a reload or a closed window takes only that page’s sockets', () => {
    const owners = new LiveOwners()
    owners.add(1, 'live-1')
    owners.add(1, 'live-2')
    owners.add(2, 'live-3')
    expect(owners.take(1)).toEqual(['live-1', 'live-2'])
    expect(owners.take(1)).toEqual([])
    expect(owners.sockets(2)).toEqual(['live-3'])
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
    expect(owners.sockets(1)).toEqual(['live-2'])
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
