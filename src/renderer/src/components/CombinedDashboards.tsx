import type { HostSummary } from '@shared/ipc'
import { t } from '@shared/i18n'
import type { HostBadge } from '../state/keptHosts'
import { hostName } from '../state/hostNames'

/** A combined host's badge: the first letter of its name on its color. */
export function HostBadgeMark({ badge }: { badge: HostBadge }) {
  return (
    <span className="host-badge" style={{ background: badge.color }} title={badge.name} aria-label={badge.name}>
      {badge.letter}
    </span>
  )
}

/** Settings' Combine Dashboards (the phone's Saved Dashboards section): a switch per signed-in host, with two or more. */
export function CombineDashboardsSetting({ hosts }: { hosts: HostSummary[] }) {
  if (hosts.length < 2) return null
  return (
    <>
      <dt>{t('Combine Dashboards')}</dt>
      <dd className="combine-dashboards">
        {hosts.map(host => (
          <label key={host.url} className="toggle">
            <input type="checkbox" checked={!!host.combined} onChange={e => void window.conduit.setCombined(host.url, e.target.checked)} />
            {hostName(host.url)}
          </label>
        ))}
        <p className="meta">
          {t(
            'Combined dashboards connect when Conduit opens, up to four at a time, and stay connected while you use another one, so switching between them is quick. One that needs you to sign in waits until you open it. Switch on two or more.'
          )}
        </p>
      </dd>
    </>
  )
}
