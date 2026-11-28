/**
 * The Conduit plugin on the other combined dashboards, from Settings > Conduit plugin: each one's
 * version as its plugin reports it, and its update run, with no switch (Eric, 2026-11-28: "update
 * plugin to multiple dashboards instead of navigating out, change dashboard then going back").
 * A run is the same host-run update this dashboard's row follows (pluginUpdate.ts `follow`), sent
 * through the dashboard's kept connection; once that dashboard is the one on screen, through the
 * gateway. Rows outlive the page, as this dashboard's does.
 */
import { useSyncExternalStore } from 'react'
import { t } from '../../../shared/i18n'
import { gateway, keptGateway } from '../gateway'
import { SELF_UPDATE_PATH, outcomeAfterStall, stallLimitMs, untilQuiet, type PluginStatus, type UpdateState } from './plugin'
import { dashboardHost } from './dashboardProfile'
import { STALL_CHECK_MS, follow, readStatus, type UpdateHttp } from './pluginUpdate'
import { forgetCapabilityAnswers } from './usePredictions'

/** One other dashboard's row: what its plugin last said, and its update. */
export interface HostPluginRow {
  status: PluginStatus
  /** A status read under way. */
  checking: boolean
  update: UpdateState
  /** When its run started, for the row's elapsed time. */
  startedAt: number
}

const IDLE: HostPluginRow = { status: { state: 'unknown' }, checking: false, update: { phase: 'idle' }, startedAt: 0 }

let rows: ReadonlyMap<string, HostPluginRow> = new Map()
const running = new Set<string>()
const listeners = new Set<() => void>()

export const hostPluginRows = () => rows
export const hostPluginRow = (host: string): HostPluginRow => rows.get(host) ?? IDLE
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setRow(host: string, change: Partial<HostPluginRow>) {
  const next = new Map(rows)
  next.set(host, { ...hostPluginRow(host), ...change })
  rows = next
  listeners.forEach(l => l())
}

/** Every other dashboard's row, for the page. */
export function useHostPluginRows(): ReadonlyMap<string, HostPluginRow> {
  return useSyncExternalStore(subscribe, hostPluginRows)
}

/** Whether `host`'s update is running. */
export const hostUpdateRunning = (host: string) => running.has(host)

/**
 * `host`'s calls: through its kept connection, or through the gateway once it's the dashboard on
 * screen (a switch mid-run takes its connection up). Another dashboard takes only the update route
 * as a change (main's KEPT_WRITE_PATHS).
 */
export function hostUpdateHttp(host: string): UpdateHttp {
  return (method, path) => (dashboardHost() === host ? gateway.http(method, path) : keptGateway(host).http(method, path))
}

/** Reads what `host`'s plugin says now; a read that can't tell keeps what it said before. */
export async function readHostPlugin(host: string, http: UpdateHttp = hostUpdateHttp(host)): Promise<void> {
  setRow(host, { checking: true })
  const status = await readStatus(http)
  setRow(host, status.state === 'unknown' && hostPluginRow(host).status.state !== 'unknown' ? { checking: false } : { checking: false, status })
}

/** Takes a finished row away (its ×). A run still going keeps its row. */
export function dismissHostUpdate(host: string) {
  if (!running.has(host)) setRow(host, { update: { phase: 'idle' } })
}

/** Leaves the rows of dashboards no longer beside this one, except a run still going. */
export function forgetHostPluginRows(keep: readonly string[]) {
  const next = new Map([...rows].filter(([host]) => keep.includes(host) || running.has(host)))
  if (next.size === rows.size) return
  rows = next
  listeners.forEach(l => l())
}

/**
 * Hands `host`'s update to its host and follows the job, as this dashboard's run does (runUpdate):
 * a run whose steps go quiet past their limit stops and asks the host where the update stands.
 * `latest` is the version the update brings. Reads the plugin again when it ends.
 */
export async function runHostUpdate(host: string, acceptScan = false, latest: string | null = null, http: UpdateHttp = hostUpdateHttp(host)) {
  if (running.has(host)) return
  running.add(host)
  const started = Date.now()
  let live = true
  let jobId: string | null = null
  const current = () => hostPluginRow(host).update
  const set = (next: UpdateState) => {
    if (live) setRow(host, { update: next })
  }
  setRow(host, { update: { phase: 'updating', step: 'downloading' }, startedAt: started })
  try {
    await untilQuiet(
      heard =>
        follow(http, set, heard, acceptScan, () => live, id => (jobId = id), { current, startedAt: started }),
      () => stallLimitMs(current()),
      STALL_CHECK_MS
    )
    if (live && current().phase === 'updating') {
      // Quiet past its limit: whatever it waited on can't land on the row any more.
      live = false
      const job = ((await http('GET', SELF_UPDATE_PATH).catch(() => null)) as { job?: unknown } | null)?.job
      setRow(host, {
        update: outcomeAfterStall(
          job,
          await readStatus(http),
          latest,
          { startedMs: started, jobId },
          t("The update didn't get going on the host, so Conduit stopped waiting for it. Try again.")
        )
      })
    }
  } finally {
    live = false
    running.delete(host)
    // Its plugin may now be another version, with other capabilities: answers kept for it go too.
    forgetCapabilityAnswers()
    await readHostPlugin(host, http)
  }
}
