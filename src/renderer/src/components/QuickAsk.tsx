import { useDashboardProfiles } from '../state/useDashboardProfiles'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { useChat } from '../state/useChat'
import { useTranscript } from '../state/transcriptStore'
import { setTurnSurfaceHost } from '../state/turnSurface'
import { setPictureHost } from '../state/gatewayPictures'
import { useRequests } from '../state/useNeedsYou'
import { Composer } from './Composer'
import { Transcript, prefillRequest } from './Transcript'
import { t } from '@shared/i18n'
import type { QuoteRequest } from '../state/quote'
import { looksLikeSlashCommand } from '../state/slash'
import { useCommands } from '../state/useCommands'
import { dataUrlBlob } from '../state/callPicture'
import { tell } from '../state/dialogs'

/**
 * The quick ask window: one field to ask Hermes something from anywhere,
 * the reply streaming under it, and the chat it made a click away in the
 * main window. Esc hides it (or stops a running turn first).
 */
/** The quick window's padding above and below the field (.quick). */
const QUICK_PADDING = 16

export function QuickAsk() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  if (!status) return <div className="quick" />
  if (status.phase === 'locked') {
    return (
      <div className="quick">
        <div className="quick-empty">{t('Unlock Conduit in its window first.')}</div>
      </div>
    )
  }
  if (status.phase === 'signed-out' || !status.url) {
    return (
      <div className="quick">
        <div className="quick-empty">{t('Sign in to Hermes in the Conduit window first.')}</div>
      </div>
    )
  }
  return <QuickChat key={`${round}-${status.url}`} status={status} onNew={() => setRound(r => r + 1)} />
}

function QuickChat({ status, onNew }: { status: ConnectionStatus; onNew: () => void }) {
  const connected = status.phase === 'open'
  // This window's sends report where they came from on the dashboard it shows.
  setTurnSurfaceHost(status.url ?? '')
  // Pictures are kept per dashboard here too: this window outlives a switch (desktop#222).
  setPictureHost(status.url ?? '')
  useDashboardProfiles(status.phase, status.url)
  const { transcriptStore, chat, loading, error, send, stop, command } = useChat(null, undefined, status.sessionAuthority === true, connected)
  const transcript = useTranscript(transcriptStore)
  const requests = useRequests()
  const openRequests = requests.filter(r => r.sessionId && r.sessionId === chat.liveId)
  const [shown, setShown] = useState(0)
  const running = useRef(false)
  const pane = useRef<HTMLDivElement>(null)
  running.current = transcript.running

  useEffect(() => window.conduit.onQuickAskShown(() => setShown(n => n + 1)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running.current) {
        event.preventDefault()
        window.conduit.hideQuickAsk()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNew])

  const started = transcript.items.length > 0
  // Staged files need the taller window too.
  const [staged, setStaged] = useState(false)
  const [quote, setQuote] = useState<QuoteRequest | null>(null)
  const commands = useCommands(undefined, connected)
  // Before a reply, staged files grow the window only as far as the field
  // needs, so no empty space sits above them.
  const [fieldHeight, setFieldHeight] = useState(0)
  useEffect(() => {
    const field = pane.current?.querySelector('.composer-wrap')
    if (started || !staged || !field) return
    const measure = () => setFieldHeight(field.getBoundingClientRect().height + QUICK_PADDING)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(field)
    return () => observer.disconnect()
  }, [started, staged])
  useEffect(() => window.conduit.setQuickAskExpanded(started ? true : staged && fieldHeight ? fieldHeight : false), [started, staged, fieldHeight])
  // Ask Hermes About Screen, as the phone's shortcut does: the screen under Quick ask, staged with the question.
  const [shot, setShot] = useState<{ id: number; files: File[] } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const screenshot = async () => {
    setCapturing(true)
    const url = await window.conduit.screenshot().catch(() => null)
    setCapturing(false)
    if (!url) {
      void tell(t('Conduit couldn’t capture the screen. On a Mac, allow Screen Recording for Conduit in System Settings, then try again.'))
      return
    }
    const blob = dataUrlBlob(url)
    setShot(current => ({ id: (current?.id ?? 0) + 1, files: [new File([blob], 'Screenshot.png', { type: blob.type || 'image/png' })] }))
  }
  return (
    <div className={`quick${started ? ' started' : ''}`} ref={pane}>
      <div className="quick-head">
        <span className="quick-title">{chat.title || t('Ask Hermes')}</span>
        {started ? (
          <>
            <button className="link" onClick={onNew} title={t('New question (Ctrl+N)')}>
              {t('New')}
            </button>
            {chat.storedId ? (
              <button
                className="link"
                onClick={() => window.conduit.openChat({ storedId: chat.storedId!, title: chat.title })}
              >
                {t('Open in Conduit')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {started ? <Transcript state={transcript} loading={loading} error={error} requests={openRequests} onQuote={setQuote} /> : null}
      <Composer
        placeholder={t('Ask Hermes anything…')}
        running={transcript.running}
        disabled={!connected}
        model={chat.model}
        onSend={(text, attachments) => {
          if (!looksLikeSlashCommand(text) || attachments.length) return send(text, attachments).then(went => went !== false)
          void command(text, commands).then(outcome => {
            if (outcome.kind === 'new') onNew()
            else if (outcome.kind === 'prefill') setQuote(prefillRequest(outcome.text, 'Hermes'))
          })
        }}
        commands={commands}
        onStop={() => void stop()}
        focusKey={`quick-${shown}`}
        draftKey="quick"
        canAttach
        voice={{}}
        dropZone={pane}
        onStagedChange={setStaged}
        quote={quote}
        stageFiles={shot}
        screenshot={{ take: () => void screenshot(), capturing }}
      />
    </div>
  )
}
