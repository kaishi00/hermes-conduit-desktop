/**
 * What a gateway restart waits on, and Restart Now, after the phone's
 * GatewayWork.swift. Hermes' restart lets running work finish first, up to
 * agent.restart_after_turn_timeout (30 minutes by default), and a second
 * restart only joins the first, so "Letting running tasks finish…" says what
 * it waits on (GET /self/gateway-work, plugin 0.135+) and offers a way out:
 * the update stops waiting, Conduit stops the chats the plugin names
 * (session.interrupt, which a draining gateway still takes), and what still
 * runs a few seconds later the plugin ends with a restart through systemd.
 * Shared by the plugin update and Restart Gateway, as on the phone.
 */
import { useSyncExternalStore } from 'react'
import { locale, t } from '../../../shared/i18n'

export const GATEWAY_WORK = 'gateway-work'
export const GATEWAY_WORK_PATH = '/api/plugins/conduit_push/self/gateway-work'
export const RESTART_NOW_PATH = `${GATEWAY_WORK_PATH}/restart-now`
export const FORCE_RESTART_PATH = `${RESTART_NOW_PATH}?force=true`
/** How often the list is read while it shows. */
export const POLL_MS = 5_000

export interface WorkUnit {
  /** `chat`, `cron`, `managed`, `api` or `deferred`. */
  kind: string
  profile?: string
  bot?: string
  title?: string
  /** The chat's session, when Conduit can stop it. */
  sessionId?: string
  jobId?: string
  /** When it started (ms), from its running time when it was read. */
  startedAt?: number
}

export interface GatewayWork {
  units: WorkUnit[]
  /** How many the restart waits on: an older gateway names none. */
  count: number
  draining: boolean
  /** When the gateway restarts anyway (ms), while it drains. */
  restartsBy?: number
}

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const canStop = (unit: WorkUnit) => unit.kind === 'chat' && !!unit.sessionId

export function parseGatewayWork(raw: unknown, now = Date.now()): GatewayWork | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  if (!Array.isArray(o.units)) return null
  const units = o.units
    .filter((u): u is Row => !!u && typeof u === 'object')
    .map(u => {
      const elapsed = num(u.elapsed_s)
      return {
        kind: text(u.kind) ?? 'work',
        profile: text(u.profile),
        bot: text(u.bot),
        title: text(u.title),
        sessionId: text(u.session_id),
        jobId: text(u.job_id),
        startedAt: elapsed === undefined ? undefined : now - elapsed * 1000
      }
    })
  const restartsBy = num(o.restarts_by)
  return {
    units,
    count: Math.max(units.length, num(o.count) ?? 0),
    draining: o.draining === true,
    restartsBy: restartsBy === undefined ? undefined : restartsBy * 1000
  }
}

/** A running time in whole minutes, at least one: "5 min", "1 hr, 5 min". */
export function runningTime(ms: number): string {
  const minutes = Math.min(Math.max(Math.round(ms / 60_000), 1), 1_000_000)
  const parts = minutes >= 60 ? { hours: Math.floor(minutes / 60), minutes: minutes % 60 } : { minutes }
  const Format = (Intl as unknown as { DurationFormat?: new (locale?: string, options?: object) => { format(d: object): string } }).DurationFormat
  if (Format) {
    try {
      return new Format(locale(), { style: 'short' }).format(parts)
    } catch {
      // The plain form below.
    }
  }
  return 'hours' in parts ? `${parts.hours} hr, ${parts.minutes} min` : `${minutes} min`
}

/** One line per unit: whose chat and which, or the job, and how long it has run. */
export function workLines(work: GatewayWork, now = Date.now()): string[] {
  const lines = work.units.map(unit => {
    let name: string
    if (unit.kind === 'chat') {
      const bot = unit.bot ?? 'Hermes'
      name = unit.title ? t('{bot}: {title}', { bot, title: unit.title }) : t('{bot}: a chat', { bot })
    } else if (unit.kind === 'cron') {
      name = t('Scheduled job {name}', { name: unit.title ?? unit.jobId ?? '?' })
    } else {
      name = t('A background task')
    }
    if (unit.startedAt === undefined) return name
    return t('{name}, running {duration}', { name, duration: runningTime(now - unit.startedAt) })
  })
  if (!work.units.length && work.count > 0) lines.push(t("Hermes doesn't say what's running."))
  return lines
}

/**
 * Restart Now's steps, apart from the dashboard they go to (so a test can
 * script them): the update stops waiting, the chats the restart waits on are
 * stopped, and whatever still runs after a few reads is ended with a forced
 * restart. Each step answers why it failed, or null.
 */
export interface RestartNowSteps {
  endWait: () => Promise<string | null>
  /** What the restart waits on; null when the read failed. */
  readWork: () => Promise<GatewayWork | null>
  stop: (unit: WorkUnit) => Promise<void>
  force: () => Promise<string | null>
  pause: () => Promise<void>
  reads?: number
}

