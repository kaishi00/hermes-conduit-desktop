import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { useChat } from '../state/useChat'
import { useTranscript } from '../state/transcriptStore'
import type { ChatDisplay } from '../state/display'
import { Transcript } from './Transcript'
import { Icon } from './icons'

/** The chat kept beside the open one. */
export interface BesideChat {
  id: string
  profile?: string
  title?: string
}

/** The pane draws its chat's newest rows; Swap shows the whole chat. */
export const BESIDE_ROWS = 60

/**
 * A chat beside the open one, after the phone's pane (all-live stage 2): in a
 * wide window, Open Beside on a chat's row opens that chat and keeps the one
 * on screen here, so a reply can be watched in one while writing in the
 * other. Live from Hermes: its newest rows, the reply as it streams, Swap and
 * Close, and a plain message box. Nothing else here acts on the chat: its
 * rows take no actions, and a question or an approval it waits on is answered
 * after Swap.
 */
export function BesideChatPane({
  chat,
  host,
  sessionAuthority,
  connected,
  author,
  face,
  display,
  onSwap,
  onClose,
  onOpenInWindow
}: {
  chat: BesideChat
  /** The dashboard it's on, so it shares the main pane's kept transcripts. */
  host: string
  sessionAuthority: boolean
  connected: boolean
  author: string
  /** The answering bot's picture over each reply. */
  face?: (moving: boolean) => React.ReactNode
  display?: ChatDisplay
  onSwap?: () => void
  onClose?: () => void
  /** The pane's Open in New Window, where there's room for another window. */
  onOpenInWindow?: () => void
}) {
  const { transcriptStore, chat: open, loading, error, send } = useChat(chat.id, chat.profile, sessionAuthority, connected, false, undefined, host)
  const transcript = useTranscript(transcriptStore)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setText(''), [chat.id])

  // Words only, while the chat is between turns and Hermes is connected.
  const canSend = connected && !transcript.running && !sending && !!text.trim()
  const submit = async () => {
    if (!canSend) return
    const words = text
    setSending(true)
    setText('')
    // It has no queue dock: a send forwarded behind a turn in the gateway stays in its chat.
    const sent = await send(words, [], undefined, { noDock: true })
    // One that didn't go keeps its words in the box.
    if (sent === false) setText(current => current || words)
    setSending(false)
  }

  const shown = transcript.items.length > BESIDE_ROWS ? { ...transcript, items: transcript.items.slice(-BESIDE_ROWS) } : transcript
  return (
    <aside className="ws-panel beside-chat" aria-label={t('Beside chat')}>
      <div className="ws-head">
        <span className="ws-title">{open.title || chat.title || t('Chat')}</span>
        {transcript.running ? <span className="beside-working">{t('Working…')}</span> : null}
        <span className="spacer" />
        {onOpenInWindow ? (
          <button
            className="staged-remove"
            onClick={onOpenInWindow}
            aria-label={t('Open in New Window')}
            title={`${t('Open in New Window')}: ${t('Moves this chat to a window of its own, and closes the pane.')}`}
          >
            <Icon name="window" />
          </button>
        ) : null}
        <button className="link" onClick={onSwap} aria-label={t('Swap Chats')} title={t('Swap Chats')}>
          {t('Swap')}
        </button>
        <button className="staged-remove" aria-label={t('Close Chat Beside')} title={t('Close Chat Beside')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="beside-rows">
        <Transcript
          state={shown}
          loading={loading}
          error={error}
          profile={chat.profile}
          author={author}
          face={face}
          display={display}
          sessionId={open.liveId ?? undefined}
        />
      </div>
      <form
        className="beside-box"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          ref={box}
          rows={2}
          value={text}
          placeholder={t('Message {name}…', { name: author })}
          aria-label={t('Message {name}…', { name: author })}
          disabled={!connected}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button
          type="submit"
          className="send beside-send"
          disabled={!canSend}
          aria-label={t('Send')}
          title={transcript.running ? t('Sends once the reply has finished') : t('Send')}
        >
          <Icon name="send" />
        </button>
      </form>
    </aside>
  )
}
