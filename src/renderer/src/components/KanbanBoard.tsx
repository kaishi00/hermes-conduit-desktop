import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import { CREATABLE, MOVABLE, PRIORITIES, ageText, columnTitle, eventPayloadText, kanbanWord, matchesTask, priorityTitle, sizeText, type KanbanAttachment, type KanbanRun, type KanbanTask, type KanbanTaskDetail } from '../state/kanban'
import { useKanban } from '../state/useKanban'
import { timeLabel } from '../state/chats'
import { Markdown } from './Markdown'
import { Icon } from './icons'
import { ask } from '../state/dialogs'
import { Select, SelectGroup } from './Select'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { useBoardScroll } from '../state/useBoardScroll'
import { useFittedMenu } from '../state/menuFit'

interface Props {
  connected: boolean
  bots: Bot[] | null
  /** Every combined dashboard's profiles: their dashboards' boards join the picker, and a far board's assignees are its own. */
  tiles?: readonly MixedTile[]
  /** A dashboard's badge, by its URL (this one's included). */
  hostBadge?: (host: string | null) => HostBadge | null
  /** The Board | Scheduled switch, for the header. */
  segment: ReactNode
}

/** The picker's value for a board: its dashboard (none for this one), then its slug. */
const boardValue = (host: string | null, slug: string) => `${host ?? ''}\n${slug}`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Tasks > Board, after the phone's Kanban: the board's lanes side by side,
 * each card its title, who has it and how it's going. A card opens its task
 * on the right: details, the latest summary, comments, and moving,
 * assigning, reprioritizing or deleting it. Drag a card to a lane to move it,
 * or right-click it for the phone's card menu.
 *
 * The lanes run wider than the window, so the chips above them bring a lane
 * into view (the phone's jump bar), the wheel and a grab on empty board space
 * move it sideways, and a card dragged to the edge rolls the board on.
 */
export function KanbanBoard({ connected, bots: ownBots, tiles = [], hostBadge, segment }: Props) {
  const farHosts = useMemo(() => [...new Set(tiles.filter(tile => !tile.own).map(tile => tile.host))], [tiles])
  const kanban = useKanban(connected, true, farHosts)
  const shownList = kanban.lists.find(list => list.host === kanban.host)
  const shownBoard = shownList?.boards.find(row => (kanban.slug ? row.slug === kanban.slug : row.current))
  const shownBadge = kanban.lists.length > 1 ? (hostBadge?.(kanban.host) ?? null) : null
  // A far board's people are its own dashboard's profiles.
  const bots = useMemo(
    () => (kanban.host ? tiles.filter(tile => !tile.own && tile.host === kanban.host).map(tile => tile.bot) : ownBots),
    [kanban.host, tiles, ownBots]
  )
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragged = useRef<KanbanTask | null>(null)
  const [menu, setMenu] = useState<{ task: KanbanTask; x: number; y: number } | null>(null)
  const menuFit = useFittedMenu(menu)
  const lanesRef = useRef<HTMLDivElement | null>(null)

  const botTitle = (name?: string) => (name ? bots?.find(b => b.name === name)?.title ?? name : t('Unassigned'))
  const columns = useMemo(
    () => (kanban.board?.columns ?? []).map(column => ({ ...column, tasks: column.tasks.filter(task => matchesTask(task, query)) })),
    [kanban.board, query]
  )
  // The lanes container goes away while the board is unavailable, so its key changes then too.
  const scroll = useBoardScroll(lanesRef, kanban.unavailable ? '' : columns.map(column => column.name).join(' '))
  const openTask = kanban.board?.columns.flatMap(c => c.tasks).find(task => task.id === openId) ?? null
  const assignees = useMemo(() => {
    const names = new Set([...(kanban.board?.assignees ?? []), ...(bots ?? []).map(b => b.name)])
    return [...names].sort((a, b) => botTitle(a).localeCompare(botTitle(b)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kanban.board, bots])

  async function move(task: KanbanTask, status: string) {
    if (task.status === status) return
    setNote(null)
    try {
      await kanban.patch(task, { status })
    } catch (e) {
      // Hermes won't close a task without word of what was done.
      const needsSummary = status === 'done' && /summary/i.test(message(e))
      setNote({
        text: needsSummary
          ? t('Hermes needs a note on what was done before {title} can be marked done. Open the task, write it, and choose Mark done.', { title: task.title })
          : t('Couldn’t move {title}: {reason}', { title: task.title, reason: message(e) }),
        tone: 'error'
      })
    }
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    // Escape closes the menu only, not the task panel open beside it: this runs first and keeps it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // A menu, an open task or a new task begun on one board never acts on another (another dashboard's included).
  useEffect(() => setMenu(null), [kanban.slug, kanban.host, kanban.unavailable])
  // A task belongs to its board: picking another closes its panel, so nothing in it (an attachment's Save) acts on the wrong board.
  const openedOn = useRef(`${kanban.host ?? ''}\n${kanban.slug ?? ''}`)
  useEffect(() => {
    const key = `${kanban.host ?? ''}\n${kanban.slug ?? ''}`
    if (openedOn.current === key) return
    openedOn.current = key
    setOpenId(null)
    setComposing(false)
  }, [kanban.slug, kanban.host])
  // With no board picked, the board is whatever Hermes calls current, which another client can change:
  // a menu whose task left the board read closes rather than act on the new one.
  useEffect(() => {
    if (menu && !kanban.board?.columns.some(column => column.tasks.some(task => task.id === menu.task.id))) setMenu(null)
  }, [kanban.board, menu])

  function copy(text: string, done: string) {
    navigator.clipboard.writeText(text).then(
      () => setNote({ text: done, tone: 'info' }),
      e => setNote({ text: message(e), tone: 'error' })
    )
  }

  async function archive(task: KanbanTask) {
    setNote(null)
    try {
      await kanban.patch(task, { status: 'archived' })
    } catch (e) {
      setNote({ text: message(e), tone: 'error' })
    }
  }

  async function remove(task: KanbanTask) {
    if (!(await ask(`${t('Delete task?')}\n\n${t('This removes {title} from the board for good.', { title: task.title })}`, { confirm: t('Delete'), destructive: true }))) return
    setNote(null)
    try {
      await kanban.remove(task)
      setOpenId(id => (id === task.id ? null : id))
    } catch (e) {
      setNote({ text: message(e), tone: 'error' })
    }
  }

  function endDrag() {
    dragged.current = null
    setDropTarget(null)
    scroll.stopEdge()
  }

  return (
    <main className="board">
      <div className="board-head">
        {segment}
        {kanban.lists.reduce((n, list) => n + list.boards.length, 0) > 1 ? (
          <Select
            className="board-picker"
            aria-label={t('Board')}
            value={boardValue(kanban.host, kanban.slug ?? shownBoard?.slug ?? '')}
            // With more than one dashboard's boards, the field names the board's dashboard by its badge.
            shownLabel={shownBadge ? (
              <span className="board-picker-name">
                <HostBadgeMark badge={shownBadge} />
                {shownBoard ? `${shownBoard.name} (${shownBoard.total})` : null}
              </span>
            ) : undefined}
            onChange={picked => {
              const at = picked.indexOf('\n')
              kanban.pickBoard(picked.slice(at + 1) || null, picked.slice(0, at) || null)
            }}
          >
            {kanban.lists.length > 1
              ? kanban.lists.map(list => {
                  const badge = hostBadge?.(list.host) ?? null
                  return (
                    <SelectGroup
                      key={list.host ?? ''}
                      id={list.host ?? ''}
                      label={
                        <>
                          {badge ? <HostBadgeMark badge={badge} /> : null}
                          {badge?.name ?? ''}
                        </>
                      }
                    >
                      {list.boards.map(row => (
                        <option key={row.slug} value={boardValue(list.host, row.slug)}>
                          {row.name} ({row.total})
                        </option>
                      ))}
                    </SelectGroup>
                  )
                })
              : kanban.lists[0].boards.map(row => (
                  <option key={row.slug} value={boardValue(null, row.slug)}>
                    {row.name} ({row.total})
                  </option>
                ))}
          </Select>
        ) : null}
        <label className="chatlist-search board-search">
          <Icon name="search" />
          <span className="sr-only">{t('Search tasks')}</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search tasks')} />
        </label>
        <span className="spacer" />
        <button className="primary board-new" disabled={!connected || kanban.unavailable} onClick={() => setComposing(true)}>
          <Icon name="plus" />
          {t('New task')}
        </button>
      </div>
      {note ? (
        <div className={`model-note board-note${note.tone === 'error' ? ' error' : ''}`} role="status">
          {note.text}
          <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      {kanban.unavailable ? (
        <div className="needs-empty">
          <Icon name="tasks" />
          <span>{t('This Hermes has no task board.')}</span>
          <span className="meta">{t('The board comes with Hermes’ Kanban plugin. Turn it on in the Hermes dashboard to see tasks here.')}</span>
        </div>
      ) : !kanban.board ? (
        <div className="needs-empty">
          <span>{kanban.error ? t('Couldn’t load the board: {reason}', { reason: kanban.error }) : t('Loading…')}</span>
        </div>
      ) : (
        <>
        <div
          className="board-jump"
          role="toolbar"
          aria-label={t('Lanes')}
          onWheel={e => {
            // A narrow window clips the chips: the wheel moves them along.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
          {columns.map((column, index) => (
            <button
              key={column.name}
              className={`board-chip${scroll.inView[index] ? ' on' : ''}`}
              aria-label={`${columnTitle(column.name)}, ${t('{count} tasks', { count: column.tasks.length })}`}
              aria-current={scroll.inView[index] ? 'location' : undefined}
              onClick={() => scroll.jumpTo(index)}
            >
              <span className={`lane-dot ${column.name}`} />
              {columnTitle(column.name)}
              <span className="meta">{column.tasks.length}</span>
              {!MOVABLE.includes(column.name) ? <Icon name="lock" /> : null}
            </button>
          ))}
        </div>
        <div
          className="board-lanes"
          ref={lanesRef}
          onDragOver={e => {
            if (dragged.current) scroll.dragAt(e.clientX)
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scroll.stopEdge()
          }}
        >
          {columns.map(column => {
            const droppable = MOVABLE.includes(column.name)
            return (
              <section
                key={column.name}
                className={`lane${dropTarget === column.name ? ' drop' : ''}`}
                aria-label={columnTitle(column.name)}
                onDragOver={e => {
                  if (!droppable || !dragged.current || dragged.current.status === column.name) return
                  e.preventDefault()
                  setDropTarget(column.name)
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(target => (target === column.name ? null : target))
                }}
                onDrop={e => {
                  e.preventDefault()
                  const task = dragged.current
                  endDrag()
                  if (task && droppable) void move(task, column.name)
                }}
              >
                <div className="lane-head">
                  <span className={`lane-dot ${column.name}`} />
                  <span className="lane-title">{columnTitle(column.name)}</span>
                  <span className="meta">{column.tasks.length}</span>
                  {!droppable ? (
                    <span className="lane-lock" title={t('Locked')} aria-label={t('Locked')}>
                      <Icon name="lock" />
                    </span>
                  ) : null}
                </div>
                <div className="lane-cards">
                  {column.tasks.map(task => (
                    <button
                      key={task.id}
                      className="card"
                      aria-current={task.id === openId ? 'true' : undefined}
                      draggable
                      onDragStart={e => {
                        dragged.current = task
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', task.id)
                      }}
                      onDragEnd={endDrag}
                      onContextMenu={e => {
                        e.preventDefault()
                        setMenu({ task, x: e.clientX, y: e.clientY })
                      }}
                      onClick={() => {
                        setComposing(false)
                        setOpenId(task.id)
                      }}
                    >
                      <span className="card-title">{task.title}</span>
                      {task.latestSummary && column.name !== 'todo' ? <span className="card-summary">{task.latestSummary}</span> : null}
                      <span className="card-meta">
                        <span>{botTitle(task.assignee)}</span>
                        {task.priority > 0 ? <span className={`card-priority p${Math.min(task.priority, 3)}`}>{priorityTitle(task.priority)}</span> : null}
                        {task.progress ? <span>{`${task.progress.done}/${task.progress.total}`}</span> : null}
                        {task.commentCount ? (
                          <span className="card-count">
                            <Icon name="chats" />
                            {task.commentCount}
                          </span>
                        ) : null}
                        {task.warnings ? <span className="card-warning">⚠ {task.warnings}</span> : null}
                        {column.name === 'running' && task.startedAt ? <span>{ageText(task.startedAt)}</span> : null}
                      </span>
                    </button>
                  ))}
                  {!column.tasks.length ? <div className="lane-empty meta">{query.trim() ? '—' : t('No tasks')}</div> : null}
                </div>
              </section>
            )
          })}
        </div>
        </>
      )}
      {menu ? (
        <div ref={menuFit.ref} className="host-menu row-menu card-menu" role="menu" style={menuFit.style}>
          <button
            role="menuitem"
            onClick={() => {
              setComposing(false)
              setOpenId(menu.task.id)
            }}
          >
            {t('Open')}
          </button>
          {MOVABLE.filter(status => status !== menu.task.status).map(status => (
            <button key={status} role="menuitem" disabled={!connected} onClick={() => void move(menu.task, status)}>
              {t('Move to {lane}', { lane: columnTitle(status) })}
            </button>
          ))}
          <button role="menuitem" onClick={() => copy(menu.task.id, t('Task ID copied'))}>
            {t('Copy Task ID')}
          </button>
          <button role="menuitem" onClick={() => copy(menu.task.title, t('Title copied'))}>
            {t('Copy Task Title')}
          </button>
          {menu.task.status !== 'archived' ? (
            <button role="menuitem" disabled={!connected} onClick={() => void archive(menu.task)}>
              {t('Archive')}
            </button>
          ) : null}
          <button role="menuitem" className="danger" disabled={!connected} onClick={() => void remove(menu.task)}>
            {t('Delete…')}
          </button>
        </div>
      ) : null}
      {composing ? (
        <TaskComposer
          assignees={assignees}
          defaultAssignee={kanban.defaultAssignee}
          botTitle={botTitle}
          onCancel={() => setComposing(false)}
          onCreate={async body => {
            const made = await kanban.create(body)
            setComposing(false)
            if (made.task) setOpenId(made.task.id)
            if (made.warning) setNote({ text: made.warning, tone: 'info' })
          }}
        />
      ) : openTask || openId ? (
        <TaskPanel
          key={openId!}
          id={openId!}
          task={openTask}
          assignees={assignees}
          botTitle={botTitle}
          load={kanban.detail}
          board={kanban.slug}
          touched={kanban.touched}
          onClose={() => setOpenId(null)}
          onPatch={async fields => {
            if (!openTask) return
            await kanban.patch(openTask, fields)
          }}
          onComment={async body => {
            if (openTask) await kanban.comment(openTask, body)
          }}
          onDelete={async () => {
            if (!openTask) return
            await kanban.remove(openTask)
            setOpenId(null)
          }}
        />
      ) : null}
    </main>
  )
}

export function TaskPanel({
  id,
  task,
  assignees,
  botTitle,
  load,
  board,
  touched,
  onClose,
  onPatch,
  onComment,
  onDelete
}: {
  id: string
  task: KanbanTask | null
  assignees: string[]
  botTitle: (name?: string) => string
  load: (id: string) => Promise<KanbanTaskDetail | null>
  /** The board the task is on, for its attachments' download link. */
  board: string | null
  /** The live stream's last batch: the task reads again when it touched this task or one of its children (a child's result). */
  touched: { revision: number; ids: ReadonlySet<string> }
  onClose: () => void
  onPatch: (fields: Record<string, unknown>) => Promise<void>
  onComment: (body: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ title: string; body: string } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const shown = task ?? detail?.task ?? null
  // The last live batch that touched this task or a child; an unrelated batch keeps it, so it reads nothing again.
  const lastTouched = useRef(0)
  // Tasks a batch touched before the first read came back, when the children weren't known yet.
  const touchedBeforeRead = useRef(new Set<string>())
  const touchedSeen = useRef(0)
  const missedReads = useRef(0)
  if (touched.revision !== touchedSeen.current) {
    touchedSeen.current = touched.revision
    if (!detail) touched.ids.forEach(touchedId => touchedBeforeRead.current.add(touchedId))
  }
  if (detail && touchedBeforeRead.current.size) {
    const missed = detail.children.some(child => touchedBeforeRead.current.has(child.id))
    touchedBeforeRead.current.clear()
    // A child changed while the first read was out: read once more.
    if (missed) missedReads.current += 1
  }
  if (touched.revision !== lastTouched.current && (touched.ids.has(id) || Boolean(detail?.children.some(child => touched.ids.has(child.id))))) {
    lastTouched.current = touched.revision
  }
  const touchedHere = `${lastTouched.current}:${missedReads.current}`

  async function saveAttachment(attachment: KanbanAttachment) {
    if (saving) return
    setSaving(attachment.id)
    setAttachmentError(null)
    try {
      const outcome = await window.conduit.saveKanbanAttachment(attachment.id, board, attachment.filename)
      if (outcome !== 'saved' && outcome !== 'cancelled') setAttachmentError(outcome)
    } catch (e) {
      setAttachmentError(message(e))
    } finally {
      setSaving(null)
    }
  }

  const refresh = () =>
    load(id)
      .then(next => {
        setDetail(next)
        setFailure(null)
      })
      .catch(e => setFailure(message(e)))

  // Read again when the board says the task moved on, or the live stream says something happened to it.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, task?.status, task?.assignee, task?.commentCount, task?.latestSummary, touchedHere])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing])

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  if (!shown) {
    return (
      <aside className="task-panel" aria-label={t('Task')}>
        <div className="task-panel-head">
          <span className="meta">{failure ? t('Couldn’t load this task: {reason}', { reason: failure }) : t('Loading…')}</span>
          <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </aside>
    )
  }

  const blocked = shown.status === 'blocked'
  const movable = MOVABLE.includes(shown.status) || ['running', 'review', 'scheduled'].includes(shown.status)
  return (
    <aside className="task-panel" aria-label={shown.title}>
      <div className="task-panel-head">
        <span className={`lane-dot ${shown.status}`} />
        <span className="meta">
          {columnTitle(shown.status)} · {shown.id}
        </span>
        <span className="spacer" />
        <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="task-panel-scroll">
        {editing ? (
          <form
            className="task-edit"
            onSubmit={e => {
              e.preventDefault()
              const fields: Record<string, unknown> = {}
              if (editing.title.trim() && editing.title.trim() !== shown.title) fields.title = editing.title.trim()
              if (editing.body !== (shown.body ?? '')) fields.body = editing.body
              void run(async () => {
                if (Object.keys(fields).length) await onPatch(fields)
                setEditing(null)
              })
            }}
          >
            <input aria-label={t('Title')} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} autoFocus />
            <textarea aria-label={t('Description')} rows={6} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} />
            <div className="job-actions">
              <button type="submit" className="primary" disabled={busy || !editing.title.trim()}>
                {t('Save')}
              </button>
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                {t('Cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="task-title">{shown.title}</h2>
            {shown.body ? (
              <div className="task-body">
                <Markdown text={shown.body} />
              </div>
            ) : null}
          </>
        )}
        <div className="task-controls">
          <label>
            {t('Status')}
            <Select value={shown.status} disabled={busy || !movable} onChange={picked => void run(() => onPatch({ status: picked }))}>
              {[...new Set([shown.status, ...MOVABLE])].map(status => (
                <option key={status} value={status} disabled={status !== shown.status && !MOVABLE.includes(status)}>
                  {columnTitle(status)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {t('Assigned to')}
            <Select value={shown.assignee ?? ''} disabled={busy} onChange={picked => void run(() => onPatch({ assignee: picked }))}>
              <option value="">{t("Parked (won't run)")}</option>
              {[...new Set([...(shown.assignee ? [shown.assignee] : []), ...assignees])].map(name => (
                <option key={name} value={name}>
                  {botTitle(name)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {t('Priority')}
            <Select value={shown.priority} disabled={busy} onChange={picked => void run(() => onPatch({ priority: Number(picked) }))}>
              {[...new Set([shown.priority, ...PRIORITIES])].sort().map(priority => (
                <option key={priority} value={priority}>
                  {priorityTitle(priority)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {error ? <div className="error-text">{error}</div> : null}
        {shown.lastFailureError ? (
          <section className="job-section">
            <h3>{t('Last error')}</h3>
            <p className="error-text">{shown.lastFailureError}</p>
          </section>
        ) : null}
        {detail?.task.latestSummary ?? shown.latestSummary ? (
          <section className="job-section">
            <h3>{t('Latest summary')}</h3>
            <div className="task-body">
              <Markdown text={(detail?.task.latestSummary ?? shown.latestSummary)!} />
            </div>
          </section>
        ) : null}
        {shown.result ? (
          <section className="job-section">
            <h3>{t('Result')}</h3>
            <div className="task-body">
              <Markdown text={shown.result} />
            </div>
          </section>
        ) : null}
        {detail?.parents.length ? (
          <section className="job-section">
            <h3>{t('Blocked by')}</h3>
            {detail.parents.map(parent => (
              <span key={parent.id} className="task-link">
                <span className={`lane-dot ${parent.status}`} />
                {parent.title}
              </span>
            ))}
          </section>
        ) : null}
        {detail?.children.length ? (
          <section className="job-section">
            <h3>{t('Blocks')}</h3>
            {detail.children.map(child => (
              <Fragment key={child.id}>
                <span className="task-link">
                  <span className={`lane-dot ${child.status}`} />
                  {child.title}
                </span>
                {/* What the child handed back (child_results), whole, as the phone's Blocks row previews it. */}
                {child.summary ? (
                  <div className="task-body child-result">
                    <Markdown text={child.summary} />
                  </div>
                ) : null}
              </Fragment>
            ))}
          </section>
        ) : null}
        <section className="job-section">
          <h3>{t('Comments')}</h3>
          {detail?.comments.length ? (
            detail.comments.map(comment => (
              <div key={comment.id} className="task-comment">
                <span className="meta">
                  {comment.author || '—'} · {timeLabel(comment.createdAt)}
                </span>
                <Markdown text={comment.body} />
              </div>
            ))
          ) : (
            <p className="meta">{detail ? t('No comments yet.') : t('Loading…')}</p>
          )}
          <form
            className="task-reply"
            onSubmit={e => {
              e.preventDefault()
              const body = reply.trim()
              if (!body) return
              void run(async () => {
                await onComment(body)
                setReply('')
              })
            }}
          >
            <textarea
              rows={2}
              value={reply}
              placeholder={blocked ? t('Answer the question, then unblock') : t('Add a comment, or a note on what was done')}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
              }}
            />
            <div className="job-actions">
              <button type="submit" className="secondary" disabled={busy || !reply.trim()}>
                {t('Add comment')}
              </button>
              {shown.status !== 'done' && shown.status !== 'archived' ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  title={t('Closes the task, with the note as its summary of what was done.')}
                  onClick={() =>
                    void run(async () => {
                      const summary = reply.trim()
                      await onPatch(summary ? { status: 'done', summary } : { status: 'done' })
                      setReply('')
                    })
                  }
                >
                  {t('Mark done')}
                </button>
              ) : null}
              {blocked ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const body = reply.trim()
                      if (body) {
                        await onComment(body)
                        setReply('')
                      }
                      try {
                        await onPatch({ status: 'ready' })
                      } catch (e) {
                        throw new Error(body ? t('The reply was posted, but the task could not be unblocked. ({detail})', { detail: message(e) }) : message(e))
                      }
                    })
                  }
                >
                  {reply.trim() ? t('Reply and unblock') : t('Unblock')}
                </button>
              ) : null}
            </div>
          </form>
        </section>
        {detail?.attachments.length ? (
          <section className="job-section">
            <h3>{t('Attachments')}</h3>
            {detail.attachments.map(attachment => (
              <div key={attachment.id} className="task-attachment">
                <span className="task-attachment-name">{attachment.filename}</span>
                <span className="meta">
                  {[attachment.size !== undefined ? sizeText(attachment.size) : null, attachment.uploadedBy, attachment.createdAt ? timeLabel(attachment.createdAt) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {/* Like the panel's other actions, Save needs the task on the board read: with no board picked, another
                    client can change Hermes' current board, and the old board's attachment would be asked of the new one. */}
                <button
                  type="button"
                  className="secondary"
                  disabled={saving !== null || !task}
                  title={task ? undefined : t('This task is no longer on the board shown.')}
                  onClick={() => void saveAttachment(attachment)}
                >
                  {saving === attachment.id ? t('Saving…') : t('Save')}
                </button>
              </div>
            ))}
            {attachmentError ? <div className="error-text">{attachmentError}</div> : null}
          </section>
        ) : null}
        {detail?.runs.length ? (
          <section className="job-section">
            <h3>{t('Runs')}</h3>
            {detail.runs.map(entry => (
              <TaskRun key={entry.id} run={entry} />
            ))}
          </section>
        ) : null}
        {detail?.events.length ? (
          <details className="job-section task-activity">
            <summary>
              <h3>{t('Activity')}</h3>
              <span className="meta">{detail.events.length}</span>
            </summary>
            {detail.events.map(event => {
              const payload = eventPayloadText(event.payload)
              return (
                <div key={event.id} className="task-event">
                  <span className="meta">
                    <strong>{kanbanWord(event.kind)}</strong>
                    {event.createdAt ? ` · ${timeLabel(event.createdAt)}` : ''}
                  </span>
                  {payload ? <pre className="task-payload">{payload}</pre> : null}
                </div>
              )
            })}
          </details>
        ) : null}
        <div className="job-actions task-footer">
          <button className="secondary" disabled={busy} onClick={() => setEditing({ title: shown.title, body: shown.body ?? '' })}>
            {t('Edit')}
          </button>
          {shown.status !== 'archived' ? (
            <button className="secondary" disabled={busy} onClick={() => void run(() => onPatch({ status: 'archived' }))}>
              {t('Archive')}
            </button>
          ) : null}
          <button
            className="secondary danger"
            disabled={busy}
            onClick={async () => {
              if (await ask(`${t('Delete task?')}\n\n${t('This removes {title} from the board for good.', { title: shown.title })}`, { confirm: t('Delete'), destructive: true })) void run(onDelete)
            }}
          >
            {t('Delete')}
          </button>
          {shown.createdAt ? <span className="meta">{t('Created {time}', { time: timeLabel(shown.createdAt) })}</span> : null}
        </div>
      </div>
    </aside>
  )
}

/** A worker run, whole: its outcome, who ran it and for how long, its error, its summary, then its metadata. */
function TaskRun({ run }: { run: KanbanRun }) {
  const failed = Boolean(run.error) || /fail|crash|error|timed_out|killed/i.test(run.outcome ?? run.status)
  const meta = [run.profile, run.stepKey, run.startedAt && run.endedAt ? ageText(run.startedAt, run.endedAt) : null, run.endedAt ?? run.startedAt ? timeLabel(run.endedAt ?? run.startedAt) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="task-run">
      <span className={failed ? 'task-run-title error-text' : 'task-run-title'}>{kanbanWord(run.outcome ?? run.status) || '—'}</span>
      {meta ? <span className="meta">{meta}</span> : null}
      {run.error ? <pre className="task-payload error-text">{run.error}</pre> : null}
      {run.summary ? (
        <div className="task-body">
          <Markdown text={run.summary} />
        </div>
      ) : null}
      {run.metadata !== undefined ? (
        <details>
          <summary className="meta">{t('Details')}</summary>
          <pre className="task-payload">{JSON.stringify(run.metadata, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  )
}

function TaskComposer({
  assignees,
  defaultAssignee,
  botTitle,
  onCancel,
  onCreate
}: {
  assignees: string[]
  defaultAssignee: string
  botTitle: (name?: string) => string
  onCancel: () => void
  onCreate: (body: Record<string, unknown>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState<string>(defaultAssignee)
  const [priority, setPriority] = useState(0)
  const [status, setStatus] = useState('ready')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (busy || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const request: Record<string, unknown> = { title: title.trim(), priority, triage: status === 'triage' }
      if (body.trim()) request.body = body.trim()
      if (assignee) request.assignee = assignee
      await onCreate(request)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <aside className="task-panel" aria-label={t('New task')}>
      <div className="task-panel-head">
        <strong>{t('New task')}</strong>
        <span className="spacer" />
        <button className="staged-remove" aria-label={t('Close')} onClick={onCancel}>
          <Icon name="close" />
        </button>
      </div>
      <form
        className="task-panel-scroll task-edit"
        onSubmit={e => {
          e.preventDefault()
          void create()
        }}
      >
        <input aria-label={t('Title')} placeholder={t('Title')} value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <textarea aria-label={t('Description')} placeholder={t('Description')} rows={6} value={body} onChange={e => setBody(e.target.value)} />
        <div className="task-controls">
          <label>
            {t('Assigned to')}
            <Select value={assignee} onChange={picked => setAssignee(picked)}>
              {[...new Set([defaultAssignee, ...assignees])].map(name => (
                <option key={name} value={name}>
                  {name === defaultAssignee ? t('Default ({name})', { name: botTitle(name) }) : botTitle(name)}
                </option>
              ))}
              <option value="">{t("Parked (won't run)")}</option>
            </Select>
          </label>
          <label>
            {t('Priority')}
            <Select value={priority} onChange={picked => setPriority(Number(picked))}>
              {PRIORITIES.map(value => (
                <option key={value} value={value}>
                  {priorityTitle(value)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {t('Starts in')}
            <Select value={status} onChange={picked => setStatus(picked)}>
              {CREATABLE.filter(name => name === 'triage' || name === 'ready').map(name => (
                <option key={name} value={name}>
                  {columnTitle(name)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <span className="meta">
          {status === 'triage'
            ? t('Triage waits for an orchestrator to specify the task before anyone works on it.')
            : assignee
              ? t('A worker picks it up as soon as it’s ready.')
              : t('Parked leaves the task unassigned so no worker claims it.')}
        </span>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="job-actions">
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            {busy ? t('Working…') : t('Create')}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </aside>
  )
}
