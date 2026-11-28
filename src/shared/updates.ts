/**
 * Conduit's own updates (main/updates.ts): electron-updater reads the newest
 * GitHub release of hermes-conduit-desktop, downloads it in the background
 * and installs it when Conduit quits, or at once with Restart to Update.
 * A beta gets newer betas and releases; a release only releases.
 * Checks go on while a downloaded update waits to install, so a release
 * published meanwhile replaces it and one restart lands on the newest
 * (issue 761: 1.1.1 went to 1.1.2, then 1.1.3).
 */

/** Why this copy doesn't update itself, or null when it does. */
export type UpdatesOff = 'development' | 'store' | 'linux-package'

/** `error` is a failed check; `download-failed` keeps the version, and Try Again downloads it again. */
export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'download-failed'

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
  /** The phase a check started from, so a failed check after Download or a failed download goes back to it. */
  before?: UpdatePhase
  /** A check under way while a downloaded update waits: the phase stays ready, and Restart to Update with it, unless a newer version turns up. */
  rechecking?: boolean
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

/** What electron-updater says, and what Settings asks for. */
export type UpdateEvent =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'found'; version: string }
  | { kind: 'download' }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'failed' }
  | { kind: 'auto'; on: boolean }

/** The next state after an event, at `now` (ms). A failure while downloading keeps the version for Try Again, and so does a failed check that started from one. */
export function nextUpdateState(state: UpdateState, event: UpdateEvent, now: number): UpdateState {
  const waiting = state.phase === 'ready' && state.rechecking === true
  switch (event.kind) {
    case 'checking':
      return state.phase === 'ready' ? { ...state, rechecking: true } : { ...state, phase: 'checking', before: state.phase }
    case 'none':
      // Nothing newer than this copy (the waiting release was pulled): what's downloaded still installs at quit.
      if (waiting) return { ...state, rechecking: undefined, checkedAt: now }
      return { ...state, phase: 'none', version: undefined, percent: undefined, checkedAt: now }
    case 'found':
      if (waiting && event.version === state.version) return { ...state, rechecking: undefined, checkedAt: now }
      // A newer one than the download waiting to install replaces it, Install updates automatically or not: the person already took an update.
      if (waiting) return { ...state, phase: 'downloading', version: event.version, percent: 0, rechecking: undefined, checkedAt: now }
      return { ...state, phase: state.auto ? 'downloading' : 'available', version: event.version, percent: 0, checkedAt: now }
    case 'download':
      return { ...state, phase: 'downloading', percent: 0 }
    case 'progress':
      return { ...state, phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(event.percent))) }
    case 'downloaded':
      return { ...state, phase: 'ready', version: event.version, percent: 100, rechecking: undefined }
    case 'failed': {
      // A check that failed while an update waits (offline) leaves it waiting.
      if (waiting) return { ...state, rechecking: undefined, checkedAt: now }
      // A failed check that started with a known version (Download or Try Again showing) keeps it and its button.
      const kept = state.phase === 'checking' && state.version && (state.before === 'available' || state.before === 'download-failed') ? state.before : null
      const phase = kept ?? (state.phase === 'downloading' && state.version ? 'download-failed' : 'error')
      return { ...state, phase, percent: undefined, checkedAt: now }
    }
    case 'auto':
      return { ...state, auto: event.on }
  }
}

/** Whether a check may start now: not while one runs or a download is under way. A downloaded update waiting to install is checked past, so a newer release replaces it. */
export function mayCheck(state: UpdateState): boolean {
  return !state.off && state.phase !== 'checking' && state.phase !== 'downloading' && !state.rechecking
}

/** Whether `found` (the state after a found event) replaces a waiting download, which the updater fetches even with Install updates automatically off. */
export function replacesWaiting(before: UpdateState, found: UpdateState): boolean {
  return before.phase === 'ready' && found.phase === 'downloading'
}

/** Whether Settings' Download (or Try Again after a failed download) applies. */
export function mayDownload(state: UpdateState): boolean {
  return !state.off && (state.phase === 'available' || state.phase === 'download-failed')
}
