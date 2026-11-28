/**
 * The app icon's number (renderer state/appBadge, hermes-conduit issue
 * 3458): the Mac's Dock and Linux launchers take a count; Windows has no
 * badge, so the renderer's drawing of it goes over the main window's
 * taskbar button. The last one is kept for a window made later.
 */
import { app, nativeImage, type BrowserWindow } from 'electron'

let last: { count: number; image: string | null } = { count: 0, image: null }

/** A count from the renderer, as a whole number of at least 0. */
export const cleanCount = (count: unknown): number =>
  typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0

/** Only a PNG data URL is drawn. */
export const cleanImage = (image: unknown): string | null =>
  typeof image === 'string' && image.startsWith('data:image/png;base64,') ? image : null

export function setAppBadge(count: number, image: string | null, window: BrowserWindow | null): void {
  last = { count, image }
  if (process.platform === 'win32') {
    applyOverlay(window)
    return
  }
  app.setBadgeCount(count)
}

/** Puts the last number on a window's taskbar button (Windows). */
export function applyOverlay(window: BrowserWindow | null): void {
  if (process.platform !== 'win32' || !window || window.isDestroyed()) return
  const image = last.count > 0 && last.image ? nativeImage.createFromDataURL(last.image) : null
  window.setOverlayIcon(image && !image.isEmpty() ? image : null, last.count > 99 ? '99+' : last.count > 0 ? String(last.count) : '')
}
