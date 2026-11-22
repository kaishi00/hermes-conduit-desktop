/**
 * Settings > Hermes, after the phone's Settings > Connection: Update Hermes
 * and Restart Gateway, which run on the host through the dashboard's own
 * actions. Update asks /api/hermes/update/check whether the host is behind,
 * runs `hermes update` (POST /api/hermes/update) and follows its log through
 * the restart that ends it. Restart asks POST /api/gateway/restart and
 * watches the gateway come back in that action's log and /api/status.
 * Each belongs to the host it started on, and outlives leaving Settings.
 */
import { useSyncExternalStore } from 'react'
import { GatewayError } from '../gateway'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)

export const CHECK_PATH = '/api/hermes/update/check'
export const UPDATE_PATH = '/api/hermes/update'
export const RESTART_PATH = '/api/gateway/restart'
export const RESTART_LOG_PATH = '/api/actions/gateway-restart/status?lines=20'
export const STATUS_PATH = '/api/status'
export const actionLogPath = (action: string) => `/api/actions/${encodeURIComponent(action)}/status?lines=40`

export interface UpdateCheck {
  installMethod: string
  currentVersion: string
  /** Commits behind: 0 is current, undefined when the check couldn't run. */
  behind?: number
  updateAvailable: boolean
  /** Whether the dashboard can update this install itself. */
  canApply: boolean
  updateCommand: string
  message: string
  sourceVersion: string
  /** Set when updating moves a newer build back to a release. */
  rollbackTo: string
  commits: { sha: string; summary: string }[]
}

export function parseUpdateCheck(raw: unknown): UpdateCheck | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  if (o.update_available === undefined && o.current_version === undefined) return null
  return {
    installMethod: str(o.install_method) || 'unknown',
    currentVersion: str(o.current_version),
    behind: int(o.behind),
    updateAvailable: o.update_available === true,
    canApply: o.can_apply === true,
    updateCommand: str(o.update_command),
    message: str(o.message),
    sourceVersion: str(o.source_version),
    rollbackTo: str(o.rollback_to),
    commits: (Array.isArray(o.commits) ? o.commits : [])
      .filter((r): r is Row => !!r && typeof r === 'object' && typeof (r as Row).sha === 'string')
      .map(r => ({ sha: r.sha as string, summary: str(r.summary) }))
  }
}

export const canUpdateHere = (check: UpdateCheck) => check.updateAvailable && check.canApply

export type UpdateStep = 'starting' | 'updating' | 'restarting'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; check: UpdateCheck }
  | { kind: 'updating'; step: UpdateStep; detail?: string }
  | { kind: 'updated'; version?: string }
  | { kind: 'failed'; detail?: string; back?: boolean }
  | { kind: 'checkFailed'; detail?: string }
  | { kind: 'manual'; message: string; command?: string }
  | { kind: 'notBackYet' }
  | { kind: 'unsupported' }

export type RestartStage = 'draining' | 'stopping' | 'starting'

export type RestartState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'restarting'; stage: RestartStage; detail?: string }
  | { kind: 'restarted'; sharedProfiles: string[] }
  | { kind: 'failed'; detail?: string }
  | { kind: 'failedToStart' }
  | { kind: 'notBackYet' }
  | { kind: 'unsupported' }

export const updateInProgress = (s: UpdateState) => s.kind === 'checking' || s.kind === 'updating'
export const restartInProgress = (s: RestartState) => s.kind === 'requesting' || s.kind === 'restarting'

/** An action's log: `/api/actions/<name>/status`. */
export interface ActionStatus {
  running: boolean
  exitCode?: number
  lines: string[]
}

export function parseActionStatus(raw: unknown): ActionStatus | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  if (typeof o.running !== 'boolean') return null
  return { running: o.running, exitCode: int(o.exit_code), lines: (Array.isArray(o.lines) ? o.lines : []).map(String) }
}

/** The newest log line worth showing, skipping blanks and the dashboard's `=== … ===` banners. */
export function latestLine(status: ActionStatus | null): string | undefined {
  for (const line of [...(status?.lines ?? [])].reverse()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('===')) continue
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed
  }
  return undefined
}

export type UpdateVerdict = 'running' | 'succeeded' | 'failed' | 'unknown'

