import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import type { Bot } from '../state/bots'
import { chatTasksLabel, isBlockedTask, isOpenTask, type ChatTask } from '../state/chatTasks'
import { boardPath, columnTitle, parseTaskDetail } from '../state/kanban'
import { TaskPanel } from './KanbanBoard'
import { Icon } from './icons'
import { everyWhileVisible } from '../state/visibility'

/** Hermes says the task isn't there (any more): a 404. */
const gone = (error: unknown) => (error as { code?: unknown } | null)?.code === 404 || /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))

/** The open panel reads its task again this often while the window shows. */
export const CHAT_TASK_PANEL_READ_MS = 15_000

interface Props {
  tasks: ChatTask[]
  chatKey: string
  /** Opens the task in Tasks > Board; left out where the window has no Tasks (a chat in a window of its own). */
  onOpen?: (task: ChatTask) => void
  /** The dashboard's profiles, for the task's Assigned to and its names. */
  bots?: Bot[] | null
  /** A task changed or went from the panel: the line reads the chat's tasks again. */
  onChanged?: () => void
}

/**
 * The Kanban tasks the chat handed to the board, after the phone's line
 * (desktop#553): "Kanban: 2 in progress" above the composer, beside the
 * delegate agents' line and drawn like it, opening into a row per task with
 * its lane, who has it, its board and, while it's blocked, why. Red while
 * one is blocked; "Kanban tasks finished" once none is open, until the chat
 * changes or the × hides it.
 *
 * A row opens its task in a panel over the chat, on its own board, so it can
 * be read and acted on without leaving the conversation; the panel's Open in
 * Tasks goes on to the full board (desktop#593).
 */
export function ChatTasksDock({ tasks, chatKey, onOpen, bots, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [shownKey, setShownKey] = useState<string | null>(null)
  const going = tasks.filter(isOpenTask).length
  const blocked = tasks.some(isBlockedTask)

  useEffect(() => {
    setOpen(false)
    setHidden(false)
    setShownKey(null)
  }, [chatKey])
  // A task that opens again (or a new one) shows the line again.
  useEffect(() => {
    if (going) setHidden(false)
  }, [going])

  const keyOf = (task: ChatTask) => `${task.board}\n${task.id}`
  const shownTask = shownKey ? (tasks.find(task => keyOf(task) === shownKey) ?? null) : null
  // A task the chat no longer lists (another chat, or deleted) closes its panel.
  useEffect(() => {
    if (shownKey && !shownTask) setShownKey(null)
  }, [shownKey, shownTask])

  if (!tasks.length || hidden) return null
  const boards = new Set(tasks.map(task => task.board))

  return (
    <div className={`plan-dock agents-dock chat-tasks-dock${open ? ' open' : ''}${blocked ? ' blocked' : ''}`}>
      {open ? (
        <ul className="plan-items agent-cards" aria-label={t('Kanban tasks')}>
          <li className="meta agent-caption">{t('Cards this chat put on the Kanban board. Hermes’ workers run them in the background.')}</li>
          {tasks.map(task => (
            <li key={keyOf(task)} className={`agent-card chat-task status-${isOpenTask(task) ? (isBlockedTask(task) ? 'failed' : 'running') : 'completed'}`}>
              <button className={`chat-task-open${shownKey === keyOf(task) ? ' active' : ''}`} aria-haspopup="dialog" onClick={() => setShownKey(keyOf(task))}>
                <div className="agent-head">
                  <span className={`lane-dot ${task.status}`} aria-hidden="true" />
                  <strong>{task.title}</strong>
                  <span className="meta chat-task-status">{columnTitle(task.status)}</span>
                  <Icon name="chevron" />
                </div>
                <div className="meta">
                  {[task.assignee ?? t('Unassigned'), boards.size > 1 || task.board !== 'default' ? task.boardName : null].filter(Boolean).join(' · ')}
                </div>
                {task.error ? <div className="agent-line chat-task-error">{task.error}</div> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="plan-line">
        <button className="plan-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {going && !blocked ? <span className="spinner" aria-hidden="true" /> : null}
          {!going || blocked ? <Icon name="tasks" /> : null}
          <strong>{chatTasksLabel(tasks)}</strong>
          <span className="spacer" />
          <Icon name="chevron" />
        </button>
        {!going ? (
          <button className="staged-remove" aria-label={t('Hide')} title={t('Hide')} onClick={() => setHidden(true)}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      {shownTask ? (
        <ChatTaskPanel
          key={shownKey!}
          task={shownTask}
          bots={bots ?? null}
          onClose={() => setShownKey(null)}
          onChanged={onChanged}
          onOpen={
            onOpen
              ? () => {
                  setShownKey(null)
                  onOpen(shownTask)
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

/**
 * One of the chat's tasks, in the board's task panel over the chat: read and
 * changed on its own board through the chat's dashboard, as the line reads
 * them, so nothing on Tasks changes (its board pick included).
 */
function ChatTaskPanel({
  task,
  bots,
  onClose,
  onChanged,
  onOpen
}: {
  task: ChatTask
  bots: Bot[] | null
  onClose: () => void
  onChanged?: () => void
  onOpen?: () => void
}) {
  const path = useCallback((rest: string) => boardPath(`/tasks/${encodeURIComponent(task.id)}${rest}`, task.board), [task.id, task.board])
  const load = useCallback(async () => {
    try {
      return parseTaskDetail(await gateway.http('GET', path('')))
    } catch (e) {
      // Deleted or gone from its board meanwhile: the panel closes and the line reads again, so it drops the task.
      if (gone(e)) {
        onClose()
        onChanged?.()
      }
      throw e
    }
  }, [path, onClose, onChanged])
  const botTitle = (name?: string) => (name ? (bots?.find(b => b.name === name)?.title ?? name) : t('Unassigned'))
  const assignees = useMemo(
    () => (bots ?? []).map(b => b.name).sort((a, b) => (bots?.find(x => x.name === a)?.title ?? a).localeCompare(bots?.find(x => x.name === b)?.title ?? b)),
    [bots]
  )
  // No live stream here: the panel reads its task again when the line's reads (every 15 s while one is open) see it
  // move on, and every 15 s on its own while it shows, so a worker's new summary, comment or result shows too.
  const [tick, setTick] = useState(0)
  useEffect(() => everyWhileVisible(() => setTick(n => n + 1), CHAT_TASK_PANEL_READ_MS), [])
  const revision = useRef(0)
  const seen = useRef('')
  const moved = `${task.status}\n${task.assignee ?? ''}\n${task.error ?? ''}\n${tick}`
  if (seen.current !== moved) {
    seen.current = moved
    revision.current += 1
  }
  const touched = useMemo(() => ({ revision: revision.current, ids: new Set([task.id]) as ReadonlySet<string> }), [moved, task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TaskPanel
      id={task.id}
      task={null}
      assignees={assignees}
      botTitle={botTitle}
      load={load}
      board={task.board}
      pinned
      touched={touched}
      onClose={onClose}
      onPatch={async fields => {
        await gateway.http('PATCH', path(''), fields)
        onChanged?.()
      }}
      onComment={async body => {
        await gateway.http('POST', path('/comments'), { body })
      }}
      onDelete={async () => {
        await gateway.http('DELETE', path(''))
        onClose()
        onChanged?.()
      }}
      extra={
        onOpen ? (
          <button className="link" onClick={onOpen}>
            {t('Open in Tasks')}
          </button>
        ) : null
      }
    />
  )
}
