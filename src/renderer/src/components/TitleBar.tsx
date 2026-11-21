import { useEffect, useState } from 'react'
import type { HostSummary } from '@shared/ipc'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import { hostBadge, keptStateLabel, useKeptHosts } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { appIconUrl, useAppIcon } from '../state/appIcon'
import { hostName } from '../state/hostNames'

export { hostName }

interface Props {
  subtitle?: string
  /** With more than one, the subtitle opens a list to switch hosts. */
  hosts?: HostSummary[]
  currentUrl?: string
  onSwitch?: (url: string) => void
}

export function TitleBar({ subtitle, hosts = [], currentUrl, onSwitch }: Props) {
  const { platform, window: win } = window.conduit
  const [open, setOpen] = useState(false)
  const switchable = hosts.length > 1 && !!onSwitch
  // Combined dashboards: how each one beside this one is doing.
  const kept = useKeptHosts()
  const icon = useAppIcon()

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="titlebar" onDoubleClick={event => event.target === event.currentTarget && win.toggleMaximize()}>
      <div className="brand">
        <img className="brand-mark" src={appIconUrl(icon)} alt="" aria-hidden="true" draggable={false} />
        <span className="brand-name">Conduit</span>
        {subtitle && switchable ? (
          <span className="host-switch">
            <button
              className="brand-sub host-button"
              aria-haspopup="menu"
              aria-expanded={open}
              title={t('Switch Hermes')}
              onClick={e => {
                e.stopPropagation()
                setOpen(o => !o)
              }}
            >
              · {subtitle} ▾
            </button>
            {open ? (
              <div className="host-menu" role="menu">
                {hosts.map(host => {
                  const state = host.url === currentUrl ? null : (kept.find(k => k.url === host.url)?.state ?? null)
                  const badge = hostBadge(hosts, host.url, hostName)
                  return (
                  <button
                    key={host.url}
                    role="menuitemradio"
                    aria-checked={host.url === currentUrl}
                    onClick={() => {
                      setOpen(false)
                      if (host.url !== currentUrl) onSwitch!(host.url)
                    }}
                  >
                    <span className="host-check">{host.url === currentUrl ? '✓' : ''}</span>
                    {badge ? <HostBadgeMark badge={badge} /> : null}
                    <span className="host-text">
                      <span className="host-label">{hostName(host.url)}</span>
                      {state ? <span className="meta">{keptStateLabel(state)}</span> : null}
                    </span>
                    {host.username ? <span className="meta">{host.username}</span> : null}
                  </button>
                  )
                })}
              </div>
            ) : null}
          </span>
        ) : subtitle ? (
          <span className="brand-sub">· {subtitle}</span>
        ) : null}
      </div>
      {platform !== 'darwin' ? (
        <div className="caption-buttons">
          <button className="cap" aria-label={t('Minimize')} onClick={() => win.minimize()}>
            <Icon name="minimize" />
          </button>
          <button className="cap" aria-label={t('Maximize')} onClick={() => win.toggleMaximize()}>
            <Icon name="maximize" />
          </button>
          <button className="cap close" aria-label={t('Close')} onClick={() => win.close()}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
