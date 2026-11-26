/**
 * Crash and freeze reports, after the phone's (MetricKit's card over the
 * main screen and Settings > Diagnostics & logs > Device reports). A
 * computer has no MetricKit, so a report is what Electron says when part of
 * Conduit stops: which process, why and its exit code, or how long the
 * window stopped responding, with the version, the system and the
 * processor. Never a chat, a path or anything typed. Conduit asks once
 * whether to send it, and Send posts it to Conduit's relay, in the shape
 * the relay takes from the phone (notifier relay/src/crash-reports.mjs).
 */

export type DeviceReportKind = 'crash' | 'hang'

export interface DeviceReport {
  id: string
  kind: DeviceReportKind
  /** When it happened, in ms since the epoch. */
  at: number
  /** The part of Conduit that stopped: the window, the GPU, a utility's name. */
  process: string
  /** Electron's reason (crashed, oom, killed…), or how a freeze ended. */
  reason: string
  exitCode?: number
  /** How long the window didn't respond. */
  durationMs?: number
  version: string
  os: string
  device: string
  /** new: not asked about yet; declined: Not now; sent: the relay kept it. */
  state: 'new' | 'declined' | 'sent'
}

export const RELAY_REPORTS = 'https://push.milim.dev/v1/crash-reports'
/** Only a report from the last 7 days is offered, the newest 5 at most, as on the phone. */
export const OFFER_DAYS = 7
export const OFFER_MAX = 5
/** Settings keeps the newest 20 from the last 30 days. */
export const KEEP_DAYS = 30
export const KEEP_MAX = 20

const DAY = 86_400_000
/** What the relay takes in a field: letters, digits, spaces and ()._,:+- up to 64. */
export const fieldText = (value: string) =>
  value
    .replace(/[^\p{L}\p{N} ()._,:+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'unknown'

/** Reports Conduit still asks about: new, recent, the newest few. */
export function offered(reports: DeviceReport[], now: number): DeviceReport[] {
  return reports
    .filter(r => r.state === 'new' && now - r.at <= OFFER_DAYS * DAY)
    .sort((a, b) => b.at - a.at)
    .slice(0, OFFER_MAX)
}

/** What's kept on the computer: the newest from the last 30 days. */
export function kept(reports: DeviceReport[], now: number): DeviceReport[] {
  return reports
    .filter(r => now - r.at <= KEEP_DAYS * DAY)
    .sort((a, b) => b.at - a.at)
    .slice(0, KEEP_MAX)
}

/** The part of Conduit, by Electron's process type and name. */
export function processName(type: string, name?: string): string {
  if (type === 'renderer') return 'window'
  if (type === 'GPU') return 'GPU'
  return fieldText(name || type)
}

/**
 * Whether a process that ended is a crash worth asking about. Not when it
 * exited cleanly or Conduit was quitting (the quit ends every process); not
 * a GPU process that couldn't start, after which Chromium draws without the
 * GPU and the window works; and not a helper process stopped with SIGTERM (exit 15),
 * which the system or the user sends to end Conduit. Those made most of
 * the desktop reports on the relay (Linux, 1.0.0 to 1.0.2), five or more to
 * a launch, none of them a crash the user saw.
 */
export function countsAsCrash(end: { type: string; reason: string; exitCode: number }, quitting: boolean): boolean {
  if (end.reason === 'clean-exit' || quitting) return false
  if (end.type === 'GPU' && end.reason === 'launch-failed') return false
  // Not the window's: a window lost that way still reloads and is reported.
  if (end.type !== 'renderer' && end.reason === 'killed' && end.exitCode === 15) return false
  return true
}

/** How it ended, in a few words: Electron's reason and the exit code. */
export function endLine(report: DeviceReport): string {
  if (report.kind === 'hang')
    return report.durationMs !== undefined
      ? `${report.process} not responding for ${(report.durationMs / 1000).toFixed(1)} s, ${report.reason}`
      : `${report.process} not responding, ${report.reason}`
  return `${report.process} ${report.reason}${report.exitCode !== undefined ? `, exit ${report.exitCode}` : ''}`
}

/** The relay's report body: the phone's fields, and one MetricKit-shaped crash or hang with no stacks. */
export function reportBody(report: DeviceReport) {
  const at = new Date(report.at).toISOString()
  const meta: Record<string, string> = {
    appVersion: fieldText(report.version),
    appBuildVersion: fieldText(report.version),
    osVersion: fieldText(report.os),
    deviceType: fieldText(report.device),
    bundleIdentifier: 'dev.conduit.desktop',
    terminationReason: fieldText(endLine(report))
  }
  if (report.kind === 'hang' && report.durationMs !== undefined) meta.hangDuration = `${(report.durationMs / 1000).toFixed(1)} sec`
  const diagnostic = { diagnosticMetaData: meta, callStackTree: { callStackPerThread: false, callStacks: [] } }
  return {
    app_version: fieldText(report.version),
    build: fieldText(`desktop ${report.version}`),
    os: fieldText(report.os),
    device: fieldText(report.device),
    kind: report.kind,
    diagnostic: {
      timeStampBegin: at,
      timeStampEnd: at,
      crashDiagnostics: report.kind === 'crash' ? [diagnostic] : [],
      hangDiagnostics: report.kind === 'hang' ? [diagnostic] : []
    }
  }
}
