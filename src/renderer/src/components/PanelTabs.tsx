import { t } from '@shared/i18n'
import type { WorkSnapshot } from '../state/work'

export type PanelTab = 'work' | 'chat' | 'files'

/** The count a bot's work shows, as its status's colour: needs you orange, then ready green, then working blue. */
export function workCount(snapshot: WorkSnapshot | null | undefined): { tone: 'needs' | 'ready' | 'working'; count: number; label: string } | null {
  if (!snapshot) return null
  if (snapshot.needsYou > 0) return { tone: 'needs', count: snapshot.needsYou, label: t('{count} needs you', { count: snapshot.needsYou }) }
  if (snapshot.ready > 0) return { tone: 'ready', count: snapshot.ready, label: t('{count} ready', { count: snapshot.ready }) }
  if (snapshot.working > 0) return { tone: 'working', count: snapshot.working, label: t('{count} working', { count: snapshot.working }) }
  return null
}

export function panelTabTitle(tab: PanelTab): string {
  return tab === 'work' ? t('Work') : tab === 'chat' ? t('In This Chat') : t('Files')
}

/**
 * The tabs atop the side panel (Eric, 2026-11-20, option C, softer): the
 * bot's Work, In This Chat and the chat's Files, where the chat has them.
 * The header keeps one button that shows or hides the panel.
 */
export function PanelTabs({ tabs, shown, onPick, work }: { tabs: PanelTab[]; shown: PanelTab; onPick: (tab: PanelTab) => void; work?: WorkSnapshot | null }) {
  const count = workCount(work)
  return (
    <div className="panel-tabs" role="tablist" aria-label={t('Side panel')}>
      {tabs.map(tab => (
        <button key={tab} className={`panel-tab${tab === shown ? ' on' : ''}`} role="tab" aria-selected={tab === shown} onClick={() => onPick(tab)}>
          {panelTabTitle(tab)}
          {tab === 'work' && count ? (
            <span className={`panel-tab-count ${count.tone}`} aria-label={count.label}>
              {count.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
