/**
 * Combined dashboards in the window (the phone's SavedDashboardsView's
 * Combine Dashboards, CombinedDashboardBadge and AppState+NeedsYou's other
 * dashboards): how each host kept beside the open one is doing, its badge
 * (the first letter of its name on its color), and Needs you's waits read
 * through its connection, which open by switching to it.
 */
import { useEffect, useRef, useState } from 'react'
import type { HostSummary, KeptHost, KeptHostState } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'
import { badgeLetters } from '../../../shared/hostNames'
import { WAITING_POLL_MS, waitingFromResponse, waitingPath, type WaitingRow } from './needsYou'
import { CHAT_LIST_PAGE, CHAT_LIST_PATH, rowsFromResponse, type ChatRow } from './chats'
import { keptRosters, rosterFromProfiles, type Bot } from './bots'
import { PULSE, parseFeed } from './pulse'
import type { ArtifactItem } from './artifacts'
import { listAllRooms, type Room } from './groups'
import { arrange, hostOrder, loadOrder, ROOMS_SYNC_KEY, saveOrder } from './botOrder'
import { PREFS_PATH } from './pinnedOrder'
import { COPIES_PATH, parseCopies, type RoomCopy } from './roomCopies'
import { keptCopies } from './useRoomCopies'
import { keptOwnRooms } from './useGroups'
import { WORK, parseWork } from './work'
import { STATUS_PATH, pluginStatus } from './plugin'
import { DASHBOARD_PROFILES_CAPABILITY } from './dashboardProfile'
import type { BotWork } from './useWork'
import { keepsFor } from './savedHosts'

export const keptStateLabel = (state: KeptHostState): string =>
  state === 'live'
    ? t('Connected in the background')
    : state === 'connecting'
      ? t('Connecting…')
      : state === 'down'
        ? t("Can't connect. Trying again.")
        : t('Sign In required')

/** One per place in the group, dark enough for white text (CombinedDashboardBadge.palette). */
export const BADGE_PALETTE = ['#3373d9', '#bf4d8c', '#268c66', '#cc6b1a', '#7359cc', '#8c7333']
const PALETTE_HUES = [0.603, 0.907, 0.438, 0.076, 0.704, 0.119]

