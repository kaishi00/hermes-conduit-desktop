import { describe, expect, it, vi } from 'vitest'
import { badgeCount, badgeText, badgeWaitingIds } from '../src/renderer/src/state/appBadge'

vi.mock('electron', () => ({}))

const { cleanCount, cleanImage } = await import('../src/main/appBadge')

describe('the app icon badge (hermes-conduit issue 3458)', () => {
  it('counts Needs you and each unread chat not already in it', () => {
    const waiting = new Set(['s1'])
    expect(badgeCount('chats', 1, waiting, ['s1', 's2', 's3', 's3'])).toBe(3)
  })

  it('counts only Needs you under Needs you only, and nothing when off', () => {
    expect(badgeCount('needsYou', 2, new Set(), ['s2', 's3'])).toBe(2)
    expect(badgeCount('off', 2, new Set(), ['s2'])).toBe(0)
  })

  it('counts a background request once with its unread chat, by the stored id a waiting row or this window knows', () => {
    const rows = [{ sessionIds: ['stored1', 'live1'] }] as never[]
    const fromRow = badgeWaitingIds([], ['live1'], () => null, rows, [])
    expect(badgeCount('chats', 1, fromRow, ['stored1'])).toBe(1)
    const fromWindow = badgeWaitingIds([], ['live2'], id => (id === 'live2' ? 'stored2' : null), [], [])
    expect(badgeCount('chats', 1, fromWindow, ['stored2'])).toBe(1)
    const other = badgeWaitingIds([], [], () => null, [], [{ sessionIds: ['far1'] }] as never[])
    expect(other.has('far1')).toBe(true)
  })

  it('writes past 99 as 99+', () => {
    expect(badgeText(7)).toBe('7')
    expect(badgeText(120)).toBe('99+')
  })

  it('takes only a whole count and a PNG data URL from the renderer', () => {
    expect(cleanCount(3.7)).toBe(3)
    expect(cleanCount(-1)).toBe(0)
    expect(cleanCount('5')).toBe(0)
    expect(cleanImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(cleanImage('file:///etc/passwd')).toBeNull()
  })
})
