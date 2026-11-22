import { isMovingDataUrl, stillOf, stillReady } from './movingPicture'
import { gateway } from '../gateway'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { avatarUrl, keptRosters, rosterFromProfiles, type Bot } from './bots'
import { keepsFor } from './savedHosts'

/** The bots roster, read when the connection opens, when profiles change and when a turn ends. */

/**
 * `host`: the dashboard this window shows. `withSessions: false` reads the bots
 * without their chats and again only when profiles change, for a window that
 * draws one bot's name and face (a pop-out chat, desktop#292); that roster
 * isn't kept for the dashboard, whose windows need the chats.
 */
export function useBots(connected: boolean, host = '', { withSessions = true }: { withSessions?: boolean } = {}) {
  const kept = keptRosters.get(host)
  const [bots, setBots] = useState<Bot[] | null>(kept?.bots ?? null)
  const [hidden, setHidden] = useState<Bot[]>(kept?.hidden ?? [])
  const [protocol, setProtocol] = useState(kept?.protocol ?? false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const body = await gateway.rpc('profiles.list', withSessions ? { include_sessions: true } : {})
      const roster = rosterFromProfiles(body)
      if (withSessions && keepsFor(host)) keptRosters.set(host, { bots: roster.bots, hidden: roster.hidden, protocol: roster.protocol, at: Date.now() })
      setBots(roster.bots)
      setHidden(roster.hidden)
      setProtocol(roster.protocol)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [host, withSessions])

  useEffect(() => {
    if (!connected) return
    void load()
    const off = window.conduit.onEvent(event => {
      if (event.type === 'profiles.changed' || (withSessions && (event.type === 'message.complete' || event.type === 'sessions.changed'))) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(), 1200)
      }
    })
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load, withSessions])

  return { bots, hidden, protocol, error, refresh: load }
}

const avatarCache = new Map<string, Promise<string | null>>()
/** What each read gave, so a picture read before draws on the first frame (a dashboard switch remounts every face). */
const avatarValues = new Map<string, string | null>()
/** The dashboard this window shows: its pictures are kept under it, beside other dashboards' (desktop: combined dashboards). */
let avatarHost = ''

/** The faces read for dashboards no longer saved go. */
export function forgetAvatarHosts(hosts: readonly string[]): void {
  for (const key of [...avatarCache.keys(), ...avatarValues.keys()]) {
    if (!hosts.includes(key.slice(0, key.indexOf('\u0000')))) {
      avatarCache.delete(key)
      avatarValues.delete(key)
    }
  }
}

const avatarKey = (name: string, host?: string) => `${host ?? avatarHost}\u0000${name}`

/** The dashboard whose bots this window's own pictures are, set as its window opens. */
export function setAvatarHost(host: string): void {
  avatarHost = host
}

/** This dashboard's pictures are read again (a bot deleted here). */
export function forgetAvatars(): void {
  for (const key of [...avatarCache.keys()]) {
    if (key.startsWith(`${avatarHost}\u0000`)) {
      avatarCache.delete(key)
      avatarValues.delete(key)
    }
  }
}

export const AVATAR_CHANGED = 'conduit-avatar-changed'

/** A bot's picture changed here: read it again wherever it shows. */
export function avatarChanged(name: string): void {
  avatarCache.delete(avatarKey(name))
  avatarValues.delete(avatarKey(name))
  window.dispatchEvent(new CustomEvent(AVATAR_CHANGED, { detail: name }))
}

/** A bot's picture as an image URL, read once per launch and again after avatarChanged. */
export function readAvatar(name: string, host?: string): Promise<string | null> {
  const key = avatarKey(name, host)
  let pending = avatarCache.get(key)
  if (!pending) {
    pending = host && host !== avatarHost
      ? // Another combined dashboard's bot, through its kept connection; a failed read is tried again next time.
        window.conduit.keptRpc(host, 'profiles.get_asset', { name, asset: 'avatar' }).then(outcome => {
          if (!outcome.ok) avatarCache.delete(key)
          return outcome.ok ? avatarUrl(outcome.result) : null
        })
      : gateway
          .rpc('profiles.get_asset', { name, asset: 'avatar' })
          .then(avatarUrl)
          .catch(() => {
            // Tried again next time, as another dashboard's is.
            avatarCache.delete(key)
            return null
          })
    avatarCache.set(key, pending)
    void pending.then(value => {
      if (avatarCache.get(key) === pending) avatarValues.set(key, value)
    })
  }
  return pending
}

/** A bot's picture from its profile's asset store, read once per launch and again when Edit Bot changes it. */
/** `host`: another combined dashboard's bot, read through that host's kept connection. */
export function useAvatar(name: string, hasAvatar: boolean, host?: string): string | null {
  const [url, setUrl] = useState<string | null>(() => (hasAvatar ? (avatarValues.get(avatarKey(name, host)) ?? null) : null))
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === name) setVersion(v => v + 1)
    }
    window.addEventListener(AVATAR_CHANGED, changed)
    return () => window.removeEventListener(AVATAR_CHANGED, changed)
  }, [name])
  useEffect(() => {
    if (!hasAvatar) {
      setUrl(null)
      return
    }
    let live = true
    void readAvatar(name, host).then(value => {
      if (live) setUrl(value)
    })
    return () => {
      live = false
    }
  }, [name, hasAvatar, host, version])
  return url
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The picture a face shows: a moving one plays only where `moving` (and
 * not with Reduce Motion); elsewhere its first frame, as the phone's rows,
 * transcript and menus keep it.
 */
export function useFace(url: string | null, moving: boolean): string | null {
  const plays = moving && !reducedMotion()
  const moves = useMemo(() => !!url && isMovingDataUrl(url), [url])
  const animated = !!url && !plays && moves
  const [still, setStill] = useState<{ of: string; url: string } | null>(null)
  useEffect(() => {
    if (!animated || !url) return
    let live = true
    void stillOf(url).then(frame => {
      if (live) setStill({ of: url, url: frame })
    })
    return () => {
      live = false
    }
  }, [animated, url])
  if (!animated) return url
  // Nothing until the first frame is ready, so a row never flashes the moving picture.
  return still?.of === url ? still.url : (stillReady(url) ?? null)
}
