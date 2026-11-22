/**
 * Conduit's own updates (main/updates.ts): electron-updater reads the newest
 * GitHub release of hermes-conduit-desktop, downloads it in the background
 * and installs it when Conduit quits, or at once with Restart to Update.
 * A beta gets newer betas and releases; a release only releases.
 */

/** Why this copy doesn't update itself, or null when it does. */
export type UpdatesOff = 'development' | 'store' | 'linux-package'

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  /** This copy's version (package.json's). */
  current: string
  off: UpdatesOff | null
  /** Settings > App > Updates: download and install by themselves (on by default). */
  auto: boolean
  phase: UpdatePhase
  /** The newer version, from available on. */
  version?: string
  /** 0 to 100 while downloading. */
  percent?: number
  /** When the last check ended, ms. */
  checkedAt?: number
}

/** A check at launch, after the window's first work, then every four hours. */
export const FIRST_CHECK_MS = 30_000
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Whether this copy can update itself: not run from source, not the
 * Microsoft Store's (the Store updates it), and on Linux only the AppImage.
 */
export function updatesOff(copy: { packaged: boolean; platform: string; windowsStore: boolean; appImage: boolean }): UpdatesOff | null {
  if (!copy.packaged) return 'development'
  if (copy.windowsStore) return 'store'
  if (copy.platform === 'linux' && !copy.appImage) return 'linux-package'
  return null
}

/** The release's page, for What's New. */
export function releaseUrl(version: string): string {
  return `https://github.com/kaishi00/hermes-conduit-desktop/releases/tag/v${version}`
}
