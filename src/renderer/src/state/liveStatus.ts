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

/** Whether an `session.active_list` answer has a chat answering now (working, or streaming its reply). */
export function anyAnswering(response: unknown): boolean {
  const rows = ((response ?? {}) as Raw).sessions
  return Array.isArray(rows) && rows.some(raw => ['working', 'streaming'].includes(str(((raw ?? {}) as Raw).status)))
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(name => b.has(name))

/**
 * The bots with a chat answering now, any chat, not only the one open (Eric, 2026-11-26): the registry
 * read for each of `profiles` at the list's pace, 4 s while one answers and slower as nothing does.
 */
export function useAnsweringProfiles(active: boolean, profiles: readonly string[], nudge: unknown): ReadonlySet<string> {
  const [names, setNames] = useState<ReadonlySet<string>>(() => new Set())
  const profileKey = profiles.join('\n')
  const step = useRef(0)
  useEffect(() => {
    step.current = 0
  }, [nudge])
  useEffect(() => {
    if (!active || !profileKey) {
      setNames(current => (current.size ? new Set() : current))
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
        if (!live) return
        const next = new Set(all.filter((_, i) => anyAnswering(answers[i])))
        setNames(current => (sameSet(current, next) ? current : next))
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
  return names
}
