import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { chatTasksLabel, isBlockedTask, isOpenTask, type ChatTask } from '../state/chatTasks'
import { columnTitle } from '../state/kanban'
import { Icon } from './icons'

interface Props {
  tasks: ChatTask[]
  chatKey: string
  /** Opens the task in Tasks > Board; left out where the window has no Tasks (a chat in a window of its own). */
  onOpen?: (task: ChatTask) => void
}

/**
 * The Kanban tasks the chat handed to the board, after the phone's line
 * (desktop#553): "Kanban: 2 in progress" above the composer, beside the
 * delegate agents' line and drawn like it, opening into a row per task with
 * its lane, who has it, its board and, while it's blocked, why. Red while
 * one is blocked; "Kanban tasks finished" once none is open, until the chat
 * changes or the × hides it.
 */
export function ChatTasksDock({ tasks, chatKey, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const going = tasks.filter(isOpenTask).length
  const blocked = tasks.some(isBlockedTask)

  useEffect(() => {
    setOpen(false)
    setHidden(false)
  }, [chatKey])
  // A task that opens again (or a new one) shows the line again.
  useEffect(() => {
    if (going) setHidden(false)
  }, [going])

  if (!tasks.length || hidden) return null
  const boards = new Set(tasks.map(task => task.board))

  return (
    <div className={`plan-dock agents-dock chat-tasks-dock${open ? ' open' : ''}${blocked ? ' blocked' : ''}`}>
      {open ? (
        <ul className="plan-items agent-cards" aria-label={t('Kanban tasks')}>
          <li className="meta agent-caption">{t('Cards this chat put on the Kanban board. Hermes’ workers run them in the background.')}</li>
          {tasks.map(task => (
            <li key={`${task.board}\n${task.id}`} className={`agent-card chat-task status-${isOpenTask(task) ? (isBlockedTask(task) ? 'failed' : 'running') : 'completed'}`}>
              <div className="agent-head">
                <strong>{task.title}</strong>
                <span className="spacer" />
                <span className="meta">{columnTitle(task.status)}</span>
              </div>
              <div className="meta">
                {[task.assignee ?? t('Unassigned'), boards.size > 1 || task.board !== 'default' ? task.boardName : null].filter(Boolean).join(' · ')}
              </div>
              {task.error ? <div className="agent-line chat-task-error">{task.error}</div> : null}
              {onOpen ? (
                <button className="link" onClick={() => onOpen(task)}>
                  {t('Open in Tasks')}
                </button>
              ) : null}
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
    </div>
  )
}
