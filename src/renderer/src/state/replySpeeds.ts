/**
 * How fast each reply was written, in tokens per second, after the phone's
 * ReplySpeeds: shown beside a reply's time while Settings > Chat > Show reply
 * speed is on (kept on this computer, off by default). The Conduit plugin
 * measures it from Hermes' model calls, the provider's own output tokens over
 * the time the model spent writing, and ties each turn to the reply it ended
 * on (`/sessions/reply-speeds`, plugin 0.204.0+). Hermes Desktop's figure
 * averages the chat's last ten calls with the wait for the first token in, so
 * Conduit doesn't use it.
 */
import { t } from '../../../shared/i18n'
import { dashboardProfilePath } from './dashboardProfile'

export const REPLY_SPEEDS_PATH = '/api/plugins/conduit_push/sessions/reply-speeds'
const SHOWN_KEY = 'conduit.showReplySpeed'
/** Show reply speed in the composer (desktop#718): its own switch, beside the one for each reply. */
const COMPOSER_KEY = 'conduit.showReplySpeedInComposer'

export interface ReplySpeeds {
  /** Each saved reply's speed, by Hermes' row id. */
  byRow: Map<number, number>
  /** The newest turn's while its reply isn't saved yet: the reply still drawn from the stream. */
  unsaved?: number
}

export function replySpeedsPath(sessionId: string, profile?: string | null): string {
  return dashboardProfilePath(`${REPLY_SPEEDS_PATH}?session_id=${encodeURIComponent(sessionId)}`, profile)
}

export function parseReplySpeeds(raw: unknown): ReplySpeeds {
  const object = (raw ?? {}) as Record<string, unknown>
  const replies = Array.isArray(object.replies) ? object.replies : []
  const speeds: ReplySpeeds = { byRow: new Map() }
  replies.forEach((reply, index) => {
    if (!reply || typeof reply !== 'object') return
    const r = reply as Record<string, unknown>
    const rate = r.tokens_per_s
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return
    const row = r.row_id
    if (typeof row === 'number' && Number.isInteger(row) && row > 0) speeds.byRow.set(row, rate)
    else if (index === replies.length - 1) speeds.unsaved = rate
  })
  return speeds
}

/** A reply's speed: its saved row's, else, for the newest reply once its turn is done, the newest turn's. */
export function replySpeedFor(
  speeds: ReplySpeeds | undefined,
  item: { key: string; rowId?: number | null },
  newestReply: string | undefined,
  running: boolean
): number | undefined {
  if (!speeds) return undefined
  if (item.rowId) return speeds.byRow.get(item.rowId)
  return !running && item.key === newestReply ? speeds.unsaved : undefined
}

/** The newest reply's speed: the newest turn's while its reply isn't saved yet, else the newest saved row's. */
export function newestReplySpeed(speeds: ReplySpeeds | undefined): number | undefined {
  if (!speeds) return undefined
  if (speeds.unsaved != null) return speeds.unsaved
  let newest = 0
  let rate: number | undefined
  for (const [row, speed] of speeds.byRow) {
    if (row > newest) {
      newest = row
      rate = speed
    }
  }
  return rate
}

const number = (rate: number) => (Math.round(rate * 10) < 100 ? rate.toFixed(1) : String(Math.round(rate)))

/** "42 tok/s"; one decimal under 10. */
export const replySpeedLabel = (rate: number) => t('{speed} tok/s', { speed: number(rate) })
export const replySpeedSpoken = (rate: number) => t('Written at {speed} tokens per second', { speed: number(rate) })

const listeners = new Set<() => void>()

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function setFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true')
    else localStorage.removeItem(key)
  } catch {
    // Off next time.
  }
  for (const listener of listeners) listener()
}

/** Show reply speed: beside each reply's time. */
export const replySpeedShown = () => flag(SHOWN_KEY)
export const setReplySpeedShown = (on: boolean) => setFlag(SHOWN_KEY, on)
/** Show reply speed in the composer: the newest reply's, as a chip after the context ring. */
export const replySpeedInComposer = () => flag(COMPOSER_KEY)
export const setReplySpeedInComposer = (on: boolean) => setFlag(COMPOSER_KEY, on)

/** For useSyncExternalStore: either switch, in this window or another (through the storage event). */
export function subscribeReplySpeedShown(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHOWN_KEY || event.key === COMPOSER_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
