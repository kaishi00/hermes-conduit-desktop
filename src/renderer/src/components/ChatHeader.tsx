import type { ReactNode } from 'react'
import { t } from '@shared/i18n'
import { VOICE_MODES, voiceModeTitle, type VoiceMode } from '../state/gptLive'
import { statusText, workTone, type WorkItem } from '../state/work'
import { Icon } from './icons'
import { Select } from './Select'

/** The Call pill: Call (or End call) and the voice mode the next call takes, or the running call's. */
export interface HeaderCall {
  calling: boolean
  /** The running call's mode while one runs, else the next call's. */
  mode: VoiceMode
  disabled: boolean
  onToggle: () => void
  onMode: (mode: VoiceMode) => void
}

/** A header icon button: what it says, whether it's on, and what a click does. */
export interface HeaderButton {
  label: string
  title?: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * A chat's header, the same wherever the chat is drawn (Eric, 2026-11-22: a
 * far dashboard's Bot Chat showed only its title): the main window's chat
 * pane, another combined dashboard's chat docked there, and a chat in a
 * window of its own. Its title with a workstream's status chip, a line under
 * it (a workstream's way back to its bot, or the bot a window's chat is
 * with), then the Call pill with its voice mode, Open in New Window, the
 * bot's screen and the side panel's toggle, each where the chat offers it.
 */
export function ChatHeader({
  title,
  working,
  workItem,
  subtitle,
  call,
  newWindow,
  screen,
  panel,
  trailing
}: {
  title: string
  /** A chat in a window of its own says while its bot works, since no list beside it does. */
  working?: boolean
  /** A workstream's chat: its status beside its title. */
  workItem?: WorkItem
  /** The line under the title: a button (a workstream's way back to its bot) or words. */
  subtitle?: { text: string; title?: string; onClick?: () => void }
  call?: HeaderCall
  newWindow?: HeaderButton
  screen?: HeaderButton
  /** The side panel's toggle, with its work dot. */
  panel?: HeaderButton & { dot?: { tone: string; label: string } | null }
  /** Anything after the buttons (a window's Open in Main Window). */
  trailing?: ReactNode
}) {
  return (
    <div className="chat-head soft">
      <div className="chat-titles">
        <div className="chat-title-line">
          {title ? <div className="chat-title">{title}</div> : null}
          {workItem ? (
            <span className={`status-chip tone-${workTone(workItem)}`} title={statusText(workItem)}>
              <span className="status-chip-text">{statusText(workItem)}</span>
            </span>
          ) : null}
          {working ? <span className="beside-working">{t('Working…')}</span> : null}
        </div>
        {subtitle ? (
          subtitle.onClick ? (
            <button className="chat-subtitle" title={subtitle.title} onClick={subtitle.onClick}>
              {subtitle.text}
            </button>
          ) : (
            <div className="chat-window-bot">{subtitle.text}</div>
          )
        ) : null}
      </div>
      <div className="chat-head-actions">
        {/* Call and its voice mode, one pill (option C, softer). */}
        {call ? (
          <div className={`call-pill${call.calling ? ' on' : ''}`}>
            <button
              className="call-pill-call"
              aria-label={call.calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(call.mode) })}
              title={call.calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(call.mode) })}
              disabled={call.disabled && !call.calling}
              onClick={call.onToggle}
            >
              <Icon name={call.calling ? 'phoneDown' : 'phone'} />
              <span>{call.calling ? t('End call') : t('Call')}</span>
            </button>
            <span className="call-pill-line" aria-hidden="true" />
            <span className="call-pill-mode">
              <Select aria-label={t('Voice mode')} title={t('Voice mode')} value={call.mode} onChange={picked => call.onMode(picked as VoiceMode)}>
                {VOICE_MODES.map(mode => (
                  <option key={mode} value={mode}>
                    {voiceModeTitle(mode)}
                  </option>
                ))}
              </Select>
            </span>
          </div>
        ) : null}
        {newWindow ? (
          <button className="chat-head-toggle" aria-label={newWindow.label} title={newWindow.title ?? newWindow.label} disabled={newWindow.disabled} onClick={newWindow.onClick}>
            <Icon name="window" />
          </button>
        ) : null}
        {screen ? (
          <button className={`chat-head-toggle${screen.on ? ' on' : ''}`} aria-label={screen.label} aria-pressed={!!screen.on} title={screen.title ?? screen.label} onClick={screen.onClick}>
            <Icon name="screen" />
          </button>
        ) : null}
        {panel ? (
          <button className={`chat-head-toggle${panel.on ? ' on' : ''}`} aria-label={panel.label} aria-pressed={!!panel.on} title={panel.title ?? panel.label} onClick={panel.onClick}>
            <Icon name="sidePanel" />
            {panel.dot ? <span className={`chat-head-dot ${panel.dot.tone}`} aria-label={panel.dot.label} /> : null}
          </button>
        ) : null}
        {trailing}
      </div>
    </div>
  )
}
