/**
 * Crash and freeze reports (shared/deviceReports.ts): Electron's word when
 * the window, the GPU or a utility process stops, and the window not
 * responding, kept in the app's data folder until the user sends or
 * declines them. A freeze still on when Conduit was quit or killed is
 * found at the next launch. A window that crashed loads again, so its
 * card shows at once.
 */
import { app, net, type BrowserWindow } from 'electron'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countsAsCrash, kept, offered, processName, RELAY_REPORTS, reportBody, type DeviceReport } from '../shared/deviceReports'

const file = () => join(app.getPath('userData'), 'device-reports.json')
const freezeFile = () => join(app.getPath('userData'), 'freeze-under-way.json')

interface Stored {
  reports: DeviceReport[]
  /** A version whose posts found no relay route: it stops asking. */
  refusedVersion?: string
}

let listener: (() => void) | null = null

function read(): Stored {
  try {
    const stored = JSON.parse(readFileSync(file(), 'utf8')) as Stored
    return { reports: Array.isArray(stored.reports) ? stored.reports : [], refusedVersion: stored.refusedVersion }
  } catch {
    return { reports: [] }
  }
}

function write(stored: Stored) {
  try {
    writeFileSync(file(), JSON.stringify({ ...stored, reports: kept(stored.reports, Date.now()) }), { mode: 0o600 })
  } catch {
    // Not kept: nothing else depends on it.
  }
}

function systemName(): string {
  const version = process.getSystemVersion()
  return process.platform === 'darwin' ? `macOS ${version}` : process.platform === 'win32' ? `Windows ${version}` : `Linux ${version}`
}

function deviceName(): string {
  const kind = process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'Linux PC'
  return `${kind} ${process.arch}`
}

function record(report: Omit<DeviceReport, 'id' | 'at' | 'version' | 'os' | 'device' | 'state'> & { at?: number }) {
  const stored = read()
  const at = report.at ?? Date.now()
  stored.reports.push({
    ...report,
    id: `${at}-${Math.random().toString(16).slice(2, 10)}`,
    at,
    version: app.getVersion(),
    os: systemName(),
    device: deviceName(),
    state: 'new'
  })
  write(stored)
  listener?.()
}

/** The reports kept, and those Conduit still asks about. */
export function deviceReports(): { reports: DeviceReport[]; offered: DeviceReport[] } {
  const stored = read()
  const now = Date.now()
  return { reports: kept(stored.reports, now), offered: stored.refusedVersion === app.getVersion() ? [] : offered(stored.reports, now) }
}

/** Not now: never asked about again; Settings still has them. */
export function declineDeviceReports(ids: string[]) {
  const stored = read()
  stored.reports = stored.reports.map(r => (ids.includes(r.id) && r.state === 'new' ? { ...r, state: 'declined' as const } : r))
  write(stored)
  listener?.()
}

/** Posts each report to the relay; true when every one was kept. */
export async function sendDeviceReports(ids: string[]): Promise<boolean> {
  const stored = read()
  let ok = true
  for (const report of stored.reports.filter(r => ids.includes(r.id) && r.state !== 'sent')) {
    try {
      const response = await net.fetch(RELAY_REPORTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportBody(report))
      })
      if (response.status === 201 || response.ok) report.state = 'sent'
      else {
        ok = false
        // No route on the relay: this version stops asking; the next one tries again.
        if (response.status === 404) stored.refusedVersion = app.getVersion()
      }
    } catch {
      ok = false
    }
  }
  write(stored)
  listener?.()
  return ok
}

let lastReload = 0

/** Watches the app's processes and the window, and tells `onChange` when the reports change. */
export function watchDeviceReports(onChange: () => void) {
  listener = onChange
  // A freeze still under way when Conduit last stopped.
  try {
    const freeze = JSON.parse(readFileSync(freezeFile(), 'utf8')) as { at?: number }
    unlinkSync(freezeFile())
    if (typeof freeze.at === 'number') record({ kind: 'hang', at: freeze.at, process: 'window', reason: 'Conduit ended first' })
  } catch {
    // None.
  }
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('render-process-gone', (_event, contents, details) => {
    if (!countsAsCrash({ type: 'renderer', reason: details.reason, exitCode: details.exitCode }, quitting)) return
    record({ kind: 'crash', process: 'window', reason: details.reason, exitCode: details.exitCode })
    // The window loads again (not over and over), so the card shows.
    if (Date.now() - lastReload > 30_000 && !contents.isDestroyed()) {
      lastReload = Date.now()
      contents.reload()
    }
  })
  app.on('child-process-gone', (_event, details) => {
    if (!countsAsCrash({ type: details.type, reason: details.reason, exitCode: details.exitCode }, quitting)) return
    record({ kind: 'crash', process: processName(details.type, details.name ?? details.serviceName), reason: details.reason, exitCode: details.exitCode })
  })
}

/** The window not responding, and how long, as a freeze report. */
export function watchWindowFreezes(window: BrowserWindow) {
  let since: number | null = null
  window.on('unresponsive', () => {
    since = Date.now()
    try {
      writeFileSync(freezeFile(), JSON.stringify({ at: since }), { mode: 0o600 })
    } catch {
      // Then a freeze that ends the app isn't found next time.
    }
  })
  window.on('responsive', () => {
    if (since === null) return
    const at = since
    since = null
    try {
      unlinkSync(freezeFile())
    } catch {
      // Gone already.
    }
    record({ kind: 'hang', at, process: 'window', reason: 'responding again', durationMs: Date.now() - at })
  })
}
