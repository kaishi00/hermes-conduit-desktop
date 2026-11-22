/**
 * Conduit's own updates, from GitHub Releases (shared/updates.ts has the
 * rules). The state goes to every window as it changes; the tray offers
 * Restart to Update once one is downloaded. Install updates automatically
 * off still checks, and the download waits for Settings' Download button.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import { CHECK_EVERY_MS, FIRST_CHECK_MS, mayCheck, mayDownload, nextUpdateState, updatesOff, type UpdateEvent, type UpdateState } from '../shared/updates'

const file = () => join(app.getPath('userData'), 'updates.json')

function readAuto(): boolean {
  try {
    return (JSON.parse(readFileSync(file(), 'utf8')) as { auto?: unknown }).auto !== false
  } catch {
    return true
  }
}

let state: UpdateState = { current: '', off: null, auto: true, phase: 'idle' }
let listener: ((state: UpdateState) => void) | null = null
let timer: NodeJS.Timeout | null = null

function apply(event: UpdateEvent): void {
  state = nextUpdateState(state, event, Date.now())
  listener?.(state)
}

export function updateState(): UpdateState {
  return state
}

/** Starts the updater once the app is ready; `changed` hears every new state. */
export function startUpdates(changed: (state: UpdateState) => void): void {
  listener = changed
  const off = updatesOff({
    packaged: app.isPackaged,
    platform: process.platform,
    windowsStore: Boolean(process.windowsStore),
    appImage: Boolean(process.env.APPIMAGE)
  })
  state = { current: app.getVersion(), off, auto: readAuto(), phase: 'idle' }
  if (off) return
  autoUpdater.autoDownload = state.auto
  autoUpdater.autoInstallOnAppQuit = true
  // electron-updater's own log goes to the console, where a packaged app keeps nothing.
  autoUpdater.logger = null
  autoUpdater.on('checking-for-update', () => apply({ kind: 'checking' }))
  autoUpdater.on('update-not-available', () => apply({ kind: 'none' }))
  autoUpdater.on('update-available', info => apply({ kind: 'found', version: info.version }))
  autoUpdater.on('download-progress', progress => apply({ kind: 'progress', percent: progress.percent }))
  autoUpdater.on('update-downloaded', info => apply({ kind: 'downloaded', version: info.version }))
  // A failed check or download (offline, GitHub down) shows in Settings and is tried again at the next check or with Try Again.
  autoUpdater.on('error', () => apply({ kind: 'failed' }))
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

export async function checkForUpdates(): Promise<UpdateState> {
  // A downloaded update stays put until it's installed; a check under way isn't doubled.
  if (!mayCheck(state)) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    if (state.phase === 'checking') apply({ kind: 'failed' })
  }
  return state
}

/** Settings' Download button, when updates don't download by themselves, and Try Again after a failed download. */
export async function downloadUpdate(): Promise<void> {
  if (!mayDownload(state)) return
  apply({ kind: 'download' })
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    if (state.phase === 'downloading') apply({ kind: 'failed' })
  }
}

/**
 * Restart to Update: Conduit quits, the update installs and Conduit opens again.
 * `beforeQuit` runs first: on the Mac the updater closes every window before
 * the app hears before-quit, so a window that only hides on close has to know
 * the app is quitting already, or Conduit stays open and nothing installs.
 */
export function installUpdate(beforeQuit: () => void): void {
  if (state.phase !== 'ready') return
  if (timer) clearInterval(timer)
  beforeQuit()
  autoUpdater.quitAndInstall(false, true)
}

export function setAutoUpdate(auto: boolean): UpdateState {
  try {
    writeFileAtomic(file(), JSON.stringify({ auto }))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  autoUpdater.autoDownload = auto
  apply({ kind: 'auto', on: auto })
  if (auto && (state.phase === 'available' || state.phase === 'download-failed')) void downloadUpdate()
  return state
}
