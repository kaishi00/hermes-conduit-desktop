/**
 * A chat too big to draw at once, and what it opens on. A resume carries
 * the chat's whole history — up to Hermes' `sessions.max_resume_messages`
 * (20,000 rows by default) — and the renderer then lays every row out in one
 * go (desktop#291), so a chat past one stored page (500 rows) opens on its
 * newest page instead and reads the pages before it as the reader scrolls up
 * (`olderRows`). The transcript draws a window of the rows it holds
 * (rowWindow.ts): scrolling up first takes on the rows already read, and the
 * page before them is read once the window reaches the first. A chat the
 * list says is shorter than a page resumes whole, with no page read first
 * (chatLength.ts). A resume carrying the whole transcript is refused (4130,
 * "This session is too long to reload safely") past that limit, while the
 * compact one (`omit_messages`) counts only the rows the model still holds,
 * so a chat that compacts in place, like a long-running inbox bot's, still
 * opens and still takes messages. That one opens compact too, under a note
 * saying why, and draws its newest stored rows from the REST transcript, as
 * the phone does (hermes-conduit's map entry "A chat while it opens").
 */
import { GatewayError } from '../gateway'
import { t } from '../../../shared/i18n'
import { fromHistory, type HistoryRow, type TranscriptItem } from './transcript'

/** Hermes' refusal of a resume carrying the whole transcript. */
export const RESUME_TOO_LONG = 4130
/** Rows per REST page (the route's most). */
export const LONG_CHAT_PAGE = 500
/** The most pages an open reads looking for words. */
export const LONG_CHAT_PAGES = 4

export function isResumeTooLong(error: unknown): boolean {
  return error instanceof GatewayError && error.code === RESUME_TOO_LONG
}

type Http = (method: 'GET', path: string) => Promise<unknown>

/** A REST row as `session.resume` names it: its id as `row_id`, its tool as `name`. */
export function storedRow(row: HistoryRow): HistoryRow {
  const named = row.name ?? (typeof row.tool_name === 'string' ? row.tool_name : null)
  const id = row.row_id ?? (typeof row.id === 'number' ? row.id : null)
  return { ...row, name: named, row_id: id }
}

function pagePath(storedId: string, profile: string | undefined, offset: number): string {
  const scope = profile && profile !== 'default' ? `&profile=${encodeURIComponent(profile)}` : ''
  return `/api/sessions/${encodeURIComponent(storedId)}/messages?order=latest&limit=${LONG_CHAT_PAGE}&offset=${offset}&include_compacted=true&inline_images=false${scope}`
}

/** Whether the rows draw something of the user's or a reply's, not only tool steps. */
function hasWords(rows: HistoryRow[]): boolean {
  return fromHistory(rows).some(item => item.kind === 'user' || item.kind === 'assistant')
}

/**
 * The chat's newest stored rows, oldest first, as `session.resume` names
 * them. A page of only tool steps (a bot working through its inbox) reads
 * the page before it, up to LONG_CHAT_PAGES, so the chat opens on words.
 */
export async function newestRows(
  http: Http,
  storedId: string,
  profile?: string,
  enough: (rows: HistoryRow[]) => boolean = hasWords
): Promise<HistoryRow[]> {
  let rows: HistoryRow[] = []
  for (let page = 0; page < LONG_CHAT_PAGES; page++) {
    const answer = (await http('GET', pagePath(storedId, profile, page * LONG_CHAT_PAGE))) as { messages?: unknown } | null
    const got = Array.isArray(answer?.messages) ? (answer.messages as HistoryRow[]).map(storedRow) : []
    rows = joinRows(got, rows)
    if (got.length < LONG_CHAT_PAGE || enough(rows)) break
  }
  return rows
}

/**
 * The rows written since `held` was read, joined after it: it reads up to
 * LONG_CHAT_PAGES (4) pages back from the newest row, stopping at the
 * first that reaches a row `held` has, so a turn that wrote up to that
 * many pages meanwhile leaves no hole.
 */
export async function rowsSince(http: Http, held: HistoryRow[], storedId: string, profile?: string): Promise<HistoryRow[]> {
  const known = new Set(held.flatMap(row => (row.row_id == null ? [] : [row.row_id])))
  const newer = await newestRows(http, storedId, profile, rows => rows.some(row => row.row_id != null && known.has(row.row_id)))
  return joinRows(held, newer)
}

/**
 * Older rows, then newer ones, each stored row once. The chat keeps
 * writing while its pages are read (a bot working through mail), so a
 * page by offset from the newest row can serve again rows the page after
 * it already did.
 */
export function joinRows(older: HistoryRow[], newer: HistoryRow[]): HistoryRow[] {
  const seen = new Set(newer.flatMap(row => (row.row_id == null ? [] : [row.row_id])))
  return [...older.filter(row => row.row_id == null || !seen.has(row.row_id)), ...newer]
}

/** The stored page before `offset` rows from the newest, oldest first, and whether the chat has rows before it. */
export async function olderRows(
  http: Http,
  storedId: string,
  profile: string | undefined,
  offset: number
): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const answer = (await http('GET', pagePath(storedId, profile, offset))) as { messages?: unknown } | null
  const rows = Array.isArray(answer?.messages) ? (answer.messages as HistoryRow[]).map(storedRow) : []
  return { rows, more: rows.length === LONG_CHAT_PAGE }
}

/** What a chat opened on its newest stored page draws above them: the note saying why, when Hermes refused the whole resume, then the rows. */
export function newestPageItems(rows: HistoryRow[], tooLong = false): TranscriptItem[] {
  const note: TranscriptItem[] = tooLong
    ? [{ kind: 'notice', key: 'long-chat', text: t('This chat is too long to open whole, so Conduit shows its newest messages.'), tone: 'info' }]
    : []
  return [...note, ...fromHistory(rows)]
}

/** What a running long chat's open reads again: a resume's turn, its queue and a card waiting on the user. */
export interface RunningResume {
  running?: boolean | null
  inflight?: unknown
  pending?: unknown
  pending_connection?: unknown
}

/**
 * A running long chat's open, settled. Its events reach it only once the
 * open settles, so after its pages it is read again: its turn as it is now
 * and the rows it wrote meanwhile. A turn can end while those rows are
 * read, so a chat still running is read once more, and when that read says
 * the turn ended, its newest rows are read again: the open never shows a
 * turn running that ended meanwhile. A read that fails keeps the open with
 * what the first one said, without the parts that go stale as the turn
 * runs: its reply text and its queue. A connection card stays, since the
 * turn waits on the user while it's open.
 */
export async function settleRunning<R extends RunningResume>(
  resume: () => Promise<R>,
  since: (held: HistoryRow[]) => Promise<HistoryRow[]>,
  first: R,
  held: HistoryRow[]
): Promise<{ result: R; rows: HistoryRow[] }> {
  let result = first
  let rows = held
  const readTurn = async () => {
    result = await resume().catch(() => ({ ...result, inflight: null, pending: undefined }))
  }
  const readRows = async () => {
    rows = await since(rows).catch(() => rows)
  }
  await readTurn()
  await readRows()
  if (result.running) {
    await readTurn()
    if (!result.running) await readRows()
  }
  return { result, rows }
}
