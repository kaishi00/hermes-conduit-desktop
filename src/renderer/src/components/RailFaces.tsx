import type { MouseEvent } from 'react'
import { t } from '@shared/i18n'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import { BotAvatar } from './BotsHome'
import { HostBadgeMark } from './CombinedDashboards'

/**
 * The collapsed strip of faces (the floating glass shell, Eric 2026-11-26):
 * with the list hidden, the rail carries each bot's face under its sections,
 * the same bots in the same order as the Bots list (other dashboards' too, in
 * a combined group, with their badge), and a click opens that bot's Bot
 * Chat, as its row there does. The open one is marked, and a bot of this
 * dashboard's mid-turn shows a dot.
 */
export function RailFaces({
  tiles,
  open,
  running,
  badgeFor,
  onOpen
}: {
  tiles: MixedTile[]
  /** The Bot Chat on screen, if one is: its bot, and its host when it's another dashboard's. */
  open?: { profile: string; host?: string }
  running: ReadonlySet<string>
  badgeFor?: (tile: MixedTile) => HostBadge | null
  onOpen: (tile: MixedTile) => void
}) {
  if (!tiles.length) return null
  return (
    <div
      className="rail-faces"
      role="group"
      aria-label={t('Bots')}
    >
      {tiles.map(tile => {
        const { bot } = tile
        const label = bot.title || bot.name
        const isOpen =
          !!open && open.profile.toLowerCase() === bot.name.toLowerCase() && (open.host ? !tile.own && tile.host === open.host : tile.own)
        const badge = tile.own ? null : (badgeFor?.(tile) ?? null)
        const busy = tile.own && running.has(bot.name)
        const name = badge ? `${label} · ${badge.name}` : label
        return (
          <button
            key={tile.key}
            className="rail-face"
            data-profile={bot.name}
            aria-label={busy ? `${name} · ${t('Working')}` : name}
            title={name}
            aria-current={isOpen ? 'page' : undefined}
            onClick={() => onOpen(tile)}
            // A face has no menu: not the rail's section menu, nor the system's.
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <BotAvatar bot={bot} size={34} host={tile.own ? undefined : tile.host} />
            {badge ? (
              <span className="rail-face-badge">
                <HostBadgeMark badge={badge} />
              </span>
            ) : null}
            {busy ? <span className="rail-face-running" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
