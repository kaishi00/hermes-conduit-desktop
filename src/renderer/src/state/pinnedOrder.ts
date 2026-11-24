/**
 * The Pinned section in the order the person sets, after the phone's
 * PinnedChatOrder (issue 1354): a pinned chat dragged in place, or moved up
 * or down from its menu. Hermes keeps whether a chat is pinned, not where it
 * sits, so the order is kept here per host and profile under each chat's
 * pin id (its lineage root, so a compacted chat keeps its place), and goes
 * to the host's synced preferences as `chats.pinned_order`, where a phone
 * with Sync across devices on reads it. Until a profile's pins are ordered
 * they follow recent activity; a chat pinned since goes on top, and an
 * unpinned one leaves the order. With every profile listed, the mixed
 * section also keeps which profile holds each place, on this computer only.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatRow } from './chats'

export interface PinnedOrders {
  /** Each profile's pin ids, top first. */
  byProfile: Record<string, string[]>
  /** The mixed Pinned section, top first: `profile\u001fpin id`. */
  mixed: string[]
}

export const SYNC_KEY = 'chats.pinned_order'
export const PREFS_PATH = '/api/plugins/conduit_push/conduit-prefs'

export const pinIdOf = (row: ChatRow) => row.lineageRoot || row.id
export const profileOf = (row: ChatRow) => (row.profile || 'default').toLowerCase()
export const mixedKey = (row: ChatRow) => `${profileOf(row)}\u001f${pinIdOf(row)}`

/** `rows` (in activity order) with those `order` names after the ones it doesn't, in its order. */
function byOrder<T>(rows: T[], order: string[], id: (row: T) => string): T[] {
  if (!order.length) return rows
  const index = new Map(order.map((key, i) => [key, i]))
  const unnamed = rows.filter(r => !index.has(id(r)))
  const named = rows.filter(r => index.has(id(r))).sort((a, b) => index.get(id(a))! - index.get(id(b))!)
  return [...unnamed, ...named]
}

/**
 * The pinned rows, given in activity order, as the section shows them. One
 * profile's follow its order. Several profiles' take the places the mixed
 * order gives each profile, and each profile's chats fill its places in
 * that profile's own order.
 */
export function arrangePinned(rows: ChatRow[], orders: PinnedOrders): ChatRow[] {
  const profiles = [...new Set(rows.map(profileOf))]
  const own = new Map(
    profiles.map(p => [
      p,
      byOrder(
        rows.filter(r => profileOf(r) === p),
        orders.byProfile[p] ?? [],
        pinIdOf
      )
    ])
  )
  if (profiles.length < 2) return own.get(profiles[0]!) ?? rows
  const places = byOrder(rows, orders.mixed, mixedKey).map(profileOf)
  const next = new Map(profiles.map(p => [p, 0]))
  return places.map(p => {
    const at = next.get(p)!
    next.set(p, at + 1)
    return own.get(p)![at]!
  })
}

/** The section after moving the row at `from` to `to`; the same list when nothing moves. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row!)
  return next
}

/** The orders after the section became `section`: each profile it shows takes its rows' order, and a mixed section its places too. */
export function ordered(orders: PinnedOrders, section: ChatRow[]): PinnedOrders {
  const byProfile = { ...orders.byProfile }
  const profiles = [...new Set(section.map(profileOf))]
  for (const p of profiles) byProfile[p] = section.filter(r => profileOf(r) === p).map(pinIdOf)
  return { byProfile, mixed: profiles.length > 1 ? section.map(mixedKey) : orders.mixed }
}

/** The order the host keeps for a profile, from its synced preferences; null when it has none. */
export function hostOrder(response: unknown): string[] | null {
  const values = (response as { values?: Record<string, { value?: unknown }> } | null)?.values
  const value = values?.[SYNC_KEY]?.value
  if (!Array.isArray(value)) return null
  const ids = value.filter((id): id is string => typeof id === 'string' && !!id.trim())
  return [...new Set(ids)]
}

export const prefsPath = (profile: string) => (profile && profile !== 'default' ? `${PREFS_PATH}?profile=${encodeURIComponent(profile)}` : PREFS_PATH)

const storageKey = (host: string) => `conduit.pinnedChatOrder.${host}`

export function loadOrders(host: string): PinnedOrders {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(host)) ?? '{}') as Partial<PinnedOrders>
    const byProfile: Record<string, string[]> = {}
    for (const [profile, ids] of Object.entries(raw.byProfile ?? {}))
      if (Array.isArray(ids)) byProfile[profile.toLowerCase()] = ids.filter(id => typeof id === 'string')
    return { byProfile, mixed: Array.isArray(raw.mixed) ? raw.mixed.filter(k => typeof k === 'string') : [] }
  } catch {
    return { byProfile: {}, mixed: [] }
  }
}

export function saveOrders(host: string, orders: PinnedOrders): void {
  try {
    localStorage.setItem(storageKey(host), JSON.stringify(orders))
  } catch {
    // Kept for this window only.
  }
}

const INSTALLATION_KEY = 'conduit.installationId'

