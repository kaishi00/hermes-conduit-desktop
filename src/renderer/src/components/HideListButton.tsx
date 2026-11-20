import { t } from '@shared/i18n'
import { Icon } from './icons'

/** The « at the top of the chat list that hides it (Eric, 2026-11-20); the » atop the rail brings it back. */
export function HideListButton({ onHide }: { onHide: () => void }) {
  const keys = window.conduit.platform === 'darwin' ? '⌘\\' : 'Ctrl+\\'
  return (
    <button className="round hide-list" aria-label={t('Hide Sidebar')} title={`${t('Hide Sidebar')} (${keys})`} onClick={onHide}>
      <Icon name="chevronsLeft" />
    </button>
  )
}
