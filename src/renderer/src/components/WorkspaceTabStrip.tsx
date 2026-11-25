import { t } from '@shared/i18n'
import type { WorkspaceTab, WorkspaceTabs } from '../state/workspaceTabs'

/** What a tab shows: its name, the bot it's with, and whether its chat works or waits on you. */
export interface TabLabel {
  title: string
  /** The bot, named on hover, and beside the title when the tabs hold more than one bot's chats. */
  bot?: string
  running?: boolean
  waits?: boolean
}

/**
 * The tabs over the chat column (issue 423), in the Folder's tab look: a
 * click shows a tab, a middle click or its × closes it, and + opens a new
 * chat in a tab of its own. Each kind of tab draws its own label through
 * `label`, so the coding workspace's kinds join without a strip of their own.
 */
export function WorkspaceTabStrip({
  tabs,
  label,
  showBots,
  onPick,
  onClose,
  onNewTab
}: {
  tabs: WorkspaceTabs
  label: (tab: WorkspaceTab) => TabLabel
  /** The tabs hold more than one bot's chats, so each names its bot. */
  showBots: boolean
  onPick: (tab: WorkspaceTab) => void
  onClose: (tab: WorkspaceTab) => void
  onNewTab: () => void
}) {
  // A middle click closes a tab, on its × too, rather than starting the browser's autoscroll.
  const middleCloses = (tab: WorkspaceTab) => ({
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      onClose(tab)
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
  })
  // ← and → move between the tabs, as a tab list's keys do.
  const arrowTo = (e: React.KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const count = tabs.tabs.length
    const next = tabs.tabs[(at + (e.key === 'ArrowRight' ? 1 : -1) + count) % count]
    if (!next) return
    onPick(next)
    const strip = e.currentTarget.closest('[role="tablist"]')
    requestAnimationFrame(() => strip?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.tabs.indexOf(next)]?.focus())
  }
  return (
    <div className="ws-tabs workspace-tabs" role="tablist" aria-label={t('Open chats')}>
      {tabs.tabs.map((tab, at) => {
        const shown = label(tab)
        const on = tab.key === tabs.active
        const status = shown.waits ? t('Needs approval') : shown.running ? t('Running') : null
        return (
          <div key={tab.key} className={`ws-tab${on ? ' on' : ''}`}>
            <button
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              title={[shown.title, shown.bot, status].filter(Boolean).join(' · ')}
              onClick={() => onPick(tab)}
              onKeyDown={e => arrowTo(e, at)}
              {...middleCloses(tab)}
            >
              {shown.waits || shown.running ? (
                <span className={`ws-tab-dot${shown.waits ? ' waits' : ' running'}`} role="img" aria-label={status ?? undefined} />
              ) : null}
              <span className="ws-tab-title">{shown.title}</span>
              {showBots && shown.bot ? <span className="ws-tab-bot">{shown.bot}</span> : null}
            </button>
            <button className="ws-tab-close" aria-label={t('Close Tab')} title={t('Close Tab')} onClick={() => onClose(tab)} {...middleCloses(tab)}>
              ×
            </button>
          </div>
        )
      })}
      <button className="ws-tab-new" aria-label={t('New Tab')} title={t('New Tab')} onClick={onNewTab}>
        +
      </button>
    </div>
  )
}
