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
import { CHECK_EVERY_MS, FIRST_CHECK_MS, updatesOff, type UpdateState } from '../shared/updates'

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

function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
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
  autoUpdater.on('checking-for-update', () => set({ phase: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ phase: 'none', version: undefined, percent: undefined, checkedAt: Date.now() }))
  autoUpdater.on('update-available', info => set({ phase: state.auto ? 'downloading' : 'available', version: info.version, percent: 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', progress => set({ phase: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', info => set({ phase: 'ready', version: info.version, percent: 100 }))
  // A failed check or download (offline, GitHub down) shows in Settings and is tried again at the next check.
  autoUpdater.on('error', () => set({ phase: 'error', checkedAt: Date.now() }))
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

export async function checkForUpdates(): Promise<UpdateState> {
  // A downloaded update stays put until it's installed; a check under way isn't doubled.
  if (state.off || state.phase === 'ready' || state.phase === 'checking' || state.phase === 'downloading') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    set({ phase: 'error', checkedAt: Date.now() })
  }
  return state
}

/** Settings' Download button, when updates don't download by themselves. */
export async function downloadUpdate(): Promise<void> {
  if (state.off || state.phase !== 'available') return
  set({ phase: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    set({ phase: 'error' })
  }
}

/** Restart to Update: Conduit quits, the update installs and Conduit opens again. */
export function installUpdate(): void {
  if (state.phase !== 'ready') return
  if (timer) clearInterval(timer)
  autoUpdater.quitAndInstall(false, true)
}

export function setAutoUpdate(auto: boolean): UpdateState {
  try {
    writeFileAtomic(file(), JSON.stringify({ auto }))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  autoUpdater.autoDownload = auto
  set({ auto })
  if (auto && state.phase === 'available') void downloadUpdate()
  return state
}
