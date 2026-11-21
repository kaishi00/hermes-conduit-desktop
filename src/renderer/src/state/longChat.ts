/**
 * A chat past Hermes' `sessions.max_resume_messages` (20,000 rows by
 * default). A resume carrying its whole transcript is refused (4130, "This
 * session is too long to reload safely"), while the compact one
 * (`omit_messages`) counts only the rows the model still holds, so a chat
 * that compacts in place, like a long-running inbox bot's, still opens and
 * still takes messages. The chat opens compact and draws its newest stored
 * rows from the REST transcript, as the phone does (hermes-conduit's map
 * entry "A chat while it opens").
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
export async function newestRows(http: Http, storedId: string, profile?: string): Promise<HistoryRow[]> {
  let rows: HistoryRow[] = []
  for (let page = 0; page < LONG_CHAT_PAGES; page++) {
    const answer = (await http('GET', pagePath(storedId, profile, page * LONG_CHAT_PAGE))) as { messages?: unknown } | null
    const got = Array.isArray(answer?.messages) ? (answer.messages as HistoryRow[]).map(storedRow) : []
    rows = [...got, ...rows]
    if (got.length < LONG_CHAT_PAGE || hasWords(rows)) break
  }
  return rows
}

/** What a too-long chat draws: the note saying why only its newest messages show, then them. */
export function longChatItems(rows: HistoryRow[]): TranscriptItem[] {
  return [{ kind: 'notice', key: 'long-chat', text: t('This chat is too long to open whole, so Conduit shows its newest messages.'), tone: 'info' }, ...fromHistory(rows)]
}
