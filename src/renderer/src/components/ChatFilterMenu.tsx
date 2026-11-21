import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import type { ChatFilterKey } from '../state/chatMarks'

/** One choice in the menu: its key, its words and how many rows it would list beside what's chosen. */
export interface FilterChoice {
  key: ChatFilterKey
  label: string
  count: number
}

/**
 * The chat list's Filter button and its menu, after the phone's (V2ChatsView
 * filterMenu): All, Starred, then Status, In progress and Done, and Sources,
 * each with its count. Filters combine, so the menu stays open while picking;
 * All, which clears them, closes it. Group by profile sits at its foot while
 * the list shows every profile.
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
  onOpen
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
}) {
  const ref = useRef<HTMLDivElement>(null)
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
      {open ? (
        <div className="host-menu filter-menu" role="menu" aria-label={t('Filter')}>
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
