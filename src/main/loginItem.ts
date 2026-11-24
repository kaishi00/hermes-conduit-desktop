import { app, shell } from 'electron'
import type { LoginItemState } from '../shared/ipc'

/**
 * Open at sign-in (issue 442): Conduit lives in the tray and tells of a
 * question, a finished turn or a call only while it runs, so a switch has
 * the computer start it at sign-in, in the tray with no window.
 *
 * - The Windows installer and the Mac: the system's own startup list
 *   (the Run key; Login Items), read back each time, so a change made in
 *   Task Manager or System Settings shows.
 * - The Microsoft Store's copy: its package declares a startup task
 *   (build/appx-extensions.xml), off until its owner turns it on in
 *   Windows' Startup apps. A packaged app's Run entry isn't read, and
 *   only Windows' own API turns the task on, so the setting opens that page.
 * - A run from source and Linux: no switch (nothing is registered for a
 *   checkout; Linux has no startup list of its own).
 */

/** What the Windows startup entry passes, so that start shows no window. */
export const HIDDEN_ARG = '--hidden'

export interface LoginItemHost {
  platform: NodeJS.Platform
  packaged: boolean
  windowsStore: boolean
}

/** How this copy opens at sign-in: its own switch, Windows' Startup apps, or not at all. */
export function loginItemKind(host: LoginItemHost): LoginItemState['kind'] {
  if (!host.packaged) return 'none'
  if (host.platform === 'win32') return host.windowsStore ? 'system' : 'switch'
  return host.platform === 'darwin' ? 'switch' : 'none'
}

/** Whether this start is the sign-in's: the Windows entry's argument; the Mac says so itself. */
export function startedAtLogin(argv: readonly string[], platform: NodeJS.Platform, macOpenedAtLogin: () => boolean): boolean {
  if (platform === 'win32') return argv.includes(HIDDEN_ARG)
  if (platform !== 'darwin') return false
  try {
    return macOpenedAtLogin()
  } catch {
    return false
  }
}

const host = (): LoginItemHost => ({ platform: process.platform, packaged: app.isPackaged, windowsStore: Boolean(process.windowsStore) })
const entry = () => (process.platform === 'win32' ? { args: [HIDDEN_ARG] } : {})

export function loginItemState(): LoginItemState {
  const kind = loginItemKind(host())
  if (kind !== 'switch') return { kind, on: false }
  try {
    const settings = app.getLoginItemSettings(entry())
    // Windows: listed, and not turned off in Task Manager's Startup apps.
    const on = process.platform === 'win32' ? settings.openAtLogin && settings.executableWillLaunchAtLogin !== false : settings.openAtLogin
    return { kind, on }
  } catch {
    return { kind, on: false }
  }
}

export function setLoginItem(on: boolean): LoginItemState {
  if (loginItemKind(host()) === 'switch') {
    try {
      app.setLoginItemSettings({ openAtLogin: on, ...entry(), ...(process.platform === 'win32' ? { enabled: on } : {}) })
    } catch {
      // The system refused: the state read back says so.
    }
  }
  return loginItemState()
}

/** Windows' Startup apps page, where the Store's copy is turned on. */
export function openStartupSettings(): void {
  if (process.platform === 'win32') void shell.openExternal('ms-settings:startupapps')
}

/** Whether this launch came from the sign-in, so no window shows. */
export function launchedAtLogin(): boolean {
  return app.isPackaged && startedAtLogin(process.argv, process.platform, () => app.getLoginItemSettings().wasOpenedAtLogin === true)
}
