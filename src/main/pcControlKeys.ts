/** The Control from Hermes bar's Stop keys and who owns them (issue 696). */
export const STOP_KEYS = 'CommandOrControl+Alt+Shift+S'

type Shortcut = {
  isRegistered(accelerator: string): boolean
  register(accelerator: string, action: () => void): boolean
  unregister(accelerator: string): void
}

/** Take the keys only when they are ours already or nobody holds them; a failed register leaves them alone. */
export function claimStopKeys(shortcut: Shortcut, ownKeys: boolean, stop: () => void): boolean {
  if (ownKeys || shortcut.isRegistered(STOP_KEYS)) return ownKeys
  try {
    return shortcut.register(STOP_KEYS, stop) === true
  } catch {
    return false
  }
}

/** Give back only the keys this bar took. */
export function releaseStopKeys(shortcut: Shortcut, ownKeys: boolean): void {
  if (!ownKeys) return
  try {
    shortcut.unregister(STOP_KEYS)
  } catch {
    // Already gone with the app: nothing to give back.
  }
}
