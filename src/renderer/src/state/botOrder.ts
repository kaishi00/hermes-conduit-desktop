/**
 * The bots, and the group chats, in the order the person sets on Bots Home, after the phone's
 * BotOrder: a portrait dragged in place, or moved from its menu. Hermes
 * keeps whether a bot is pinned, not where it sits, so the order is kept
 * here per host by profile name (matched in any case) and goes to the
 * host's synced preferences as `bots.order`, which a phone with Sync across
 * devices on reads and writes too. Until it's set the bots follow Hermes'
 * order; a bot it doesn't name yet goes at the end, and a hidden or deleted
 * one keeps its name for when it's back. Pinned bots show first, each group
 * in the person's order. The group chats keep an order of their own the
 * same way, by room id, synced as `groups.order`; a room it doesn't name
 * yet goes first, where Hermes lists one just made.
 *
 * In a combined group, Bots Home mixes every dashboard's bots in one order
 * the person arranges (the phone's CombinedBotsHomeOrder), by host and bot,
 * kept on this computer only. Until it's arranged, each dashboard's bots
 * follow in Saved Dashboards order, so a switch moves nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bot } from './bots'
import { installationId, PREFS_PATH } from './pinnedOrder'

export const BOTS_SYNC_KEY = 'bots.order'
export const ROOMS_SYNC_KEY = 'groups.order'

/**
 * What an order holds: bots by profile name, matched in any case, with the
 * ones it doesn't name last; or group chats by room id, matched exactly
 * (the gateway's are case-sensitive), with the ones it doesn't name first,
 * where Hermes lists a room just made.
 */
export type OrderKind = 'bots' | 'rooms'

const keyOf = (kind: OrderKind) => (kind === 'rooms' ? (s: string) => s : (s: string) => s.toLowerCase())
const sameIn = (kind: OrderKind) => {
  const key = keyOf(kind)
  return (a: string, b: string) => key(a) === key(b)
}

/** Names without blanks or repeats, as the phone keeps them. */
export function cleanOrder(names: unknown, kind: OrderKind = 'bots'): string[] {
  if (!Array.isArray(names)) return []
  const key = keyOf(kind)
  const seen = new Set<string>()
  return names.filter((n): n is string => typeof n === 'string' && !!n && !seen.has(key(n)) && !!seen.add(key(n)))
}

/** `items` in `order`: the ones it names as it names them, the rest as they came, after them (bots) or before them (rooms). */
export function arrange<T>(items: readonly T[], order: readonly string[], name: (item: T) => string, kind: OrderKind = 'bots'): T[] {
  if (!order.length) return [...items]
  const key = keyOf(kind)
  const place = new Map(order.map((n, i) => [key(n), i]))
  return items
    .map((item, i) => ({ item, rank: place.get(key(name(item))) ?? (kind === 'rooms' ? i - items.length : order.length + i) }))
    .sort((a, b) => a.rank - b.rank)
    .map(r => r.item)
}

/** The roster as Bots Home shows it: in the person's order, pinned bots first. */
export function orderedBots(bots: readonly Bot[], order: readonly string[]): Bot[] {
  const arranged = arrange(bots, order, b => b.name)
  return [...arranged.filter(b => b.pinned), ...arranged.filter(b => !b.pinned)]
}

/** The order with every shown name in it, the ones it doesn't name yet where `arrange` shows them. */
function filled(order: readonly string[], shown: readonly string[], kind: OrderKind): string[] {
  const same = sameIn(kind)
  const missing = shown.filter(s => !order.some(n => same(n, s)))
  return kind === 'rooms' ? [...missing, ...order] : [...order, ...missing]
}

function movingBefore(order: readonly string[], moved: string, target: string | null, shown: readonly string[], kind: OrderKind): string[] {
  const same = sameIn(kind)
  if (target && same(moved, target)) return [...order]
  const full = filled(order, shown, kind).filter(n => !same(n, moved))
  const at = target ? full.findIndex(n => same(n, target)) : -1
  if (at >= 0) full.splice(at, 0, moved)
  else {
    const last = [...shown].reverse().find(s => !same(s, moved))
    const after = last ? full.findIndex(n => same(n, last)) : -1
    if (after >= 0) full.splice(after + 1, 0, moved)
    else full.push(moved)
  }
  return cleanOrder(full, kind)
}

/**
 * The order after `moved` is dropped on `target` (null: past the last one),
 * whose place it takes as an app does on the Home Screen: carried on, it
 * goes after the one it lands on; carried back, before it. So neighbours
 * swap. Names the order holds that aren't shown keep their places.
 */
