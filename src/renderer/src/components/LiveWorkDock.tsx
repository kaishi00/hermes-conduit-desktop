import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { elapsed } from '../state/agents'
import { stepTitle } from '../state/liveDoing'
import type { LiveWork } from '../state/liveWork'

/**
 * A turn of the open chat running in the gateway, on `hermes dashboard`,
 * after the phone's ChatLiveWorkDock (Eric, 2026-11-27): an API chat's
 * turn, another app's, one this app's message waits behind. Above the
 * composer, drawn like the delegate agents' line: what the turn does now
 * and each agent it waits on, with its goal, its own step and how long it
 * has run, so a chat waiting on a subagent doesn't look finished. A turn
 * this app runs itself streams its own progress, so the line hides then.
 */
export function LiveWorkDock({ work, running }: { work: LiveWork; running: boolean }) {
  const [now, setNow] = useState(Date.now())
  const shows = work.running && !running
  const counting = shows && work.agents.length > 0
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])
  if (!shows) return null
  // The clock ticks only while agents run: read it now too, so a new agent never shows the mount's time.
  const at = Math.max(now, Date.now())
  return (
    <div className="plan-dock agents-dock live-work-dock open" aria-live="polite">
      {work.agents.length ? (
        <ul className="plan-items agent-cards" aria-label={t('Delegate agents')}>
          {work.agents.map(agent => (
            <li key={agent.id} className="agent-card status-running">
              <div className="agent-head">
                <strong>{agent.goal || t('Delegate agent')}</strong>
                <span className="spacer" />
                <span className="meta">
                  {stepTitle(agent.step) ?? t('Working…')}
                  {agent.started !== undefined ? ` · ${elapsed(at / 1000 - agent.started)}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="plan-line">
        <div className="plan-toggle" role="status">
          <span className="spinner" aria-hidden="true" />
          <strong>{(work.step && stepTitle(work.step)) ?? t('Working…')}</strong>
          <span className="spacer" />
          {work.agents.length ? <span className="meta">{t('Subagents working: {count}', { count: String(work.agents.length) })}</span> : null}
        </div>
      </div>
    </div>
  )
}
