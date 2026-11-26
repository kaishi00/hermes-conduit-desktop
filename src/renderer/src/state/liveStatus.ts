/**
 * Running and Needs approval on the chat list's rows, after the phone's
 * SessionLiveStatusIndex: the gateway's live registry (`session.active_list`)
 * says which chats run a turn ("working") and which wait on the user
 * ("waiting"), by their runtime and stored ids. "starting" and "idle" rows
 * aren't busy. It's read every 4 s while a chat runs, then 8, 15, 30 and 60 s
 * while nothing does, and only while the list is on screen.
 */
import { useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'

export type LiveState = 'working' | 'waiting'

export const POLL_STEPS_MS = [4_000, 8_000, 15_000, 30_000, 60_000]

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Every id a busy row goes by → its state; waiting outranks working when two rows share an id. */
export function liveStates(response: unknown, into = new Map<string, LiveState>()): Map<string, LiveState> {
  const rows = ((response ?? {}) as Raw).sessions
  if (!Array.isArray(rows)) return into
  for (const raw of rows) {
    const row = (raw ?? {}) as Raw
    const status = str(row.status)
    if (status !== 'working' && status !== 'waiting') continue
    for (const id of [str(row.id), str(row.session_key)]) {
      if (id && into.get(id) !== 'waiting') into.set(id, status)
    }
  }
  return into
}

/** The next wait: back to 4 s while a chat runs or the list moved, else one step longer. */
export const nextStep = (step: number, busy: boolean) => (busy ? 0 : Math.min(step + 1, POLL_STEPS_MS.length - 1))

const sameStates = (a: Map<string, LiveState>, b: Map<string, LiveState>) => a.size === b.size && [...a].every(([id, state]) => b.get(id) === state)

/**
 * The registry for `profiles` (the profile shown, or every profile the list
 * holds), one read each, while `active`. `nudge` changing (a turn ended,
 * the list moved) reads again at once at the fastest pace.
 */
export function useLiveStatus(active: boolean, profiles: readonly string[], nudge: unknown): Map<string, LiveState> {
  const [states, setStates] = useState<Map<string, LiveState>>(() => new Map())
  const profileKey = profiles.join('\n')
  const step = useRef(0)
  useEffect(() => {
    step.current = 0
  }, [nudge])
  useEffect(() => {
    if (!active) {
      setStates(current => (current.size ? new Map() : current))
      return
    }
    let live = true
    let timer: number | undefined
    const read = async () => {
      if (!document.hidden) {
        const next = new Map<string, LiveState>()
        const names = profileKey ? profileKey.split('\n') : ['']
        const answers = await Promise.all(
          names.map(name =>
            gateway.rpc('session.active_list', name && name !== 'default' ? { profile: name } : {}).then(
              r => r,
              () => null
            )
          )
        )
        if (!live) return
        for (const answer of answers) liveStates(answer, next)
        setStates(current => (sameStates(current, next) ? current : next))
        step.current = nextStep(step.current, [...next.values()].includes('working'))
      }
      timer = window.setTimeout(() => void read(), POLL_STEPS_MS[step.current])
    }
    void read()
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [active, profileKey, nudge])
  return states
}

/** The ids (runtime id and session key) of the chats an `session.active_list` answer has answering now (working, or streaming its reply). */
export function answeringIds(response: unknown): string[] {
  const rows = ((response ?? {}) as Raw).sessions
  if (!Array.isArray(rows)) return []
  return rows.flatMap(raw => {
    const row = (raw ?? {}) as Raw
    return ['working', 'streaming'].includes(str(row.status)) ? [str(row.id), str(row.session_key)].filter(Boolean) : []
  })
}

export const LIVE_STEPS_PATH = '/api/plugins/conduit_push/live-steps'
export const liveStepsPath = (profile: string) => (profile && profile !== 'default' ? `${LIVE_STEPS_PATH}?profile=${encodeURIComponent(profile)}` : LIVE_STEPS_PATH)

/** One running chat's step, as the plugin's GET /live-steps gives it (plugin 0.200+). */
export interface LiveStep {
  phase: string
  tool?: string | null
  since?: number | null
}

/** The newest step among `ids`' chats in a GET /live-steps answer, or null. */
export function stepOf(answer: unknown, ids: readonly string[]): LiveStep | null {
  const steps = ((answer ?? {}) as Raw).steps
  if (!steps || typeof steps !== 'object') return null
  let best: LiveStep | null = null
  for (const id of ids) {
    const raw = (steps as Raw)[id]
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Raw
    if (typeof entry.phase !== 'string') continue
    const step: LiveStep = { phase: entry.phase, tool: typeof entry.tool === 'string' ? entry.tool : null, since: typeof entry.since === 'number' ? entry.since : null }
    if (!best || (step.since ?? 0) > (best.since ?? 0)) best = step
  }
  return best
}

const sameSteps = (a: ReadonlyMap<string, string | null>, b: ReadonlyMap<string, string | null>) =>
  a.size === b.size && [...a].every(([name, step]) => b.has(name) && b.get(name) === step)

/**
 * The bots with a chat answering now, any chat, not only the one open (Eric, 2026-11-26), each with the
 * step it's on there as the plugin notes it ("Running a command"; null on a plugin without live steps):
 * the registry read for each of `profiles` at the list's pace, 4 s while one answers and slower as
 * nothing does, and the steps read for the bots answering.
 */
export function useAnsweringBots(
  active: boolean,
  profiles: readonly string[],
  nudge: unknown,
  title: (step: LiveStep) => string | null
): ReadonlyMap<string, string | null> {
  const [bots, setBots] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const profileKey = profiles.join('\n')
  const step = useRef(0)
  const titleRef = useRef(title)
  titleRef.current = title
  useEffect(() => {
    step.current = 0
  }, [nudge])
  useEffect(() => {
    if (!active || !profileKey) {
      setBots(current => (current.size ? new Map() : current))
      return
    }
    let live = true
    let timer: number | undefined
    const read = async () => {
      if (!document.hidden) {
        const all = profileKey.split('\n')
        const answers = await Promise.all(
          all.map(name => gateway.rpc('session.active_list', name !== 'default' ? { profile: name } : {}).then(r => r, () => null))
        )
        const busy = all.flatMap((name, i) => {
          const ids = answeringIds(answers[i])
          return ids.length ? [{ name, ids }] : []
        })
        const steps = await Promise.all(busy.map(({ name }) => gateway.http('GET', liveStepsPath(name)).then(r => r, () => null)))
        if (!live) return
        const next = new Map<string, string | null>()
        busy.forEach(({ name, ids }, i) => {
          const found = stepOf(steps[i], ids)
          next.set(name, found ? titleRef.current(found) : null)
        })
        setBots(current => (sameSteps(current, next) ? current : next))
        step.current = nextStep(step.current, next.size > 0)
      }
      timer = window.setTimeout(() => void read(), POLL_STEPS_MS[step.current])
    }
    void read()
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [active, profileKey, nudge])
  return bots
}
