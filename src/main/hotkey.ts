/**
 * A global shortcut the user picks in Settings: Quick Ask's keys, and the
 * keys that start a Live call in a window of its own. It holds the keys while
 * the system lets it, keeps the ones before when new keys are refused, and
 * lets go of them while Settings listens for a pick.
 */
import { globalShortcut } from 'electron'

export class GlobalHotkey {
  /** The keys picked, null when the shortcut is off. */
  accelerator: string | null = null
  /** Whether the system let Conduit have them: another app may hold them. */
  registered = false

  constructor(private readonly action: () => void) {}

  register(accelerator: string | null): boolean {
    this.unregister()
    this.accelerator = accelerator
    if (!accelerator) return true
    try {
      this.registered = globalShortcut.register(accelerator, () => this.action())
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

  /** While Settings listens for new keys, the ones held now are let go, so pressing them picks them instead. */
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

  /** The keys shown beside a menu item: only those the system let Conduit have. */
  get held(): string | null {
    return this.registered ? this.accelerator : null
  }
}