export function dropping(order: readonly string[], moved: string, target: string | null, shown: readonly string[], kind: OrderKind = 'bots'): string[] {
  const same = sameIn(kind)
  const from = shown.findIndex(s => same(s, moved))
  const to = target ? shown.findIndex(s => same(s, target)) : -1
  if (!target || from < 0 || to < 0 || from >= to) return movingBefore(order, moved, target, shown, kind)
  const full = filled(order, shown, kind).filter(n => !same(n, moved))
  const at = full.findIndex(n => same(n, target))
  if (at < 0) return movingBefore(order, moved, null, shown, kind)
  full.splice(at + 1, 0, moved)
  return cleanOrder(full, kind)
}

/** The item `step` places from `name` among `shown` (Move Earlier is -1), or null at either end. */
export function neighbour(shown: readonly string[], name: string, step: -1 | 1): string | null {
  const at = shown.findIndex(s => s.toLowerCase() === name.toLowerCase())
  if (at < 0) return null
  return shown[at + step] ?? null
}

/** The host's synced order under `key`, or null when it keeps none. */
export function hostOrder(response: unknown, key: string = BOTS_SYNC_KEY, kind: OrderKind = 'bots'): string[] | null {
  const values = (response as { values?: Record<string, { value?: unknown }> } | null)?.values
  const value = values?.[key]?.value
  return Array.isArray(value) ? cleanOrder(value, kind) : null
}

/** The host's synced `bots.order`, or null when it keeps none. */
export const hostBotOrder = (response: unknown) => hostOrder(response)

const STORAGE: Record<OrderKind, string> = { bots: 'conduit.botOrder', rooms: 'conduit.groupRoomOrder' }
const SYNC: Record<OrderKind, string> = { bots: BOTS_SYNC_KEY, rooms: ROOMS_SYNC_KEY }

export function loadOrder(host: string, kind: OrderKind = 'bots'): string[] {
  try {
    return cleanOrder(JSON.parse(localStorage.getItem(`${STORAGE[kind]}.${host}`) ?? '[]'), kind)
  } catch {
    return []
  }
}

export const loadBotOrder = (host: string) => loadOrder(host)

