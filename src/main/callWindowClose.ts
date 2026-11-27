/**
 * The Live call window closed mid-call: it's hidden at once, its page is
 * asked to end the call (so the call is saved, a Classic call's chat filed
 * and its presence let go, as the call's End does), and the window goes a
 * moment after the call has ended, or after a few seconds whatever happens.
 * The shortcut pressed again meanwhile cancels it: the window stays, and its
 * next call is its own. Kept free of Electron so the timing is tested alone.
 */
export const CALL_CLOSE_CAP_MS = 5000
export const CALL_SAVE_GRACE_MS = 1500

export class CallWindowClose {
  private timers: ReturnType<typeof setTimeout>[] = []
  private pending = false

  constructor(
    private readonly destroy: () => void,
    private readonly timer: { set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>; clear: (id: ReturnType<typeof setTimeout>) => void } = {
      set: (run, ms) => setTimeout(run, ms),
      clear: id => clearTimeout(id)
    }
  ) {}

  /** Whether a close is under way. */
  get closing(): boolean {
    return this.pending
  }

  /** The close starts: false when one already is. */
  start(): boolean {
    if (this.pending) return false
    this.pending = true
    this.timers.push(this.timer.set(() => this.finish(), CALL_CLOSE_CAP_MS))
    return true
  }

  /** The page says its call ended: its last saves get a moment, then the window goes. */
  callEnded(): void {
    if (!this.pending) return
    this.timers.push(this.timer.set(() => this.finish(), CALL_SAVE_GRACE_MS))
  }

  /** Asked for again before it went: nothing closes it. */
  cancel(): void {
    for (const id of this.timers) this.timer.clear(id)
    this.timers = []
    this.pending = false
  }

  private finish(): void {
    if (!this.pending) return
    this.cancel()
    this.destroy()
  }
}
