import { applyScale, nextScale, readScale, scaleFromStorage, scaleStep, shortcutFor, wheelSteps } from '../state/shortcuts'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t } from '@shared/i18n'
import type { ChatWindowRequest, ConnectionStatus } from '@shared/ipc'
import { useChatDisplay } from '../state/display'
import { useBots } from '../state/useBots'
import { useDashboardProfiles } from '../state/useDashboardProfiles'
import { useChat } from '../state/useChat'
import { useRequests, useWaiting } from '../state/useNeedsYou'
import { askedInChat } from '../state/needsYou'
import { useCommands } from '../state/useCommands'
import { useAgents } from '../state/useAgents'
import { useChatTasks } from '../state/useChatTasks'
import { ChatTasksDock } from './ChatTasksDock'
import { usePredictions } from '../state/usePredictions'
import { SummaryHost } from '../state/useStepSummaries'
import { chatDraft } from '../state/composerDrafts'
import { openElsewhereMessage, owner } from '../state/chatTakeover'
import { mentionCandidates, withMentionNote, withoutMentionNote } from '../state/botMentions'
import { clearExpired } from '../state/expiredQuestions'
import { isResetCommand, looksLikeSlashCommand } from '../state/slash'
import { cleanTitle } from '../state/text'
import { notificationsEnabled, requestNotification, turnNotification, type NotificationSpec } from '../state/notifications'
import { readMuted } from '../state/chatMute'
import { gateway } from '../gateway'

import type { StagedAttachment } from '../state/attachments'
import { CHAT_WINDOW_LIMIT, chatWindowTitle } from '@shared/chatWindows'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { ContextPanel } from './ContextPanel'
import { LiveTranscript, prefillRequest, quoteRequest } from './Transcript'
import { useTranscriptValue } from '../state/transcriptStore'
import type { QuoteRequest } from '../state/quote'
import { PlanDock } from './PlanDock'
import { AgentsDock } from './AgentsDock'
import { ControlDock } from './ControlDock'
import { ChatQueueDock } from './ChatQueueDock'
import { ConnectionActionsContext } from './ConnectionCardView'
import { useReplyFace } from './BotsHome'
import { AskedQuestionBar, WorkPanel } from './WorkPanel'
import { useChatCall } from './ChatCall'
import { ChatHeader } from './ChatHeader'
import { chatMenuItems } from '../state/chatMenu'
import { loadPins, savePins, withoutChat } from '../state/pinnedReplies'
import { mutateSession } from '../state/chatActions'
import { ask, askText, tell } from '../state/dialogs'
import { PanelTabs, workCount, type PanelTab } from './PanelTabs'
import { ArtifactsPanel } from './ArtifactsPanel'
import { FilesPanel } from './FilesPanel'
import { ColumnDivider } from './ColumnDivider'
import { FileLinks } from './Markdown'
import { WorkLinks, type WorkLinkActions } from './WorkLinkCard'
import { revealMessage } from './Transcript'
import { useWork } from '../state/useWork'
import { shownTitle, type WorkItem } from '../state/work'
import { absolutePath, pathForDraft } from '../state/workspace'
import { useRevealRow } from '../state/revealRow'
import { PANEL_COLUMN, readWidth, shownWindowPanelWidth, writeWidth } from '../state/columnWidths'
import { screenKey } from '@shared/screenWindows'

const muteHttp = (method: 'GET' | 'PUT', path: string, body?: unknown) => gateway.http(method, path, body)