export function saveOrder(host: string, order: string[], kind: OrderKind): void {
  try {
    if (order.length) localStorage.setItem(`${STORAGE[kind]}.${host}`, JSON.stringify(order))
    else localStorage.removeItem(`${STORAGE[kind]}.${host}`)
  } catch {
    // Kept for this window only.
  }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/**
 * This host's order of its bots (`bots.order`) or its group chats
 * (`groups.order`): read from this computer, then the host's synced copy
 * once per connection, which wins (the phone's merge is replace). A move
 * saves here and sends the order to the host; a host without the route
 * keeps it here. Bots and rooms are the gateway's, so the main profile's
 * copy holds them.
 */
export function useSyncedOrder(host: string, connected: boolean, http: Http, kind: OrderKind) {
  const [order, setOrder] = useState<string[]>(() => loadOrder(host, kind))
  const asked = useRef('')
  useEffect(() => {
    setOrder(loadOrder(host, kind))
    asked.current = ''
  }, [host, kind])
  useEffect(() => {
    if (!host || !connected || asked.current === host) return
    asked.current = host
    let live = true
    http('GET', PREFS_PATH).then(
      response => {
        const names = hostOrder(response, SYNC[kind], kind)
        if (!live || !names) return
        setOrder(current => {
          if (current.length === names.length && current.every((n, i) => n === names[i])) return current
          saveOrder(host, names, kind)
          return names
        })
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [host, connected, http, kind])
  /** An item dropped on `target` (null: past the last one), among the ones `shown` in their order. */
  const drop = useCallback(
    (moved: string, target: string | null, shown: string[]) => {
      const next = dropping(order, moved, target, shown, kind)
      if (next.length === order.length && next.every((n, i) => n === order[i])) return
      setOrder(next)
      saveOrder(host, next, kind)
      void http('PUT', PREFS_PATH, {
        installation_id: installationId(),
        device: 'Conduit for desktop',
        changes: { [SYNC[kind]]: next }
      }).catch(() => undefined)
    },
    [order, host, http, kind]
  )
  return { order, drop }
}

export const useBotOrder = (host: string, connected: boolean, http: Http) => useSyncedOrder(host, connected, http, 'bots')

// The combined group's mixed order.

/** A mixed grid's key: the host and the bot's name in lowercase. */
export const mixedBotKey = (host: string, name: string) => `${host}\u001f${name.toLowerCase()}`

export interface MixedTile {
  key: string
  /** The host the bot is on. */
  host: string
  bot: Bot
  /** This dashboard's own bot, not another's. */
  own: boolean
}

/**
 * Every dashboard's bots as the mixed grid shows them: the saved order's
 * first, as it names them, then the rest in Saved Dashboards order (the
 * dashboard on screen's in its own order), so a switch moves nothing.
 */
export function mixedTiles(
  ownHost: string,
  own: readonly Bot[],
  others: readonly { host: string; bot: Bot }[],
  savedHosts: readonly string[],
  saved: readonly string[]
): MixedTile[] {
  const hosts = [...savedHosts.filter(h => h === ownHost || others.some(o => o.host === h))]
  if (!hosts.includes(ownHost)) hosts.unshift(ownHost)
  for (const o of others) if (!hosts.includes(o.host)) hosts.push(o.host)
  const tiles: MixedTile[] = []
  for (const host of hosts) {
    if (host === ownHost) tiles.push(...own.map(bot => ({ key: mixedBotKey(host, bot.name), host, bot, own: true })))
    else tiles.push(...others.filter(o => o.host === host).map(o => ({ key: mixedBotKey(host, o.bot.name), host, bot: o.bot, own: false })))
  }
  const place = new Map(saved.map((k, i) => [k, i]))
  const known = tiles.filter(t => place.has(t.key)).sort((a, b) => place.get(a.key)! - place.get(b.key)!)
  return [...known, ...tiles.filter(t => !place.has(t.key))]
}

/**
 * The mixed order after `dragged` is dropped on `target` (null: at the
 * end), taking its place as on the Home Screen. Every shown key gets a
 * place first, and a host no longer shown leaves the order.
 */
export function droppingMixed(saved: readonly string[], dragged: string, target: string | null, shown: readonly string[]): string[] {
  const hosts = new Set(shown.map(k => k.split('\u001f')[0]))
  const kept = saved.filter(k => hosts.has(k.split('\u001f')[0]))
  const order = [...kept, ...shown.filter(k => !kept.includes(k))]
  if (dragged === target) return order
  const from = order.indexOf(dragged)
  const to = target ? order.indexOf(target) : -1
  const carriedOn = from >= 0 && to >= 0 && from < to
  const next = order.filter(k => k !== dragged)
  const at = target ? next.indexOf(target) : -1
  if (at >= 0) next.splice(carriedOn ? at + 1 : at, 0, dragged)
  else next.push(dragged)
  return next
}

const MIXED_KEY = 'conduit.combinedBotsOrder'

export function loadMixedOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MIXED_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && k.includes('\u001f')) : []
  } catch {
    return []
  }
}

export function saveMixedOrder(order: readonly string[]): void {
  try {
    if (order.length) localStorage.setItem(MIXED_KEY, JSON.stringify(order))
    else localStorage.removeItem(MIXED_KEY)
  } catch {
    // Kept for this window only.
  }
}

/**
 * The group's mixed order, kept on this computer. A group that falls to
 * one dashboard forgets it, as the phone's does (`grouped` false).
 */
export function useMixedBotOrder(grouped: boolean | null) {
  const [order, setOrder] = useState<string[]>(loadMixedOrder)
  useEffect(() => {
    // Null while the saved dashboards are still being read.
    if (grouped !== false || !order.length) return
    setOrder([])
    saveMixedOrder([])
  }, [grouped, order.length])
  const drop = useCallback((dragged: string, target: string | null, shown: string[]) => {
    setOrder(current => {
      const next = droppingMixed(current, dragged, target, shown)
      saveMixedOrder(next)
      return next
    })
  }, [])
  return { order, drop }
}

// Rooms across the group's dashboards.

/** One of your other Hermes' bots, as an own Link brings it: its Link, profile and readiness. */
export interface FarCandidate {
  linkId: string
  profile: string
  ready: boolean
}

/**
 * The bot of another combined dashboard as your own other Hermes brings it
 * into a room this one hosts (the phone's ownHermesBot): over the own Link
 * whose bots are most of that dashboard's, by profile name, and only once
 * it's set up to join (Linked Rooms on for it there). Null when no own Link
 * brings it, so a drop only moves it.
 */
export function farBotFor<T extends FarCandidate>(name: string, dashboardBots: readonly string[], own: readonly T[]): T | null {
  const names = new Set(dashboardBots.map(n => n.toLowerCase()))
  const counts = new Map<string, number>()
  for (const bot of own) if (names.has(bot.profile.toLowerCase())) counts.set(bot.linkId, (counts.get(bot.linkId) ?? 0) + 1)
  let link: string | null = null
  let most = 0
  for (const [id, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) if (n > most) [link, most] = [id, n]
  if (!link) return null
  return own.find(b => b.linkId === link && b.profile.toLowerCase() === name.toLowerCase() && b.ready) ?? null
}

/**
 * Whether `adding` of your other Hermes' bots can join a room being started
 * that holds `own` of this Hermes' bots and `far` of another's: they come
 * from one other Hermes, beside at least one bot here once two of theirs
 * are in, at most 6 in all.
 */
export function canAddFar(own: number, far: readonly FarCandidate[], adding: readonly FarCandidate[], max = 6): boolean {
  const all = [...far, ...adding]
  if (!adding.length || new Set(all.map(b => b.linkId)).size > 1) return false
  if (new Set(all.map(b => `${b.linkId}/${b.profile.toLowerCase()}`)).size < all.length) return false
  if (own === 0 && all.length > 1) return false
  return own + all.length <= max
}
