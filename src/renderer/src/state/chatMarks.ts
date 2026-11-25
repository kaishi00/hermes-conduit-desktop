/**
 * Stars and read state for the chat list, after the phone's (#757, #454):
 * both kept on this computer, per host, never on Hermes. A chat is unread
 * when it moved on after it was last open here; chats from before the
 * first look count as read, so a new install doesn't light every row up.
 */
import type { ChatRow } from './chats'
import type { ProjectChat } from './projects'

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

/** At most this many read times and hand marks are kept; the oldest go first. */
const MARK_LIMIT = 2000

export function loadMarks(host: string, now = Date.now()): ChatMarks {
  flushMarks(host)
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

/** How long a change of marks waits before it's written: the open chat's read time moves with each streamed bump (desktop#543). */
export const MARKS_SAVE_WAIT_MS = 1_000
const pendingSaves = new Map<string, { marks: ChatMarks; timer: ReturnType<typeof setTimeout> }>()

/** Writes `host`'s marks a moment from now, the latest change only; a load or the window closing writes them at once. */
export function saveMarksSoon(host: string, marks: ChatMarks): void {
  const pending = pendingSaves.get(host)
  if (pending) {
    pending.marks = marks
    return
  }
  const timer = setTimeout(() => flushMarks(host), MARKS_SAVE_WAIT_MS)
  pendingSaves.set(host, { marks, timer })
}

/** Writes `host`'s pending marks now (every host's when none is named). */
export function flushMarks(host?: string): void {
  for (const [key, pending] of [...pendingSaves]) {
    if (host !== undefined && key !== host) continue
    clearTimeout(pending.timer)
    pendingSaves.delete(key)
    saveMarks(key, pending.marks)
  }
}

if (typeof window !== 'undefined') for (const event of ['pagehide', 'beforeunload']) window.addEventListener(event, () => flushMarks())

export function saveMarks(host: string, marks: ChatMarks): void {
  const entries = Object.entries(marks.seen)
  const seen = entries.length > MARK_LIMIT ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MARK_LIMIT)) : marks.seen
  // Hand marks are keyed by chat too: a chat marked unread and then deleted otherwise
  // keeps its key in localStorage forever (issue 527).
  const unread = marks.unread.length > MARK_LIMIT ? marks.unread.slice(-MARK_LIMIT) : marks.unread
  try {
    localStorage.setItem(storageKey(host), JSON.stringify({ ...marks, seen, unread }))
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

/**
 * Whether the row draws its unread dot. The open chat reads as it goes, so
 * activity alone draws none there; marked unread by hand, it keeps its dot
 * while open (state/openChatRead).
 */
export const showsUnread = (marks: ChatMarks, row: ChatRow, open: boolean): boolean =>
  isUnread(marks, row) && (!open || marks.unread.includes(markKey(row)))

/**
 * A project chat's dot, as its row would draw it. The list's copy wins when present
 * (it carries newer activity and Hermes' flag); otherwise the project's own fields
 * stand in. `openId` is null while a chat is docked or absent, so its mark stays.
 */
export function projectChatUnread(
  marks: ChatMarks,
  chat: ProjectChat,
  listed: readonly ChatRow[] | null | undefined,
  openId: string | null | undefined
): boolean {
  const row: ChatRow = listed?.find(r => r.id === chat.id) ?? {
    id: chat.id,
    title: chat.title,
    pinned: false,
    profile: chat.profile,
    activeAt: chat.lastActive
  }
  return showsUnread(marks, row, chat.id === openId)
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

/**
 * The Filter menu's choices, after the phone's V2FilterSelection: filters
 * combine. Starred narrows everything; the statuses (Unread, Running, Needs
 * approval) list a chat with any of them, as In progress and Done do and as
 * the sources do; the groups narrow each other. Empty is All.
 */
export type ChatFilterKey = Exclude<ChatFilter, 'all'> | `source:${string}`

const STATUS_KEYS: readonly ChatFilterKey[] = ['unread', 'running', 'waiting']
const PROGRESS_KEYS: readonly ChatFilterKey[] = ['inprogress', 'done']
export const isSourceKey = (key: ChatFilterKey): key is `source:${string}` => key.startsWith('source:')
const groupOf = (key: ChatFilterKey) => (key === 'starred' ? 'scope' : STATUS_KEYS.includes(key) ? 'status' : PROGRESS_KEYS.includes(key) ? 'progress' : 'source')

/** Turns one filter on or off; the order stays the menu's. */
export function settingFilter(selection: readonly ChatFilterKey[], key: ChatFilterKey, on: boolean): ChatFilterKey[] {
  const rest = selection.filter(k => k !== key)
  return on ? [...rest, key] : rest
}

/**
 * What the menu counts beside `key`: the other groups' choices with `key`
 * alone in its own, so with Unread on, a source counts its unread chats.
 * Starred's count is the starred rows among what's chosen.
 */
export function facetOf(selection: readonly ChatFilterKey[], key: ChatFilterKey): ChatFilterKey[] {
  if (key === 'starred') return [...selection.filter(k => k !== key), key]
  const group = groupOf(key)
  return [...selection.filter(k => groupOf(k) !== group), key]
}

export interface FilterContext {
  marks: ChatMarks
  running: ReadonlySet<string>
  waiting: ReadonlySet<string>
  done: (row: ChatRow) => boolean
  /** Whether the row is under a source (state/voiceList underSource). */
  underSource: (row: ChatRow, source: string) => boolean
}

/** The rows the selection lists, in their order. */
export function selectRows<R extends ChatRow>(rows: R[], selection: readonly ChatFilterKey[], c: FilterContext): R[] {
  if (!selection.length) return rows
  const statuses = selection.filter(k => groupOf(k) === 'status')
  const progress = selection.filter(k => groupOf(k) === 'progress')
  const sources = selection.filter(isSourceKey).map(k => k.slice('source:'.length))
  const starred = selection.includes('starred')
  const one = (row: R, key: ChatFilterKey) => filterRows([row], key as ChatFilter, c.marks, c.running, c.waiting, c.done).length > 0
  return rows.filter(
    row =>
      (!starred || isStarred(c.marks, row)) &&
      (!statuses.length || statuses.some(k => one(row, k))) &&
      (!progress.length || progress.some(k => one(row, k))) &&
      (!sources.length || sources.some(s => c.underSource(row, s)))
  )
}

/** A selection read back, keeping only what a menu could hold. */
export function parseSelection(raw: unknown): ChatFilterKey[] {
  if (!Array.isArray(raw)) return []
  const known: readonly string[] = ['starred', ...STATUS_KEYS, ...PROGRESS_KEYS]
  return [...new Set(raw.filter((k): k is ChatFilterKey => typeof k === 'string' && (known.includes(k) || /^source:[a-z0-9_-]+$/i.test(k))))]
}
