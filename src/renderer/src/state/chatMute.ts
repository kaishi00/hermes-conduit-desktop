/**
 * Muted chats, after the phone's ChatMutes (hermes-conduit: Notifications). The
 * user mutes one chat for 15 minutes, an hour, a day or until they unmute it;
 * the plugin keeps the mute per profile (`/notifications/muted-chats`, plugin
 * 0.193.0+) and skips that chat's pushes itself, so it holds on every device.
 * A mute is sent under the row's own id, never its lineage root (a branch or
 * reset names its parent as root); the plugin's answer names every session a
 * compaction carried the chat through, so a compacted chat still finds it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { ChatRow } from './chats'

export const MUTE_PATH = '/api/plugins/conduit_push/notifications/muted-chats'
/** A profile's mutes are read at most this often while the list changes. */
export const MUTE_READ_INTERVAL_MS = 30_000

/** The menu's durations, in seconds; null is until unmuted. */
export const MUTE_CHOICES: { key: string; label: () => string; seconds: number | null }[] = [
  { key: '15m', label: () => t('For 15 Minutes'), seconds: 15 * 60 },
  { key: '1h', label: () => t('For 1 Hour'), seconds: 60 * 60 },
  { key: '1d', label: () => t('For 1 Day'), seconds: 24 * 60 * 60 },
  { key: 'forever', label: () => t('Until I Unmute'), seconds: null }
]

export interface ChatMute {
  ids: string[]
  /** When it ends, in ms on this computer's clock; null for until unmuted. */
  until: number | null
}

/** Each profile's mutes, by its lowercase name; null until one has been read (an older plugin never answers). */
export type ChatMutes = Record<string, ChatMute[]> | null

const profileKey = (profile?: string | null) => (profile || 'default').toLowerCase()

export const mutePath = (profile?: string | null) =>
  profile && profile !== 'default' ? `${MUTE_PATH}?profile=${encodeURIComponent(profile)}` : MUTE_PATH

/**
 * The ids a mute is sent under: the row's own, never its lineage root, since a
 * branch or reset names its parent as root and muting it must leave the parent.
 * The plugin adds the sessions a compaction carried the chat through.
 */
export const muteIds = (row: ChatRow): string[] => (row.id ? [row.id] : [])

/**
 * The route's answer; null when it isn't one. `remaining_s` is read against
 * this computer's clock, so a host whose clock is off still ends the mute on time.
 */
export function parseMutes(body: unknown, now = Date.now()): ChatMute[] | null {
  const rows = body && typeof body === 'object' ? (body as Record<string, unknown>).chats : undefined
  if (!Array.isArray(rows)) return null
  return rows.flatMap((row): ChatMute[] => {
    const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    const ids = Array.isArray(o.session_ids) ? o.session_ids.filter((id): id is string => typeof id === 'string' && !!id) : []
    if (!ids.length) return []
    if (o.remaining_s === null || o.remaining_s === undefined) return o.until === null || o.until === undefined ? [{ ids, until: null }] : []
    return typeof o.remaining_s === 'number' && o.remaining_s > 0 ? [{ ids, until: now + o.remaining_s * 1000 }] : []
  })
}

/**
 * `mutes` with `key`'s replaced by `found`; `mutes` itself when they say the
 * same, a timed mute's end read again within a couple of seconds included, so
 * a read every 30 seconds doesn't redraw the list (desktop#543).
 */
export function withProfileMutes(mutes: ChatMutes, key: string, found: ChatMute[]): ChatMutes {
  const before = mutes?.[key]
  const same =
    !!before &&
    before.length === found.length &&
    before.every((mute, i) => {
      const other = found[i]!
      const ends = mute.until === null || other.until === null ? mute.until === other.until : Math.abs(mute.until - other.until) < 2_000
      return ends && mute.ids.length === other.ids.length && mute.ids.every((id, j) => id === other.ids[j])
    })
  return same ? mutes : { ...(mutes ?? {}), [key]: found }
}

/** The row's mute while it lasts, else null. */
export function muteOf(mutes: ChatMutes, row: ChatRow, now = Date.now()): ChatMute | null {
  const id = row.id
  return mutes?.[profileKey(row.profile)]?.find(mute => !!id && mute.ids.includes(id) && (mute.until === null || mute.until > now)) ?? null
}

