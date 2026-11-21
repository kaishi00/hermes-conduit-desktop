/**
 * Quick ask: Alt+Space (Option+Space on the Mac) from anywhere opens a small
 * window over everything to ask Hermes one thing. It hides again on Esc or
 * when it loses focus; the chat it started opens in the main window on
 * request.
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'
import { confineNavigation } from './navigation'

export const QUICK_ASK_ACCELERATOR = 'Alt+Space'

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
  registered = false

  register(): void {
    try {
      this.registered = globalShortcut.register(QUICK_ASK_ACCELERATOR, () => this.toggle())
    } catch {
      this.registered = false
    }
  }

  unregister(): void {
    if (this.registered) globalShortcut.unregister(QUICK_ASK_ACCELERATOR)
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
