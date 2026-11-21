import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { ChatWindowRequest, ConnectionStatus } from '@shared/ipc'
import { useChatDisplay } from '../state/display'
import { useBots } from '../state/useBots'
import { useDashboardProfiles } from '../state/useDashboardProfiles'
import { useChat } from '../state/useChat'
import { useRequests } from '../state/useNeedsYou'
import { useCommands } from '../state/useCommands'
import { useAgents } from '../state/useAgents'
import { usePredictions } from '../state/usePredictions'
import { SummaryHost } from '../state/useStepSummaries'
import { chatDraft } from '../state/composerDrafts'
import { openElsewhereMessage, owner } from '../state/chatTakeover'
import { mentionCandidates, withMentionNote, withoutMentionNote } from '../state/botMentions'
import { clearExpired } from '../state/expiredQuestions'
import { isResetCommand, looksLikeSlashCommand } from '../state/slash'
import { cleanTitle } from '../state/text'
import { notificationsEnabled, requestNotification, turnNotification, type NotificationSpec } from '../state/notifications'
import type { StagedAttachment } from '../state/attachments'
import { chatWindowTitle } from '@shared/chatWindows'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { ContextPanel } from './ContextPanel'
import { LiveTranscript, prefillRequest } from './Transcript'
import { useTranscriptValue } from '../state/transcriptStore'
import type { QuoteRequest } from '../state/quote'
import { PlanDock } from './PlanDock'
import { AgentsDock } from './AgentsDock'
import { ControlDock } from './ControlDock'
import { ChatQueueDock } from './ChatQueueDock'
import { ConnectionActionsContext } from './ConnectionCardView'
import { useReplyFace } from './BotsHome'

/**
 * A chat in a window of its own (Eric, 2026-11-21): the whole chat, live,
 * for its own bot, beside the main window and any other chat windows. Its
 * rows with their cards, approvals and questions, the composer with
 * attachments, slash commands, the model and context panels, Stop, the
 * queue, the agents and the plan. Calls stay in the main window, which owns
 * the microphone. Open in Main Window opens the chat there and closes this
 * window. The window's title follows the chat's and the bot's names as they
 * change. Its chat can be on another combined dashboard, which its calls go
 * to (the main process routes them), and a switch between combined
 * dashboards keeps it open. A sign-out, a lock or a dashboard that's no
 * longer combined closes it.
 */
export function ChatWindow({ chat: request }: { chat: ChatWindowRequest }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  useEffect(() => {
    if (status && (status.phase === 'locked' || status.phase === 'signed-out' || !status.url)) window.close()
  }, [status])
  if (!status?.url) return <div className="chat-window-page" />
  return (
    <SummaryHost.Provider value={status.url}>
      <WindowChat request={request} status={status} />
    </SummaryHost.Provider>
  )
}

