/**
 * Conduit in the tray (the Mac's menu bar): it keeps running with its window
 * closed, so Needs you and finished turns still notify. Closing the window
 * hides it; Quit (the tray's, the Mac's ⌘Q) ends the app.
 */
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { AppIconChoice, MenuAction } from '../shared/ipc'
import { t } from '../shared/i18n'

export interface TrayDeps {
  window: () => BrowserWindow | null
  showWindow: () => void
  command: (action: MenuAction) => void
  quit: () => void
  quickAsk: () => void
  /** A Live call in a small window of its own, as its shortcut starts one. */
  liveCall: () => void
  installUpdate: () => void
}

export function trayIconPath(file: string): string {
  // Packaged: electron-builder's extraResources; in development: the repo's resources/.
  return app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../resources', file)
}

/** The tooltip, and the menu's first line: how many things wait on the user. */
export function trayLabel(waiting: number): string {
  if (waiting <= 0) return 'Conduit'
  return waiting === 1 ? t('Conduit · 1 thing needs you') : t('Conduit · {count} things need you', { count: waiting })
}

/** The Windows and Linux tray icon for the app icon picked. */
export const trayFile = (icon: AppIconChoice) => (icon === 'light' ? 'tray-light.png' : 'tray.png')

export class ConduitTray {
  private tray: Tray | null = null
  private waiting = 0
  /** A downloaded update's version: the menu offers Restart to Update. */
  private update: string | null = null
  /** Quick Ask's and the Live call's shortcuts, shown beside their items. */
  private quickAsk: string | null = null
  private liveCall: string | null = null

  constructor(private readonly deps: TrayDeps) {}

  create(icon: AppIconChoice = 'dark'): void {
    const mac = process.platform === 'darwin'
    const image = nativeImage.createFromPath(trayIconPath(mac ? 'trayTemplate.png' : trayFile(icon)))
    if (mac) image.setTemplateImage(true)
    this.tray = new Tray(image)
    // A click opens the window on Windows and Linux; the Mac shows the menu, as menu bar items do.
    this.tray.on('click', () => {
      if (!mac) this.deps.showWindow()
    })
    this.render()
  }

  setWaiting(count: number): void {
    if (count === this.waiting) return
    this.waiting = count
    this.render()
  }

  /** The app icon picked in Settings > Appearance; the Mac's menu bar keeps its monochrome template. */
  setAppIcon(icon: AppIconChoice): void {
    if (!this.tray || process.platform === 'darwin') return
    this.tray.setImage(nativeImage.createFromPath(trayIconPath(trayFile(icon))))
  }

  setHotkeys(quickAsk: string | null, liveCall: string | null): void {
    if (quickAsk === this.quickAsk && liveCall === this.liveCall) return
    this.quickAsk = quickAsk
    this.liveCall = liveCall
    this.render()
  }

  setUpdate(version: string | null): void {
    if (version === this.update) return
    this.update = version
    this.render()
  }

  /** Builds the menu again, in a new language. */
  refresh(): void {
    this.render()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private render(): void {
    if (!this.tray) return
    const label = trayLabel(this.waiting)
    this.tray.setToolTip(label)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label, enabled: false },
        { type: 'separator' },
        { label: t('Open Conduit'), click: () => this.deps.showWindow() },
        {
          label: t('New Chat'),
          click: () => {
            this.deps.showWindow()
            this.deps.command('new-chat')
          }
        },
        { label: t('Quick Ask'), ...(this.quickAsk ? { accelerator: this.quickAsk } : {}), click: () => this.deps.quickAsk() },
        { label: t('Start Live Call'), ...(this.liveCall ? { accelerator: this.liveCall } : {}), click: () => this.deps.liveCall() },
        {
          label: t('Needs You'),
          enabled: this.waiting > 0,
          click: () => {
            this.deps.showWindow()
            this.deps.command('needs-you')
          }
        },
        { type: 'separator' },
        ...(this.update ? [{ label: t('Restart to Update to {version}', { version: this.update }), click: () => this.deps.installUpdate() }] : []),
        { label: t('Quit Conduit'), click: () => this.deps.quit() }
      ])
    )
  }
}
