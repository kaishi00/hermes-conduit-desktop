/**
 * Settings > Appearance > App icon, as on the phone: the dark icon or the light
 * one. The installer, the exe and the Start menu keep the dark icon they were
 * built with; what a running app can change follows the choice: each window's
 * icon (the taskbar button on Windows and Linux), the Mac's Dock icon, and the
 * tray icon (ConduitTray).
 */
import { BrowserWindow, app, nativeImage, type NativeImage } from 'electron'
import type { AppIconChoice } from '../shared/ipc'
import { trayIconPath } from './tray'

const mac = process.platform === 'darwin'
let current: AppIconChoice = 'dark'
let image: NativeImage | null = null

/** The packaged icon for a choice: the Mac's has the inset its Dock expects. */
export function appIconFile(choice: AppIconChoice, platform: string = process.platform): string {
  return platform === 'darwin' ? `app-icon-${choice}-mac.png` : `app-icon-${choice}.png`
}

function iconImage(): NativeImage {
  image ??= nativeImage.createFromPath(trayIconPath(appIconFile(current)))
  return image
}

/** Shows the choice wherever a running app can. */
export function applyAppIcon(choice: AppIconChoice): void {
  current = choice
  image = null
  if (mac) {
    // The dark icon is the app's own: setting it back puts the bundle's icon there.
    app.dock?.setIcon(iconImage())
    return
  }
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.setIcon(iconImage())
}

/**
 * Every window opened later (chats in their own window, Bot's Screen, quick ask) wears the choice too, the
 * dark one included: a window with a title bar shows it there, and one left without falls back to the
 * running exe's, Electron's own in a development build.
 */
export function watchNewWindows(): void {
  if (mac) return
  app.on('browser-window-created', (_event, window) => window.setIcon(iconImage()))
}
