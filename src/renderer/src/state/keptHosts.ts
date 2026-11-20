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
import { WAITING_POLL_MS, waitingFromResponse, waitingPath, type WaitingRow } from './needsYou'
import { CHAT_LIST_PAGE, CHAT_LIST_PATH, rowsFromResponse, type ChatRow } from './chats'
import { rosterFromProfiles, type Bot } from './bots'
import { PULSE, parseFeed } from './pulse'
import { listPath, parsePage, type ArtifactFilter, type ArtifactItem } from './artifacts'
import { roomsFromList, type Room } from './groups'
import { COPIES_PATH, parseCopies, type RoomCopy } from './roomCopies'

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
  const label = name(url).trim()
  return { letter: (Array.from(label)[0] ?? '?').toUpperCase(), color: badgeColor(index), name: label }
}

/** The hosts kept beside the open one, as the main process says. */
export function useKeptHosts(): KeptHost[] {
  const [hosts, setHosts] = useState<KeptHost[]>([])
  useEffect(() => {
    const off = window.conduit.onKeptHosts(setHosts)
    void window.conduit.keptHosts().then(setHosts)
    return off
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

/** A wait opened from another host: the switch remounts the window, and the new host's window takes it. */
let pending: { host: string; row: WaitingRow } | null = null

export function openAfterSwitch(row: KeptWaitingRow): void {
  const { host, ...rest } = row
  pending = { host, row: rest }
}

export function takeOpenAfterSwitch(host: string): WaitingRow | null {
  if (!pending || pending.host !== host) return null
  const row = pending.row
  pending = null
  return row
}

/** A chat on another combined host: it only opens, through a switch. */
export type OtherChatRow = ChatRow & { host: string }

/** How often the other hosts' chats are read while the window is on screen, at most (the phone's minute). */
export const KEPT_CHATS_POLL_MS = 60_000

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
 * once a minute while the window is on screen. A failed read keeps what the
 * host showed; a host let go shows nothing more.
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
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        urls.map(async url => {
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
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
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

/** A chat opened on another host: the switch remounts the window, and the new host's window opens it. */
let pendingChat: { host: string; row: ChatRow } | null = null

export function openChatAfterSwitch(row: OtherChatRow): void {
  const { host, ...rest } = row
  pendingChat = { host, row: rest }
}

export function takeChatAfterSwitch(host: string): ChatRow | null {
  if (!pendingChat || pendingChat.host !== host) return null
  const row = pendingChat.row
  pendingChat = null
  return row
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
export function useKeptRooms(kept: readonly KeptHost[], on: boolean): Map<string, HostRooms> {
  const [rooms, setRooms] = useState<Map<string, HostRooms>>(new Map())
  const byHost = useRef(new Map<string, HostRooms>())
  const live = on
    ? kept
        .filter(h => h.state === 'live')
        .map(h => h.url)
        .join('\n')
    : ''

  useEffect(() => {
    const urls = live ? live.split('\n') : []
    for (const url of [...byHost.current.keys()]) if (!urls.includes(url)) byHost.current.delete(url)
    const show = () => setRooms(new Map(byHost.current))
    show()
    if (!urls.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        urls.map(async url => {
          const [listed, copied] = await Promise.all([
            window.conduit.keptRpc(url, 'groups.list', { include_disbanded: false }),
            window.conduit.keptHttp(url, COPIES_PATH)
          ])
          if (stopped) return
          const last = byHost.current.get(url)
          const rooms = listed.ok ? roomsFromList(listed.result).filter(r => !r.disbanded) : (last?.rooms ?? [])
          const copies = (copied.ok ? parseCopies(copied.result) : null) ?? last?.copies ?? []
          if (!listed.ok && !copied.ok && !last) return
          byHost.current.set(url, { rooms, copies })
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
  }, [live])

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
 * `copies`: this host's copies left to show; `others`: the other hosts'
 * group chats, in Saved Dashboards order, each one's newest first.
 */
export function combinedRooms(
  here: string,
  order: readonly string[],
  hereRooms: readonly Room[],
  hereCopies: readonly RoomCopy[],
  kept: ReadonlyMap<string, HostRooms>
): { copies: RoomCopy[]; others: OtherRoom[] } {
  if (!kept.size) return { copies: [...hereCopies], others: [] }
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
  const copies = hereCopies.filter(c => (home(c.roomId, memberIds(c.members)) ?? here) === here)
  const others: OtherRoom[] = []
  for (const list of lists) {
    if (list.url === here) continue
    const own: (OtherRoom & { at: number })[] = [
      ...list.rooms
        .filter(r => home(r.roomId, memberIds(r.members)) === list.url)
        .map(room => ({ host: list.url, kind: 'room' as const, room, at: room.updatedAt ?? 0 })),
      ...list.copies
        .filter(c => home(c.roomId, memberIds(c.members)) === list.url)
        .map(copy => ({ host: list.url, kind: 'copy' as const, copy, at: copy.updatedAt }))
    ]
    others.push(...own.sort((a, b) => b.at - a.at).map(({ at: _at, ...row }) => row as OtherRoom))
  }
  return { copies, others }
}

/** A group chat opened on another host: the new host's window opens it once its rooms or copies are read. */
let pendingRoom: { host: string; kind: 'room' | 'copy'; id: string } | null = null

export function openRoomAfterSwitch(other: OtherRoom): void {
  pendingRoom = { host: other.host, kind: other.kind, id: other.kind === 'room' ? other.room.roomId : other.copy.id }
}

/** The room or copy to open here, once this host's list holds it; it waits while the list isn't read. */
export function takeRoomAfterSwitch(host: string, rooms: readonly Room[] | null, copies: readonly RoomCopy[] | null): { room: Room } | { copy: RoomCopy } | null {
  if (!pendingRoom || pendingRoom.host !== host) return null
  const { kind, id } = pendingRoom
  if (kind === 'room') {
    if (!rooms) return null
    pendingRoom = null
    const room = rooms.find(r => r.roomId === id)
    return room ? { room } : null
  }
  if (!copies) return null
  pendingRoom = null
  const copy = copies.find(c => c.id === id)
  return copy ? { copy } : null
}

/** A bot on another combined host: its starter face (its picture is that host's), opening through a switch. */
export interface OtherBot {
  host: string
  bot: Bot
}

/** Every live kept host's bots, read on Bots Home once a minute; a failed read keeps what the host showed. */
export function useKeptBots(kept: readonly KeptHost[], on: boolean): OtherBot[] {
  const [bots, setBots] = useState<OtherBot[]>([])
  const byHost = useRef(new Map<string, OtherBot[]>())
  const live = on
    ? kept
        .filter(h => h.state === 'live')
        .map(h => h.url)
        .join('\n')
    : ''

  useEffect(() => {
    const urls = live ? live.split('\n') : []
    for (const url of [...byHost.current.keys()]) if (!urls.includes(url)) byHost.current.delete(url)
    const show = () => setBots([...byHost.current.values()].flat())
    show()
    if (!urls.length) return
    let stopped = false
    const read = async () => {
      if (document.hidden) return
      await Promise.all(
        urls.map(async url => {
          const outcome = await window.conduit.keptRpc(url, 'profiles.list', { include_sessions: true })
          if (!outcome.ok || stopped) return
          byHost.current.set(
            url,
            rosterFromProfiles(outcome.result).bots.map(bot => ({ host: url, bot }))
          )
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
  }, [live])

  return bots
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

/** A page picked on another host (Pulse's chip): the new host's window opens on it. */
let pendingPage: { host: string; page: string } | null = null

export function openPageAfterSwitch(host: string, page: string): void {
  pendingPage = { host, page }
}

export function takePageAfterSwitch(host: string): string | null {
  if (!pendingPage || pendingPage.host !== host) return null
  const page = pendingPage.page
  pendingPage = null
  return page
}

/** An artifact from another combined host: its rows open and copy there; Save and Show in Chat stay with that host. */
export type KeptArtifact = ArtifactItem & { dashboard: string; dashboardProfile?: string }

/** A kept artifact's key, unique across hosts and profiles. */
export const keptArtifactKey = (host: string, profile: string | undefined, id: string) => `${host}\u0000${profile ?? ''}\u0000${id}`

/**
 * The Artifacts page's other combined hosts: each profile of each live kept
 * host, its first page for the kind and search shown, read through its kept
 * connection after this host's own. A host that fails keeps nothing.
 */
export function useKeptArtifacts(kept: readonly KeptHost[], on: boolean, filter: ArtifactFilter, words: string, reload: number): KeptArtifact[] {
  const [rows, setRows] = useState<KeptArtifact[]>([])
  const live = on
    ? kept
        .filter(h => h.state === 'live')
        .map(h => h.url)
        .join('\n')
    : ''
  useEffect(() => {
    const urls = live ? live.split('\n') : []
    if (!urls.length) {
      setRows([])
      return
    }
    let stopped = false
    void Promise.all(
      urls.map(async url => {
        const listed = await window.conduit.keptHttp(url, '/api/profiles')
        const names = (listed.ok ? profileNames(listed.result) : null) ?? ['default']
        const pages = await Promise.all(
          names.map(async name => {
            const profile = name === 'default' ? undefined : name
            const outcome = await window.conduit.keptHttp(url, listPath({ profile, filter, query: words }))
            if (!outcome.ok) return []
            return parsePage(outcome.result).items.map(item => ({ ...item, id: keptArtifactKey(url, profile, item.id), dashboard: url, dashboardProfile: profile }))
          })
        )
        return pages.flat()
      })
    ).then(all => {
      if (!stopped) setRows(all.flat().sort((a, b) => b.at - a.at))
    })
    return () => {
      stopped = true
    }
  }, [live, filter, words, reload])
  return rows
}

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
