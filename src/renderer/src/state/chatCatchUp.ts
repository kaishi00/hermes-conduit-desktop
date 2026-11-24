/**
 * Rows another process wrote into the open chat. A turn the gateway hosts
 * (a scheduled job's hidden turn, a platform's) runs outside the dashboard's
 * session host, so this socket hears none of its events, and a note is a
 * stored row with no event at all. The dashboard only says the store moved
 * (`sessions.changed`), so the open chat asks for its newest stored row
 * then, and when the window comes back to the front, and reads itself again
 * when that row is one it hasn't drawn (hermes-conduit's map entry "A chat
 * while it opens"; the phone's ChatSync does the same from the catalog's
 * stored counts).
 */
import { storedRow } from './longChat'
import type { HistoryRow } from './transcript'

type Http = (method: 'GET', path: string) => Promise<unknown>

/** How long the open chat waits after the store moved, so a burst of writes asks once. */
export const CATCH_UP_SETTLE_MS = 1_500
/** The window coming forward asks at most this often. */
export const CATCH_UP_FOCUS_MS = 5_000
/** A chat another process keeps writing to is read again at most this often. */
export const CATCH_UP_RELOAD_MS = 10_000

/** The newest stored row id among these rows, or null when none carries one. */
export function tipOf(rows: readonly HistoryRow[] | null | undefined): number | null {
  let tip: number | null = null
  for (const row of rows ?? []) {
    const id = row.row_id
    if (typeof id === 'number' && Number.isFinite(id) && (tip === null || id > tip)) tip = id
  }
  return tip
}

/** The chat's newest stored row id, read from one row of its REST transcript. */
export async function newestRowId(http: Http, storedId: string, profile?: string): Promise<number | null> {
  const scope = profile && profile !== 'default' ? `&profile=${encodeURIComponent(profile)}` : ''
  const answer = (await http('GET', `/api/sessions/${encodeURIComponent(storedId)}/messages?order=latest&limit=1&include_compacted=true&inline_images=false${scope}`)) as {
    messages?: unknown
  } | null
  return tipOf(Array.isArray(answer?.messages) ? (answer.messages as HistoryRow[]).map(storedRow) : [])
}

/**
 * What the newest stored row means for the open chat.
 *
 * `drawn` is the newest row the transcript accounts for (null: none known,
 * so the first answer only sets it). A turn this window followed live drew
 * its rows from events, which carry no row ids, so the rows it stored are
 * `adopt`ed, not read again. Rows another process wrote meanwhile ride
 * along unread until the store next moves without a turn of ours.
 */
export function catchUpStep(tip: number | null, drawn: number | null, followedLive: boolean): 'none' | 'adopt' | 'reload' {
  if (tip === null) return 'none'
  if (drawn === null) return 'adopt'
  if (tip <= drawn) return 'none'
  return followedLive ? 'adopt' : 'reload'
}
