import { webContents, type BrowserWindow, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import { isBackCommand } from './backCommand'

/**
 * A mouse's Back doesn't always reach the page as button 3 (desktop#755). On
 * Windows, Logi Options+ and other mouse software send it as the
 * browser-backward command; on a Mac, as a swipe back. Each goes to the page in
 * front as one Back press, which mouseBack.ts answers as it does the button.
 */
export function watchNavigateBack(window: BrowserWindow): void {
  const send = () => {
    const target = backTarget(window)
    if (target && !target.isDestroyed()) target.send(IPC.navigateBack)
  }
  window.on('app-command', (_event, command) => {
    if (isBackCommand('app-command', command)) send()
  })
  window.on('swipe', (_event, direction) => {
    if (isBackCommand('swipe', direction)) send()
  })
}

/** The page the press is for: a docked chat's frame when it has the focus, otherwise the window's own page. */
function backTarget(window: BrowserWindow): WebContents | null {
  if (window.isDestroyed()) return null
  const focused = webContents.getFocusedWebContents()
  if (focused && !focused.isDestroyed() && (focused === window.webContents || focused.hostWebContents === window.webContents)) return focused
  return window.webContents
}
