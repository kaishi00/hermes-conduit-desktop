import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import type { ChatFilterKey } from '../state/chatMarks'
import { NO_PROJECT } from '../state/hiddenProjects'

/** One choice in the menu: its key, its words and how many rows it would list beside what's chosen. */
export interface FilterChoice {
  key: ChatFilterKey
  label: string
  count: number
}

/** Filter › Projects: the profile's projects, each ticked while its chats show. */
export interface ProjectChoices {
  /** Home's title, which stands for the chats in no project. */
  home?: string
  list: { id: string; title: string }[]
  hidden: ReadonlySet<string>
  onHidden: (ids: string[]) => void
}

/**
 * The chat list's Filter button and its menu, after the phone's (V2ChatsView
 * filterMenu): All, Starred, then Status, In progress and Done, and Sources,
 * each with its count. Filters combine, so the menu stays open while picking;
 * All, which clears them, closes it. Needs you leads it, every profile's
 * waits; Projects opens a page of the profile's projects to untick, which
 * All leaves as they are. Archived opens the manually archived chats, and
 * Group by profile sits at its foot while the list shows every profile.
 */
export function ChatFilterMenu({
  selection,
  allCount,
  starred,
  statuses,
  progress,
  sources,
  waiting,
  onToggle,
  onClear,
  groupByProfile,
  onGroupByProfile,
  open,
  onOpen,
  onNeedsYou,
  onArchived,
  projects
}: {
  selection: readonly ChatFilterKey[]
  allCount: number
  starred: FilterChoice
  statuses: FilterChoice[]
  /** In progress and Done, on a plugin that keeps Done marks. */
  progress: FilterChoice[]
  /** Shown once chats come from more than one place. */
  sources: FilterChoice[]
  /** Chats waiting on the person: the button's amber dot. */
  waiting: number
  onToggle: (key: ChatFilterKey, on: boolean) => void
  onClear: () => void
  /** Offered under All with two or more profiles. */
  groupByProfile?: boolean
  onGroupByProfile?: (on: boolean) => void
  open: boolean
  onOpen: (open: boolean) => void
  /** Needs you: every profile's waiting chats, where the list is served. */
  onNeedsYou?: () => void
  /** Archived: this dashboard's manually archived chats. */
  onArchived?: () => void
  /** Offered once the profile has a project besides Home, never in All. */
  projects?: ProjectChoices
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<'filters' | 'projects'>('filters')
  useEffect(() => {
    if (!open || !projects) setPage('filters')
  }, [open, projects])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    const onBlur = () => onOpen(false)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, onOpen])
  const on = (key: ChatFilterKey) => selection.includes(key)
  const item = (choice: FilterChoice) => (
    <button
      key={choice.key}
      role="menuitemcheckbox"
      aria-checked={on(choice.key)}
      className="filter-item"
      onClick={() => onToggle(choice.key, !on(choice.key))}
    >
      <span className="filter-check" aria-hidden="true">
        {on(choice.key) ? '✓' : ''}
      </span>
      <span className="filter-label">{choice.label}</span>
      <span className={`filter-count${choice.key === 'waiting' && choice.count ? ' waits' : ''}`}>{choice.count}</span>
    </button>
  )
  return (
    <div className="filter-menu-wrap" ref={ref}>
      <button
        className={`filter-button${selection.length ? ' on' : ''}`}
        aria-label={t('Filter')}
        title={t('Filter')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <Icon name="filter" />
        {waiting > 0 ? <span className="filter-dot" role="img" aria-label={t('Needs approval')} /> : null}
      </button>
      {open && page === 'projects' && projects ? (
        <div className="host-menu filter-menu" role="menu" aria-label={t('Projects')}>
          <button role="menuitem" className="filter-item filter-back" onClick={() => setPage('filters')}>
            <span className="filter-check" aria-hidden="true">
              ‹
            </span>
            <span className="filter-label">{t('Filter')}</span>
          </button>
          <hr />
          <button role="menuitem" className="filter-item" disabled={!projects.hidden.size} onClick={() => projects.onHidden([])}>
            <span className="filter-check" aria-hidden="true" />
            <span className="filter-label">{t('Show all projects')}</span>
          </button>
          <hr />
          {[{ id: NO_PROJECT, title: projects.home ?? t('Not in a project') }, ...projects.list].map(project => {
            const shown = !projects.hidden.has(project.id)
            return (
              <button
                key={project.id}
                role="menuitemcheckbox"
                aria-checked={shown}
                className="filter-item"
                onClick={() =>
                  projects.onHidden(shown ? [...projects.hidden, project.id] : [...projects.hidden].filter(id => id !== project.id))
                }
              >
                <span className="filter-check" aria-hidden="true">
                  {shown ? '✓' : ''}
                </span>
                <span className="filter-label">{project.title}</span>
              </button>
            )
          })}
        </div>
      ) : open ? (
        <div className="host-menu filter-menu" role="menu" aria-label={t('Filter')}>
          {onNeedsYou ? (
            <>
              <button
                role="menuitem"
                className="filter-item"
                onClick={() => {
                  onOpen(false)
                  onNeedsYou()
                }}
              >
                <span className="filter-check" aria-hidden="true" />
                <span className="filter-label">{t('Needs you')}</span>
              </button>
              <hr />
            </>
          ) : null}
          <button
            role="menuitemcheckbox"
            aria-checked={!selection.length}
            className="filter-item"
            onClick={() => {
              onClear()
              onOpen(false)
            }}
          >
            <span className="filter-check" aria-hidden="true">
              {selection.length ? '' : '✓'}
            </span>
            <span className="filter-label">{t('All')}</span>
            <span className="filter-count">{allCount}</span>
          </button>
          {item(starred)}
          <div className="filter-head">{t('Status')}</div>
          {statuses.map(item)}
          {progress.length ? (
            <>
              <hr />
              {progress.map(item)}
            </>
          ) : null}
          {sources.length > 1 ? (
            <>
              <div className="filter-head">{t('Sources')}</div>
              {sources.map(item)}
            </>
          ) : null}
          {projects ? (
            <>
              <hr />
              <button role="menuitem" aria-haspopup="menu" className="filter-item" onClick={() => setPage('projects')}>
                <span className="filter-check" aria-hidden="true" />
                <span className="filter-label">{t('Projects')}</span>
                <span className="filter-count">›</span>
              </button>
            </>
          ) : null}
          {onArchived ? (
            <>
              <hr />
              <button
                role="menuitem"
                className="filter-item"
                onClick={() => {
                  onOpen(false)
                  onArchived()
                }}
              >
                <span className="filter-check" aria-hidden="true" />
                <span className="filter-label">{t('Archived')}</span>
              </button>
            </>
          ) : null}
          {onGroupByProfile ? (
            <>
              <hr />
              <label className="filter-item filter-toggle">
                <span className="filter-check" aria-hidden="true" />
                <span className="filter-label">{t('Group by profile')}</span>
                <input type="checkbox" checked={!!groupByProfile} onChange={e => onGroupByProfile(e.target.checked)} />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
