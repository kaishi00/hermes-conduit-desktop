import type { ReactNode } from 'react'
import { t } from '@shared/i18n'

/** What a tab shows: its name, the bot it's with, and whether it works or waits on you. */
export interface TabLabel {
  title: string
  /** The bot, named on hover, and beside the title when the tabs hold more than one bot's chats. */
  bot?: string
  running?: boolean
  waits?: boolean
  /** Drawn before the title (a file, a branch, a terminal). */
  icon?: ReactNode
  /** A count after the title (Changes' files). */
  count?: number
  /** Dimmed: a terminal whose shell ended. */
  ended?: boolean
  /** A tab the strip always has (Files, Changes): no ×. */
  fixed?: boolean
  /** Said on hover, after the title. */
  hint?: string
}

/**
 * The workspace's tab look (issue 423): the chat tabs over the chat column,
 * and the workbench's (its views over the bench, its terminals in the
 * drawer). A click shows a tab, a middle click or its × closes it, ← and →
 * move between them, and + opens a new one.
 */
export function TabStrip<T>({
  tabs,
  keyOf,
  active,
  label,
  showBots = false,
  onPick,
  onClose,
  onNewTab,
  newTabLabel,
  ariaLabel,
  className,
  trailing
}: {
  tabs: T[]
  keyOf: (tab: T) => string
  active: string | null
  label: (tab: T) => TabLabel
  /** The tabs hold more than one bot's chats, so each names its bot. */
  showBots?: boolean
  onPick: (tab: T) => void
  onClose?: (tab: T) => void
  /** + at the end: a new tab. */
  onNewTab?: () => void
  newTabLabel?: string
  ariaLabel: string
  className?: string
  /** Buttons after the tabs, at the strip's end. */
  trailing?: ReactNode
}) {
  // A middle click closes a tab, on its × too, rather than starting the browser's autoscroll.
  const middleCloses = (tab: T, fixed: boolean) => ({
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1 || fixed || !onClose) return
      e.preventDefault()
      onClose(tab)
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
  })
  const arrowTo = (e: React.KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const count = tabs.length
    const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : -1) + count) % count]
    if (next === undefined) return
    onPick(next)
    const strip = e.currentTarget.closest('[role="tablist"]')
    requestAnimationFrame(() => strip?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.indexOf(next)]?.focus())
  }
  return (
    <div className={`ws-tabs workspace-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, at) => {
        const shown = label(tab)
        const key = keyOf(tab)
        const on = key === active
        const status = shown.waits ? t('Needs approval') : shown.running ? t('Running') : null
        const fixed = shown.fixed === true || !onClose
        return (
          <div key={key} className={`ws-tab${on ? ' on' : ''}${shown.ended ? ' ended' : ''}${fixed ? ' fixed' : ''}`}>
            <button
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              title={[shown.title, shown.bot, status, shown.hint].filter(Boolean).join(' · ')}
              onClick={() => onPick(tab)}
              onKeyDown={e => arrowTo(e, at)}
              {...middleCloses(tab, fixed)}
            >
              {shown.waits || shown.running ? (
                <span className={`ws-tab-dot${shown.waits ? ' waits' : ' running'}`} role="img" aria-label={status ?? undefined} />
              ) : null}
              {shown.icon ?? null}
              <span className="ws-tab-title">{shown.title}</span>
              {showBots && shown.bot ? <span className="ws-tab-bot">{shown.bot}</span> : null}
              {shown.count ? <span className="ws-tab-count">{shown.count}</span> : null}
            </button>
            {fixed ? null : (
              <button className="ws-tab-close" aria-label={t('Close Tab')} title={t('Close Tab')} onClick={() => onClose!(tab)} {...middleCloses(tab, fixed)}>
                ×
              </button>
            )}
          </div>
        )
      })}
      {onNewTab ? (
        <button className="ws-tab-new" aria-label={newTabLabel ?? t('New Tab')} title={newTabLabel ?? t('New Tab')} onClick={onNewTab}>
          +
        </button>
      ) : null}
      {trailing ? <span className="ws-tabs-end">{trailing}</span> : null}
    </div>
  )
}
