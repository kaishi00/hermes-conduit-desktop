/**
 * The Kanban tasks a chat handed to the board, after the phone's: Hermes
 * stamps each card `kanban_create` makes with the chat's session, and the
 * Conduit plugin's `/sessions/kanban-tasks` (plugin 0.197.0+) finds them on
 * every board, through the chat's compressions. A worker's own cards carry
 * the chat's stamp too, so a squad's fan-out counts (desktop#553).
 */
import { t } from '../../../shared/i18n'
import { dashboardProfilePath } from './dashboardProfile'

export const CHAT_TASKS_PATH = '/api/plugins/conduit_push/sessions/kanban-tasks'

export interface ChatTask {
  id: string
  title: string
  status: string
  assignee?: string
  board: string
  boardName: string
  /** Why it's blocked, only while it is. */
  error?: string
}

export interface ChatTasks {
  /** False when this Hermes doesn't stamp cards with their chat: nothing to show. */
  supported: boolean
  tasks: ChatTask[]
}

export function chatTasksPath(sessionId: string, profile?: string | null): string {
  return dashboardProfilePath(`${CHAT_TASKS_PATH}?session_id=${encodeURIComponent(sessionId)}`, profile)
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function parseChatTasks(raw: unknown): ChatTasks {
  const object = (raw ?? {}) as Record<string, unknown>
  const rows = Array.isArray(object.tasks) ? object.tasks : []
  const tasks: ChatTask[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = str(r.id)
    const board = str(r.board)
    if (!id || !board) continue
    tasks.push({
      id,
      title: str(r.title) || id,
      status: str(r.status).toLowerCase(),
      assignee: str(r.assignee) || undefined,
      board,
      boardName: str(r.board_name) || board,
      error: str(r.error) || undefined
    })
  }
  return { supported: object.supported === true, tasks }
}

/** Not finished yet: queued, running, blocked or waiting on review. */
export const isOpenTask = (task: ChatTask) => task.status !== 'done' && task.status !== 'archived'
export const isBlockedTask = (task: ChatTask) => task.status === 'blocked'

/**
 * The tasks the line shows: every open one, and the finished ones once the
 * chat has seen any of its tasks open while it showed. A chat reopened after
 * all its tasks finished shows nothing; its finished cards live on the board.
 */
export function shownTasks(tasks: readonly ChatTask[], seenOpen: ReadonlySet<string>): ChatTask[] {
  if (!tasks.some(isOpenTask) && !tasks.some(task => seenOpen.has(task.id))) return []
  return tasks.filter(task => isOpenTask(task) || seenOpen.has(task.id))
}

/**
 * One read's tasks merged into what the chat has seen open (`seenOpen`,
 * grown in place), and the tasks the line shows after it.
 */
export function afterRead(listed: readonly ChatTask[], seenOpen: Set<string>): ChatTask[] {
  for (const task of listed) if (isOpenTask(task)) seenOpen.add(task.id)
  return shownTasks(listed, seenOpen)
}

/** "Kanban: 2 in progress", then how many are blocked; "Kanban tasks finished" once none is open. */
export function chatTasksLabel(tasks: readonly ChatTask[]): string {
  const blocked = tasks.filter(isBlockedTask).length
  const going = tasks.filter(isOpenTask).length - blocked
  if (going && blocked) return t('Kanban: {count} in progress, {blocked} blocked', { count: String(going), blocked: String(blocked) })
  if (blocked) return t('Kanban: {count} blocked', { count: String(blocked) })
  if (going) return t('Kanban: {count} in progress', { count: String(going) })
  return t('Kanban tasks finished')
}