/** Exit 0, Hermes' completion line for this action, or this action's receipt mean the update is done. */
export function updateVerdict(status: ActionStatus, receipt: unknown, actionId?: string): UpdateVerdict {
  if (status.running) return 'running'
  if (actionId && status.lines.includes(`=== hermes-update completed ${actionId} ===`)) return 'succeeded'
  const r = receipt && typeof receipt === 'object' ? (receipt as Row) : null
  // Only this action's receipt: without an id, an older update's could settle this one.
  if (r && actionId && r.action_id === actionId) {
    if (r.outcome === 'success' || r.outcome === 'partial') return 'succeeded'
    if (r.outcome === 'failed') return 'failed'
  }
  if (status.exitCode === undefined) return 'unknown'
  return status.exitCode === 0 ? 'succeeded' : 'failed'
}

/** The gateway fields of `/api/status` a restart watches. */
export interface GatewayStatus {
  running: boolean
  state?: string
  pid?: number
  sharedProfiles: string[]
}

export function parseGatewayStatus(raw: unknown): GatewayStatus | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  if (typeof o.gateway_running !== 'boolean') return null
  return {
    running: o.gateway_running,
    state: str(o.gateway_state) || undefined,
    pid: int(o.gateway_pid),
    sharedProfiles: sharedProfiles(o.gateway_shared_with)
  }
}

/** `gateway_shared_with` as Hermes shows it: unique names, default first, the rest sorted; empty unless two or more. */
export function sharedProfiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names = [...new Set(value.map(v => String(v).trim()).filter(Boolean))]
  if (names.length < 2) return []
  return names.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b, undefined, { numeric: true })))
}

/** Up and serving: running, and neither starting, failed, stopped nor draining. */
export function isServing(gateway: GatewayStatus): boolean {
  if (!gateway.running) return false
  return !['starting', 'stopped', 'startup_failed', 'draining'].includes((gateway.state ?? '').toLowerCase())
}

export type RestartVerdict =
  | { kind: 'waiting'; stage: RestartStage }
  | { kind: 'back'; gateway: GatewayStatus }
  | { kind: 'failed'; detail?: string }
  | { kind: 'failedToStart' }
  | { kind: 'notBackYet' }

/**
 * Decides, poll by poll, whether a restarted gateway is back, as the phone
 * does: the restart child exiting 0, the gateway going down or a new PID,
 * or 30 s with the gateway serving, then serving in /api/status.
 */
export class RestartMonitor {
  static readonly runningChildGrace = 30
  static readonly comeBackWindow = 90
  static readonly watchLimit = 600
  private sawDown = false
  private childFinishedAt?: number

  constructor(private readonly before: GatewayStatus | null) {}

  observe(action: ActionStatus | null, gateway: GatewayStatus | null, elapsed: number): RestartVerdict {
    if (action && !action.running && action.exitCode !== undefined) {
      if (action.exitCode !== 0) return { kind: 'failed', detail: latestLine(action) }
      if (this.childFinishedAt === undefined) this.childFinishedAt = elapsed
    }
    if (this.before?.running === false || gateway?.running === false) this.sawDown = true
    if (gateway && isServing(gateway)) {
      const newProcess = this.before?.pid !== undefined && gateway.pid !== undefined && this.before.pid !== gateway.pid
      if (this.childFinishedAt !== undefined || this.sawDown || newProcess || elapsed >= RestartMonitor.runningChildGrace) return { kind: 'back', gateway }
    }
    const outOfTime =
      elapsed >= RestartMonitor.watchLimit || (this.childFinishedAt !== undefined && elapsed - this.childFinishedAt >= RestartMonitor.comeBackWindow)
    if (outOfTime) return gateway?.state?.toLowerCase() === 'startup_failed' ? { kind: 'failedToStart' } : { kind: 'notBackYet' }
    if (this.sawDown || this.childFinishedAt !== undefined) return { kind: 'waiting', stage: 'starting' }
    return { kind: 'waiting', stage: gateway?.state?.toLowerCase() === 'draining' ? 'draining' : 'stopping' }
  }
}