function WindowChat({ request, status }: { request: ChatWindowRequest; status: ConnectionStatus }) {
  const connected = status.phase === 'open'
  const host = status.url ?? ''
  const profile = request.profile
  const botChat = request.botChat === true
  useDashboardProfiles(status.phase, status.url)
  const display = useChatDisplay(profile, connected, true)
  const roster = useBots(connected, host)
  const bot = roster.bots?.find(b => b.name === (profile ?? 'default'))
  const face = useReplyFace(bot)
  const botTitle = bot?.title ?? request.author ?? 'Hermes'
  const {
    transcriptStore,
    chat,
    loading,
    error,
    send,
    stop,
    command,
    notice,
    setModel,
    setReasoning,
    setSpeed,
    setYolo,
    takeover,
    takeOver,
    respondConnection,
    reissueConnection,
    wakeConnection,
    queue,
    cancelQueued,
    editQueued,
    sendQueuedNow,
    discardLost,
    resendLost,
    react
  } = useChat(request.id, profile, status.sessionAuthority === true, connected, botChat, undefined, host)
  // The transcript is drawn by LiveTranscript, so a streaming reply runs that, not this window, once a frame (desktop#212).
  const running = useTranscriptValue(transcriptStore, state => state.running)
  const plan = useTranscriptValue(transcriptStore, state => state.plan)

  // A Bot Chat goes by its bot's name: Hermes titles every one "Bot Chat".
  const title = botChat ? botTitle : cleanTitle(chat.title || request.title || '') || t('Chat')
  useEffect(() => {
    document.title = chatWindowTitle(title, botChat ? undefined : botTitle)
  }, [title, botTitle, botChat])

  const requests = useRequests()
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])
  const commands = useCommands(profile, connected)
  const delegates = useAgents(chat.liveId, connected, running)
  const predictions = usePredictions(transcriptStore, connected ? (chat.liveId ?? undefined) : undefined)
  const mentionBots = useMemo(() => mentionCandidates(roster.bots ?? [], '', profile ?? 'default'), [roster.bots, profile])
  const connectionActions = useMemo(
    () => ({ respond: respondConnection, reissue: reissueConnection, wake: wakeConnection }),
    [respondConnection, reissueConnection, wakeConnection]
  )
  const [quote, setQuote] = useState<QuoteRequest | null>(null)
  const [sendNow, setSendNow] = useState(0)
  const [modelOpen, setModelOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const pane = useRef<HTMLElement>(null)
  // Each finished turn and each output, so the control dock reads again as the main window's does.
  const [turnsDone, setTurnsDone] = useState(0)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) setTurnsDone(n => n + 1)
    wasRunning.current = running
  }, [running])
  const outputs = useTranscriptValue(transcriptStore, state => state.items.filter(item => item.kind === 'output').length)

  /**
   * This window's own notifications: a reply finished or a question waiting
   * while it isn't in front. The main window leaves a chat with a window to
   * it, so a chat on another combined dashboard notifies too; a click brings
   * this window back.
   */
  const chatRef = useRef({ liveId: chat.liveId, storedId: chat.storedId, profile, title })
  chatRef.current = { liveId: chat.liveId, storedId: chat.storedId, profile, title }
  const notify = useCallback((spec: NotificationSpec) => {
    if (!notificationsEnabled() || typeof Notification === 'undefined' || (document.hasFocus() && !document.hidden)) return
    const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
    n.onclick = () => {
      const live = chatRef.current.liveId
      if (live) void window.conduit.chatWindowOf(live, true)
    }
  }, [])
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        const { liveId, ...ref } = chatRef.current
        if (event.type !== 'message.complete' || !event.session_id || event.session_id !== liveId) return
        const spec = turnNotification(event.session_id, event.payload, ref)
        if (spec) notify(spec)
      }),
    [notify]
  )
  const notified = useRef(new Set<string>())
  useEffect(() => {
    for (const request of openRequests) {
      if (notified.current.has(request.id)) continue
      notified.current.add(request.id)
      const { liveId: _live, ...ref } = chatRef.current
      notify(requestNotification(request, ref))
    }
  }, [openRequests, notify])

  const openInMain = useCallback(() => {
    window.conduit.openChat({ storedId: chat.storedId ?? request.id, profile, title, ...(botChat ? { botChat: true } : {}), ...(host ? { host } : {}) })
    window.close()
  }, [chat.storedId, request.id, title, profile, botChat, host])

  const onSend = useCallback(
    async (text: string, attachments: StagedAttachment[] = [], options: { takeOver?: boolean; spoken?: boolean } = {}) => {
      // A bot's one chat never resets: /new compacts it, and a compaction carries no attachments.
      if (botChat && attachments.length && isResetCommand(text)) {
        notice(t('This bot chat never resets. Remove the attachments to compact it instead.'), 'error')
        return false
      }
      if (looksLikeSlashCommand(text) && !attachments.length) {
        const outcome = await command(text, commands, { botChat })
        // A new chat starts in the main window; this one keeps its chat.
        if (outcome.kind === 'new') {
          notice(t('Start a new chat in the main window. This window keeps its chat.'), 'info')
          return true
        }
        if (outcome.kind === 'model') setModelOpen(true)
        if (outcome.kind === 'prefill') setQuote(prefillRequest(withoutMentionNote(outcome.text), botTitle))
        return true
      }
      const sent = await send(withMentionNote(text, roster.bots, profile ?? 'default'), attachments, undefined, options)
      if (sent === false) return false
      // The message answers the questions Hermes stopped waiting for here.
      clearExpired(chat.liveId)
      return true
    },
    [botChat, command, commands, notice, send, roster.bots, profile, botTitle, chat.liveId]
  )

  return (
    <div className="chat-window-page">
      <main className="chat chat-window-chat" ref={pane} aria-label={title}>
        <div className="chat-head soft">
          <div className="chat-titles">
            <div className="chat-title-line">
              <div className="chat-title">{title}</div>
              {running ? <span className="beside-working">{t('Working…')}</span> : null}
            </div>
            {botChat ? null : <div className="chat-window-bot">{botTitle}</div>}
          </div>
          <div className="chat-head-actions">
            <button className="link" onClick={openInMain} title={t('Opens this chat in the main window and closes this one.')}>
              {t('Open in Main Window')}
            </button>
          </div>
        </div>
        <ConnectionActionsContext.Provider value={connectionActions}>
          <LiveTranscript
            store={transcriptStore}
            loading={loading}
            error={error}
            requests={openRequests}
            profile={profile}
            author={botTitle}
            face={face}
            onQuote={setQuote}
            onCommand={text => void onSend(text)}
            display={display}
            sessionId={chat.liveId ?? undefined}
            onReact={chat.liveId ? react : undefined}
          />
        </ConnectionActionsContext.Provider>
        {contextOpen && chat.liveId ? (
          <ContextPanel
            chat={chat}
            profile={profile}
            running={running}
            onClose={() => setContextOpen(false)}
            onCompress={() => void onSend('/compress')}
          />
        ) : null}
        {modelOpen && chat.liveId ? (
          <ModelPicker
            chat={chat}
            profile={profile}
            onClose={() => setModelOpen(false)}
            setModel={setModel}
            setReasoning={setReasoning}
            setSpeed={setSpeed}
            setYolo={setYolo}
          />
        ) : null}
        <ControlDock liveId={chat.liveId} profile={profile} connected={connected} pulse={turnsDone + outputs} />
        <AgentsDock
          agents={delegates.agents}
          running={running}
          chatKey={request.id}
          steer={delegates.steer}
          stop={delegates.stop}
          tail={delegates.tail}
          processes={delegates.processes}
          kill={delegates.kill}
        />
        <PlanDock plan={plan} running={running} chatKey={request.id} />
        {takeover ? (
          <div className="takeover-offer" role="status">
            <span>{openElsewhereMessage(owner(takeover.surface))}</span>
            <button
              className="primary"
              disabled={takeover.busy || !connected}
              onClick={() => void takeOver().then(ready => ready && setSendNow(n => n + 1))}
            >
              {t('Take over this chat')}
            </button>
          </div>
        ) : null}
        <ChatQueueDock
          rows={queue}
          chatKey={request.id}
          onSendNow={sendQueuedNow}
          onEdit={(row, text) => editQueued(row, withMentionNote(text, roster.bots, profile ?? 'default'))}
          onCancel={cancelQueued}
          onDiscard={discardLost}
          onResend={async row => {
            const words = await resendLost(row)
            if (words) setQuote(prefillRequest(words, botTitle))
          }}
        />
        <Composer
          sendNow={sendNow}
          placeholder={t('Message {name}…', { name: botTitle })}
          quote={quote}
          commands={commands}
          onModel={
            chat.liveId
              ? () => {
                  setContextOpen(false)
                  setModelOpen(open => !open)
                }
              : undefined
          }
          context={chat.context}
          onContext={
            chat.liveId
              ? () => {
                  setModelOpen(false)
                  setContextOpen(open => !open)
                }
              : undefined
          }
          running={running}
          disabled={!connected}
          model={chat.model}
          cwd={chat.cwd}
          onSend={onSend}
          replies={predictions.replies}
          onDraftPause={predictions.askDraft}
          onSuggestion={text => void onSend(text, [])}
          onStop={() => void stop()}
          focusKey={request.id}
          draftKey={chatDraft(profile, request.id)}
          canAttach
          dropZone={pane}
          voice={{ profile }}
          mentionBots={mentionBots}
        />
      </main>
    </div>
  )
}
