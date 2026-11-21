import { useEffect, useState } from 'react'
import type { HostSummary } from '@shared/ipc'
import { t } from '@shared/i18n'
import { hostBadge, launchRows, readLastHost } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { hostName } from '../state/hostNames'

/**
 * Ask Which Dashboard at Launch, after the phone's (issue 1908): Settings'
 * switch, shown only with two or more hosts saved.
 */
export function AskDashboardSetting({ hosts }: { hosts: number }) {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void window.conduit.askHostAtLaunch().then(next => live && setOn(next))
    return () => {
      live = false
    }
  }, [])
  if (hosts < 2 || on === null) return null
  return (
    <>
      <dt>{t('Saved Dashboards')}</dt>
      <dd>
        <label className="toggle">
          <input
            type="checkbox"
            checked={on}
            onChange={async e => {
              const next = e.target.checked
              if (await window.conduit.setAskHostAtLaunch(next)) setOn(next)
            }}
          />
          {t('Ask Which Dashboard at Launch')}
        </label>
        <p className="meta">{t('When Conduit opens, your dashboards stay listed until you pick one, instead of signing in to the last one you used.')}</p>
      </dd>
    </>
  )
}

/** The window at launch with that switch on: the saved hosts, until one is picked. */
export function DashboardChoice({ hosts, onAdd }: { hosts: HostSummary[]; onAdd: () => void }) {
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (url: string) => {
    setOpening(url)
    if (!(await window.conduit.switchHost(url))) setOpening(null)
  }
  return (
    <div className="dashboard-choice">
      <h1>{t('Your dashboards')}</h1>
      <ul>
        {launchRows(hosts, readLastHost()).map(row =>
          row.kind === 'host' ? (
            <li key={row.host.url}>
              <button disabled={opening !== null} title={row.host.url} onClick={() => void open(row.host.url)}>
                <span className="host-label">{hostName(row.host.url)}</span>
                {row.host.username ? <span className="meta">{row.host.username}</span> : null}
              </button>
            </li>
          ) : (
            <li key={`group:${row.opens}`}>
              <button disabled={opening !== null} title={row.members.map(h => h.url).join('\n')} onClick={() => void open(row.opens)}>
                <span className="launch-group-badges">
                  {row.members.map(h => {
                    const badge = hostBadge(hosts, h.url, hostName)
                    return badge ? <HostBadgeMark key={h.url} badge={badge} /> : null
                  })}
                </span>
                <span className="host-label">{t('Combine Dashboards')}</span>
                <span className="meta">{row.members.map(h => hostName(h.url)).join(', ')}</span>
              </button>
            </li>
          )
        )}
      </ul>
      <button className="link" disabled={opening !== null} onClick={onAdd}>
        {t('Add a dashboard')}
      </button>
    </div>
  )
}
