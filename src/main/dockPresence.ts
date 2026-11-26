/**
 * Hide from the Dock (desktop#586): on the Mac, Conduit already lives on in
 * the menu bar with its windows closed (tray.ts), Quick Ask and notifications
 * included. With this setting on, its Dock icon and ⌘-Tab entry go too while
 * no window of its own is open, and come back as soon as one opens. Quick Ask
 * is a floating panel, so it opens without bringing the Dock icon back.
 *
 * The icon leaves a moment after the last window closes, so a window that
 * steps aside and comes straight back (a screenshot for a call or Quick Ask)
 * doesn't make it flicker.
 */

export interface DockHost {
  hide(): void
  show(): Promise<void>
  isVisible(): boolean
}

export interface DockTimers {
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** How long the Dock icon waits once the last window closes. */
export const DOCK_HIDE_DELAY_MS = 800

export class DockPresence {
  private enabled = false
  private pending: unknown = null

  constructor(
    private readonly dock: DockHost,
    /** Whether a window of Conduit's own is open: shown or minimized, Quick Ask left out. */
    private readonly windowsOpen: () => boolean,
    private readonly timers: DockTimers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout) },
    private readonly delay = DOCK_HIDE_DELAY_MS
  ) {}

  get on(): boolean {
    return this.enabled
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    this.update()
  }

  /**
   * After a window shows, hides or closes. `shown` runs once the Dock icon is
   * back, when it had gone: a window shown while it was hidden can open
   * behind the app in front, so the caller focuses it then.
   */
  update(shown?: () => void): void {
    if (!this.enabled || this.windowsOpen()) {
      this.cancel()
      if (!this.dock.isVisible()) {
        void this.dock.show().then(
          () => shown?.(),
          () => undefined
        )
      }
      return
    }
    if (this.pending !== null || !this.dock.isVisible()) return
    this.pending = this.timers.setTimeout(() => {
      this.pending = null
      if (this.enabled && !this.windowsOpen()) this.dock.hide()
    }, this.delay)
  }

  private cancel(): void {
    if (this.pending === null) return
    this.timers.clearTimeout(this.pending)
    this.pending = null
  }
}
