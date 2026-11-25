// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderHook } from './hookHarness'
import {
  arrangePinned,
  dropFromSavedOrder,
  EDGE_MAX_STEP,
  EDGE_ZONE,
  edgeScrollDecision,
  edgeScrollStep,
  hostOrder,
  loadOrders,
  moved,
  ordered,
  pinIdOf,
  prefsPath,
  saveOrders,
  SYNC_KEY,
  usePinnedOrder,
  without,
  type PinnedOrders
} from '../src/renderer/src/state/pinnedOrder'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, profile?: string, lineageRoot?: string): ChatRow => ({ id, title: id, pinned: true, profile, lineageRoot })
const none: PinnedOrders = { byProfile: {}, mixed: [] }
const ids = (rows: ChatRow[]) => rows.map(r => r.id)

describe('pinned chats order', () => {
  it('follows activity until ordered, then the order with chats pinned since on top', () => {
    const rows = [row('a'), row('b'), row('c')]
    expect(ids(arrangePinned(rows, none))).toEqual(['a', 'b', 'c'])
    expect(ids(arrangePinned(rows, { byProfile: { default: ['c', 'a'] }, mixed: [] }))).toEqual(['b', 'c', 'a'])
  })

  it('keys a compacted chat by its lineage root, so it keeps its place', () => {
    const tip = row('tip-2', undefined, 'root-1')
    expect(pinIdOf(tip)).toBe('root-1')
    expect(ids(arrangePinned([row('x'), tip], { byProfile: { default: ['root-1', 'x'] }, mixed: [] }))).toEqual(['tip-2', 'x'])
  })

  it('moves a row and saves every profile the section shows, with the mixed places', () => {
    const section = [row('a'), row('f1', 'Furina'), row('b')]
    const next = moved(section, 2, 0)
    expect(ids(next)).toEqual(['b', 'a', 'f1'])
    expect(moved(section, 1, 1)).toBe(section)
    const orders = ordered(none, next)
    expect(orders.byProfile).toEqual({ default: ['b', 'a'], furina: ['f1'] })
    expect(orders.mixed).toEqual(['default\u001fb', 'default\u001fa', 'furina\u001ff1'])
    expect(ordered(none, [row('a'), row('b')]).mixed).toEqual([])
  })

  it('fills each profile’s places in the mixed section in that profile’s own order', () => {
    const rows = [row('a'), row('f1', 'furina'), row('b'), row('f2', 'furina')]
    // A phone reordered Furina's pins; the mixed places stay where they were.
    const orders: PinnedOrders = {
      byProfile: { furina: ['f2', 'f1'] },
      mixed: ['default\u001fa', 'furina\u001ff1', 'default\u001fb', 'furina\u001ff2']
    }
    expect(ids(arrangePinned(rows, orders))).toEqual(['a', 'f2', 'b', 'f1'])
  })

  it('reads the host’s synced order, and asks a profile’s copy', () => {
    expect(hostOrder({ values: { 'chats.pinned_order': { value: ['a', 'b', 'a', 3, ''] } } })).toEqual(['a', 'b'])
    expect(hostOrder({ values: {} })).toBeNull()
    expect(hostOrder(null)).toBeNull()
    expect(prefsPath('default')).toBe('/api/plugins/conduit_push/conduit-prefs')
    expect(prefsPath('Furina')).toBe('/api/plugins/conduit_push/conduit-prefs?profile=Furina')
  })
})

describe('edge scrolling while dragging', () => {
  it('scrolls toward the nearer edge, faster the closer, and not in the middle', () => {
    expect(edgeScrollStep(300, 100, 500)).toBe(0)
    expect(edgeScrollStep(100 + EDGE_ZONE, 100, 500)).toBe(0)
    expect(edgeScrollStep(101, 100, 500)).toBeLessThan(0)
    expect(edgeScrollStep(499, 100, 500)).toBeGreaterThan(0)
    expect(Math.abs(edgeScrollStep(110, 100, 500))).toBeLessThan(Math.abs(edgeScrollStep(101, 100, 500)))
  })
  it('stops after a pause and away from both edges, then restarts on the next dragover', () => {
    // Fake clock values instead of waiting 400 ms: the decision is pure.
    expect(edgeScrollDecision(101, 1_000, 1_000, 100, 500)).toBeLessThan(0)
    expect(edgeScrollDecision(101, 1_401, 1_000, 100, 500)).toBe(0)
    expect(edgeScrollDecision(300, 1_000, 1_000, 100, 500)).toBe(0)
    expect(edgeScrollDecision(499, 1_100, 1_000, 100, 500)).toBeGreaterThan(0)
  })
  it('caps its speed past the edge and always moves inside the zone', () => {
    expect(edgeScrollStep(0, 100, 500)).toBe(-EDGE_MAX_STEP)
    expect(edgeScrollStep(900, 100, 500)).toBe(EDGE_MAX_STEP)
    expect(edgeScrollStep(100 + EDGE_ZONE - 1, 100, 500)).toBe(-1)
  })
  it('does nothing in a list too short to have a middle', () => {
    expect(edgeScrollStep(10, 0, 0)).toBe(0)
  })
})

describe("a chat unpinned or archived from the open chat's menu (desktop#503)", () => {
  const host = 'https://hermes.example.com'
  beforeEach(() => localStorage.clear())

  it('leaves the saved order, and orders without it are left as they are', () => {
    const orders: PinnedOrders = { byProfile: { default: ['a', 'b'], furina: ['f1'] }, mixed: ['default\u001fa', 'furina\u001ff1', 'default\u001fb'] }
    expect(without(orders, row('a'))).toEqual({ byProfile: { default: ['b'], furina: ['f1'] }, mixed: ['furina\u001ff1', 'default\u001fb'] })
    expect(without(orders, row('zz'))).toBe(orders)
  })

  it('saves it here, sends the profile to the host, and the list reads it again', async () => {
    saveOrders(host, { byProfile: { furina: ['f1', 'f2'] }, mixed: [] })
    const http = vi.fn(async (_method: 'GET' | 'PUT', _path: string, _body?: unknown) => ({}))
    const list = renderHook(() => usePinnedOrder(host, [], http), undefined)
    expect(list.result().orders.byProfile.furina).toEqual(['f1', 'f2'])
    act(() => dropFromSavedOrder(host, row('f1', 'Furina'), http))
    expect(loadOrders(host).byProfile.furina).toEqual(['f2'])
    expect(list.result().orders.byProfile.furina).toEqual(['f2'])
    expect(http).toHaveBeenCalledWith('PUT', prefsPath('Furina'), expect.objectContaining({ changes: { [SYNC_KEY]: ['f2'] } }))
    // A chat with no place in the order changes nothing and sends nothing.
    http.mockClear()
    act(() => dropFromSavedOrder(host, row('other', 'Furina'), http))
    expect(http).not.toHaveBeenCalled()
    // Another dashboard's list doesn't read this one's change.
    const elsewhere = renderHook(() => usePinnedOrder('https://other.example.com', [], http), undefined)
    act(() => dropFromSavedOrder(host, row('f2', 'Furina'), http))
    expect(elsewhere.result().orders.byProfile.furina).toBeUndefined()
    expect(http).toHaveBeenCalledWith('PUT', prefsPath('Furina'), expect.objectContaining({ changes: { [SYNC_KEY]: null } }))
    list.unmount()
    elsewhere.unmount()
  })
})