/** The chat muted (`seconds`, null for until unmuted) or unmuted (0) before the plugin answers. */
export function settingMute(mutes: ChatMutes, row: ChatRow, seconds: number | null, now = Date.now()): ChatMutes {
  const key = profileKey(row.profile)
  const ids = new Set(muteIds(row))
  const kept = (mutes?.[key] ?? []).filter(mute => !mute.ids.some(id => ids.has(id)))
  const next = seconds === 0 ? kept : [{ ids: muteIds(row), until: seconds === null ? null : now + seconds * 1000 }, ...kept]
  return { ...(mutes ?? {}), [key]: next }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/**
 * Whether a chat is muted, read from the plugin at once: for a window that
 * keeps no list of mutes (a chat in a window of its own). Can't tell is not muted.
 */
export async function readMuted(http: Http, row: ChatRow): Promise<boolean> {
  try {
    return !!muteOf({ [profileKey(row.profile)]: parseMutes(await http('GET', mutePath(row.profile))) ?? [] }, row)
  } catch {
    return false
  }
}

/**
 * The chat an event names, as a mute knows it. `profileUnknown`: neither an
 * open chat, Needs you nor the list knows its profile (a compacted chat this
 * window never opened), so a mute is looked for under every profile read.
 */
export type MuteTarget = ChatRow & { profileUnknown?: boolean }

/** The target's mute while it lasts, under its own profile or, when that isn't known, any profile read. */
export function muteOfTarget(mutes: ChatMutes, target: MuteTarget, now = Date.now()): ChatMute | null {
  if (!target.profileUnknown) return muteOf(mutes, target, now)
  for (const key of Object.keys(mutes ?? {})) {
    const found = muteOf(mutes, { ...target, profile: key }, now)
    if (found) return found
  }
  return null
}

/** How long a profile's mutes read for a finished turn answer the turns after it (desktop#539). */
export const TURN_MUTE_READ_MS = 5_000

/**
 * The mutes read for finished turns, each profile's answer shared for
 * TURN_MUTE_READ_MS: a busy host's turns ending together ask the plugin once,
 * not once each. Forgotten when this window sets a mute, or the host changes.
 */
export class TurnMuteReads {
  private readonly kept = new Map<string, { at: number; mutes: Promise<ChatMute[]> }>()
  constructor(private readonly http: Http) {}

  mutes(profile: string | undefined, now = Date.now()): Promise<ChatMute[]> {
    const key = profileKey(profile)
    const held = this.kept.get(key)
    if (held && now - held.at < TURN_MUTE_READ_MS) return held.mutes
    // Can't tell is not muted.
    const mutes = this.http('GET', mutePath(profile)).then(body => parseMutes(body) ?? [], () => [])
    this.kept.set(key, { at: now, mutes })
    return mutes
  }

  /** A mute set or unset here is authoritative until this cache window ends. */
  seed(profile: string | undefined, mutes: ChatMute[], now = Date.now()): void {
    this.kept.set(profileKey(profile), { at: now, mutes: Promise.resolve(mutes) })
  }

  forget(): void {
    this.kept.clear()
  }
}

/** Whether the plugin has the target muted: each listed profile asked when its own isn't known (none listed: the default). */
async function readMutedTarget(reads: TurnMuteReads, target: MuteTarget, profiles: string[]): Promise<boolean> {
  const names = !target.profileUnknown ? [target.profile] : profiles.length ? profiles : ['default']
  const answers = await Promise.all(names.map(profile => reads.mutes(profile)))
  return names.some((profile, i) => !!muteOf({ [profileKey(profile)]: answers[i]! }, { ...target, profile }))
}

/**
 * The profiles a chat whose profile isn't known is asked of: those the list
 * shows and every bot's, each once by its key. The default profile's bot can
 * carry another name, and is still the default profile.
 */
export function muteProfilesToAsk(listed: string[], bots: { name: string; isDefault: boolean }[]): string[] {
  const byKey = new Map<string, string>()
  for (const name of [...listed, ...bots.map(bot => (bot.isDefault ? 'default' : bot.name))]) {
    const key = profileKey(name)
    if (!byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()].sort()
}

/**
 * Whether a chat's finished turn notifies here: not while it's muted, as the
 * plugin doesn't push it, by the mutes read so far, and then asked at once
 * for a mute set on another device since (`reads`, shared for a few seconds). Approvals and questions don't come
 * through here: they notify whatever the mute, as on the phone.
 */
export async function turnNotifies(
  http: Http,
  mutes: ChatMutes,
  target: MuteTarget,
  profiles: string[],
  reads: TurnMuteReads = new TurnMuteReads(http)
): Promise<boolean> {
  if (muteOfTarget(mutes, target)) return false
  return !(await readMutedTarget(reads, target, profiles))
}

/**
 * The listed profiles' mutes, read again as the list changes (`version`), each
 * profile at most every MUTE_READ_INTERVAL_MS. `available` says the plugin keeps
 * them: the menu waits for it. `onError` hears a mute that didn't take.
 */
export function useChatMute(http: Http, connected: boolean, profiles: string[], version: string, host: string, onError?: (reason: string) => void) {
  const [mutes, setMutes] = useState<ChatMutes>(null)
  const readAt = useRef(new Map<string, number>())
  // A read that started before a write answers with the old mutes: it's dropped.
  const wroteAt = useRef(new Map<string, number>())
  const hostRef = useRef(host)
  const turnReads = useMemo(() => new TurnMuteReads(http), [http])
  useEffect(() => {
    hostRef.current = host
    readAt.current.clear()
    wroteAt.current.clear()
    turnReads.forget()
    setMutes(null)
  }, [host, turnReads])

  const read = useCallback(
    async (profile: string) => {
      const askedHost = hostRef.current
      const key = profileKey(profile)
      const started = Date.now()
      readAt.current.set(key, started)
      try {
        const found = parseMutes(await http('GET', mutePath(profile)))
        if (!found || hostRef.current !== askedHost || (wroteAt.current.get(key) ?? 0) >= started) return
        setMutes(current => withProfileMutes(current, key, found))
      } catch {
        // An older plugin, or the host away: the mutes stay as they were.
      }
    },
    [http]
  )

  const key = profiles.join('\t')
  useEffect(() => {
    if (!connected) return
    const now = Date.now()
    for (const profile of key.split('\t')) {
      const last = readAt.current.get(profileKey(profile))
      if (last === undefined || now - last >= MUTE_READ_INTERVAL_MS) void read(profile)
    }
    // host: another host's mutes are read at once, not at the list's next change.
  }, [connected, key, version, read, host])

  // A timed mute ending redraws its row and menu then, not at the next change.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const now = Date.now()
    const ends = Object.values(mutes ?? {}).flat().flatMap(mute => (mute.until !== null && mute.until > now ? [mute.until] : []))
    if (!ends.length) return
    const timer = setTimeout(() => setTick(n => n + 1), Math.min(...ends) - now + 50)
    return () => clearTimeout(timer)
    // tick: each end that passes arms the timer for the next one.
  }, [mutes, tick])

  /** Mutes the chat for `seconds` (null: until unmuted), or unmutes it (0). */
  const setMute = useCallback(
    (row: ChatRow, seconds: number | null) => {
      const askedHost = hostRef.current
      const profileName = row.profile ?? 'default'
      wroteAt.current.set(profileKey(profileName), Date.now())
      // A turn finishing before the PUT lands must not read a stale mute from the
      // plugin and cache it for five seconds (issue 550).
      const key = profileKey(profileName)
      turnReads.seed(profileName, (settingMute(mutes ?? {}, row, seconds) ?? {})[key] ?? [])
      setMutes(current => settingMute(current, row, seconds))
      http('PUT', mutePath(row.profile), { session_ids: muteIds(row), mute_s: seconds })
        .then(body => {
          const found = parseMutes(body)
          if (found && hostRef.current === askedHost) setMutes(current => ({ ...(current ?? {}), [profileKey(profileName)]: found }))
        })
        .catch(e => {
          onError?.(e instanceof Error ? e.message : String(e))
          void read(profileName)
        })
    },
    [http, read, onError, turnReads, mutes]
  )

  // `tick` changes when a timed mute ends, so what reads the mutes reads them again.
  return { mutes, available: mutes !== null, setMute, tick, turnReads }
}

/** When a timed mute ends, for its menu: the time today, else the day and time. */
export function muteEnd(until: number, now = Date.now()): string {
  const end = new Date(until)
  const sameDay = end.toDateString() === new Date(now).toDateString()
  return sameDay
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : end.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