/** This computer's id for the host's synced preferences, made once. */
export function installationId(): string {
  try {
    const kept = localStorage.getItem(INSTALLATION_KEY)
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept
    const made = `desktop-${crypto.randomUUID().replace(/-/g, '')}`
    localStorage.setItem(INSTALLATION_KEY, made)
    return made
  } catch {
    return 'desktop-unsaved'
  }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

export const DEVICE_NAME = 'Conduit for desktop'

/**
 * The host's orders for the list: read from this computer, then each
 * profile with pinned chats takes the host's synced copy once per launch,
 * where it has one. A move or an unpin saves here and sends the profiles
 * it changed to the host. A host without the route keeps the order here.
 */
export function usePinnedOrder(host: string, rows: ChatRow[] | null, http: Http) {
  const [orders, setOrders] = useState<PinnedOrders>(() => loadOrders(host))
  const asked = useRef(new Set<string>())
  useEffect(() => {
    setOrders(loadOrders(host))
    asked.current = new Set()
  }, [host])
  // Each profile's name as Hermes lists it, for its synced copy's address; orders are kept by its lowercase.
  const names = useRef(new Map<string, string>())
  for (const r of rows ?? []) if (r.profile) names.current.set(profileOf(r), r.profile)
  const nameOf = (profile: string) => names.current.get(profile) ?? profile
  const profiles = [...new Set((rows ?? []).filter(r => r.pinned).map(profileOf))].sort().join('\n')
  useEffect(() => {
    if (!host || !profiles) return
    let live = true
    for (const profile of profiles.split('\n')) {
      if (asked.current.has(profile)) continue
      asked.current.add(profile)
      http('GET', prefsPath(nameOf(profile))).then(
        response => {
          const ids = hostOrder(response)
          if (!live || !ids) return
          setOrders(current => {
            const mine = current.byProfile[profile] ?? []
            if (mine.length === ids.length && mine.every((id, i) => id === ids[i])) return current
            const next = { ...current, byProfile: { ...current.byProfile, [profile]: ids } }
            saveOrders(host, next)
            return next
          })
        },
        () => undefined
      )
    }
    return () => {
      live = false
    }
  }, [host, profiles, http])
  const send = useCallback(
    (next: PinnedOrders, changed: string[]) => {
      for (const profile of changed)
        void http('PUT', prefsPath(nameOf(profile)), {
          installation_id: installationId(),
          device: DEVICE_NAME,
          changes: { [SYNC_KEY]: next.byProfile[profile]?.length ? next.byProfile[profile] : null }
        }).catch(() => undefined)
    },
    [http]
  )
  /** The Pinned section after a move, top first. */
  const reorder = useCallback(
    (section: ChatRow[]) => {
      const next = ordered(orders, section)
      setOrders(next)
      saveOrders(host, next)
      send(next, [...new Set(section.map(profileOf))])
    },
    [orders, host, send]
  )
  /** An unpinned chat leaves the order, so pinning it again puts it on top. */
  const drop = useCallback(
    (row: ChatRow) => {
      const profile = profileOf(row)
      const id = pinIdOf(row)
      const mine = orders.byProfile[profile] ?? []
      const key = mixedKey(row)
      if (!mine.includes(id) && !orders.mixed.includes(key)) return
      const next = { byProfile: { ...orders.byProfile, [profile]: mine.filter(x => x !== id) }, mixed: orders.mixed.filter(k => k !== key) }
      setOrders(next)
      saveOrders(host, next)
      if (mine.includes(id)) send(next, [profile])
    },
    [orders, host, send]
  )
  return { orders, reorder, drop }
}

/** How close to the list's top or bottom edge (px) a dragged row starts scrolling it. */
export const EDGE_ZONE = 56
/** How long a paused drag still keeps the edge scroll alive (useBoardScroll's 400 ms). */
export const EDGE_HOLD_MS = 400

/**
 * The pinned drag's stop-and-restart decision: a frame past the hold leaves the loop alone,
 * and a pointer away from both edges (step 0) ends it until the next dragover (issue 464).
 */
export function edgeScrollDecision(
  y: number,
  now: number,
  at: number,
  top: number,
  bottom: number
): number {
  if (now - at > EDGE_HOLD_MS) return 0
  return edgeScrollStep(y, top, bottom)
}

/** The fastest the list scrolls while dragging (px per frame). */
export const EDGE_MAX_STEP = 18

/**
 * Pixels to scroll the list this frame for a drag at `y`, within a list whose
 * visible box runs `top` to `bottom`: negative scrolls up, positive down, 0 when
 * the pointer is away from both edges. Speed grows toward the edge, and holds
 * at the maximum beyond it (issue 396).
 */
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE_ZONE, (bottom - top) / 2)
  if (zone <= 0) return 0
  const speed = (depth: number) => Math.max(1, Math.round(Math.min(1, depth / zone) * EDGE_MAX_STEP))
  if (y < top + zone) return -speed(top + zone - y)
  if (y > bottom - zone) return speed(y - (bottom - zone))
  return 0
}
