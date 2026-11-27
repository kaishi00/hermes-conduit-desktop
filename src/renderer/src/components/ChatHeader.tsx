import { useEffect, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { VOICE_MODES, voiceModeTitle, type VoiceMode } from '../state/gptLive'
import { statusText, workTone, type WorkItem } from '../state/work'
import { Icon } from './icons'
import { Select } from './Select'
import { HeaderMenu, HeaderMenuButton, useHeaderMenu, type HeaderMenuItem } from './HeaderMenu'

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
 * bot's screen, the workbench's and the side panel's toggles, a chat window's pin
 * (issue 608), each where the chat offers it,
 * and last the chat's own menu (issue 448), which a right-click on the title
 * opens too.
 */
export function ChatHeader({
  title,
  working,
  workItem,
  subtitle,
  call,
  newWindow,
  screen,
  bench,
  panel,
  pin,
  menu,
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
  /** The workbench's toggle, on a chat with a folder. */
  bench?: HeaderButton
  /** The side panel's toggle, with its work dot. */
  panel?: HeaderButton & { dot?: { tone: string; label: string } | null }
  /** A chat window's pin: kept on top of every other window (issue 608). */
  pin?: HeaderButton
  /** The chat's own menu: what its row in the chat list offers. Left out or empty, no button is drawn. */
  menu?: HeaderMenuItem[]
  /** Anything after the buttons (a window's Open in Main Window). */
  trailing?: ReactNode
}) {
  const more = useHeaderMenu()
  const items = menu?.length ? menu : null
  // The menu went away with its chat (another chat opened, or none): an open one closes with it.
  const closeMore = more.setOpen
  useEffect(() => {
    if (!items) closeMore(null)
  }, [items === null, closeMore])
  return (
    <div className="chat-head soft">
      <div className="chat-titles">
        <div className="chat-title-line">
          {title ? (
            <div
              className="chat-title"
              onContextMenu={
                items
                  ? e => {
                      e.preventDefault()
                      more.setOpen({ x: e.clientX, y: e.clientY })
                    }
                  : undefined
              }
            >
              {title}
            </div>
          ) : null}
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
        {bench ? (
          <button className={`chat-head-toggle${bench.on ? ' on' : ''}`} aria-label={bench.label} aria-pressed={!!bench.on} title={bench.title ?? bench.label} onClick={bench.onClick}>
            <Icon name="bench" />
          </button>
        ) : null}
        {panel ? (
          <button className={`chat-head-toggle${panel.on ? ' on' : ''}`} aria-label={panel.label} aria-pressed={!!panel.on} title={panel.title ?? panel.label} onClick={panel.onClick}>
            <Icon name="sidePanel" />
            {panel.dot ? <span className={`chat-head-dot ${panel.dot.tone}`} aria-label={panel.dot.label} /> : null}
          </button>
        ) : null}
        {pin ? (
          <button className={`chat-head-toggle${pin.on ? ' on' : ''}`} aria-label={pin.label} aria-pressed={!!pin.on} title={pin.title ?? pin.label} disabled={pin.disabled} onClick={pin.onClick}>
            <Icon name="pin" />
          </button>
        ) : null}
        {items ? <HeaderMenuButton menu={more} /> : null}
        {trailing}
      </div>
      {items ? <HeaderMenu menu={more} items={items} /> : null}
    </div>
  )
}
