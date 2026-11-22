/**
 * The Conduit plugin update the Settings page starts: its row's state, which
 * outlives the page, the run that hands the update to the host and follows its
 * job, and the guard that drops a row left from another dashboard (desktop#289).
 * The host is reached through an injected `http`, so tests can drive the run.
 */
import { t } from '../../../shared/i18n'
import { gateway } from '../gateway'
import {
  HOST_FOLLOW_LIMIT_MS,
  SELF_UPDATE_PATH,
  STATUS_PATH,
  outcomeAfterStall,
  selfUpdatePath,
  stallLimitMs,
  untilQuiet,
  jobState,
  pluginStatus,
  type PluginStatus,
  type UpdateState
} from './plugin'
import { dashboardHost } from './dashboardProfile'
import { forgetCapabilityAnswers } from './usePredictions'

/** How the run reaches the host: the gateway's own `http` in the app. */
export type UpdateHttp = (method: 'GET' | 'POST', path: string) => Promise<unknown>
const hostHttp: UpdateHttp = (method, path) => gateway.http(method, path)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const httpCode = (e: unknown) => (e as { code?: unknown })?.code

/** The update outlives the page: leaving Settings and coming back shows where it stands. */
let update: UpdateState = { phase: 'idle' }
let startedAt = 0
/** The update row as it stands, and when its run started. */
export const currentUpdate = () => update
export const updateStartedAt = () => startedAt
/** The dashboard the update ran on: a held scan's Update Anyway is only ever for it. */
let updateHost = ''
let running = false
const listeners = new Set<() => void>()
export const setUpdate = (next: UpdateState) => {
  update = next
  listeners.forEach(l => l())
}
export const subscribeUpdate = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function readStatus(http: UpdateHttp = hostHttp): Promise<PluginStatus> {
  try {
    return pluginStatus(await http('GET', STATUS_PATH))
  } catch (e) {
    return httpCode(e) === 404 ? { state: 'missing' } : { state: 'unknown' }
  }
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
/** How often the update's watchdog looks at it. */
const STALL_CHECK_MS = 15_000

/**
 * Hands the update to the host and follows its job, as the phone's runOnHost does. A run whose steps go
 * quiet past their limit (`stallLimitMs`) stops there and asks the host where the update stands, so the
 * row can't sit on a step for good (Eric, 2026-11-21: "Downloading the plugin…" with nothing on the host).
 */
export async function runUpdate(onDone: () => void, acceptScan = false, latest: string | null = null, http: UpdateHttp = hostHttp) {
  if (running) return
  running = true
  startedAt = Date.now()
  const runStarted = startedAt
  updateHost = dashboardHost()
  let live = true
  let jobId: string | null = null
  // The gateway follows the dashboard on screen: after a switch its answers are another host's, so the run stops there.
  const onHost = () => dashboardHost() === updateHost
  const following = () => live && onHost()
  const set = (next: UpdateState) => {
    if (following()) setUpdate(next)
  }
  set({ phase: 'updating', step: 'downloading' })
  try {
    await untilQuiet(
      heard =>
        follow(http, set, heard, acceptScan, following, id => {
          jobId = id
        }),
      () => stallLimitMs(update),
      STALL_CHECK_MS
    )
    if (live && !onHost()) {
      // Left on its host, which finishes it; the row is that dashboard's, and goes on another one's page.
      live = false
      setUpdate({ phase: 'runningOnHost' })
    } else if (live && update.phase === 'updating') {
      // Quiet past its limit: whatever it waited on can't land on the row any more, and its follow stops.
      live = false
      const job = ((await http('GET', SELF_UPDATE_PATH).catch(() => null)) as { job?: unknown } | null)?.job
      setUpdate(
        outcomeAfterStall(
          job,
          await readStatus(http),
          latest,
          { startedMs: runStarted, jobId },
          t("The update didn't get going on the host, so Conduit stopped waiting for it. Try again.")
        )
      )
    }
  } finally {
    live = false
    running = false
    // The plugin may now be another version, with other capabilities.
    forgetCapabilityAnswers()
    onDone()
  }
}

/**
 * Starts the host's job and follows it, reporting each step through `set`, each answer from the host
 * through `heard` and the job it follows through `onJob`. Stops once the run is no longer `live`.
 */
async function follow(
  http: UpdateHttp,
  set: (next: UpdateState) => void,
  heard: () => void,
  acceptScan: boolean,
  live: () => boolean,
  onJob: (id: string) => void
) {
  let job: Record<string, unknown> | null = null
  try {
    const started = (await http('POST', selfUpdatePath(acceptScan))) as { job?: Record<string, unknown> }
    job = started?.job ?? null
  } catch (e) {
    // No answer may still have started it: follow one that runs.
    const code = httpCode(e)
    if (code !== undefined && code !== 0) return set({ phase: 'failed', detail: message(e) })
    const probe = (await http('GET', SELF_UPDATE_PATH).catch(() => null)) as { job?: Record<string, unknown> } | null
    job = probe?.job ?? null
  }
  const id = job?.id
  if (!job || typeof id !== 'string') return set({ phase: 'failed', detail: null })
  onJob(id)
  heard()
  for (;;) {
    const state = jobState(job)
    if (state && state.phase !== 'updating') return set(state)
    set(state ?? update)
    if (Date.now() - startedAt > HOST_FOLLOW_LIMIT_MS) return set({ phase: 'runningOnHost' })
    await pause(2000)
    if (!live()) return
    // Reads fail while the dashboard restarts; the next poll asks again. Only an answer counts as word
    // from the host (even when the step is the same), so reads that keep failing let the watchdog end it.
    let latest: { job?: Record<string, unknown> } | null
    try {
      latest = (await http('GET', SELF_UPDATE_PATH)) as { job?: Record<string, unknown> }
    } catch {
      continue
    }
    heard()
    if (!latest?.job || latest.job.id !== id) {
      // The restarted dashboard lost the job: its report says where it stands.
      const status = await readStatus(http)
      return set(
        status.state === 'reported' && !status.restartNeeded
          ? { phase: 'updated', version: status.loadedVersion ?? status.version }
          : { phase: 'needsDashboardRestart', detail: null }
      )
    }
    job = latest.job
  }
}

/**
 * Run when the page opens: a row left from another dashboard goes, whatever it says, except a run
 * still going (desktop#289), which stops by itself once the dashboard changes. A held scan's Update Anyway on this dashboard goes once the host says
 * its job moved on; a read that fails leaves it as it was.
 */
export async function guardUpdateRow(host: string = dashboardHost(), http: UpdateHttp = hostHttp): Promise<void> {
  const held = update
  if (held.phase === 'idle' || (held.phase === 'updating' && running)) return
  if (updateHost !== host) return setUpdate({ phase: 'idle' })
  if (held.phase !== 'scanHeld') return
  try {
    const job = ((await http('GET', SELF_UPDATE_PATH)) as { job?: { id?: unknown } } | null)?.job
    // A held job without an id is still this hold while the host says its job is held.
    const stillHeld = held.id ? job?.id === held.id : jobState(job)?.phase === 'scanHeld'
    if (update === held && !stillHeld) setUpdate({ phase: 'idle' })
  } catch {
    // Left as it was.
  }
}
