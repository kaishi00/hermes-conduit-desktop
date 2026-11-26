import { t } from '@shared/i18n'
import type { WorkspaceTab, WorkspaceTabs } from '../state/workspaceTabs'
import { TabStrip, type TabLabel } from './TabStrip'

export type { TabLabel }

/**
 * The tabs over the chat column (issue 423), in the Folder's tab look: a
 * click shows a tab, a middle click or its × closes it, and + opens a new
 * chat in a tab of its own. The workbench draws its own tabs with the same
 * strip (TabStrip), so the two read as one workspace.
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
  return (
    <TabStrip
      tabs={tabs.tabs}
      keyOf={tab => tab.key}
      active={tabs.active}
      label={label}
      showBots={showBots}
      onPick={onPick}
      onClose={onClose}
      onNewTab={onNewTab}
      ariaLabel={t('Open chats')}
    />
  )
}
