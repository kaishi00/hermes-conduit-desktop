/**
 * Quick ask: Alt+Space (Option+Space on the Mac) from anywhere opens a small
 * window over everything to ask Hermes one thing. It hides again on Esc or
 * when it loses focus; the chat it started opens in the main window on
 * request. Settings > Quick Ask picks other keys, or none.
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'
import { confineNavigation } from './navigation'

const WIDTH = 680
/** Just the field, so nothing invisible sits over other apps; a reply grows it. */
const FIELD_HEIGHT = 128
const HEIGHT = 460

/** The window height for a reply (true), the field (false), or the field and its staged files (px). */
export function quickAskHeight(expanded: boolean | number): number {
  if (typeof expanded === 'boolean') return expanded ? HEIGHT : FIELD_HEIGHT
  if (!Number.isFinite(expanded)) return FIELD_HEIGHT
  return Math.min(HEIGHT, Math.max(FIELD_HEIGHT, Math.ceil(expanded)))
}

export class QuickAsk {
  private window: BrowserWindow | null = null
  private height = FIELD_HEIGHT
  /** The keys picked, null when the shortcut is off. */
  accelerator: string | null = null
  /** Whether the system let Conduit have them: another app may hold them. */
  registered = false

  register(accelerator: string | null): boolean {
    this.unregister()
    this.accelerator = accelerator
    if (!accelerator) return true
    try {
      this.registered = globalShortcut.register(accelerator, () => this.toggle())
    } catch {
      this.registered = false
    }
    return this.registered
  }

  /** Other keys from Settings: when the system refuses them, the ones before stay. */
  change(accelerator: string | null): boolean {
    const before = this.accelerator
    if (accelerator === before && (this.registered || !accelerator)) return true
    if (this.register(accelerator)) return true
    this.register(before)
    return false
  }

  /** While Settings listens for new keys, the ones held now are let go, so pressing them picks them instead of opening the window. */
  suspend(): void {
    this.unregister()
  }

  resume(): void {
    if (!this.registered) this.register(this.accelerator)
  }

  unregister(): void {
    if (this.registered && this.accelerator) globalShortcut.unregister(this.accelerator)
    this.registered = false
  }

  toggle(): void {
    const window = this.ensure()
    if (window.isVisible() && window.isFocused()) {
      window.hide()
      return
    }
    this.place(window)
    window.show()
    window.focus()
    window.webContents.send(IPC.quickAskShown)
  }

  /**
   * The full height for a reply, the field's alone, or (a number) what the
   * field needs with its staged files, so no empty space sits above them.
   */
  setExpanded(expanded: boolean | number): void {
    const window = this.window
    const height = quickAskHeight(expanded)
    if (!window || window.isDestroyed() || height === this.height) return
    this.height = height
    const bounds = window.getBounds()
    // Grow upward from where the field sits, so the field doesn't jump.
    window.setBounds({ ...bounds, y: bounds.y + bounds.height - height, height })
  }

  hide(): void {
    this.window?.hide()
  }

  /** Whether this is Quick Ask's own window, which floats without the Dock icon (dockPresence.ts). */
  owns(window: BrowserWindow): boolean {
    return window === this.window
  }

  destroy(): void {
    this.window?.destroy()
    this.window = null
  }

  /** On the display the pointer is on, a third of the way down. */
  private place(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const height = this.height
    window.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height / 4 + HEIGHT - height),
      width: WIDTH,
      height
    })
  }

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      width: WIDTH,
      height: FIELD_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: true,
      title: t('Quick ask'),
      backgroundColor: '#00000000',
      transparent: process.platform !== 'linux',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    window.setAlwaysOnTop(true, 'floating')
    window.on('blur', () => {
      if (!window.webContents.isDevToolsOpened()) window.hide()
    })
    // The same link rules as every window: a reply's mail and phone links open too.
    confineNavigation(window.webContents)
    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#quick`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'quick' })
    }
    this.window = window
    return window
  }
}
