/**
 * Hide from the Dock (desktop#586): on the Mac, Conduit already lives on in
 * the menu bar with its windows closed (tray.ts), Quick Ask and notifications
 * included. With this setting on, its Dock icon and ⌘-Tab entry go too while
 * no window of its own is open, and come back as soon as one opens. Quick Ask
 * is a floating panel, so it opens without bringing the Dock icon back.
 *
 * The icon leaves a moment after the last window closes, and not at all while
 * a window steps aside on purpose (hold(), a screenshot for a call or Quick
 * Ask), so it doesn't flicker.
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
  /** A show() under way: the icon isn't visible yet, but will be. */
  private showing = false
  /** Windows stepping aside on purpose (a screenshot), however long it takes. */
  private holds = 0
  /** Windows waiting to come forward once the show under way settles. */
  private waiting: (() => void)[] = []

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
    if (!this.enabled || this.windowsOpen() || this.holds > 0) {
      this.cancel()
      // A show under way may already read as visible: the window waits for it all the same.
      if (this.showing) {
        if (shown) this.waiting.push(shown)
        return
      }
      if (this.dock.isVisible()) return
      if (shown) this.waiting.push(shown)
      this.showing = true
      const settle = (ok: boolean) => {
        this.showing = false
        const waiting = this.waiting
        this.waiting = []
        if (!ok) return
        for (const run of waiting) run()
        // The window that asked may have closed again while the icon came back.
        this.update()
      }
      void this.dock.show().then(
        () => settle(true),
        () => settle(false)
      )
      return
    }
    if (this.pending !== null || (!this.dock.isVisible() && !this.showing)) return
    this.pending = this.timers.setTimeout(() => {
      this.pending = null
      if (this.enabled && this.holds === 0 && !this.windowsOpen()) this.dock.hide()
    }, this.delay)
  }

  /** A window steps aside for a moment (a screenshot): the icon stays until release(), however long it takes. */
  hold(): void {
    this.holds += 1
    this.cancel()
  }

  release(): void {
    this.holds = Math.max(0, this.holds - 1)
    this.update()
  }

  private cancel(): void {
    if (this.pending === null) return
    this.timers.clearTimeout(this.pending)
    this.pending = null
  }
}
