import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import type { HostSummary } from '@shared/ipc'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import { hostBadge, keptStateLabel, useKeptHosts, type HostBadge } from '../state/keptHosts'
import { lookPictureUrl } from '../state/roomLooks'
import { HostBadgeMark } from './CombinedDashboards'
import { appIconUrl, useAppIcon } from '../state/appIcon'
import { hostName } from '../state/hostNames'
import type { BrandAlert } from '../state/connectionAlert'

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
/** The rail's brand only: you on this Hermes (Eric, 2026-11-26). */
interface RailBrandProps {
  inRail?: boolean
  /** Your picture on this Hermes (Multiplayer's, kept on Hermes), drawn in place of the app's mark. */
  picture?: string | null
  /** This dashboard's badge in a combined group, on the picture, so the button still says which Hermes. */
  badge?: HostBadge | null
  /** Opens where your picture is chosen (Settings > Appearance > You). */
  onPicture?: () => void
  /** Only when something's wrong; null draws nothing. */
  alert?: BrandAlert | null
}

export function Brand({ subtitle, hosts = [], currentUrl, onSwitch, inRail = false, picture, badge, onPicture, alert }: BrandProps & RailBrandProps) {
  const [open, setOpen] = useState(false)
  const switchable = hosts.length > 1 && !!onSwitch
  // In the rail, the list also holds Your Picture, so it opens with one Hermes too.
  const actions = inRail ? (alert?.actions ?? []) : []
  const opens = switchable || (inRail && !!onPicture) || actions.length > 0
  // Combined dashboards: how each one beside this one is doing.
  const kept = useKeptHosts()
  const icon = useAppIcon()

  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // As the rail's menus: focus lands on the Hermes you're on, and Escape gives it back to the button.
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])]
    ;(items.find(item => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      toggleRef.current?.focus()
    }
    // As the rail's menus, a press outside it or the window losing focus closes it too.
    const onPress = (e: Event) => {
      const target = e.target as Node | null
      if (target && (menuRef.current?.contains(target) || toggleRef.current?.contains(target))) return
      close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPress)
    window.addEventListener('blur', close)
    // Hidden while open (a banner moves the brand between the rail and the title bar), it closes, so it never comes back open unasked.
    const menu = menuRef.current
    const hidden = typeof ResizeObserver === 'undefined' || !menu ? null : new ResizeObserver(() => !menu.getClientRects().length && close())
    if (menu) hidden?.observe(menu)
    return () => {
      hidden?.disconnect()
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPress)
      window.removeEventListener('blur', close)
    }
  }, [open])

  const moveFocus = (e: ReactKeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  const menu = open ? (
    <div
      className="host-menu"
      role="menu"
      ref={menuRef}
      onKeyDown={moveFocus}
      // Tabbing out of it closes it, as the rail's menus do.
      onBlur={e => {
        const next = e.relatedTarget as Node | null
        if (next && !e.currentTarget.contains(next) && !toggleRef.current?.contains(next)) setOpen(false)
      }}
    >
      {actions.map(action => (
        <button
          key={action.label}
          role="menuitem"
          onClick={() => {
            setOpen(false)
            action.run()
          }}
        >
          <span className="host-check" />
          <span className="host-text">
            <span className="host-label">{action.label}</span>
          </span>
        </button>
      ))}
      {actions.length && hosts.length ? <div className="host-menu-sep" role="separator" /> : null}
      {hosts.map(host => {
        // The one you're on says so only while it isn't connected; every other one says how it's doing.
        const keptState = host.url === currentUrl ? null : kept.find(k => k.url === host.url)?.state
        const state = host.url === currentUrl ? (inRail ? (alert?.here ?? null) : null) : keptState ? keptStateLabel(keptState) : null
        const badge = hostBadge(hosts, host.url, hostName)
        return (
          <button
            key={host.url}
            role="menuitemradio"
            aria-checked={host.url === currentUrl}
            onClick={() => {
              setOpen(false)
              if (host.url !== currentUrl) onSwitch?.(host.url)
            }}
          >
            <span className="host-check">{host.url === currentUrl ? '✓' : ''}</span>
            {badge ? <HostBadgeMark badge={badge} /> : null}
            <span className="host-text">
              <span className="host-label">{hostName(host.url)}</span>
              {state ? <span className="meta">{state}</span> : null}
            </span>
          </button>
        )
      })}
      {inRail && onPicture ? (
        <>
          {switchable || actions.length ? <div className="host-menu-sep" role="separator" /> : null}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onPicture()
            }}
          >
            <span className="host-check" />
            <span className="host-text">
              <span className="host-label">{picture ? t('Change Your Picture…') : t('Choose Your Picture…')}</span>
            </span>
          </button>
        </>
      ) : null}
    </div>
  ) : null
  const pictureUrl = inRail ? lookPictureUrl(picture ? { picture } : null) : null
  const mark = pictureUrl ? (
    <span className="brand-mark brand-you" aria-hidden="true">
      <img src={pictureUrl} alt="" draggable={false} />
      {badge ? (
        <span className="brand-you-badge">
          <HostBadgeMark badge={badge} />
        </span>
      ) : null}
    </span>
  ) : inRail && badge ? (
    // In a combined group the badge says which Hermes, on the app's mark too.
    <span className="brand-mark-badged" aria-hidden="true">
      <img className="brand-mark" src={appIconUrl(icon)} alt="" draggable={false} />
      <span className="brand-you-badge">
        <HostBadgeMark badge={badge} />
      </span>
    </span>
  ) : (
    <img className="brand-mark" src={appIconUrl(icon)} alt="" aria-hidden="true" draggable={false} />
  )
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(o => !o)
  }

  if (inRail) {
    const label = subtitle ? `Conduit · ${subtitle}` : 'Conduit'
    // No name under the mark (Eric, 2026-11-26): it's in the tooltip and the list; only Sign In is written there.
    const host =
      alert?.tone === 'signIn' ? (
        <span className="rail-brand-host rail-brand-sign-in">{t('Sign In')}</span>
      ) : null
    const state = alert ? <span className={`rail-brand-state ${alert.tone}`} aria-hidden="true" /> : null
    // The tooltip says what a press does: switch Hermes, or choose your picture with one Hermes.
    const does = switchable ? t('Switch Hermes') : onPicture ? (picture ? t('Change Your Picture…') : t('Choose Your Picture…')) : null
    const tip = [label, alert?.text, does].filter(Boolean).join('\n')
    return (
      <div
        className="rail-brand host-switch"
        onContextMenu={e => {
          // Not the rail's section menu, nor the system's.
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {opens ? (
          <button
            className="rail-brand-button"
            ref={toggleRef}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={[label, alert?.text, does].filter(Boolean).join(', ')}
            title={tip}
            onClick={toggle}
          >
            <span className="rail-brand-mark">
              {mark}
              {state}
            </span>
            {host}
          </button>
        ) : (
          <div className="rail-brand-button" role="img" aria-label={[label, alert?.text].filter(Boolean).join(', ')} title={tip}>
            <span className="rail-brand-mark">
              {mark}
              {state}
            </span>
            {host}
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
          <button className="brand-sub host-button" ref={toggleRef} aria-haspopup="menu" aria-expanded={open} title={t('Switch Hermes')} onClick={toggle}>
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
