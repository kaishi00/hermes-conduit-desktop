/**
 * Stars and read state for the chat list, after the phone's (#757, #454):
 * both kept on this computer, per host, never on Hermes. A chat is unread
 * when it moved on after it was last open here; chats from before the
 * first look count as read, so a new install doesn't light every row up.
 */
import type { ChatRow } from './chats'

export type ChatFilter = 'all' | 'starred' | 'unread' | 'running' | 'waiting' | 'inprogress' | 'done'

export interface ChatMarks {
  /** "profile\tid" of each starred chat. */
  stars: string[]
  /** "profile\tid" → the activity time last seen, in ms. */
  seen: Record<string, number>
  /** Rows active at or before this count as read. */
  baseline: number
  /** "profile\tid" of chats marked unread by hand. */
  unread: string[]
}

export const markKey = (row: { id: string; profile?: string }) => `${row.profile ?? 'default'}\t${row.id}`

const storageKey = (host: string) => `conduit.chatMarks.${host}`

/** At most this many read times are kept; the oldest go first. */
const SEEN_LIMIT = 2000

export function loadMarks(host: string, now = Date.now()): ChatMarks {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(host)) ?? 'null') as Partial<ChatMarks> | null
    if (raw && typeof raw.baseline === 'number') {
      const list = (value: unknown) => (Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [])
      return { stars: list(raw.stars), seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {}, baseline: raw.baseline, unread: list(raw.unread) }
    }
  } catch {
    // A fresh start.
  }
  return { stars: [], seen: {}, baseline: now, unread: [] }
}

export function saveMarks(host: string, marks: ChatMarks): void {
  const entries = Object.entries(marks.seen)
  const seen = entries.length > SEEN_LIMIT ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, SEEN_LIMIT)) : marks.seen
  try {
    localStorage.setItem(storageKey(host), JSON.stringify({ ...marks, seen }))
  } catch {
    // Kept for this window only.
  }
}

export const isStarred = (marks: ChatMarks, row: ChatRow) => marks.stars.includes(markKey(row))

export function toggleStar(marks: ChatMarks, row: ChatRow): ChatMarks {
  const key = markKey(row)
  return { ...marks, stars: marks.stars.includes(key) ? marks.stars.filter(s => s !== key) : [...marks.stars, key] }
}

export function isUnread(marks: ChatMarks, row: ChatRow): boolean {
  const key = markKey(row)
  if (marks.unread.includes(key)) return true
  const at = row.activeAt ?? 0
  // Hermes' own flag, unless this computer has seen the chat since its last activity.
  if (row.unread && (marks.seen[key] ?? -1) < at) return true
  return at > marks.baseline && at > (marks.seen[key] ?? 0)
}

/** The row as read up to its latest activity; the same marks when nothing changes. */
export function markRead(marks: ChatMarks, row: ChatRow): ChatMarks {
  if (!isUnread(marks, row)) return marks
  const key = markKey(row)
  return { ...marks, seen: { ...marks.seen, [key]: row.activeAt ?? 0 }, unread: marks.unread.filter(k => k !== key) }
}

export function markUnread(marks: ChatMarks, row: ChatRow): ChatMarks {
  const key = markKey(row)
  return marks.unread.includes(key) ? marks : { ...marks, unread: [...marks.unread, key] }
}

export function filterRows(
  rows: ChatRow[],
  filter: ChatFilter,
  marks: ChatMarks,
  running: ReadonlySet<string>,
  waiting: ReadonlySet<string> = new Set(),
  /** Done chats (state/chatDone): whether the row is marked done. */
  done: (row: ChatRow) => boolean = () => false
): ChatRow[] {
  switch (filter) {
    case 'starred':
      return rows.filter(row => isStarred(marks, row))
    case 'unread':
      return rows.filter(row => isUnread(marks, row))
    case 'running':
      return rows.filter(row => running.has(row.id) && !waiting.has(row.id))
    case 'waiting':
      return rows.filter(row => waiting.has(row.id))
    case 'inprogress':
      return rows.filter(row => !done(row))
    case 'done':
      return rows.filter(row => done(row))
    default:
      return rows
  }
}