/**
 * A chat in a window of its own (Eric, 2026-11-21): the whole chat, live,
 * for its own bot, beside the main window and any other chat windows. Its
 * rows with their cards, approvals and questions, the composer with
 * attachments, slash commands, the model and context panels, Stop, the
 * queue, the agents and the plan. A window's chat has no call: calls stay in
 * the main window, which owns the microphone. Open in Main Window opens the chat there and closes this
 * window. The window's title follows the chat's and the bot's names as they
 * change. Its chat can be on another combined dashboard, which its calls go
 * to (the main process routes them), and a switch between combined
 * dashboards keeps it open. A sign-out, a lock or a dashboard that's no
 * longer combined closes it.
 *
 * Docked, the same page is another combined dashboard's chat opened in the
 * main window's chat pane, with no switch (the phone's no-switch open,
 * stage 2): Open in New Window moves it to a window of its own, and the main
 * window closes it when its dashboard goes. Being in the main window, it
 * offers Call too: the call runs in this page, so it reads and sends through
 * the chat's own dashboard (Eric, 2026-11-22), and the main window hears it
 * start and end, to ask before a switch and to keep wake phrases quiet. Like
 * the main window's, it ends when another chat opens here or Chats goes.
 *
 * Either way its header is the main window's (ChatHeader, Eric, 2026-11-22):
 * a workstream's status and its way back to its bot, the bot's screen, and
 * the side panel with the bot's Work, In This Chat and the chat's Files, all
 * read from the chat's own dashboard; a reply's work cards and file paths
 * open there too.
 */
