import type { MouseEvent } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import { BotAvatar } from './BotsHome'

/**
 * The collapsed strip of faces (the floating glass shell, Eric 2026-11-26):
 * with the list hidden, the rail carries each bot's face under its sections,
 * in the Bots list's order, and a click opens that bot's Bot Chat, as a row
 * in the list does. The open one is marked, and a bot mid-turn shows a dot.
 */
export function RailFaces({
  bots,
  openProfile,
  running,
  onOpen
}: {
  bots: Bot[]
  /** The bot whose Bot Chat is on screen, if one is. */
  openProfile?: string
  running: ReadonlySet<string>
  onOpen: (bot: Bot) => void
}) {
  if (!bots.length) return null
  return (
    <div
      className="rail-faces"
      role="group"
      aria-label={t('Bots')}
      // The rail's own menu is for its sections, not the faces.
      onContextMenu={(e: MouseEvent) => e.stopPropagation()}
    >
      {bots.map(bot => {
        const label = bot.title || bot.name
        return (
          <button
            key={bot.name}
            className="rail-face"
            data-profile={bot.name}
            aria-label={label}
            title={label}
            aria-current={openProfile === bot.name ? 'page' : undefined}
            onClick={() => onOpen(bot)}
          >
            <BotAvatar bot={bot} size={34} />
            {running.has(bot.name) ? <span className="rail-face-running" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