/** Past the palette, the middle of the widest gap left between the hues taken, darker for yellows and greens. */
export function badgeColor(index: number): string {
  if (index < BADGE_PALETTE.length) return BADGE_PALETTE[Math.max(index, 0)]!
  const taken = [...PALETTE_HUES]
  let hue = 0
  for (let i = BADGE_PALETTE.length; i <= index; i++) {
    const sorted = [...taken].sort((a, b) => a - b)
    let best = { gap: 0, middle: 0 }
    sorted.forEach((start, at) => {
      const end = at + 1 < sorted.length ? sorted[at + 1]! : sorted[0]! + 1
      if (end - start > best.gap) best = { gap: end - start, middle: (start + (end - start) / 2) % 1 }
    })
    hue = best.middle
    taken.push(hue)
  }
  const light = hue > 0.1 && hue < 0.45
  // HSB(hue, 0.70, b) as HSL.
  const b = light ? 0.48 : 0.62
  const l = b * (1 - 0.7 / 2)
  const s = l === 0 || l === 1 ? 0 : (b - l) / Math.min(l, 1 - l)
  return `hsl(${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

export interface HostBadge {
  letter: string
  color: string
  name: string
}

/** A combined host's badge: its place among the group in the saved order. Only the group has badges. */
export function hostBadge(hosts: readonly HostSummary[], url: string, name: (url: string) => string): HostBadge | null {
  const group = hosts.filter(h => h.combined)
  const index = group.findIndex(h => h.url === url)
  if (group.length < 2 || index < 0) return null
  const labels = group.map(h => name(h.url).trim())
  // Its name's first letter, or its place where two names start alike.
  return { letter: badgeLetters(labels)[index]!, color: badgeColor(index), name: labels[index]! }
}

/** How long an emptied kept-host list waits before it's believed. */
const KEPT_EMPTY_WAIT_MS = 400

/** The kept hosts as last heard, and the open one then, so a window opened by a switch starts from them. */
let lastKept: KeptHost[] = []
let lastOwn = ''

/**
 * The hosts kept beside the open one, as the main process says. `own`: the
 * open host. A window a switch opened starts from the last list, the host it
 * left in place of the one it opened, until the main process says, so the
 * other dashboard's bots and chats don't drop out meanwhile.
 */
export function useKeptHosts(own = ''): KeptHost[] {
  const [hosts, setHosts] = useState<KeptHost[]>(() =>
    own && lastOwn && own !== lastOwn && lastKept.some(h => h.url === own)
      ? [...lastKept.filter(h => h.url !== own), { url: lastOwn, state: 'live' as KeptHostState }]
      : lastKept
  )
  useEffect(() => {
    if (own) lastOwn = own
  }, [own])
  useEffect(() => {
    // A switch empties the list for a moment before the host it left joins it: an empty list waits a beat, so
    // the other dashboard's bots and chats don't blink out.
    let emptying: ReturnType<typeof setTimeout> | null = null
    const heard = (list: KeptHost[]) => {
      if (emptying) clearTimeout(emptying)
      emptying = null
      const apply = () => {
        lastKept = list
        setHosts(list)
      }
      if (list.length) apply()
      else emptying = setTimeout(apply, KEPT_EMPTY_WAIT_MS)
    }
    const off = window.conduit.onKeptHosts(heard)
    void window.conduit.keptHosts().then(heard)
    return () => {
      off()
      if (emptying) clearTimeout(emptying)
    }
  }, [])
  return hosts
}

/** A wait from another combined host. */
export type KeptWaitingRow = WaitingRow & { host: string }

/** Hermes always has `default`; an empty list is a degraded reply (null). */
export function profileNames(body: unknown): string[] | null {
  const list = body && typeof body === 'object' ? (body as { profiles?: unknown }).profiles : undefined
  if (!Array.isArray(list)) return null
  const names = list
    .map(value => (typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string' && !!name)
  if (!names.length) return null
  return names.includes('default') ? names : ['default', ...names]
}

/** A kept host's profiles are read again after this, so one made or deleted there shows. */
export const KEPT_PROFILES_MAX_AGE_MS = 5 * 60_000

/**
 * Every live kept host's waits, for each of its profiles, on Needs you's
 * 20 s poll while the window is on screen. A profile whose read fails keeps
 * what it showed; a host let go shows nothing more.
 */
export function useKeptWaiting(kept: readonly KeptHost[]): KeptWaitingRow[] {
  const [rows, setRows] = useState<KeptWaitingRow[]>([])
  const profiles = useRef(new Map<string, { names: string[]; at: number }>())
  const byHost = useRef(new Map<string, Map<string, KeptWaitingRow[]>>())
  const live = kept
    .filter(h => h.state === 'live')
    .map(h => h.url)
    .join('\n')

  useEffect(() => {
    const urls = live ? live.split('\n') : []
    for (const url of [...byHost.current.keys()]) if (!urls.includes(url)) byHost.current.delete(url)
    for (const url of [...profiles.current.keys()]) if (!urls.includes(url)) profiles.current.delete(url)
    const show = () => setRows([...byHost.current.values()].flatMap(m => [...m.values()].flat()).sort((a, b) => b.at - a.at))
    show()
    if (!urls.length) return
    let stopped = false
    const readHost = async (url: string) => {
      const last = profiles.current.get(url)
      let names = last?.names
      if (!last || Date.now() - last.at > KEPT_PROFILES_MAX_AGE_MS) {
        const outcome = await window.conduit.keptHttp(url, '/api/profiles')
        const read = outcome.ok ? profileNames(outcome.result) : null
        if (read) profiles.current.set(url, { names: read, at: Date.now() })
        names = read ?? names
      }
      if (stopped || !names) return
      const host = byHost.current.get(url) ?? new Map<string, KeptWaitingRow[]>()
      await Promise.all(
        names.map(async name => {
          const outcome = await window.conduit.keptHttp(url, waitingPath(name === 'default' ? undefined : name))
          if (!outcome.ok) return
          host.set(
            name,
            waitingFromResponse(outcome.result, name === 'default' ? undefined : name).map(row => ({ ...row, host: url }))
          )
        })
      )
      for (const name of [...host.keys()]) if (!names.includes(name)) host.delete(name)
      if (!stopped && urls.includes(url)) byHost.current.set(url, host)
    }
    const read = async () => {
      if (document.hidden) return
      await Promise.all(urls.map(readHost))
      if (!stopped) show()
    }
    void read()
    const timer = setInterval(() => void read(), WAITING_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [live])

  return rows
}

/** Another host's waits not also listed here: one Hermes saved at two addresses shows a wait once, as this host's. */
export const otherHostsWaiting = (kept: readonly KeptWaitingRow[], here: readonly WaitingRow[]): KeptWaitingRow[] => {
  const ids = new Set(here.map(r => r.id))
  const seen = new Set<string>()
  return kept.filter(r => !ids.has(r.id) && !seen.has(r.id) && !!seen.add(r.id))
}

/** A chat on another combined host: it opens in place, in the main window's chat pane (components/DockedChat). */
export type OtherChatRow = ChatRow & { host: string }

/** How often the other hosts' chats are read while the window is on screen, at most (the phone's minute). */
export const KEPT_CHATS_POLL_MS = 60_000

/** How long a kept host's chat changes settle before its chats are read: a burst is one read, as on the phone. */
export const KEPT_CHATS_CHANGE_WAIT_MS = 2_000

/** The newest chats read from each of another host's profiles, as on the phone. */
export const KEPT_CHATS_PER_PROFILE = 50

/** One profile's newest chats on another host: the chat list's read, narrowed to that profile. */
export const keptChatsPath = (profile: string): string =>
  `${CHAT_LIST_PATH.replace(`limit=${CHAT_LIST_PAGE}`, `limit=${KEPT_CHATS_PER_PROFILE}`)}&profile=${encodeURIComponent(profile)}`

/** Rows read per profile as one list, each chat once (a Hermes that ignores `profile` answers every profile each time). */
export function mergeKeptChats(host: string, pages: readonly unknown[]): OtherChatRow[] {
  const seen = new Set<string>()
  const rows: OtherChatRow[] = []
  for (const page of pages) {
    for (const row of rowsFromResponse(page)) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push({ ...row, pinned: false, host })
    }
  }
  return rows.sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
}

/**
 * Every live kept host's newest chats, 50 from each of its profiles as on
 * the phone (one page across them while its profiles can't be read), read
 * once a minute while the window is on screen, and a host's alone once its own
 * `sessions.changed` settles. A failed read keeps what the host showed; a host
 * let go shows nothing more.
 */
export function useKeptChats(kept: readonly KeptHost[], on: boolean): OtherChatRow[] {
  const [rows, setRows] = useState<OtherChatRow[]>([])
  const byHost = useRef(new Map<string, OtherChatRow[]>())
  const profiles = useRef(new Map<string, { names: string[]; at: number }>())
  const live = on
    ? kept
        .filter(h => h.state === 'live')
        .map(h => h.url)
        .join('\n')
    : ''

  useEffect(() => {
    const urls = live ? live.split('\n') : []
    for (const url of [...byHost.current.keys()]) if (!urls.includes(url)) byHost.current.delete(url)
    for (const url of [...profiles.current.keys()]) if (!urls.includes(url)) profiles.current.delete(url)
    const show = () => setRows([...byHost.current.values()].flat())
    show()
    if (!urls.length) return
    let stopped = false
    const namesOf = async (url: string): Promise<string[] | null> => {
      const last = profiles.current.get(url)
      if (last && Date.now() - last.at <= KEPT_PROFILES_MAX_AGE_MS) return last.names
      const outcome = await window.conduit.keptHttp(url, '/api/profiles')
      const read = outcome.ok ? profileNames(outcome.result) : null
      if (read) profiles.current.set(url, { names: read, at: Date.now() })
      return read ?? last?.names ?? null
    }
    const read = async (only?: string) => {
      if (document.hidden) return
      await Promise.all(
        urls.filter(url => !only || url === only).map(async url => {
          const names = await namesOf(url)
          const paths = names ? names.map(keptChatsPath) : [CHAT_LIST_PATH]
          const outcomes = await Promise.all(paths.map(path => window.conduit.keptHttp(url, path)))
          if (stopped || !outcomes.some(o => o.ok)) return
          // A profile whose read failed keeps nothing back: the rest still show.
          byHost.current.set(url, mergeKeptChats(url, outcomes.filter(o => o.ok).map(o => (o as { result: unknown }).result)))
        })
      )
      if (!stopped) show()
    }
    void read()
    const timer = setInterval(() => void read(), KEPT_CHATS_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    const changed = new Map<string, ReturnType<typeof setTimeout>>()
    const offChanged = window.conduit.onKeptChatsChanged(url => {
      if (!urls.includes(url) || changed.has(url)) return
      changed.set(
        url,
        setTimeout(() => {
          changed.delete(url)
          if (!stopped) void read(url)
        }, KEPT_CHATS_CHANGE_WAIT_MS)
      )
    })
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      offChanged()
      for (const wait of changed.values()) clearTimeout(wait)
    }
  }, [live])

  return rows
}

/** Other hosts' chats this list doesn't hold already: one Hermes saved at two addresses lists a chat once, as this host's. */
export function otherHostsChats(other: readonly OtherChatRow[], here: readonly ChatRow[] | null): OtherChatRow[] {
  const ids = new Set((here ?? []).map(r => r.id))
  const seen = new Set<string>()
  return other.filter(r => !ids.has(r.id) && !seen.has(r.id) && !!seen.add(r.id))
}

/** Another combined host's group chat: a room its Hermes hosts, or its copy of a room another Hermes hosts. */
export type OtherRoom = { host: string; kind: 'room'; room: Room } | { host: string; kind: 'copy'; copy: RoomCopy }

/** One host's group chats, as last read. */
export interface HostRooms {
  rooms: Room[]
  copies: RoomCopy[]
}

/**
 * Every live kept host's group chats, read once a minute while Bots shows:
 * the rooms it hosts (`groups.list` over its socket) and its copies of rooms
 * elsewhere (the plugin's copies route). What can't be read keeps what it
 * showed; a host let go shows nothing more.
 */
/** Each kept host's rooms as last read, for the next window to start from. */
export const keptRoomsByHost = new Map<string, HostRooms & { at: number }>()

/** A host's rooms from whichever read is newer: as another dashboard, or as the open one (keptOwnRooms, keptCopies). */
function roomsOf(url: string): HostRooms | null {
  const kept = keptRoomsByHost.get(url)
  const own = keptOwnRooms.get(url)
  if (own && (!kept || own.at > kept.at)) return { rooms: own.rooms.filter(r => !r.disbanded), copies: keptCopies.get(url) ?? kept?.copies ?? [] }
  return kept ? { rooms: kept.rooms, copies: kept.copies } : null
}

const roomsShown = (urls: string[]) => new Map(urls.flatMap(url => {
  const rooms = roomsOf(url)
  return rooms ? [[url, rooms] as const] : []
}))

export function useKeptRooms(kept: readonly KeptHost[], on: boolean): Map<string, HostRooms> {
  // As the bots: drawn while live or reconnecting, from the start; read only while live and shown.
  const shown = kept
    .filter(h => h.state === 'live' || h.state === 'connecting')
    .map(h => h.url)
    .join('\n')
  const live = kept
    .filter(h => h.state === 'live')
    .map(h => h.url)
    .join('\n')
  const [rooms, setRooms] = useState<Map<string, HostRooms>>(() => roomsShown(shown ? shown.split('\n') : []))

  useEffect(() => {
    const drawn = shown ? shown.split('\n') : []
    const urls = live ? live.split('\n') : []
    const show = () => setRooms(roomsShown(drawn))
    show()
    if (!on || !urls.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        urls.map(async url => {
          const [listed, copied, prefs] = await Promise.all([
            listAllRooms(async (method, params) => {
              const outcome = await window.conduit.keptRpc(url, method, params)
              if (!outcome.ok) throw new Error(outcome.error)
              return outcome.result
            }).catch(() => null),
            window.conduit.keptHttp(url, COPIES_PATH),
            window.conduit.keptHttp(url, PREFS_PATH)
          ])
          if (stopped) return
          // Its synced room order, so its rows show here as its own window will draw them (combinedRooms reads it).
          const order = prefs.ok ? hostOrder(prefs.result, ROOMS_SYNC_KEY, 'rooms') : null
          // Saved only when it changed, so a read that brings the same order writes nothing.
          if (order && JSON.stringify(order) !== JSON.stringify(loadOrder(url, 'rooms'))) saveOrder(url, order, 'rooms')
          const last = keptRoomsByHost.get(url)
          const rooms = listed ?? last?.rooms ?? []
          const copies = (copied.ok ? parseCopies(copied.result) : null) ?? last?.copies ?? []
          if (!listed && !copied.ok && !last) return
          if (keepsFor(url)) keptRoomsByHost.set(url, { rooms, copies, at: Date.now() })
        })
      )
      if (!stopped) show()
    }
    void read()
    const timer = setInterval(() => void read(), KEPT_CHATS_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [shown, live, on])

  return rooms
}

/** A room's id is only unique on the Hermes that hosts it: two lists are one room's when they share a member too (or either names none). */
const sameMembers = (a: readonly string[], b: readonly string[]) => !a.length || !b.length || a.some(m => b.includes(m))

/**
 * Group chats in a combined group, as the phone draws them (Eric,
 * 2026-11-20): every host's, each room once, under the host you talk in it
 * from, so you're the same person in it whichever host is on screen. That's
 * the host whose Hermes hosts it (this one first, for one Hermes saved at
 * two addresses), else the first in Saved Dashboards order with a copy.
 * `copies`: this host's copies left to show (one an agent of yours waits in
 * for your approval, `waiting`, always stays, since only its row answers
 * it); `before` and `after`: the other hosts' group chats that Saved
 * Dashboards puts before this host and after it, each host's as it shows
 * them when it's on screen (its copies, then its rooms in its own order,
 * `roomOrder`), so opening one, which switches there, moves nothing (Eric,
 * 2026-11-21: the group chats' order shifted on a tap).
 */
export function combinedRooms(
  here: string,
  order: readonly string[],
  hereRooms: readonly Room[],
  hereCopies: readonly RoomCopy[],
  kept: ReadonlyMap<string, HostRooms>,
  waiting: ReadonlySet<string> = new Set(),
  roomOrder: (host: string) => readonly string[] = host => loadOrder(host, 'rooms')
): { copies: RoomCopy[]; before: OtherRoom[]; after: OtherRoom[] } {
  if (!kept.size) return { copies: [...hereCopies], before: [], after: [] }
  const lists = order.flatMap(url =>
    url === here ? [{ url, rooms: hereRooms, copies: hereCopies }] : kept.has(url) ? [{ url, ...kept.get(url)! }] : []
  )
  const memberIds = (members: readonly { memberId: string }[]) => members.map(m => m.memberId)
  const home = (roomId: string, members: readonly string[]): string | null => {
    const hosts = lists.filter(l => l.rooms.some(r => r.roomId === roomId && sameMembers(memberIds(r.members), members)))
    const host = hosts.find(l => l.url === here) ?? hosts[0]
    if (host) return host.url
    return lists.find(l => l.copies.some(c => c.roomId === roomId && sameMembers(memberIds(c.members), members)))?.url ?? null
  }
  const copies = hereCopies.filter(c => waiting.has(c.id) || (home(c.roomId, memberIds(c.members)) ?? here) === here)
  const before: OtherRoom[] = []
  const after: OtherRoom[] = []
  // This host, saved or not, sits where Saved Dashboards puts it; unsaved, first.
  let passed = !lists.some(l => l.url === here)
  for (const list of lists) {
    if (list.url === here) {
      passed = true
      continue
    }
    const rooms = arrange(
      list.rooms.filter(r => home(r.roomId, memberIds(r.members)) === list.url),
      roomOrder(list.url),
      r => r.roomId,
      'rooms'
    )
    ;(passed ? after : before).push(
      ...list.copies
        .filter(c => home(c.roomId, memberIds(c.members)) === list.url)
        .map(copy => ({ host: list.url, kind: 'copy' as const, copy })),
      ...rooms.map(room => ({ host: list.url, kind: 'room' as const, room }))
    )
  }
  return { copies, before, after }
}

/** How long a group chat opened on another host waits for the new host to list it. */
export const ROOM_AFTER_SWITCH_MS = 30_000

/** A group chat opened on another host: the new host's window opens it once its rooms or copies are read. */
let pendingRoom: { host: string; kind: 'room' | 'copy'; id: string; at: number } | null = null

export function openRoomAfterSwitch(other: OtherRoom, now = Date.now()): void {
  pendingRoom = { host: other.host, kind: other.kind, id: other.kind === 'room' ? other.room.roomId : other.copy.id, at: now }
}

/**
 * The room or copy to open here, once this host's list holds it; it waits
 * while the list isn't read, and a copy for a list that holds it (its
 * plugin's routes are read before its copies, so an early list is empty),
 * both up to `ROOM_AFTER_SWITCH_MS`, so a switch that never settles doesn't
 * open the room on a later visit.
 */
export function takeRoomAfterSwitch(
  host: string,
  rooms: readonly Room[] | null,
  copies: readonly RoomCopy[] | null,
  now = Date.now()
): { room: Room } | { copy: RoomCopy } | null {
  // An expired one goes at the next look, whichever host asks.
  if (pendingRoom && now - pendingRoom.at > ROOM_AFTER_SWITCH_MS) pendingRoom = null
  if (!pendingRoom || pendingRoom.host !== host) return null
  const { kind, id } = pendingRoom
  if (kind === 'room') {
    if (!rooms) return null
    pendingRoom = null
    const room = rooms.find(r => r.roomId === id)
    return room ? { room } : null
  }
  const copy = copies?.find(c => c.id === id)
  if (!copy) return null
  pendingRoom = null
  return { copy }
}

/** A bot on another combined host: its starter face (its picture is that host's), opening through a switch. */
export interface OtherBot {
  host: string
  bot: Bot
}

/**
 * Every live kept host's bots, read on Bots Home once a minute; a failed read keeps what the host showed. A read
 * is the roster the host's own window reads (keptRosters), so the first switch there draws its bots at once too.
 */
const botsOf = (url: string): OtherBot[] => (keptRosters.get(url)?.bots ?? []).map(bot => ({ host: url, bot }))

export function useKeptBots(kept: readonly KeptHost[], on: boolean): OtherBot[] {
  // Drawn while live or reconnecting (the host a switch left is dialed again, which over the internet takes most
  // of a second); read only while live.
  const shown = kept
    .filter(h => h.state === 'live' || h.state === 'connecting')
    .map(h => h.url)
    .join('\n')
  const live = kept
    .filter(h => h.state === 'live')
    .map(h => h.url)
    .join('\n')
  // A window a switch opened draws the other dashboard's bots at once, from the last read (or its roster when
  // it was the open one), whether or not the list shows yet; they're read again only while it does (`on`).
  const [bots, setBots] = useState<OtherBot[]>(() => (shown ? shown.split('\n').flatMap(botsOf) : []))

  useEffect(() => {
    const drawn = shown ? shown.split('\n') : []
    const urls = live ? live.split('\n') : []
    const show = () => setBots(drawn.flatMap(botsOf))
    show()
    if (!on || !urls.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        urls.map(async url => {
          const outcome = await window.conduit.keptRpc(url, 'profiles.list', { include_sessions: true })
          if (!outcome.ok || stopped) return
          const roster = rosterFromProfiles(outcome.result)
          if (keepsFor(url)) keptRosters.set(url, { bots: roster.bots, hidden: roster.hidden, protocol: roster.protocol, at: Date.now() })
        })
      )
      if (!stopped) show()
    }
    void read()
    const timer = setInterval(() => void read(), KEPT_CHATS_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [shown, live, on])

  return bots
}

/** Another host's bot's key in `useKeptWork`'s map. */
export const keptWorkKey = (host: string, name: string): string => `${host}\u0000${name.toLowerCase()}`

/**
 * Another host's bot's workstreams route, named as that host's plugin reads
 * it: `?conduit_profile=` when it lists `dashboard-profiles`, else `?profile=`
 * (dashboardProfile.ts has why); the dashboard's own bot goes with neither.
 */
export function keptWorkPath(name: string, dashboardProfiles: boolean): string {
  if (!name || name === 'default') return WORK
  return `${WORK}?${dashboardProfiles ? 'conduit_profile' : 'profile'}=${encodeURIComponent(name)}`
}

/**
 * The other hosts' bots' work, read through each one's connection while Bots
 * shows, as this host's bots' is (useWorkSessions): what needs you and
 * what's working, for their rows' pills. A bot whose work can't be read
 * keeps what it showed; a host let go shows nothing more.
 */
export function useKeptWork(others: readonly OtherBot[], on: boolean): ReadonlyMap<string, BotWork> {
  const [work, setWork] = useState<ReadonlyMap<string, BotWork>>(new Map())
  const byBot = useRef(new Map<string, BotWork>())
  const served = useRef(new Map<string, boolean>())
  // The names as each host lists them, so a bot renamed only in case is read under its new name.
  const names = on
    ? others
        .map(o => `${o.host}\u0000${o.bot.name}`)
        .sort()
        .join('\n')
    : ''

  useEffect(() => {
    const bots = names
      ? names.split('\n').map(entry => {
          const [host, name] = entry.split('\u0000') as [string, string]
          return { key: keptWorkKey(host, name), host, name }
        })
      : []
    const hosts = new Set(bots.map(b => b.host))
    for (const k of [...byBot.current.keys()]) if (!bots.some(b => b.key === k)) byBot.current.delete(k)
    for (const host of [...served.current.keys()]) if (!hosts.has(host)) served.current.delete(host)
    // The same answer keeps the same map, so the Bots list doesn't redraw for nothing, as useWorkSessions's sameWork does.
    const show = () => setWork(current => (sameBotWork(current, byBot.current) ? current : new Map(byBot.current)))
    show()
    if (!bots.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        [...hosts].map(async host => {
          if (!served.current.has(host)) {
            const status = await window.conduit.keptHttp(host, STATUS_PATH)
            if (status.ok) {
              const read = pluginStatus(status.result)
              served.current.set(host, read.state === 'reported' && read.capabilities.includes(DASHBOARD_PROFILES_CAPABILITY))
            }
          }
          const dashboardProfiles = served.current.get(host) ?? false
          await Promise.all(
            bots
              .filter(b => b.host === host)
              .map(async b => {
                const outcome = await window.conduit.keptHttp(host, keptWorkPath(b.name, dashboardProfiles))
                if (stopped || !outcome.ok) return
                const answer = parseWork(outcome.result)
                byBot.current.set(b.key, { working: answer.working, needsYou: answer.needsYou })
              })
          )
        })
      )
      if (!stopped) show()
    }
    void read()
    // As often as Needs you's waits, so a pill shows about when its row does.
    const timer = setInterval(() => void read(), WAITING_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [names])

  return work
}

/** Whether two maps of bots' work say the same. */
export function sameBotWork(a: ReadonlyMap<string, BotWork>, b: ReadonlyMap<string, BotWork>): boolean {
  if (a.size !== b.size) return false
  for (const [key, work] of a) {
    const other = b.get(key)
    if (!other || other.working !== work.working || other.needsYou !== work.needsYou) return false
  }
  return true
}

/** A bot opened on another host: the new host's window opens it once its bots are read. */
let pendingBot: { host: string; name: string } | null = null

export function openBotAfterSwitch(other: OtherBot): void {
  pendingBot = { host: other.host, name: other.bot.name }
}

export function takeBotAfterSwitch(host: string, bots: readonly Bot[] | null): Bot | null {
  if (!pendingBot || pendingBot.host !== host || !bots) return null
  const name = pendingBot.name
  pendingBot = null
  return bots.find(b => b.name === name) ?? null
}

/**
 * Another dashboard's face in the chat list's column: once its switch lands, the list shows that profile's
 * chats, as the phone's strip picks the profile on the dashboard it switched to.
 */
let pendingProfile: { host: string; name: string } | null = null

export function showProfileAfterSwitch(other: OtherBot): void {
  pendingProfile = { host: other.host, name: other.bot.name }
}

/** The profile to show on `host`, once its roster is read: one it no longer lists is forgotten. */
export function takeProfileAfterSwitch(host: string, bots: readonly Bot[] | null | undefined): Bot | null {
  if (!pendingProfile || pendingProfile.host !== host || !bots) return null
  const name = pendingProfile.name.toLowerCase()
  pendingProfile = null
  return bots.find(b => b.name.toLowerCase() === name) ?? null
}

/**
 * How many Pulse cards are new on each live kept host, read with the page's
 * minute read while Pulse is on screen. A host whose Pulse doesn't answer has
 * no count (and no chip).
 */
export function useKeptPulse(kept: readonly KeptHost[], on: boolean): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map())
  const live = on
    ? kept
        .filter(h => h.state === 'live')
        .map(h => h.url)
        .join('\n')
    : ''
  useEffect(() => {
    const urls = live ? live.split('\n') : []
    setCounts(current => new Map([...current].filter(([url]) => urls.includes(url))))
    if (!urls.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      const read = await Promise.all(
        urls.map(async url => {
          const outcome = await window.conduit.keptHttp(url, `${PULSE}/feed`)
          return [url, outcome.ok ? parseFeed(outcome.result).unseen : null] as const
        })
      )
      if (stopped) return
      setCounts(new Map(read.filter((entry): entry is readonly [string, number] => entry[1] !== null)))
    }
    void read()
    const timer = setInterval(() => void read(), KEPT_CHATS_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [live])
  return counts
}

export interface PulseChip {
  url: string
  badge: HostBadge
  /** New cards there; the host on screen's own count. */
  count: number
  current: boolean
}

/** A chip per combined host whose Pulse answers, in the saved order; none unless another one has a chip. */
export function pulseChips(hosts: readonly HostSummary[], current: string, currentCount: number, counts: ReadonlyMap<string, number>, name: (url: string) => string): PulseChip[] {
  const chips: PulseChip[] = []
  for (const host of hosts) {
    const badge = hostBadge(hosts, host.url, name)
    if (!badge) continue
    if (host.url === current) chips.push({ url: host.url, badge, count: currentCount, current: true })
    else if (counts.has(host.url)) chips.push({ url: host.url, badge, count: counts.get(host.url)!, current: false })
  }
  return chips.length > 1 ? chips : []
}

/** An artifact from another combined host: its rows open and copy there; Save and Show in Chat stay with that host. */
export type KeptArtifact = ArtifactItem & { dashboard: string; dashboardProfile?: string }

/** A kept artifact's key, unique across hosts: one path on a host is one artifact, whichever of its profiles lists it. */
export const keptArtifactKey = (host: string, id: string) => `${host}\u0000${id}`

/** New Bot made on another combined host: the sheet's words and look, carried over the switch. */
export interface NewBotCarry {
  name: string
  description: string
  soul: string
  face: number
  picture: string | null
  shareAuth: boolean
}

let pendingNewBot: { host: string; bot: NewBotCarry } | null = null

export function newBotAfterSwitch(host: string, bot: NewBotCarry): void {
  pendingNewBot = { host, bot }
}

export function takeNewBotAfterSwitch(host: string): NewBotCarry | null {
  if (!pendingNewBot || pendingNewBot.host !== host) return null
  const bot = pendingNewBot.bot
  pendingNewBot = null
  return bot
}

/** The launch list's rows: the combined group, two or more, is one row where its first member stands. */
export type LaunchRow = { kind: 'host'; host: HostSummary } | { kind: 'group'; members: HostSummary[]; opens: string }

export function launchRows(hosts: readonly HostSummary[], lastUsed: string | null): LaunchRow[] {
  const group = hosts.filter(h => h.combined)
  if (group.length < 2) return hosts.map(host => ({ kind: 'host', host }))
  // A tap opens the member used last, else the first.
  const opens = group.find(h => h.url === lastUsed)?.url ?? group[0]!.url
  const rows: LaunchRow[] = []
  for (const host of hosts) {
    if (!host.combined) rows.push({ kind: 'host', host })
    else if (host === group[0]) rows.push({ kind: 'group', members: group, opens })
  }
  return rows
}

const LAST_HOST_KEY = 'conduit.lastHost'

/** The host used last, for the launch list's group row; kept on this computer. */
export function readLastHost(): string | null {
  try {
    return localStorage.getItem(LAST_HOST_KEY)
  } catch {
    return null
  }
}

export function writeLastHost(url: string): void {
  try {
    localStorage.setItem(LAST_HOST_KEY, url)
  } catch {
    // Not kept: the group's row opens its first member.
  }
}
