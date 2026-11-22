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
 *
 * A bot is its screen key (shared/screenWindows.ts): its profile, with its
 * dashboard before it when that's another combined one.
 */
import type { ScreenWindowRequest } from '../shared/ipc'
import { screenKey } from '../shared/screenWindows'

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
  /** Never reset, so a retry from before a dashboard switch can't match a newer hand back's count. */
  private handBackCount = 0
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
    const key = screenKey(screen.host, screen.profile)
    const had = this.open.get(key)
    if (had) return had.focus()
    // A hand back still being tried stops, and stays owed: the new window's page settles it, or its close sends it again.
    if (this.pending.delete(key)) {
      this.cancelHandBack(key)
      this.holding.add(key)
    }
    const window = this.create({ ...screen, viewerId: this.viewers.get(key) }, () => {
      if (this.open.get(key) !== window) return
      this.open.delete(key)
      this.handBack(key)
      this.changed(this.profiles())
    })
    this.open.set(key, window)
    this.changed(this.profiles())
  }

  /** Closes the screen windows whose bot `test` picks (another combined dashboard's that left the group), handing back for each. */
  closeWhere(test: (key: string) => boolean): void {
    const windows = [...this.open].filter(([key]) => test(key))
    for (const [key, window] of windows) {
      this.open.delete(key)
      this.handBack(key)
      window.close()
    }
    if (windows.length) this.changed(this.profiles())
  }

  /** The page's viewer id for its bot (its screen key), and whether it holds the screen now. */
  note(key: string, viewerId: string, holds: boolean): void {
    this.viewers.set(key, viewerId)
    if (holds) {
      this.cancelHandBack(key)
      this.pending.delete(key)
      this.holding.add(key)
    } else this.holding.delete(key)
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

  private handBack(key: string): void {
    const viewer = this.viewers.get(key)
    if (!this.holding.delete(key) || !viewer) return
    const mine = this.cancelHandBack(key)
    const owed = () => this.handBacks.get(key) === mine
    this.pending.add(key)
    const settled = () => {
      if (owed()) this.pending.delete(key)
    }
    void Promise.resolve(this.release(key, viewer, owed)).then(settled, settled)
  }

  private cancelHandBack(key: string): number {
    const next = ++this.handBackCount
    this.handBacks.set(key, next)
    return next
  }
}
