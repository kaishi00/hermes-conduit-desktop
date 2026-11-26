import { useEffect, useState, type MouseEvent } from 'react'
import type { HostSummary } from '@shared/ipc'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import { hostBadge, keptStateLabel, useKeptHosts } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { appIconUrl, useAppIcon } from '../state/appIcon'
import { hostName } from '../state/hostNames'

interface BrandProps {
  subtitle?: string
  /** With more than one, the subtitle opens a list to switch hosts. */
  hosts?: HostSummary[]
  currentUrl?: string
  onSwitch?: (url: string) => void
}

interface Props extends BrandProps {
  /** The open window draws its brand at the top of the rail's island instead (Brand with `inRail`). */
  bare?: boolean
}

/**
 * The app's mark, its name and the Hermes it's on, which opens the list of
 * Hermes to switch to when there's more than one. In the title bar on the
 * sign-in screens; at the top of the rail's island in the open window
 * (the floating glass shell, Eric 2026-11-26), where it's the mark alone over
 * the host's name and the list opens beside it.
 */
export function Brand({ subtitle, hosts = [], currentUrl, onSwitch, inRail = false }: BrandProps & { inRail?: boolean }) {
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

  const menu = open ? (
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
          </button>
        )
      })}
    </div>
  ) : null
  const mark = <img className="brand-mark" src={appIconUrl(icon)} alt="" aria-hidden="true" draggable={false} />
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(o => !o)
  }

  if (inRail) {
    const label = subtitle ? `Conduit · ${subtitle}` : 'Conduit'
    return (
      <div
        className="rail-brand host-switch"
        onContextMenu={e => {
          // Not the rail's section menu, nor the system's.
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {switchable ? (
          <button className="rail-brand-button" aria-haspopup="menu" aria-expanded={open} aria-label={t('Switch Hermes')} title={`${label}\n${t('Switch Hermes')}`} onClick={toggle}>
            {mark}
            {subtitle ? <span className="rail-brand-host">{subtitle}</span> : null}
          </button>
        ) : (
          <div className="rail-brand-button" role="img" aria-label={label} title={label}>
            {mark}
            {subtitle ? <span className="rail-brand-host">{subtitle}</span> : null}
          </div>
        )}
        {menu}
      </div>
    )
  }

  return (
    <div className="brand">
      {mark}
      <span className="brand-name">Conduit</span>
      {subtitle && switchable ? (
        <span className="host-switch">
          <button className="brand-sub host-button" aria-haspopup="menu" aria-expanded={open} title={t('Switch Hermes')} onClick={toggle}>
            · {subtitle} ▾
          </button>
          {menu}
        </span>
      ) : subtitle ? (
        <span className="brand-sub">· {subtitle}</span>
      ) : null}
    </div>
  )
}

export function TitleBar({ bare = false, ...brand }: Props) {
  const { platform, window: win } = window.conduit
  return (
    <header className={bare ? 'titlebar bare' : 'titlebar'} onDoubleClick={event => event.target === event.currentTarget && win.toggleMaximize()}>
      {/* Bare, it's drawn only while a banner keeps the island from rising (the CSS); the rail draws it otherwise. */}
      <Brand {...brand} />
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
