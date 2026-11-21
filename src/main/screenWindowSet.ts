/**
 * Bots' screens in windows of their own (Eric, 2026-11-21), so the chat's
 * text and tool output stay in view beside it: one window per bot, focused
 * again when it's asked for twice. Kept free of Electron so the rules are
 * tested on their own.
 *
 * A window that closes takes its React page with it before the page could
 * hand back a takeover, so the page tells this set its viewer id and whether
 * it holds the screen, and the set hands back for it. The viewer id is kept
 * per bot, so a reopened window watches as the same viewer.
 */
import type { ScreenWindowRequest } from '../shared/ipc'

/** What a window needs of Electron: focus it, close it. */
export interface ScreenWindowHandle {
  focus(): void
  close(): void
}

export class ScreenWindowSet<W extends ScreenWindowHandle = ScreenWindowHandle> {
  private readonly open = new Map<string, W>()
  private readonly viewers = new Map<string, string>()
  private readonly holding = new Set<string>()
  /** Each bot's hand back count: reopening its window or taking over again cancels one still being tried. */
  private readonly handBacks = new Map<string, number>()
  /** Bots whose hand back is still being tried. */
  private readonly pending = new Set<string>()

  constructor(
    private readonly create: (screen: ScreenWindowRequest, onClosed: () => void) => W,
    private readonly changed: (profiles: string[]) => void,
    private readonly release: (profile: string, viewerId: string, owed: () => boolean) => Promise<unknown> | void
  ) {}

  profiles(): string[] {
    return [...this.open.keys()]
  }

  /** The bot's screen window: its own if it has one, else a new one. */
  show(screen: Omit<ScreenWindowRequest, 'viewerId'>): void {
    const had = this.open.get(screen.profile)
    if (had) return had.focus()
    // A hand back still being tried stops, and stays owed: the new window's page settles it, or its close sends it again.
    if (this.pending.delete(screen.profile)) {
      this.cancelHandBack(screen.profile)
      this.holding.add(screen.profile)
    }
    const window = this.create({ ...screen, viewerId: this.viewers.get(screen.profile) }, () => {
      if (this.open.get(screen.profile) !== window) return
      this.open.delete(screen.profile)
      this.handBack(screen.profile)
      this.changed(this.profiles())
    })
    this.open.set(screen.profile, window)
    this.changed(this.profiles())
  }

  /** The page's viewer id for its bot, and whether it holds the screen now. */
  note(profile: string, viewerId: string, holds: boolean): void {
    this.viewers.set(profile, viewerId)
    if (holds) {
      this.cancelHandBack(profile)
      this.pending.delete(profile)
      this.holding.add(profile)
    } else this.holding.delete(profile)
  }

  /** Closes every screen window. Another dashboard forgets this one's viewers and holds, which are its host's. */
  close(forget = false): void {
    if (forget) {
      this.viewers.clear()
      this.holding.clear()
      this.handBacks.clear()
      this.pending.clear()
    }
    const windows = [...this.open]
    this.open.clear()
    for (const [profile, window] of windows) {
      this.handBack(profile)
      window.close()
    }
    if (windows.length) this.changed(this.profiles())
  }

  private handBack(profile: string): void {
    const viewer = this.viewers.get(profile)
    if (!this.holding.delete(profile) || !viewer) return
    const mine = this.cancelHandBack(profile)
    const owed = () => this.handBacks.get(profile) === mine
    this.pending.add(profile)
    const settled = () => {
      if (owed()) this.pending.delete(profile)
    }
    void Promise.resolve(this.release(profile, viewer, owed)).then(settled, settled)
  }

  private cancelHandBack(profile: string): number {
    const next = (this.handBacks.get(profile) ?? 0) + 1
    this.handBacks.set(profile, next)
    return next
  }
}
