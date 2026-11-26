import type { MouseEvent } from 'react'
import { t } from '@shared/i18n'
import type { MixedTile } from '../state/botOrder'
import type { HostBadge } from '../state/keptHosts'
import type { BotWork } from '../state/useWork'
import { BotAvatar } from './BotsHome'
import { HostBadgeMark } from './CombinedDashboards'

/**
 * The collapsed strip of faces (the floating glass shell, Eric 2026-11-26):
 * with the list hidden, the rail carries each bot's face under its sections,
 * the same bots in the same order as the Bots list (other dashboards' too, in
 * a combined group, with their badge), and a click opens that bot's Bot
 * Chat, as its row there does. The face of the bot whose chat is on screen
 * is marked, and a dot shows what the list's pill does: a bot at work, or
 * one that needs you.
 */
export function RailFaces({
  tiles,
  open,
  running,
  workOf,
  badgeFor,
  onOpen
}: {
  tiles: MixedTile[]
  /** The chat on screen, if one is: its bot, and its host when it's another dashboard's. */
  open?: { profile: string; host?: string }
  running: ReadonlySet<string>
  /** A bot's work as the Bots list's pill reads it. */
  workOf?: (tile: MixedTile) => BotWork | undefined
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
        // In a combined group every face wears its dashboard's badge, as in the Bots list.
        const badge = badgeFor?.(tile) ?? null
        const work = workOf?.(tile)
        const needs = (work?.needsYou ?? 0) > 0
        const busy = !needs && ((work?.working ?? 0) > 0 || (tile.own && running.has(bot.name)))
        const name = badge ? `${label} · ${badge.name}` : label
        const state = needs ? t('{count} needs you', { count: work!.needsYou }) : busy ? t('Working') : null
        return (
          <button
            key={tile.key}
            className="rail-face"
            data-profile={bot.name}
            aria-label={state ? `${name} · ${state}` : name}
            title={state ? `${name} · ${state}` : name}
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
            {needs || busy ? <span className={`rail-face-running${needs ? ' needs' : ''}`} aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