const unsupportedCode = (e: unknown) => e instanceof GatewayError && (e.code === 404 || e.code === 405 || e.code === 501)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface Runner {
  request: (method: 'GET' | 'POST', path: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** False once the run should stop: the host changed or the window let go. */
  live: () => boolean
  pollMs?: number
}

export async function checkUpdate(run: Runner, force: boolean): Promise<UpdateState> {
  try {
    const check = parseUpdateCheck(await run.request('GET', CHECK_PATH + (force ? '?force=true' : '')))
    return check ? { kind: 'checked', check } : { kind: 'checkFailed' }
  } catch (e) {
    return unsupportedCode(e) ? { kind: 'unsupported' } : { kind: 'checkFailed', detail: message(e) }
  }
}

/** Hermes Desktop's limits: an update may take minutes, and the restart after it a few more. */
export const UPDATE_LIMIT = 360_000
export const COME_BACK_LIMIT = 240_000

export async function runUpdate(run: Runner, progress: (s: UpdateState) => void, fallback: string): Promise<UpdateState> {
  progress({ kind: 'updating', step: 'starting' })
  let started: Row
  try {
    started = ((await run.request('POST', UPDATE_PATH)) ?? {}) as Row
  } catch (e) {
    return unsupportedCode(e) ? { kind: 'unsupported' } : { kind: 'failed', detail: message(e) }
  }
  if (started.ok === false) return { kind: 'manual', message: str(started.message) || fallback, command: str(started.update_command) || undefined }
  const action = str(started.name) || 'hermes-update'
  const actionId = str(started.action_id) || undefined
  let deadline = run.now() + UPDATE_LIMIT
  let restarting = false
  let line: string | undefined
  const quiet = (): UpdateState | null => {
    if (!restarting) {
      restarting = true
      deadline = Math.max(deadline, run.now() + COME_BACK_LIMIT)
    }
    if (run.now() >= deadline) return { kind: 'notBackYet' }
    progress({ kind: 'updating', step: 'restarting', detail: line })
    return null
  }
  progress({ kind: 'updating', step: 'updating' })
  for (;;) {
    await run.sleep(run.pollMs ?? 1500)
    if (!run.live()) return { kind: 'idle' }
    let answer: Row
    try {
      answer = ((await run.request('GET', actionLogPath(action))) ?? {}) as Row
    } catch {
      // The dashboard restarting on the new version answers nothing for a while.
      const end = quiet()
      if (end) return end
      continue
    }
    const status = parseActionStatus(answer) ?? { running: false, lines: [] }
    line = latestLine(status) ?? line
    switch (updateVerdict(status, answer.receipt, actionId)) {
      case 'running':
        restarting = false
        if (run.now() >= deadline) return { kind: 'notBackYet' }
        progress({ kind: 'updating', step: 'updating', detail: line })
        break
      case 'succeeded': {
        const after = await checkUpdate(run, true)
        return { kind: 'updated', version: after.kind === 'checked' && after.check.currentVersion ? after.check.currentVersion : undefined }
      }
      case 'failed':
        return { kind: 'failed', detail: line }
      default: {
        // Not running and no exit code: a dashboard that restarted forgot the action.
        const end = quiet()
        if (end) return end
      }
    }
  }
}

export async function runRestart(run: Runner, progress: (s: RestartState) => void): Promise<RestartState> {
  progress({ kind: 'requesting' })
  const gatewayStatus = async () => {
    try {
      return parseGatewayStatus(await run.request('GET', STATUS_PATH))
    } catch {
      return null
    }
  }
  const before = await gatewayStatus()
  try {
    await run.request('POST', RESTART_PATH)
  } catch (e) {
    return unsupportedCode(e) ? { kind: 'unsupported' } : { kind: 'failed', detail: message(e) }
  }
  const started = run.now()
  const monitor = new RestartMonitor(before)
  let logAvailable = true
  let line: string | undefined
  progress({ kind: 'restarting', stage: 'stopping' })
  for (;;) {
    await run.sleep(run.pollMs ?? 1500)
    if (!run.live()) return { kind: 'idle' }
    let action: ActionStatus | null = null
    if (logAvailable) {
      try {
        action = parseActionStatus(await run.request('GET', RESTART_LOG_PATH))
      } catch (e) {
        // A Hermes without the action log still restarts: watch /api/status alone.
        if (e instanceof GatewayError && e.code === 404) logAvailable = false
      }
    }
    const gateway = await gatewayStatus()
    if (!run.live()) return { kind: 'idle' }
    line = latestLine(action) ?? line
    const verdict = monitor.observe(action, gateway, (run.now() - started) / 1000)
    switch (verdict.kind) {
      case 'waiting':
        progress({ kind: 'restarting', stage: verdict.stage, detail: line })
        break
      case 'back':
        return { kind: 'restarted', sharedProfiles: verdict.gateway.sharedProfiles }
      default:
        return verdict
    }
  }
}

/**
 * What the connection banner says while Hermes is away because of an update
 * started here, in place of a bare "reconnecting": the update's step, or
 * that it didn't come back (the update may have stopped, and Hermes may need
 * starting on the host). Null for anything else.
 */
export function updateBanner(update: UpdateState): 'updating' | 'restarting' | 'notBack' | 'failed' | null {
  if (update.kind === 'updating') return update.step === 'restarting' ? 'restarting' : 'updating'
  if (update.kind === 'notBackYet') return 'notBack'
  // Once Hermes has been reachable since, a later disconnection isn't the update's.
  if (update.kind === 'failed' && !update.back) return 'failed'
  return null
}

/** The window's one update and one restart, for the host they started on. */
interface HostActions {
  host: string
  update: UpdateState
  restart: RestartState
  /** The host's version from its last check or update, kept when a dismissed row clears the check. */
  version?: string
}

let current: HostActions = { host: '', update: { kind: 'idle' }, restart: { kind: 'idle' } }
const listeners = new Set<() => void>()
let runs = 0

function set(next: Partial<HostActions>) {
  current = { ...current, ...next }
  const update = next.update
  if (update?.kind === 'checked' && update.check.currentVersion) current.version = update.check.currentVersion
  else if (update?.kind === 'updated') current.version = update.version
  for (const listener of listeners) listener()
}

/** The actions for `host`: another host's never show here. */
export function useHostActions(host: string): HostActions {
  const shown = useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
  return shown.host === host ? shown : { host, update: { kind: 'idle' }, restart: { kind: 'idle' } }
}

/** The window's actions as they stand, for tests. */
export const hostActionsNow = (): HostActions => current

/** Whether an update, check or restart is running on `host`: only one runs at a time. */
export const hostBusy = (host: string) => current.host === host && (updateInProgress(current.update) || restartInProgress(current.restart))

/** Whether Update Hermes is running on `host`: Restart Now waits for it. */
export const hermesUpdateRunning = (host: string) => current.host === host && current.update.kind === 'updating'

function runner(host: string, request: Runner['request']): Runner {
  const id = ++runs
  return {
    request,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    live: () => runs === id && current.host === host
  }
}

function claim(host: string) {
  if (current.host !== host) current = { host, update: { kind: 'idle' }, restart: { kind: 'idle' } }
}

export async function startCheck(host: string, request: Runner['request'], force: boolean) {
  if (hostBusy(host)) return
  claim(host)
  const run = runner(host, request)
  set({ update: { kind: 'checking' } })
  const outcome = await checkUpdate(run, force)
  if (run.live()) set({ update: outcome })
}

export async function startUpdate(host: string, request: Runner['request'], fallback: string, onUpdated: () => void) {
  if (hostBusy(host)) return
  claim(host)
  const run = runner(host, request)
  const outcome = await runUpdate(run, state => run.live() && set({ update: state }), fallback)
  if (!run.live()) return
  set({ update: outcome })
  if (outcome.kind === 'updated') onUpdated()
}

export async function startRestart(host: string, request: Runner['request']) {
  if (hostBusy(host)) return
  claim(host)
  const run = runner(host, request)
  const outcome = await runRestart(run, state => run.live() && set({ restart: state }))
  if (run.live()) set({ restart: outcome })
}

/**
 * Hermes is reachable on `host`: an update that wasn't back yet is, so its row
 * clears, and a failed one stays in Settings but no longer speaks for the
 * connection banner.
 */
export function hostReachable(host: string) {
  if (current.host !== host) return
  if (current.update.kind === 'notBackYet') set({ update: { kind: 'idle' } })
  else if (current.update.kind === 'failed' && !current.update.back) set({ update: { ...current.update, back: true } })
}

/** Clears a finished update's outcome. */
export function dismissUpdate(host: string) {
  if (current.host === host && !updateInProgress(current.update)) set({ update: { kind: 'idle' } })
}

/** Clears a finished restart's outcome. */
export function dismissRestart(host: string) {
  if (current.host === host && !restartInProgress(current.restart)) set({ restart: { kind: 'idle' } })
}
