import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import { BotAvatar } from './BotsHome'
import { HostBadgeMark } from './CombinedDashboards'

/** The column's width, beside the list's own (styles: .profile-column-wrap). */
export const PROFILE_COLUMN_WIDTH = 52

/**
 * The chat list's profiles, in a column beside it (Eric, 2026-11-21: the
 * strip and three rows of chips took half the list): All, then every
 * profile's face, in a combined group every dashboard's in the group's
 * Bots Home order, each with its dashboard's badge, as the phone's strip
 * holds them. It scrolls on its own, so any number of profiles costs the
 * same. A face carries its profile's unread dot and the count waiting on
 * you; a moving picture plays here, never with Reduce Motion (Eric,
 * 2026-11-21). Another dashboard's face shows that profile's chats, read
 * through its kept connection, with no switch.
 */
export function ProfileColumn({
  tiles,
  profile,
  otherProfile = null,
  onProfile,
  onOther,
  onLeaveOther,
  badgeFor,
  unread,
  waits,
  onShowInAll,
  onEditProfile
}: {
  tiles: readonly MixedTile[]
  profile: string | null
  /** Another dashboard's profile the list shows, picked by its face. */
  otherProfile?: { host: string; name: string } | null
  onProfile: (profile: string | null) => void
  /** Another dashboard's profile: the list shows its chats, with no switch. */
  onOther?: (tile: MixedTile) => void
  /** Tapping the chosen far face again; without it, that goes to All. */
  onLeaveOther?: () => void
  badgeFor?: (tile: MixedTile) => HostBadge | null
  /** Whether a profile has unread chats. */
  unread: (tile: MixedTile) => boolean
  /** How many of a profile's chats wait on the person. */
  waits: (tile: MixedTile) => number
  /** Show in All: from a right-click on All, or a click on All while it's chosen. */
  onShowInAll?: () => void
  /** Edit profile from a face's right-click, this dashboard's profiles only. */
  onEditProfile?: (bot: Bot) => void
}) {
  const [menu, setMenu] = useState<{ bot: Bot; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])
  const same = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase()
  // The chosen face scrolls into view, by its own tile (a namesake on another dashboard is never it).
  const column = useRef<HTMLDivElement>(null)
  useEffect(() => {
    column.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [profile, otherProfile])
  return (
    <>
      <div className="profile-column" role="tablist" aria-orientation="vertical" aria-label={t('Profiles')} ref={column}>
        <button
          role="tab"
          className="profile-column-all"
          aria-selected={profile === null && !otherProfile}
          title={onShowInAll ? t('Right-click to choose which profiles All shows') : t('All')}
          onClick={() => (profile === null && onShowInAll ? onShowInAll() : onProfile(null))}
          onContextMenu={
            onShowInAll
              ? e => {
                  e.preventDefault()
                  onShowInAll()
                }
              : undefined
          }
        >
          {t('All')}
        </button>
        <span className="profile-column-rule" aria-hidden="true" />
        {tiles.map(tile => {
          const { bot } = tile
          const chosen = tile.own ? same(profile, bot.name) : !!otherProfile && otherProfile.host === tile.host && same(otherProfile.name, bot.name)
          const badge = badgeFor?.(tile) ?? null
          const waiting = waits(tile)
          const fresh = !waiting && unread(tile)
          return (
            <button
              key={tile.key}
              role="tab"
              className="profile-column-face"
              aria-selected={chosen}
              aria-label={badge ? `${bot.title}, ${badge.name}` : bot.title}
              title={badge ? `${bot.title} · ${badge.name}` : bot.title}
              onClick={() => (tile.own ? onProfile(chosen ? null : bot.name) : chosen ? (onLeaveOther ? onLeaveOther() : onProfile(null)) : onOther?.(tile))}
              onContextMenu={
                tile.own && onEditProfile
                  ? e => {
                      e.preventDefault()
                      setMenu({ bot, x: e.clientX, y: e.clientY })
                    }
                  : undefined
              }
            >
              <BotAvatar bot={bot} size={34} moving host={tile.own ? undefined : tile.host} />
              {badge ? (
                <span className="profile-column-badge">
                  <HostBadgeMark badge={badge} />
                </span>
              ) : null}
              {waiting ? (
                <span className="profile-column-waits" role="img" aria-label={t('{count} needs you', { count: waiting })}>
                  {waiting}
                </span>
              ) : fresh ? (
                <span className="profile-column-unread" role="img" aria-label={t('Unread')} />
              ) : null}
            </button>
          )
        })}
      </div>
      {menu && onEditProfile ? (
        <div className="host-menu row-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 60) }}>
          <button role="menuitem" onClick={() => onEditProfile(menu.bot)}>
            {t('Edit profile')}
          </button>
        </div>
      ) : null}
    </>
  )
}