export function ChatWindow({ chat: request }: { chat: ChatWindowRequest }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  // The chat's text size, the one setting every window shares: its keys work here too, and a change made
  // in another window shows here (desktop#449).
  useEffect(() => {
    let scale = readScale()
    document.documentElement.style.setProperty('--chat-scale', String(scale))
    const step = (by: -1 | 0 | 1 | null) => {
      // Docked in the main window too: keys pressed in the pane never reach that window's page, and the
      // size it writes reaches every window.
      if (by === null) return false
      scale = nextScale(scale, by)
      applyScale(scale)
      return true
    }
    const mac = window.conduit.platform === 'darwin'
    const onKey = (event: KeyboardEvent) => {
      // On a Mac the View menu's own keys arrive as its commands.
      if (!mac && step(scaleStep(shortcutFor(event, false)))) event.preventDefault()
    }
    const follow = (event: StorageEvent) => {
      const next = scaleFromStorage(event)
      if (next === null) return
      scale = next
      document.documentElement.style.setProperty('--chat-scale', String(next))
    }
    const read = wheelSteps()
    const onWheel = (event: WheelEvent) => {
      const by = read(event)
      if (by === null) return
      event.preventDefault()
      if (by) step(by)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('storage', follow)
    const offMenu = window.conduit.onMenu(action => void step(scaleStep(action)))
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('storage', follow)
      offMenu()
    }
  }, [request.docked])
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  useEffect(() => {
    if (!request.docked && status && (status.phase === 'locked' || status.phase === 'signed-out' || !status.url)) window.close()
  }, [status, request.docked])
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
  const docked = request.docked === true
  useDashboardProfiles(status.phase, status.url)
  const display = useChatDisplay(profile, connected, true)
  // Only this chat's bot is drawn here: its name and face, not every bot's chats (desktop#292).
  const roster = useBots(connected, host, { withSessions: false })
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
    loadOlder,
    loadingOlder,
    olderRows,
    seekRow,
    react,
    noteCorrection
  } = useChat(request.fresh ? null : request.id, profile, status.sessionAuthority === true, connected, botChat, undefined, host)
  // The transcript is drawn by LiveTranscript, so a streaming reply runs that, not this window, once a frame (desktop#212).
  const running = useTranscriptValue(transcriptStore, state => state.running)
  const plan = useTranscriptValue(transcriptStore, state => state.plan)

  // A Bot Chat goes by its bot's name: Hermes titles every one "Bot Chat".
  // A name given from this window's menu shows at once: Hermes sends no title for a rename.
  const [renamed, setRenamed] = useState<string | null>(null)
  const title = botChat ? botTitle : cleanTitle(renamed ?? (chat.title || request.title || '')) || t('Chat')
  useEffect(() => {
    if (!docked) document.title = chatWindowTitle(title, botChat ? undefined : botTitle)
  }, [title, botTitle, botChat, docked])

  const requests = useRequests()
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])
  // A question the bot asked here that waits past its turn, as in the main window.
  const waitingProfiles = useMemo(() => [profile ?? ''], [profile])
  const waiting = useWaiting(connected, waitingProfiles)
  const askedHere = useMemo(
    () => askedInChat(waiting.rows, profile, [chat.storedId, request.id, chat.liveId]),
    [waiting.rows, profile, chat.storedId, request.id, chat.liveId]
  )
  const commands = useCommands(profile, connected)
  const delegates = useAgents(chat.liveId, connected, running)
  const chatTasks = useChatTasks(chat.storedId ?? chat.liveId, profile, connected, running)
  const mentionBots = useMemo(() => mentionCandidates(roster.bots ?? [], '', profile ?? 'default'), [roster.bots, profile])
  const connectionActions = useMemo(
    () => ({ respond: respondConnection, reissue: reissueConnection, wake: wakeConnection }),
    [respondConnection, reissueConnection, wakeConnection]
  )
  // A docked Pulse card's Do it leaves its words in the message box.
  const [quote, setQuote] = useState<QuoteRequest | null>(() => (request.draft ? quoteRequest({ draft: request.draft }) : null))
  // Another card's Do it on the same docked chat points the page here again with new words, so they replace the box's.
  const firstRequest = useRef(request)
  useEffect(() => {
    if (request === firstRequest.current || !request.draft) return
    setQuote(quoteRequest({ draft: request.draft }))
  }, [request])
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

  // The chat's id on its dashboard: a new chat's once Hermes has stored it.
  const chatId = request.fresh ? (chat.storedId ?? null) : (chat.storedId ?? request.id)
  // The side panel, as the main window's (Eric, 2026-11-20, option C, softer): the bot's Work, In This Chat and the
  // chat's Files, where the chat has them, one open at a time.
  const [panelOpen, setPanelOpen] = useState<PanelTab | null>(null)
  const lastTab = useRef<PanelTab>('work')
  // The bot's work: a Bot Chat offers it, and a workstream's chat shows its status and its way back to the bot.
  const work = useWork(profile, connected, botChat || panelOpen === 'work')
  const openWorkItem = chatId ? work.snapshot?.items.find(item => item.kind === 'workstream' && item.sessionId === chatId) : undefined
  const workItem: WorkItem | undefined = openWorkItem ?? (chatId ? work.resolved?.find(item => item.kind === 'workstream' && item.sessionId === chatId) : undefined)
  const readResolvedWork = work.readResolved
  // A Bot Chat names resolved work too, and a workstream's chat may be resolved: the Resolved page has them.
  useEffect(() => {
    if (botChat || (chatId && work.snapshot && !openWorkItem)) readResolvedWork()
  }, [botChat, chatId, work.snapshot, openWorkItem, readResolvedWork])
  const workHere = botChat || !!workItem
  const panelTabs: PanelTab[] = [
    ...(workHere && (work.snapshot || work.error) ? (['work'] as const) : []),
    ...(chatId ? (['chat'] as const) : []),
    ...(chat.cwd ? (['files'] as const) : [])
  ]
  const shownTab = panelOpen && panelTabs.includes(panelOpen) ? panelOpen : null
  const openTab = useCallback((tab: PanelTab | null) => {
    if (tab) lastTab.current = tab
    setPanelOpen(tab)
  }, [])
  const workDot = workHere ? workCount(work.snapshot) : null
  const panelTabBar = shownTab && panelTabs.length > 1 ? <PanelTabs tabs={panelTabs} shown={shownTab} onPick={openTab} work={work.snapshot} /> : null
  // The panel's width, dragged by the line beside it and kept on this device, as the main window's.
  const [panelStored, setPanelStored] = useState(() => readWidth(PANEL_COLUMN))
  const [panelLive, setPanelLive] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const resized = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  const panelWidth = shownWindowPanelWidth(panelLive ?? panelStored, windowWidth)
  // A file path in a reply opens in the Files tab.
  const [reveal, setReveal] = useState<{ path: string; id: number } | null>(null)
  const cwd = chat.cwd
  const openPath = useMemo(
    () =>
      cwd
        ? (path: string) => {
            setReveal(current => ({ path: absolutePath(path, cwd), id: (current?.id ?? 0) + 1 }))
            openTab('files')
          }
        : null,
    [cwd, openTab]
  )
  // An artifact's Show in Chat: its message, here.
  const showInChat = useRevealRow(transcriptStore, chatId, chat.storedId, key => requestAnimationFrame(() => revealMessage(pane.current, key)), seekRow)
  // Docked, the chat's call (components/ChatCall.tsx), running here on the chat's own dashboard.
  const endCallRef = useRef<() => void>(() => undefined)
  const chatCall = useChatCall({
    profile,
    chatId,
    liveId: chat.liveId,
    connected,
    store: transcriptStore,
    running,
    turnsDone,
    onStop: () => void stop(),
    onCorrected: noteCorrection,
    tell: message => notice(message, 'error')
  })
  const calling = docked && chatCall.calling
  const endCall = chatCall.end
  endCallRef.current = endCall
  // Replies predicted for the box wait while a call speaks.
  const predictions = usePredictions(transcriptStore, connected && !calling ? (chat.liveId ?? undefined) : undefined)
  // The main window hears the call start and end.
  useEffect(() => {
    if (!docked || !calling) return
    window.conduit.dockedToPane('calling')
    return () => window.conduit.dockedToPane('call-ended')
  }, [docked, calling])
  // Another chat pointed here ends the call, as another chat opened in the main window does.
  const callChatKey = `${profile ?? ''}\u001f${request.fresh ? '' : request.id}`
  const callChat = useRef(callChatKey)
  useEffect(() => {
    if (callChat.current !== callChatKey) endCall()
    callChat.current = callChatKey
  }, [callChatKey, endCall])
  useEffect(() => {
    setModelOpen(false)
    setContextOpen(false)
  }, [callChatKey])
  const canPickModel = connected && (!!chat.liveId || !chat.storedId)
  const defaultModel = !chat.storedId ? bot?.model : undefined
  // The bot's screen, offered where its dashboard can have one, in a window of its own.
  const screenProfile = profile ?? 'default'
  const [screenSupported, setScreenSupported] = useState(false)
  useEffect(() => {
    setScreenSupported(false)
    if (!connected) return
    let live = true
    gateway
      .rpc<{ supported?: unknown }>('display.status', { profile: screenProfile })
      .then(answer => live && setScreenSupported(answer?.supported === true))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [connected, screenProfile])
  const [screenWindows, setScreenWindows] = useState<string[]>([])
  useEffect(() => {
    const off = window.conduit.onScreenWindows(setScreenWindows)
    void window.conduit.screenWindows().then(setScreenWindows)
    return off
  }, [])
  const screenOpen = screenWindows.includes(screenKey(host || undefined, screenProfile))
  /** Another chat on the chat's dashboard: the main window docks it (or shows it, on the dashboard on screen). */
  const openOther = useCallback(
    (sessionId: string, title?: string, other?: { botChat?: boolean; profile?: string; workstream?: boolean }) =>
      window.conduit.openChat({
        storedId: sessionId,
        profile: other?.profile ?? profile,
        title,
        ...(other?.botChat ? { botChat: true } : {}),
        ...(other?.workstream ? { workstream: true } : {}),
        ...(host ? { host } : {})
      }),
    [profile, host]
  )
  // A reply's links to its work and to other chats: a card or a link opens the chat, as in the main window.
  const workSnapshot = work.snapshot
  const workResolved = work.resolved
  const workLinkActions = useMemo<WorkLinkActions>(() => {
    // The open list first, then the Resolved page, as the phone's cards read them.
    const known = [...(workSnapshot?.items ?? []), ...(workResolved ?? [])]
    const workstream = (ref: string) => known.find(item => item.kind === 'workstream' && item.ref === ref && !!item.sessionId)
    const ofSession = (sessionId: string) => known.find(i => i.sessionId === sessionId)
    return {
      open: (sessionId, linkProfile) => {
        const item = ofSession(sessionId)
        // A workstream says so: the main window's own read of every bot's work can trail one just started.
        openOther(sessionId, item ? shownTitle(item) : undefined, { profile: linkProfile ?? profile, workstream: item?.kind === 'workstream' })
      },
      item: workstream,
      missing: readResolvedWork,
      chatOf: botChat
        ? ref => {
            const item = workstream(ref)
            return item ? { sessionId: item.sessionId, profile } : undefined
          }
        : undefined,
      titleOf: sessionId => {
        const item = ofSession(sessionId)
        return item ? shownTitle(item) : undefined
      }
    }
  }, [workSnapshot, workResolved, readResolvedWork, botChat, profile, openOther])

  /**
   * This window's own notifications: a reply finished or a question waiting
   * while it isn't in front. The main window leaves a chat with a window to
   * it, so a chat on another combined dashboard notifies too; a click brings
   * this window back.
   */
  const paneShown = useRef(true)
  useEffect(() => {
    if (!docked) return
    const off = window.conduit.onDockedShown(shown => {
      paneShown.current = shown
      // Chats went (another section): the call ends, as the main window's does.
      if (!shown) endCallRef.current()
    })
    // A tell sent before this listened is asked for again.
    window.conduit.dockedToPane('ask')
    return off
  }, [docked])
  // The chat's title as stored (kept for reopening); the notification builders read "Chat" and
  // "Untitled chat" as no title, so the bot's name stands in.
  const chatTitle = botChat ? botTitle : cleanTitle(chat.title || request.title || '') || undefined
  const chatRef = useRef({ liveId: chat.liveId, storedId: chat.storedId, profile, title: chatTitle, bot: botTitle })
  chatRef.current = { liveId: chat.liveId, storedId: chat.storedId, profile, title: chatTitle, bot: botTitle }
  const notify = useCallback(
    async (spec: NotificationSpec) => {
      if (!notificationsEnabled() || typeof Notification === 'undefined') return
      // Docked, the chat is watched while its pane is on screen and the main window is in front, wherever its focus is.
      if (docked ? paneShown.current && (await window.conduit.pageWatched()) : document.hasFocus() && !document.hidden) return
      const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
      n.onclick = () => {
        const live = chatRef.current.liveId
        // Docked: the main window comes back with this chat docked again, wherever it was since.
        if (docked) {
          const storedId = chatRef.current.storedId ?? (request.fresh ? '' : request.id)
          window.conduit.openChat({ storedId, profile, title: chatRef.current.title, host, ...(botChat ? { botChat: true } : {}), ...(storedId ? {} : { fresh: true }) })
        }
        else if (live) void window.conduit.chatWindowOf(live, true)
      }
    },
    [docked, request.id, request.fresh, profile, host, botChat]
  )
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        const { liveId, ...ref } = chatRef.current
        if (event.type !== 'message.complete' || !event.session_id || event.session_id !== liveId) return
        const spec = turnNotification(event.session_id, event.payload, ref)
        // A muted chat's finished turn stays quiet, as the plugin's push does (state/chatMute).
        if (!spec) return
        if (!ref.storedId) void notify(spec)
        else
          void readMuted(muteHttp, { id: ref.storedId, title: ref.title ?? '', pinned: false, profile: ref.profile ?? undefined }).then(
            muted => muted || void notify(spec)
          )
      }),
    [notify]
  )
  const notified = useRef(new Set<string>())
  useEffect(() => {
    for (const request of openRequests) {
      if (notified.current.has(request.id)) continue
      notified.current.add(request.id)
      const { liveId: _live, ...ref } = chatRef.current
      void notify(requestNotification(request, ref))
    }
  }, [openRequests, notify])

  // Docked: the chat moves to a window of its own, and the main window, seeing it there, closes this pane.
  // A new chat has a window of its own once Hermes has stored it.
  const windowId = chatId
  const openInWindow = useCallback(async () => {
    if (!windowId) return
    const opened = await window.conduit.openChatWindow({ id: windowId, profile, title, author: botTitle, host, ...(botChat ? { botChat: true } : {}) })
    // The window may go by an id the pane wasn't opened with (a new chat's stored id), so the pane is told.
    if (opened && docked) window.conduit.dockedToPane('moved')
    if (opened) return
    const open = await window.conduit.chatWindows()
    notice(
      open.length >= CHAT_WINDOW_LIMIT
        ? t('Up to {count} chats can have windows of their own. Close one to open another.', { count: CHAT_WINDOW_LIMIT })
        : t('The chat didn’t open. Try again.'),
      'error'
    )
  }, [windowId, profile, title, botTitle, host, botChat, notice, docked])
  const openInMain = useCallback(() => {
    window.conduit.openChat({ storedId: chat.storedId ?? request.id, profile, title, fromWindow: true, ...(botChat ? { botChat: true } : {}), ...(host ? { host } : {}) })
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
        if (outcome.kind === 'unsent') return false
        // A new chat starts in the main window; this one keeps its chat.
        if (outcome.kind === 'new') {
          notice(docked ? t('Start a new chat from the chat list. This chat stays open.') : t('Start a new chat in the main window. This window keeps its chat.'), 'info')
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
    [botChat, docked, command, commands, notice, send, roster.bots, profile, botTitle, chat.liveId]
  )

  // A window's chat has no list row beside it, so its header's menu (issue 448) renames and deletes it here. A bot's
  // one chat and a workstream keep their names and aren't deleted from a list either; a docked chat is its dashboard's.
  const storedId = chat.storedId ?? (request.fresh ? null : request.id)
  const headerMenu =
    !docked && !botChat && !workItem && storedId && connected
      ? chatMenuItems(
          { pinned: false },
          {
            rename: async () => {
              const name = (await askText(t('Rename'), title))?.trim()
              if (!name || name === title) return
              try {
                await mutateSession(gateway.http, storedId, profile, { title: name })
                setRenamed(name)
              } catch (e) {
                void tell(t('Couldn’t change “{title}”: {reason}', { title, reason: e instanceof Error ? e.message : String(e) }))
              }
            },
            remove: async () => {
              if (!(await ask(`${t('Delete conversation?')}\n\n${t('This permanently deletes the conversation and cannot be undone.')}`, { confirm: t('Delete'), destructive: true }))) return
              try {
                await mutateSession(gateway.http, storedId, profile, null)
                // A deleted chat's pinned replies go with it, as from its row; the main window reads them again when this one closes.
                const pinHost = host
                savePins(pinHost, withoutChat(loadPins(pinHost), profile, storedId))
                window.close()
              } catch (e) {
                void tell(t('Couldn’t change “{title}”: {reason}', { title, reason: e instanceof Error ? e.message : String(e) }))
              }
            }
          }
        )
      : undefined

  return (
    <div className="chat-window-page" style={panelWidth !== null ? ({ '--panel-width': `${panelWidth}px` } as CSSProperties) : undefined}>
      <main className="chat chat-window-chat" ref={pane} aria-label={title}>
        <ChatHeader
          title={title}
          working={running}
          workItem={workItem}
          subtitle={
            workItem
              ? {
                  text: t('{bot}’s work · {ref}', { bot: botTitle, ref: workItem.ref }),
                  title: t('Back to {bot}', { bot: botTitle }),
                  onClick: () => {
                    if (bot?.botChatId) openOther(bot.botChatId, botTitle, { botChat: true })
                  }
                }
              : botChat
                ? undefined
                : { text: botTitle }
          }
          call={docked ? chatCall.header : undefined}
          newWindow={
            docked && windowId
              ? {
                  label: t('Open in New Window'),
                  title: calling ? t('End the call to move this chat to a window of its own') : `${t('Open in New Window')}: ${t('Moves this chat to a window of its own.')}`,
                  disabled: calling,
                  onClick: () => void openInWindow()
                }
              : undefined
          }
          screen={
            screenSupported
              ? { label: t("Bot's Screen"), on: screenOpen, onClick: () => window.conduit.openScreenWindow({ profile: screenProfile, botName: botTitle, ...(host ? { host } : {}) }) }
              : undefined
          }
          panel={
            panelTabs.length
              ? {
                  label: shownTab ? t('Hide side panel') : t('Show side panel'),
                  on: !!shownTab,
                  onClick: () => openTab(shownTab ? null : panelTabs.includes(lastTab.current) ? lastTab.current : panelTabs[0]!),
                  dot: workDot && shownTab !== 'work' ? workDot : null
                }
              : undefined
          }
          menu={headerMenu}
          trailing={
            docked ? null : (
              <button className="link" onClick={openInMain} title={t('Opens this chat in the main window and closes this one.')}>
                {t('Open in Main Window')}
              </button>
            )
          }
        />
        <AskedQuestionBar rows={askedHere} onChanged={() => void waiting.refresh()} liveId={chat.liveId} />
        <FileLinks.Provider value={openPath}>
          <WorkLinks.Provider value={workLinkActions}>
            <ConnectionActionsContext.Provider value={connectionActions}>
              <LiveTranscript
                store={transcriptStore}
                chatId={request.id || undefined}
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
                onLoadOlder={loadOlder}
                onSeekRow={seekRow}
                loadingOlder={loadingOlder}
                olderRows={olderRows}
              />
            </ConnectionActionsContext.Provider>
          </WorkLinks.Provider>
        </FileLinks.Provider>
        {contextOpen && chat.liveId ? (
          <ContextPanel
            chat={chat}
            profile={profile}
            running={running}
            onClose={() => setContextOpen(false)}
            onCompress={() => void onSend('/compress')}
          />
        ) : null}
        {modelOpen && canPickModel ? (
          <ModelPicker
            chat={chat}
            profile={profile}
            defaultModel={defaultModel}
            onClose={() => setModelOpen(false)}
            setModel={setModel}
            setReasoning={setReasoning}
            setSpeed={setSpeed}
            setYolo={setYolo}
          />
        ) : null}
        {docked ? chatCall.view({ requests: openRequests, onSend }) : null}
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
        <ChatTasksDock tasks={chatTasks.tasks} chatKey={request.id} />
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
            canPickModel
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
          model={chat.model ?? defaultModel}
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
          voice={calling ? undefined : { profile }}
          mentionBots={mentionBots}
        />
      </main>
      {shownTab ? (
        <ColumnDivider
          label={t('Side panel width')}
          bounds={PANEL_COLUMN}
          sign={-1}
          width={panelWidth}
          onLive={setPanelLive}
          onCommit={width => {
            setPanelLive(null)
            setPanelStored(width)
            writeWidth(PANEL_COLUMN, width)
          }}
        />
      ) : null}
      {shownTab === 'chat' && chatId ? (
        <ArtifactsPanel
          profile={profile}
          sessionIds={[chatId]}
          refreshKey={turnsDone}
          folder={chat.cwd}
          onShowInFolder={path => openPath?.(path)}
          onOpenChat={item => (item.sessionId === chatId ? showInChat(item.sessionId, item.messageId) : openOther(item.sessionId))}
          onClose={() => openTab(null)}
          tabs={panelTabBar}
        />
      ) : shownTab === 'work' ? (
        <WorkPanel
          key={profile ?? 'default'}
          profile={profile}
          botName={botTitle}
          snapshot={work.snapshot}
          error={work.error}
          onReload={() => void work.reload()}
          onAnswered={() => void waiting.refresh()}
          openChat={{ storedId: chat.storedId, liveId: chat.liveId, botChat }}
          onOpenChat={item => openOther(item.sessionId, shownTitle(item), { workstream: item.kind === 'workstream' })}
          onClose={() => openTab(null)}
          tabs={panelTabBar}
        />
      ) : shownTab === 'files' && chat.cwd ? (
        <FilesPanel
          root={chat.cwd}
          profile={profile}
          refreshKey={turnsDone}
          reveal={reveal}
          onInsertPath={path => setQuote(quoteRequest({ insert: pathForDraft(path) }))}
          onClose={() => openTab(null)}
          tabs={panelTabBar}
        />
      ) : null}
    </div>
  )
}
