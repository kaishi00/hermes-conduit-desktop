/**
 * Calls from Hermes on this computer (notifier `call-rings`): the plugin
 * keeps each call that goes out for two minutes, and Conduit asks for the
 * new ones every few seconds, per profile. A call rings here beside the
 * iPhone; answering here opens its chat and starts a call in the voice mode
 * picked in Settings. The relay's pushes reach phones only, so this is how a
 * computer hears of a call. A ring settled on another device (answered on
 * the iPhone, declined) stops here at the next ask; a decline here tells
 * Hermes, as the iPhone's does, and so does a miss when no iPhone is paired.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { STATUS_PATH, askPluginStatus, serves, type PluginStatus } from './plugin'

const withProfile = (path: string, profile?: string, query = '') => {
  const params = new URLSearchParams(query)
  if (profile && profile !== 'default') params.set('profile', profile)
  const text = params.toString()
  return text ? `${path}?${text}` : path
}

export const RINGS_CAPABILITY = 'call-rings'
export const RINGS_PATH = '/api/plugins/conduit_push/calls/rings'
export const RING_POLL_MS = 4_000
/** How long a call rings here before it counts as missed. */
export const RING_FOR_MS = 45_000
/** A call this old (by the host's clock) when first heard of no longer rings: the computer was asleep or offline. */
const FRESH_S = 30

export interface Ring {
  id: string
  profile?: string
  kind: string | null
  /** The bot's name. */
  name: string
  heading: string
  body: string
  reason: string
  title: string
  sessionIds: string[]
  /** When it went out, by the host's clock. */
  at: number
  /** Still ringing, or settled on some device: answered (a call started anywhere), declined or missed. */
  state: 'ringing' | 'answered' | 'declined' | 'missed'
  /** No iPhone is paired with its profile: a miss here is this computer's to tell Hermes. */
  reportsMiss: boolean
}

const STATES = ['ringing', 'answered', 'declined', 'missed'] as const

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The host's answer: its rings and its clock, for the next ask. */
export function ringsFrom(body: unknown, profile?: string): { rings: Ring[]; now: number | null } {
  const r = (body ?? {}) as Record<string, unknown>
  const now = typeof r.now === 'number' ? r.now : null
  // An older plugin leaves it out: its calls rang an iPhone, which reports the miss.
  const reportsMiss = r.paired === false
  const rings = (Array.isArray(r.rings) ? r.rings : []).flatMap((raw): Ring[] => {
    const e = (raw ?? {}) as Record<string, unknown>
    if (!str(e.id) || typeof e.at !== 'number') return []
    return [
      {
        id: str(e.id),
        profile,
        kind: str(e.kind) || null,
        name: str(e.name),
        heading: str(e.heading),
        body: str(e.body),
        reason: str(e.reason),
        title: str(e.title),
        sessionIds: Array.isArray(e.session_ids) ? e.session_ids.filter((s): s is string => typeof s === 'string' && !!s) : [],
        at: e.at,
        state: (STATES as readonly string[]).includes(str(e.state)) ? (e.state as Ring['state']) : 'ringing',
        reportsMiss
      }
    ]
  })
  return { rings, now }
}

/** Which of a first answer's rings still ring: the ones that just went out. */
export const freshRings = (rings: Ring[], now: number | null) =>
  now === null ? [] : rings.filter(ring => ring.state === 'ringing' && now - ring.at <= FRESH_S)

/** What an answer changes: the rings to start, and the ids settled elsewhere (answered on the iPhone, declined) that stop. */
export function ringChanges(rings: Ring[], seen: ReadonlySet<string>): { added: Ring[]; settled: string[] } {
  return {
    added: rings.filter(ring => ring.state === 'ringing' && !seen.has(ring.id)),
    settled: rings.filter(ring => ring.state !== 'ringing').map(ring => ring.id)
  }
}

/**
 * What a dropped connection forgets: each host's clock, what its plugin serves,
 * and the rings already shown. A ring still ringing when the connection comes
 * back rings again, as it would on a fresh launch, so its miss is still
 * reported; one already declined or missed is settled on the host and stays
 * gone (desktop#205).
 */
export function startOver(state: { after: Map<string, number>; served: Map<string, boolean>; seen: Set<string> }) {
  state.after.clear()
  state.served.clear()
  state.seen.clear()
}

export const OUTCOMES_PATH = '/api/plugins/conduit_push/calls/outcomes'
export const PRESENCE_PATH = '/api/plugins/conduit_push/calls/presence'
export const PRESENCE_CAPABILITY = 'hermes-call-presence'
export const PRESENCE_S = 90
export const PRESENCE_RENEW_MS = 30_000

/** The decline or miss Hermes hears in that chat's next turn, as the iPhone reports one; it also stops this ring wherever it still rings on a computer. */
export const declineBody = (ring: Ring, outcome: 'declined' | 'missed' = 'declined') => ({
  call_id: ring.id,
  session_ids: ring.sessionIds,
  outcome,
  kind: ring.kind,
  title: ring.title,
  reason: ring.reason,
  age_s: 0
})