export async function restartNow(steps: RestartNowSteps): Promise<string | null> {
  const failure = await steps.endWait()
  if (failure) return failure
  const work = await steps.readWork()
  // All at once, so one chat that doesn't answer holds the rest up for its own timeout only. A chat
  // that won't stop is ended by the forced restart below.
  if (work) await Promise.all(work.units.filter(canStop).map(unit => steps.stop(unit).catch(() => undefined)))
  // Stopped chats end within a few seconds; an update still waiting sends its restart once the flag
  // lands. A read that fails proves nothing, so only an answer with no work skips the force.
  for (let i = 0; i < (steps.reads ?? 5); i++) {
    await steps.pause()
    const now = await steps.readWork()
    if (now && now.count === 0) return null
  }
  return steps.force()
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const code = (e: unknown) => (e as { code?: unknown })?.code

/** How Restart Now reaches the host: the active dashboard's own calls in the app. */
export interface RestartNowHost {
  http: (method: 'GET' | 'POST', path: string, timeoutMs?: number) => Promise<unknown>
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>
}

export async function readGatewayWork(http: RestartNowHost['http']): Promise<GatewayWork | null> {
  try {
    return parseGatewayWork(await http('GET', GATEWAY_WORK_PATH))
  } catch {
    return null
  }
}

/** Restart Now's steps against a dashboard. */
export function restartNowSteps(host: RestartNowHost, pauseMs = 2_000): RestartNowSteps {
  return {
    endWait: async () => {
      try {
        await host.http('POST', RESTART_NOW_PATH)
        return null
      } catch (e) {
        return message(e)
      }
    },
    readWork: () => readGatewayWork(host.http),
    stop: async unit => {
      if (!unit.sessionId) return
      await host.rpc('session.interrupt', { session_id: unit.sessionId, ...(unit.profile ? { profile: unit.profile } : {}) })
    },
    force: async () => {
      try {
        await host.http('POST', FORCE_RESTART_PATH, 40_000)
      } catch (e) {
        // The restart can take the dashboard down with the gateway before it answers, so a request
        // that went out and got no answer (no HTTP status) is how a forced restart looks. Anything
        // the dashboard answered is a failure.
        const status = code(e)
        if (status === 501)
          return t(
            'Conduit can only force a restart for a gateway that systemd runs. Run hermes gateway stop, then hermes gateway start, on the host.'
          )
        if (typeof status === 'number') return message(e)
      }
      return null
    },
    pause: () => new Promise(resolve => setTimeout(resolve, pauseMs))
  }
}

/** Restart Now's state: which dashboard runs it, and why the last one failed. */
interface RestartNowState {
  running: Set<string>
  failure: { host: string; message: string; at: number } | null
}
let state: RestartNowState = { running: new Set(), failure: null }
const listeners = new Set<() => void>()
function set(next: Partial<RestartNowState>) {
  state = { ...state, ...next }
  listeners.forEach(l => l())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A failure shows on the dashboard it came from, for 15 minutes or until the next Restart Now. */
export const FAILURE_SHOWS_MS = 15 * 60_000
export function failureFor(host: string, now = Date.now()): string | null {
  const failure = state.failure
  return failure && failure.host === host && now - failure.at < FAILURE_SHOWS_MS ? failure.message : null
}
export const restartingNow = (host: string) => state.running.has(host)

export function useRestartNow(host: string): { running: boolean; failure: string | null } {
  const shown = useSyncExternalStore(subscribe, () => state)
  return { running: shown.running.has(host), failure: failureFor(host) }
}

/**
 * Restart Now on `host`, the dashboard on screen. `hostNow` says which one is on screen now: a
 * failure from a run whose dashboard was switched away from stays with that run.
 */
export async function runRestartNow(
  host: string,
  connection: RestartNowHost | null,
  hostNow: () => string,
  hermesUpdating: boolean,
  steps: (connection: RestartNowHost) => RestartNowSteps = restartNowSteps
) {
  if (state.running.has(host)) return
  if (!connection) return set({ failure: { host, message: t('Connect to this dashboard first.'), at: Date.now() } })
  // Update Hermes restarts it at the end; a restart now would land mid-install and pass for the update's own.
  if (hermesUpdating) return set({ failure: { host, message: t('Wait for the Hermes update to finish.'), at: Date.now() } })
  set({ running: new Set([...state.running, host]), failure: state.failure?.host === host ? null : state.failure })
  let failure: string | null = null
  try {
    failure = await restartNow(steps(connection))
  } finally {
    const running = new Set(state.running)
    running.delete(host)
    set({ running, ...(failure && hostNow() === host ? { failure: { host, message: failure, at: Date.now() } } : {}) })
  }
}

/** Forgets Restart Now's state, for tests. */
export function resetRestartNow() {
  set({ running: new Set(), failure: null })
}
