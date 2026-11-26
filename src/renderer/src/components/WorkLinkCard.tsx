import { createContext, useContext, useEffect } from 'react'
import { t } from '@shared/i18n'
import { shownTitle, statusText, workTone, type WorkItem } from '../state/work'
import type { WorkLink } from '../state/workLinks'
import { Icon } from './icons'

/** What a reply's links to chats and work reach: the chat's column, and the open bot's work. */
export interface WorkLinkActions {
  /** Opens a chat (a workstream's, or one Hermes referred to). */
  open: (sessionId: string, profile?: string) => void
  /** The open bot's workstream by its ref, for its card. */
  item: (ref: string) => WorkItem | undefined
  /** Asks for the bot's resolved work, when a card names work its open list doesn't. */
  missing?: () => void
  /** In a Bot Chat, a ref its work lists, for a named "W3" to link to. */
  chatOf?: (ref: string) => { sessionId: string; profile?: string } | undefined
  /** A listed chat's name, for a reference's link. */
  titleOf: (sessionId: string) => string | undefined
  /** Reads a card's chat ahead as the pointer or focus reaches it, so its click draws it at once (desktop#612). */
  readAhead?: (sessionId: string, profile?: string) => void
}

export const WorkLinks = createContext<WorkLinkActions | null>(null)

/**
 * A reply's link to a workstream, drawn as a card under it, after the phone's
 * BotWorkLinkCard: its mark, ref and task, where it is now, and a click opens
 * its chat.
 */
export function WorkLinkCard({ link }: { link: WorkLink }) {
  const actions = useContext(WorkLinks)
  const item = actions?.item(link.ref)
  const missing = !item ? actions?.missing : undefined
  useEffect(() => missing?.(), [missing])
  const tone = item ? workTone(item) : null
  const mark = !item
    ? 'linked'
    : tone === 'needs'
      ? 'bell'
      : tone === 'working'
        ? 'spinner'
        : tone === 'failed'
          ? 'close'
          : !item.closed && item.status === 'stopped'
            ? 'stop'
            : 'check'
  const open = t('Open {ref}’s chat', { ref: link.ref })
  const readAhead = () => actions?.readAhead?.(link.sessionId, link.profile)
  return (
    <button
      className="work-link-card"
      title={open}
      disabled={!actions}
      onPointerEnter={readAhead}
      onFocus={readAhead}
      onClick={() => actions?.open(link.sessionId, link.profile)}
    >
      <span className={`status-mark${tone ? ` tone-${tone}` : ' tone-link'}`} aria-hidden="true">
        <Icon name={mark} />
      </span>
      <span className="work-link-text">
        <span className="work-link-line">
          <span className="work-ref">{link.ref}</span>
          <span className="work-link-title">{item ? shownTitle(item) : open}</span>
        </span>
        {item ? <span className={`work-link-status tone-${tone}`}>{statusText(item)}</span> : null}
      </span>
      <Icon name="chevron" />
    </button>
  )
}
