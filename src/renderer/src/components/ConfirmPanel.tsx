import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { MAX_EDIT_TEXT, askerLine, canConfirm, declineLabel, insteadLabel, insteadPlaceholder, isAsk, isComputerAsk, type ConfirmOutcome } from '../state/presented'
import type { WaitingConfirm } from '../state/usePresented'
import { Icon } from './icons'
import { Reply } from './Transcript'

/**
 * The confirmation Hermes waits on, after the phone's PresentedConfirmPanel:
 * who asks, what, and what will happen; the primary action, the decline,
 * and for a room's or a Link's ask Say instead (Change it for Run work), or
 * Edit for one of Hermes' own from a chat.
 */
export function ConfirmPanel({
  item,
  more,
  onAnswer,
  onEdit
}: {
  item: WaitingConfirm
  /** How many more wait after this one. */
  more: number
  onAnswer: (outcome: ConfirmOutcome, editText?: string) => void
  /** Hermes' own confirmation from a chat: the chat opens with its preview to rework. */
  onEdit?: () => void
}) {
  const { prompt } = item
  const [instead, setInstead] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const ask = isAsk(prompt)
  // Another computer's ask (Control from Hermes): Allow or Don’t Allow, nothing to rework.
  const computer = isComputerAsk(prompt)

  useEffect(() => {
    setInstead(null)
  }, [prompt.id])
  useEffect(() => {
    if (instead !== null) field.current?.focus()
  }, [instead !== null])

  return (
    <section className="confirm-panel" role="alertdialog" aria-label={`${askerLine(prompt)}. ${prompt.title}`}>
      <div className="confirm-asker">
        <Icon name={computer ? 'screen' : prompt.link ? 'link' : prompt.room ? 'linked' : 'check'} />
        <span>{askerLine(prompt)}</span>
        {more ? <span className="confirm-more">{t('{count} more', { count: more })}</span> : null}
      </div>
      <h3>{prompt.title}</h3>
      {prompt.preview ? (
        <div className="confirm-preview">
          <Reply text={prompt.preview} />
        </div>
      ) : null}
      {instead !== null ? (
        <div className="confirm-instead">
          <textarea
            ref={field}
            className="input-ask-field"
            rows={3}
            value={instead}
            maxLength={MAX_EDIT_TEXT}
            placeholder={insteadPlaceholder(prompt)}
            onChange={e => setInstead(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && instead.trim()) {
                e.preventDefault()
                onAnswer('edit', instead)
              }
              if (e.key === 'Escape') setInstead(null)
            }}
          />
          <div className="confirm-actions">
            <button className="link" onClick={() => setInstead(null)}>
              {t('Cancel')}
            </button>
            <span className="spacer" />
            <button className="primary" disabled={!instead.trim()} onClick={() => onAnswer('edit', instead)}>
              {t('Send')}
            </button>
          </div>
        </div>
      ) : (
        <div className="confirm-actions">
          {ask ? (
            <button className="secondary" onClick={() => setInstead('')}>
              {insteadLabel(prompt)}
            </button>
          ) : onEdit && !computer ? (
            <button className="secondary" onClick={onEdit}>
              {t('Edit')}
            </button>
          ) : null}
          <button className="link" onClick={() => onAnswer('declined')}>
            {declineLabel(prompt)}
          </button>
          <span className="spacer" />
          {canConfirm(prompt) ? (
            <button className="primary" onClick={() => onAnswer('confirmed')}>
              {prompt.actionLabel}
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}