export function declineOnHost(ring: Ring, outcome: 'declined' | 'missed' = 'declined'): void {
  if (!ring.sessionIds.length) return
  void gateway.http('POST', withProfile(OUTCOMES_PATH, ring.profile), declineBody(ring, outcome), 10_000).catch(() => undefined)
}

/**
 * While a call runs here, the host holds the user's call presence, as the
 * iPhone does for its calls: nothing Hermes calls about rings over it, and a
 * call from Hermes answered here counts as answered on every device.
 * 90 seconds, renewed every 30, let go at hang-up. A capabilities ask that
 * can't tell (a timeout, a 5xx while the plugin host restarts) is asked
 * again at the next renewal, as the phone's renewal loop keeps trying; only
 * a plugin that answers without `hermes-call-presence` is left alone.
 */
export function holdCallPresence(
  ask: () => Promise<PluginStatus | null>,
  hold: (seconds: number) => Promise<unknown>,
  every: (ms: number, tick: () => void) => () => void = (ms, tick) => {
    const timer = setInterval(tick, ms)
    return () => clearInterval(timer)
  }
): () => void {
  let live = true
  /** null until the plugin answers whether it keeps presence. */
  let served: boolean | null = null
  let asking = false
  const renew = async () => {
    if (served === null) {
      if (asking) return
      asking = true
      const status = await ask()
      asking = false
      if (!live || !status) return
      served = serves(status, [PRESENCE_CAPABILITY])
    }
    if (served) await hold(PRESENCE_S).catch(() => undefined)
  }
  void renew()
  const stop = every(PRESENCE_RENEW_MS, () => void renew())
  return () => {
    live = false
    stop()
    if (served) void hold(0).catch(() => undefined)
  }
}

export function useCallPresence(calling: boolean, profile: string | undefined) {
  useEffect(() => {
    if (!calling) return
    return holdCallPresence(
      () => askPluginStatus(() => gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 12_000)),
      seconds => gateway.http('PUT', withProfile(PRESENCE_PATH, profile), { hold_s: seconds }, 10_000)
    )
  }, [calling, profile])
}

/** The calls ringing on this computer, newest last, and a way to let one go. */
export function useRings(connected: boolean, profiles: readonly string[]) {
  const [ringing, setRinging] = useState<Ring[]>([])
  const after = useRef(new Map<string, number>())
  const served = useRef(new Map<string, boolean>())
  const seen = useRef(new Set<string>())
  // Moves on at each start over, so a poll asked before it can't write the old host's state back (desktop#216).
  const generation = useRef(0)
  const profileKey = profiles.join('\n')

  const dismiss = useCallback((id: string) => setRinging(current => current.filter(ring => ring.id !== id)), [])

  const read = useCallback(async () => {
    const names = profileKey ? profileKey.split('\n') : ['']
    const asked = generation.current
    const current = () => asked === generation.current
    await Promise.all(
      names.map(async name => {
        const profile = name || undefined
        if (!served.current.has(name)) {
          const status = await askPluginStatus(() => gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 12_000))
          // Only an answer is kept: a route that isn't there yet (a plugin installed or reloading) is asked again next poll.
          if (!current() || status?.state !== 'reported') return
          served.current.set(name, serves(status, [RINGS_CAPABILITY]))
        }
        if (!served.current.get(name)) return
        const since = after.current.get(name)
        let answer: { rings: Ring[]; now: number | null }
        try {
          answer = ringsFrom(
            await gateway.http('GET', withProfile(RINGS_PATH, profile, since === undefined ? '' : `after=${since}`), undefined, 10_000),
            profile
          )
        } catch {
          return
        }
        if (!current()) return
        if (answer.now !== null) after.current.set(name, answer.now)
        const fresh = since === undefined ? freshRings(answer.rings, answer.now) : answer.rings
        const { added, settled } = ringChanges(fresh, seen.current)
        if (!added.length && !settled.length) return
        added.forEach(ring => seen.current.add(ring.id))
        settled.forEach(id => seen.current.add(id))
        setRinging(current => [...current.filter(ring => !added.some(a => a.id === ring.id) && !settled.includes(ring.id)), ...added])
      })
    )
  }, [profileKey])

  useEffect(() => {
    if (!connected) return
    void read()
    const timer = setInterval(() => void read(), RING_POLL_MS)
    return () => clearInterval(timer)
  }, [connected, read])

  // A host change or a dropped connection starts over: the next host's clock and calls are its own.
  useEffect(() => {
    if (connected) return
    generation.current += 1
    startOver({ after: after.current, served: served.current, seen: seen.current })
    setRinging([])
  }, [connected])

  return { ringing, dismiss }
}
