/**
 * Tasks > Board, after the phone's Kanban: Hermes' shared task board from
 * the kanban plugin (`/api/plugins/kanban`). The board is cross-profile by
 * design, so nothing here names a profile; a board is picked by its slug.
 */
import { t } from '../../../shared/i18n'
import { initialCursor } from './kanbanEvents'

export const KANBAN = '/api/plugins/kanban'

export interface KanbanTask {
  id: string
  title: string
  body?: string
  assignee?: string
  status: string
  priority: number
  createdAt?: number
  startedAt?: number
  completedAt?: number
  result?: string
  latestSummary?: string
  lastFailureError?: string
  commentCount: number
  progress?: { done: number; total: number }
  warnings?: number
}

export interface KanbanColumn {
  name: string
  tasks: KanbanTask[]
}

export interface KanbanBoard {
  columns: KanbanColumn[]
  assignees: string[]
  /** The newest task event this read saw (`latest_event_id`): where the live stream starts. */
  latestEventId?: number
}

export interface KanbanBoardRow {
  slug: string
  name: string
  total: number
  current: boolean
}

export interface KanbanComment {
  id: string
  author: string
  body: string
  createdAt?: number
}

export interface KanbanEvent {
  id: string
  kind: string
  createdAt?: number
}

export interface KanbanTaskDetail {
  task: KanbanTask
  comments: KanbanComment[]
  events: KanbanEvent[]
  parents: { id: string; title: string; status: string }[]
  children: { id: string; title: string; status: string; summary?: string }[]
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
/** Hermes' epoch seconds as milliseconds. */
const when = (value: unknown): number | undefined => {
  const seconds = num(value)
  return seconds && seconds > 0 ? seconds * 1000 : undefined
}

export function parseTask(raw: unknown): KanbanTask | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = str(row.id)
  if (!id) return null
  const progress = row.progress as { done?: unknown; total?: unknown } | null | undefined
  const done = num(progress?.done)
  const total = num(progress?.total)
  const warnings = num((row.warnings as { count?: unknown } | null | undefined)?.count)
  return {
    id,
    title: str(row.title) ?? id,
    body: str(row.body),
    assignee: str(row.assignee),
    status: str(row.status) ?? 'todo',
    priority: num(row.priority) ?? 0,
    createdAt: when(row.created_at),
    startedAt: when(row.current_run_started_at) ?? when(row.started_at),
    completedAt: when(row.completed_at),
    result: str(row.result),
    latestSummary: str(row.latest_summary),
    lastFailureError: str(row.last_failure_error),
    commentCount: num(row.comment_count) ?? 0,
    progress: done !== undefined && total ? { done, total } : undefined,
    warnings: warnings || undefined
  }
}

/** The order the phone shows the lanes in; one Hermes adds goes after them. */
export const COLUMN_ORDER = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']

/** Lanes a task can be moved to by hand; the rest only Hermes moves a task into. */
export const MOVABLE = ['triage', 'todo', 'ready', 'blocked', 'done']

/** A new task starts in one of these. */
export const CREATABLE = ['triage', 'todo', 'ready', 'blocked']

export function parseBoard(raw: unknown): KanbanBoard {
  const object = (raw ?? {}) as { columns?: unknown; assignees?: unknown; latest_event_id?: unknown }
  const columns = (Array.isArray(object.columns) ? object.columns : []).flatMap(value => {
    const column = (value ?? {}) as { name?: unknown; tasks?: unknown }
    const name = str(column.name)
    if (!name) return []
    const tasks = (Array.isArray(column.tasks) ? column.tasks : []).map(parseTask).filter((task): task is KanbanTask => task !== null)
    return [{ name, tasks }]
  })
  const rank = (name: string) => {
    const index = COLUMN_ORDER.indexOf(name)
    return index < 0 ? COLUMN_ORDER.length : index
  }
  columns.sort((a, b) => rank(a.name) - rank(b.name))
  const assignees = (Array.isArray(object.assignees) ? object.assignees : []).filter((name): name is string => typeof name === 'string' && !!name)
  const latest = initialCursor(object.latest_event_id)
  return latest === null ? { columns, assignees } : { columns, assignees, latestEventId: latest }
}

export function parseBoards(raw: unknown): KanbanBoardRow[] {
  const object = (raw ?? {}) as { boards?: unknown; current?: unknown }
  const current = str(object.current)
  return (Array.isArray(object.boards) ? object.boards : []).flatMap(value => {
    const row = (value ?? {}) as Record<string, unknown>
    const slug = str(row.slug)
    if (!slug) return []
    return [{ slug, name: str(row.name) ?? slug, total: num(row.total) ?? 0, current: row.is_current === true || slug === current }]
  })
}

export function parseTaskDetail(raw: unknown): KanbanTaskDetail | null {
  const object = (raw ?? {}) as Record<string, unknown>
  const task = parseTask(object.task)
  if (!task) return null
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : [])
  const linked = new Map(list(object.link_tasks).map(row => [String(row.id), row]))
  const links = (object.links ?? {}) as { parents?: unknown; children?: unknown }
  const linkRows = (ids: unknown) =>
    (Array.isArray(ids) ? ids : []).map(id => {
      const row = linked.get(String(id))
      return { id: String(id), title: str(row?.title) ?? String(id), status: str(row?.status) ?? '' }
    })
  const summaries = new Map(list(object.child_results).map(row => [String(row.id), str(row.result) ?? str(row.latest_summary)]))
  return {
    task,
    comments: list(object.comments).map((row, index) => ({
      id: String(row.id ?? index),
      author: str(row.author) ?? '',
      body: typeof row.body === 'string' ? row.body : '',
      createdAt: when(row.created_at)
    })),
    events: list(object.events).map((row, index) => ({ id: String(row.id ?? index), kind: str(row.kind) ?? '', createdAt: when(row.created_at) })),
    parents: linkRows(links.parents),
    children: linkRows(links.children).map(child => ({ ...child, summary: summaries.get(child.id) }))
  }
}

/** A board path, naming the board when one is picked. */
export function boardPath(path: string, board: string | null, params: Record<string, string> = {}): string {
  const query = Object.entries({ ...(board ? { board } : {}), ...params })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `${KANBAN}${path}${query ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`
}

export function columnTitle(name: string): string {
  switch (name) {
    case 'triage':
      return t('Triage')
    case 'todo':
      return t('To Do')
    case 'scheduled':
      return t('Scheduled')
    case 'ready':
      return t('Ready')
    case 'running':
      return t('Running')
    case 'blocked':
      return t('Blocked')
    case 'review':
      return t('Review')
    case 'done':
      return t('Done')
    case 'archived':
      return t('Archived')
    default: {
      const words = name.replace(/_/g, ' ')
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : t('Other')
    }
  }
}

/** Hermes' priorities: higher runs first. The phone's names for them. */
export const PRIORITIES = [0, 1, 2, 3]

export function priorityTitle(priority: number): string {
  if (priority >= 3) return t('Critical')
  if (priority === 2) return t('Urgent')
  if (priority === 1) return t('High')
  return t('Normal')
}

/** Who a new task goes to when none is picked: Hermes' resolved default assignee. */
export function defaultAssignee(raw: unknown): string {
  const resolved = str((raw as { resolved_default_assignee?: unknown } | null)?.resolved_default_assignee)?.trim()
  return resolved || 'default'
}

/** A task's card, narrowed by every word typed (title, id, assignee, summary). */
export function matchesTask(task: KanbanTask, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [task.title, task.id, task.assignee, task.latestSummary, task.body].filter(Boolean).join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

/** "3 min", "2 h", "4 d": how long a task has been at it. */
export function ageText(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 3600) return t('{count} min', { count: Math.max(1, Math.round(seconds / 60)) })
  if (seconds < 86_400) return t('{count} h', { count: Math.round(seconds / 3600) })
  return t('{count} d', { count: Math.round(seconds / 86_400) })
}

/** The board's read while it shows, as the phone paces it without the live stream. */
export const BOARD_POLL_MS = 8000

/**
 * How long until the board is read again: a board whose reads keep finding
 * nothing new is read less often, 15 s after 15 such reads and 30 s after
 * 45, as the phone does; a read that finds a change or fails starts over.
 */
export function boardPollDelay(unchangedReads: number): number {
  if (unchangedReads >= 45) return 30_000
  if (unchangedReads >= 15) return 15_000
  return BOARD_POLL_MS
}

/** How long a first read lost in transit waits before asking once more. */
export const FIRST_READ_RETRY_MS = 1000

/**
 * A read that failed on the way rather than by Hermes' answer: no
 * connection or a timeout (no status), a 408, a 429 or a 5xx. Hermes' own
 * refusals (a 404, a 403, a 400) aren't asked again.
 */
export function failedInTransit(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'number') return true
  return code === 408 || code === 429 || code >= 500
}
