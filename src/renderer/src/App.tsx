import { ROOM_RULES_CAPABILITY } from './state/roomChoices'
import { ROOM_LEAVE_CAPABILITY } from './state/roomCopies'
import { ROOM_FILES_CAPABILITY, ROOM_FILES_LINKED_CAPABILITY, ROOM_FILE_PICTURES_CAPABILITY } from './state/roomFiles'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type ComponentProps } from 'react'
import { gateway } from './gateway'
import { draftAgents, type OwnHermesBot } from './state/roomDrafts'
import { arrange, farBotFor, orderedBots, useBotOrder, useMixedBotOrder, useSyncedOrder } from './state/botOrder'
import { STATUS_PATH as PLUGIN_STATUS_PATH, pluginStatus } from './state/plugin'
import type { ConnectionStatus, HostSummary, LanguageChoice, MenuAction } from '@shared/ipc'
import { BotsHome, useReplyFace, type BotAction } from './components/BotsHome'
import { ProjectsPane } from './components/ProjectsPane'
import { BotScreen } from './components/BotScreen'
import { ChatList, type MoveTarget } from './components/ChatList'
import { Composer } from './components/Composer'
import { ModelPicker } from './components/ModelPicker'
import { ContextPanel } from './components/ContextPanel'
import { RoomView } from './components/RoomView'
import { Tasks } from './components/Tasks'
import { PulsePage } from './components/PulsePage'
import { FilesPanel } from './components/FilesPanel'
import { ColumnDivider } from './components/ColumnDivider'
import { LastCallTrace } from './components/LastCallTrace'
import { CrashReportBanner, DeviceReportsSetting } from './components/DeviceReports'
import { GlowContext, useGlowColors } from './components/GlowColors'
import { archiveClassicChat, tagVoiceSession, useVoiceList, withVoice } from './state/voiceList'
import { setCatalogHost } from './state/modelCatalog'
import { setTurnSurfaceHost } from './state/turnSurface'
import { useDashboardProfiles } from './state/useDashboardProfiles'
import { setDesktopCardsHost } from './state/desktopCards'
import { setKanbanHost } from './state/useKanban'
import { LIST_COLUMN, PANEL_COLUMN, besideChatFits, readListHidden, readWidth, shownListWidth, shownPanelWidth, writeListHidden, writeWidth } from './state/columnWidths'
import { BesideChatPane, type BesideChat } from './components/BesideChat'
import { CHAT_WINDOW_LIMIT } from '@shared/chatWindows'
import { absolutePath, pathForDraft } from './state/workspace'
import { FileLinks } from './components/Markdown'
import { usePulse } from './state/usePulse'
import { Icon } from './components/icons'
import { useMouseBack } from './state/mouseBack'
import { NeedsYou } from './components/NeedsYou'
import { SignIn } from './components/SignIn'
import { TitleBar, hostName } from './components/TitleBar'
import { setRunningCall, switchEndingCall } from './state/callSwitch'
import { Transcript, prefillRequest, quoteRequest, revealMessage } from './components/Transcript'
import { forgetSummaries } from './state/stepSummaries'
import { WAKE_EVENT, wakeBindings, wakeChat, wakeProfiles, type WakeBinding } from './state/wakeSettings'
import { forgetChatLists } from './state/savedChatList'
import { forgetKeptAnswers, setKeptAnswersHost } from './state/keptAnswers'
import { keepTabs, launchPage, syncedTabs } from './state/launchTab'
import { PREFS_PATH } from './state/pinnedOrder'
import { useFollowUps, usePredictions } from './state/usePredictions'
import { SummaryHost } from './state/useStepSummaries'
import { chatDraft, composerDrafts } from './state/composerDrafts'
import { openElsewhereMessage, owner } from './state/chatTakeover'
import type { Bot } from './state/bots'
import type { ChatRow } from './state/chats'
import { forgetAvatars, useBots } from './state/useBots'
import { mentionCandidates, withMentionNote, withoutMentionNote } from './state/botMentions'
import type { Room } from './state/groups'
import { useRooms } from './state/useGroups'
import { useChat } from './state/useChat'
import { useChatList } from './state/useChatList'
import { unmatchedWaiting, type WaitingRow } from './state/needsYou'
import { useRequests, useWaiting } from './state/useNeedsYou'
import { clearExpired, useExpiredQuestions } from './state/expiredQuestions'
import {
  askNotification,
  inviteNotification,
  isWatching,
  newlyArrived,
  notificationsEnabled,
  requestNotification,
  setNotificationsEnabled,
  turnNotification,
  type ChatRef,
  type NotificationSpec
} from './state/notifications'
import { cleanTitle } from './state/text'
import { askerLine } from './state/presented'
import type { StagedAttachment } from './state/attachments'
import type { QuoteRequest } from './state/quote'
import { isResetCommand, looksLikeSlashCommand } from './state/slash'
import { UsagePage } from './components/UsagePage'
import { ModelsPage } from './components/ModelsPage'
import { HostActions } from './components/HostActions'
import { hostReachable, updateBanner, useHostActions } from './state/hostActions'
import { ArtifactsPanel } from './components/ArtifactsPanel'
import { CapabilitiesPage } from './components/CapabilitiesPage'
import { onAppsDirectory, type AppsRequest } from './state/appsDirectory'
import { onModelsSettings, type ModelsRequest } from './state/modelsLink'
import { MemoryPage } from './components/MemoryPage'
import { PlanDock } from './components/PlanDock'
import { AgentsDock } from './components/AgentsDock'
import { ControlDock } from './components/ControlDock'
import { useAgents } from './state/useAgents'
import { planFromChecklist } from './state/plan'
import { BotEditor } from './components/BotEditor'
import { TakeoverSettings } from './components/TakeoverSettings'
import { ConnectionActionsContext } from './components/ConnectionCardView'
import { NewBot, type NewBotDashboard } from './components/NewBot'
import { useChatDisplay } from './state/display'
import { ConfigPage } from './components/ConfigPage'
import { ConduitPluginPage } from './components/ConduitPluginPage'
import { VaultPage } from './components/VaultPage'
import { AppearancePage } from './components/AppearancePage'
import { ReadAloudVoiceSetting } from './components/ReadAloudVoiceSetting'
import { MultiplayerPage } from './components/MultiplayerPage'
import { RoomInviteCard } from './components/RoomInviteCard'
import { useRoomInvites } from './state/useRoomInvites'
import { useRoomCopies } from './state/useRoomCopies'
import { useRoomDrafts } from './state/useRoomDrafts'
import { NewGroupChat } from './components/NewGroupChat'
import { RoomDraftCard } from './components/RoomDraftCard'
import { canLeave as canLeaveCopy, copyApprovals, copyRoom, isOver } from './state/roomCopies'
import { LOOKS_READ_MS } from './state/roomLooks'
import { useRoomLooks, type PersonPicture } from './state/useRoomLooks'
import { usePresented } from './state/usePresented'
import { ConfirmPanel } from './components/ConfirmPanel'
import { everyWhileVisible } from './state/visibility'
import { ROOM_LINKS_CAPABILITY } from './state/roomLinks'
import { ChatQueueDock } from './components/ChatQueueDock'
import { AppLockSetting, LockedScreen } from './components/AppLock'
import { AskDashboardSetting, DashboardChoice } from './components/AskDashboard'
import { CombineDashboardsSetting } from './components/CombinedDashboards'
import {
  hostBadge,
  keptStateLabel,
  openAfterSwitch,
  openBotAfterSwitch,
  openRoomAfterSwitch,
  openChatAfterSwitch,
  openPageAfterSwitch,
  newBotAfterSwitch,
  takeNewBotAfterSwitch,
  type NewBotCarry,
  otherHostsChats,
  otherHostsWaiting,
  takeBotAfterSwitch,
  takeChatAfterSwitch,
  takeRoomAfterSwitch,
  takeOpenAfterSwitch,
  takePageAfterSwitch,
  useKeptBots,
  useKeptRooms,
  combinedRooms,
  type OtherRoom,
  useKeptChats,
  useKeptPulse,
  pulseChips,
  useKeptHosts,
  useKeptWaiting,
  writeLastHost,
  type KeptWaitingRow,
  type OtherBot,
  type OtherChatRow
} from './state/keptHosts'
import { StepSummarySettings } from './components/StepSummarySettings'
import { PredictiveSettings } from './components/PredictiveSettings'
import { advancedSections, chatSections, workspaceSections } from './state/profileConfig'
import { canDelete, duplicateBot, writeMeta } from './state/botActions'
import { WorkPanel } from './components/WorkPanel'
import { PanelTabs, workCount, type PanelTab } from './components/PanelTabs'
import { useWork, useWorkSessions } from './state/useWork'
import { shownTitle, statusText, workTone, type WorkItem } from './state/work'
import { VoiceCall } from './components/VoiceCall'
import { VoiceModeCapsule } from './components/VoiceModeCapsule'
import { CallPictureControls } from './components/CallPictureControls'
import { dataUrlBlob, type CallPicture, type PictureKind, type PictureNote } from './state/callPicture'
import { modelFrame, stageFile } from './state/picture'
import { GptLiveCall } from './components/GptLiveCall'
import { GrokLiveCall } from './components/GrokLiveCall'
import { LocalLiveCall } from './components/LocalLiveCall'
import { GeminiLiveCall } from './components/GeminiLiveCall'
import { HermesCallSettings } from './components/HermesCallSettings'
import { WakePhraseSettings } from './components/WakePhraseSettings'
import { IncomingCall } from './components/IncomingCall'
import { declineOnHost, useCallPresence, useRings, type Ring } from './state/rings'
import { VoiceModeSettings } from './components/VoiceModeSettings'
import { VOICE_MODE_EVENT, VOICE_MODES, setVoiceMode, voiceMode, voiceModeTitle, type VoiceMode } from './state/gptLive'
import { readAloud, readsRepliesAloud, setReadsRepliesAloud } from './state/readAloud'
import { useCommands } from './state/useCommands'
import { authorityMutation, moveChat, mutateSession, sessionPath } from './state/chatActions'
import { branchPlan } from './state/branch'
import { ROOM_CHATS_CAPABILITY, openRoomChat, roomChatsClient, wrapUpPrompt, type RoomChatAgent } from './state/roomChats'
import { parseProjects, type ProjectChat } from './state/projects'
import { useLiveStatus } from './state/liveStatus'
import { loadPins, newPin, pinsOfChat, savePins, withoutChat, type PinnedReply } from './state/pinnedReplies'
import { PinnedRepliesSheet, type PinControls } from './components/PinnedReplies'
import { loadMarks, markRead, markUnread, saveMarks, toggleStar, isUnread, type ChatMarks } from './state/chatMarks'
import { isDone, useChatDone } from './state/chatDone'
import { GO_TO, SCALES, applyScale, nextScale, readScale, shortcutFor } from './state/shortcuts'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { CallTranscriptSheet } from './components/CallTranscriptSheet'
import { ProviderConsentSheet } from './components/ProviderConsent'
import { consented, isLive } from './state/consent'
import { loadChatCalls, type CallTranscript, type ChatCall } from './state/voiceCalls'
import type { CallResume } from './state/voiceSave'
import { LANGUAGES, LANGUAGE_NAMES, t } from '@shared/i18n'
import { ask, tell } from './state/dialogs'
import { forgetTranscripts } from './state/transcriptCache'

/** The host's synced preferences, for the bots' order. */
const prefsHttp = (method: 'GET' | 'PUT', path: string, body?: unknown) => gateway.http(method, path, body)

export function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  const [adding, setAdding] = useState(false)
  // Edit Connection: the open host's address and sign-in, on the sign-in card.
  const [editing, setEditing] = useState<HostSummary | null>(null)
  // Repair Connection: a host that can't connect, changed in its place. It
  // stays up through its own sign-in's connecting until the host opens.
  const [repairing, setRepairing] = useState<HostSummary | null>(null)
  // A new host signed in (or the sign-in screen otherwise left): back to the app.
  const url = status?.url
  useEffect(() => setAdding(false), [url])
  // Another host's transcripts never draw here. An effect, so it runs after the
  // old host's chat view has kept its own on unmount (desktop#201).
  useEffect(() => forgetTranscripts(), [url])
  // The launch list's combined row opens the member used last.
  useEffect(() => {
    if (url) writeLastHost(url)
  }, [url])
  // Model pickers open on the catalog kept from this host's last answer, never another host's.
  setCatalogHost(url ?? '')
  setKeptAnswersHost(url ?? '')
  setTurnSurfaceHost(url ?? '')
  setDesktopCardsHost(url ?? '')
  setKanbanHost(url ?? '')
  const phase = status?.phase
  // A host Hermes signed out opens on Repair; one that opens needs none.
  useEffect(() => {
    if (phase === 'open') setRepairing(null)
    else if (phase === 'failed' && url) setRepairing(current => (current?.url === url ? current : savedHost(status?.hosts, url)))
  }, [phase, url]) // eslint-disable-line react-hooks/exhaustive-deps
  // Whether this dashboard's plugin reads ?conduit_profile= for another profile's routes, or an older one keeps ?profile=.
  useDashboardProfiles(phase, url)
  // A host signed out or removed takes the summaries of its runs of steps, and its saved chat list, with it.
  const hostList = status?.hosts?.map(h => h.url).join('\n')
  useEffect(() => {
    if (hostList === undefined) return
    forgetSummaries(hostList ? hostList.split('\n') : [])
    forgetChatLists(hostList ? hostList.split('\n') : [])
    forgetKeptAnswers(hostList ? hostList.split('\n') : [])
  }, [hostList])

  if (!status) return <div className="app" />
  const signedOut = status.phase === 'signed-out' || (status.phase === 'failed' && !status.url)
  return (
    <div className="app">
      <TitleBar
        subtitle={signedOut ? undefined : status.hostLabel}
        hosts={status.hosts}
        currentUrl={status.url}
        onSwitch={async url => {
          if (!(await switchEndingCall(hostName(url)))) return
          setRepairing(null)
          void window.conduit.switchHost(url)
        }}
      />
      {status.phase === 'locked' ? (
        <LockedScreen />
      ) : editing ? (
        <SignIn editing={editing} onCancel={() => setEditing(null)} onDone={() => setEditing(null)} />
      ) : adding ? (
        <SignIn onCancel={() => setAdding(false)} />
      ) : repairing && status.phase !== 'open' ? (
        <SignIn
          key={repairing.url}
          editing={repairing}
          repairing
          notice={status.phase === 'failed' ? status.error : undefined}
          onCancel={status.phase === 'reconnecting' ? () => setRepairing(null) : undefined}
          onDone={() => setRepairing(null)}
        />
      ) : status.phase === 'signed-out' && status.choosing && status.hosts?.length ? (
        <DashboardChoice hosts={status.hosts} onAdd={() => setAdding(true)} />
      ) : signedOut || status.phase === 'failed' ? (
        <SignIn notice={status.error} />
      ) : (
        // Each host gets a fresh window state: its chats, bots and rooms are its own.
        <SummaryHost.Provider value={status.url ?? ''}>
          <Shell
            key={status.url}
            status={status}
            onAddHost={() => void switchEndingCall(null).then(ok => ok && setAdding(true))}
            onEditHost={host => void switchEndingCall(null).then(ok => ok && setEditing(host))}
            onRepair={() => status.url && setRepairing(savedHost(status.hosts, status.url))}
          />
        </SummaryHost.Provider>
      )}
    </div>
  )
}

/**
 * A pane kept mounted while another section shows. Away, it renders what it
 * last showed, so the rest of the window's updates skip it (its own state
 * still updates), and the CSS keeps its layout without painting it.
 */
function KeptPane({ away, children }: { away: boolean; children: ReactNode }) {
  const shown = useRef(children)
  if (!away) shown.current = children
  return (
    <div className={`chats-section${away ? ' away' : ''}`} inert={away}>
      {shown.current}
    </div>
  )
}

type Section = 'bots' | 'room' | 'chats' | 'tasks' | 'pulse' | 'artifacts' | 'needs' | 'settings'

const REOPEN_SECTION = 'conduit.reopen-section'

/** Comes back to Settings once a page that takes the whole window (Connection Setup, Add another Hermes) closes. */
function reopenSettings(): void {
  try {
    sessionStorage.setItem(REOPEN_SECTION, 'settings')
  } catch {
    // Opens on the first tab instead.
  }
}

/** Settings after a language change reloads the window, else the first tab the phone's layout shows (Bots until it's reordered). */
function reopenedSection(host: string): Section {
  try {
    const saved = sessionStorage.getItem(REOPEN_SECTION)
    sessionStorage.removeItem(REOPEN_SECTION)
    if (saved === 'settings') return 'settings'
  } catch {
    // A launch.
  }
  return launchPage(host)
}

/** The saved host at `url`, or its address alone when the list doesn't have it yet. */
function savedHost(hosts: HostSummary[] | undefined, url: string): HostSummary {
  return hosts?.find(host => host.url === url) ?? { url, method: 'password' }
}

/** The connection banner's words while an update started here has Hermes away (state/hostActions' updateBanner). */
function updateAwayText(away: NonNullable<ReturnType<typeof updateBanner>>): string {
  if (away === 'updating') return `${t('Updating Hermes…')} ${t("Conduit reconnects when it's back.")}`
  if (away === 'restarting') return `${t('Hermes is restarting on the new version…')} ${t("Conduit reconnects when it's back.")}`
  if (away === 'notBack') return `${t("Hermes hasn't come back after its update.")} ${t('The update may have stopped. If Hermes stays away, start it on the host.')}`
  return `${t("Couldn't update Hermes")}. ${t('The update may have stopped. If Hermes stays away, start it on the host.')}`
}

function Shell({
  status,
  onAddHost,
  onEditHost,
  onRepair
}: {
  status: ConnectionStatus
  onAddHost: () => void
  onEditHost: (host: HostSummary) => void
  onRepair: () => void
}) {
  // Before any picture is read for this host.
  useState(forgetAvatars)
  const connected = status.phase === 'open'
  const [section, setSection] = useState<Section>(() => reopenedSection(status.url ?? ''))
  // A bot opened from Bots home keeps the bots, and its workstreams, in the sidebar (as the iPad's Bots column
  // stays beside an open Bot Chat) until Chats in the rail asks for the sessions list.
  const [botsSide, setBotsSide] = useState(false)
  /** Chats has been open: from then on its pane stays mounted, only hidden. */
  const [chatsSeen, setChatsSeen] = useState(section === 'chats')
  if (section === 'chats' && !chatsSeen) setChatsSeen(true)
  const chatsShown = chatsSeen || section === 'chats'
  // `folder`: a new chat started in a project works there.
  const [selected, setSelected] = useState<{ id: string | null; profile?: string; title?: string; botChat?: boolean; folder?: string }>({ id: null })
  const [projectsOpen, setProjectsOpen] = useState(false)
  const list = useChatList(connected, status.url ?? '')
  const {
    transcript,
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
    noteCorrection,
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
    react: reactTo
  } = useChat(selected.id, selected.profile, status.sessionAuthority === true, connected, selected.botChat === true, selected.id ? undefined : selected.folder)

  // The chat list's profile: a new chat starts in it.
  const [chatProfile, setChatProfile] = useState<string | null>(null)
  const chatProfileRef = useRef(chatProfile)
  const chatPane = useRef<HTMLElement>(null)
  chatProfileRef.current = chatProfile
  const newChat = useCallback(() => {
    setSection('chats')
    setSelected({ id: null, profile: chatProfileRef.current ?? undefined })
  }, [])

  // The Mac's menu bar sends its shortcuts; elsewhere the window reads Ctrl and the same key.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])
  const [chatScale, setChatScale] = useState(readScale)
  useEffect(() => applyScale(chatScale), [chatScale])
  // A chat's apps card opens Settings > Capabilities > Browse Apps.
  const [appsRequest, setAppsRequest] = useState<AppsRequest | null>(null)
  useEffect(
    () =>
      onAppsDirectory(request => {
        setAppsRequest(request)
        setSection('settings')
      }),
    []
  )
  // Group Settings' router model opens Settings > Models for the default profile.
  const [modelsRequest, setModelsRequest] = useState<ModelsRequest | null>(null)
  useEffect(
    () =>
      onModelsSettings(request => {
        setModelsRequest(request)
        setSection('settings')
      }),
    []
  )
  // A Link invite opened from another app opens in Settings > Multiplayer, as on the phone.
  const [linkRequest, setLinkRequest] = useState<{ url: string; at: number } | null>(null)
  useEffect(() => {
    const open = (url: string | null) => {
      if (!url) return
      setLinkRequest({ url, at: Date.now() })
      setSection('settings')
    }
    void window.conduit.takeLinkUrl().then(open).catch(() => undefined)
    return window.conduit.onLinkUrl(open)
  }, [])
  const runShortcut = useRef<(action: MenuAction) => void>(() => {})
  runShortcut.current = action => {
    if (action === 'new-chat') newChat()
    else if (action === 'needs-you') setSection('needs')
    else if (action === 'settings') setSection('settings')
    else if (action === 'shortcuts') setShortcutsOpen(open => !open)
    else if (action === 'text-bigger') setChatScale(s => nextScale(s, 1))
    else if (action === 'text-smaller') setChatScale(s => nextScale(s, -1))
    else if (action === 'text-normal') setChatScale(1)
    else if (action === 'stop') {
      if (section === 'chats' && transcript.running) void stop()
    } else if (action === 'toggle-sidebar') {
      if (section === 'chats') hideList(!listHidden)
      else {
        setSection('chats')
        hideList(false)
      }
    } else if (action === 'search') {
      setSection('chats')
      hideList(false)
      // The list mounts with Chats.
      setTimeout(() => document.querySelector<HTMLInputElement>('.chatlist-search input')?.focus(), 0)
    } else if (action.startsWith('go-')) {
      const target = GO_TO[Number(action.slice(3)) - 1]
      if (target) setSection(target)
    }
  }
  useEffect(() => {
    const offMenu = window.conduit.onMenu(action => runShortcut.current(action))
    const offOpen = window.conduit.onOpenChat(ref => {
      setSelected({ id: ref.storedId, profile: ref.profile, title: ref.title })
      setSection('chats')
    })
    if (window.conduit.platform === 'darwin') {
      return () => {
        offMenu()
        offOpen()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutFor(event, false)
      if (!action) return
      event.preventDefault()
      runShortcut.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offMenu()
      offOpen()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const roster = useBots(connected)
  // The phone's tab layout, kept for this dashboard's next launch (not this one: the page is already open).
  useEffect(() => {
    if (!connected || !status.url) return
    const host = status.url
    prefsHttp('GET', PREFS_PATH).then(
      response => keepTabs(host, syncedTabs(response)),
      () => undefined
    )
  }, [connected, status.url])
  // The bots in the person's order (synced as bots.order), which every list of bots follows.
  const botOrder = useBotOrder(status.url ?? '', connected, prefsHttp)
  const roomOrder = useSyncedOrder(status.url ?? '', connected, prefsHttp, 'rooms')
  const orderedRoster = useMemo(() => (roster.bots ? orderedBots(roster.bots, botOrder.order) : null), [roster.bots, botOrder.order])
  const glowBots = useMemo(() => [...(roster.bots ?? []), ...roster.hidden], [roster.bots, roster.hidden])
  // Thinking and Tool cards as the profile's settings say; read again after a visit to Settings.
  const chatDisplay = useChatDisplay(selected.profile, connected, section === 'chats')
  const chatBot = roster.bots?.find(b => b.name === (selected.profile ?? 'default'))
  const botTitle = chatBot?.title ?? 'Hermes'
  const chatFace = useReplyFace(chatBot)
  const [quote, setQuote] = useState<QuoteRequest | null>(null)
  // A quote lands in the composer it was made for, not again on the way back to Chats.
  useEffect(() => {
    if (section !== 'chats') setQuote(null)
  }, [section])
  const pulse = usePulse(connected, section === 'pulse')
  // The Folder beside the chat: open until closed, for whichever chat has a folder.
  const [filesOpen, setFilesOpen] = useState(() => {
    try {
      return localStorage.getItem('conduit.filesOpen') === '1'
    } catch {
      return false
    }
  })
  const showFiles = useCallback((open: boolean) => {
    setFilesOpen(open)
    try {
      localStorage.setItem('conduit.filesOpen', open ? '1' : '0')
    } catch {
      // Kept for this window only.
    }
  }, [])
  // A file path in a reply opens in the Folder.
  const [reveal, setReveal] = useState<{ path: string; id: number } | null>(null)
  const cwd = chat.cwd
  const openPath = useMemo(
    () =>
      cwd
        ? (path: string) => {
            setReveal(current => ({ path: absolutePath(path, cwd), id: (current?.id ?? 0) + 1 }))
            setArtifactsOpen(false)
            setWorkOpen(false)
            showFiles(true)
          }
        : null,
    [cwd, showFiles]
  )
  // Each reply's end reads the open folders again: the agent may have changed files.
  const [turnsDone, setTurnsDone] = useState(0)
  const [calling, setCalling] = useState(false)
  // A dashboard switch ends the call, so a pick asks first (state/callSwitch.ts).
  useEffect(() => {
    if (!calling) return
    setRunningCall(() => setCalling(false))
    return () => setRunningCall(null)
  }, [calling])
  // The call's mode, read as it starts: Settings > Voice, or Classic after a GPT-Live call failed.
  const [callMode, setCallMode] = useState<VoiceMode>('classic')
  // A live mode asks once before sending the call to its company; Allow redraws with the call.
  const [, setConsentGiven] = useState(0)
  const asksConsent = calling && isLive(callMode) && !consented(callMode)
  // The mode is set with the call, never a render later: a Classic call drawn first would open the microphone.
  const toggleCall = () => {
    if (!calling) setCallMode(voiceMode())
    setResume(null)
    setCalling(!calling)
  }
  // Resume call, from a saved call's card: a live call in its chat that continues it, on the mode picked now.
  const [resume, setResume] = useState<CallResume | null>(null)
  useEffect(() => {
    if (!calling) setResume(null)
  }, [calling])
  const resumeCall = (callId: string, call: CallTranscript) => {
    setOpenCall(null)
    setResume({ callId, turns: call.turns, from: call.count })
    setCallMode(voiceMode())
    setCalling(true)
  }
  // A call's mode menu, or the picker beside the call button during a call: Voice settings keep the
  // mode picked, and the call ends and starts again in it, in the same chat. Its own mode leaves it be.
  const switchCallMode = (mode: VoiceMode) => {
    setVoiceMode(mode)
    if (!calling || mode === callMode) return
    setResume(null)
    setCallMode(mode)
  }
  const modeMenu = <VoiceModeCapsule mode={callMode} onPick={switchCallMode} />
  // Show a picture on a call: it waits on the call's chat for the next request, and the call hears of it.
  const [callPicture, setCallPicture] = useState<CallPicture | null>(null)
  const [pictureNote, setPictureNote] = useState<PictureNote | null>(null)
  const [pictureBusy, setPictureBusy] = useState(false)
  const pictureIds = useRef(0)
  const waitingPicture = useRef<CallPicture | null>(null)
  waitingPicture.current = callPicture
  useEffect(() => {
    if (calling) return
    setCallPicture(null)
    setPictureNote(null)
  }, [calling])
  const showPicture = async (file: Blob & { name?: string }, kind: PictureKind) => {
    setPictureBusy(true)
    try {
      const id = ++pictureIds.current
      const named = file instanceof File ? file : new File([file], kind === 'screenshot' ? 'Screenshot.png' : 'Picture.png', { type: file.type || 'image/png' })
      const [attachment, frame] = await Promise.all([stageFile(named, `call-picture-${id}`), modelFrame(named)])
      if (attachment.kind !== 'image') {
        void tell(t('That file isn’t a picture Conduit can show.'))
        return
      }
      setCallPicture({ id, kind, attachment, frame })
      setPictureNote({ id, kind, change: 'shown', frame })
    } finally {
      setPictureBusy(false)
    }
  }
  const screenshotForCall = async () => {
    setPictureBusy(true)
    const shot = await window.conduit.screenshot().catch(() => null)
    setPictureBusy(false)
    if (!shot) {
      void tell(t('Conduit couldn’t capture the screen. On a Mac, allow Screen Recording for Conduit in System Settings, then try again.'))
      return
    }
    await showPicture(dataUrlBlob(shot), 'screenshot')
  }
  const removeCallPicture = () => {
    const picture = waitingPicture.current
    if (!picture) return
    setCallPicture(null)
    setPictureNote({ id: ++pictureIds.current, kind: picture.kind, change: 'removed', frame: null })
  }
  /** A call's request to Hermes: the waiting picture goes with it, once. */
  const callSay = (words: string) => {
    const picture = waitingPicture.current
    if (picture) {
      waitingPicture.current = null
      setCallPicture(null)
    }
    void onSend(words, picture ? [picture.attachment] : [], { takeOver: true, spoken: true })
  }
  const pictureControls = (
    <CallPictureControls
      waiting={callPicture}
      busy={pictureBusy}
      onPick={file => void showPicture(file, 'picture')}
      onScreenshot={() => void screenshotForCall()}
      onRemove={removeCallPicture}
    />
  )
  // The mode the next call takes, picked beside the call button or in Settings > Voice.
  const [nextMode, setNextMode] = useState<VoiceMode>(voiceMode)
  useEffect(() => {
    const changed = () => setNextMode(voiceMode())
    window.addEventListener(VOICE_MODE_EVENT, changed)
    return () => window.removeEventListener(VOICE_MODE_EVENT, changed)
  }, [])
  // The open chat's saved voice calls, read again once a call here ends (its save lands a moment later).
  const [chatCallList, setChatCallList] = useState<ChatCall[]>([])
  const [openCall, setOpenCall] = useState<string | null>(null)
  useEffect(() => {
    setChatCallList([])
    setOpenCall(null)
    const id = selected.id
    if (!id || calling) return
    let live = true
    const read = () =>
      void loadChatCalls(selected.profile, id).then(calls => {
        if (live) setChatCallList(calls)
      })
    read()
    const later = window.setTimeout(read, 3000)
    return () => {
      live = false
      window.clearTimeout(later)
    }
  }, [selected.id, selected.profile, calling])
  /** Edit Bot, open over Bots home. */
  const [editingBot, setEditingBot] = useState<Bot | null>(null)
  const [newBot, setNewBot] = useState(false)
  // New Bot made on another combined dashboard: the sheet's words, carried over the switch.
  const [carriedBot, setCarriedBot] = useState<NewBotCarry | null>(null)
  const [botNotice, setBotNotice] = useState<string | null>(null)
  // A call is the open chat's: another chat, or another screen, ends it. A
  // new chat getting its id from the call's first message is the same chat.
  const callChat = useRef(selected.id)
  useEffect(() => {
    const was = callChat.current
    callChat.current = selected.id
    if (was !== null && was !== selected.id) setCalling(false)
  }, [selected.id])
  useEffect(() => setCalling(false), [selected.profile, section])
  // A chat a Classic call made (started with no chat open) is filed under Voice, and archived when the
  // call ends so Hermes Desktop's list keeps the chats people work in; this list shows it still.
  const classicFresh = useRef<{ fresh: boolean; chat: { id: string; profile?: string } | null }>({ fresh: false, chat: null })
  useEffect(() => {
    const kept = classicFresh.current
    if (calling && callMode === 'classic') {
      if (!kept.fresh && !kept.chat && !selected.id) kept.fresh = true
      if (kept.fresh && !kept.chat && selected.id) {
        kept.chat = { id: selected.id, profile: selected.profile }
        void tagVoiceSession(selected.profile, selected.id, 'classic').catch(() => undefined)
      }
      return
    }
    if (kept.chat) void archiveClassicChat(kept.chat.profile, kept.chat.id).catch(() => undefined)
    classicFresh.current = { fresh: false, chat: null }
  }, [calling, callMode, selected.id, selected.profile])
  // A call from Hermes answered here: its chat opens, then the call starts in it (after the resets above).
  const answeredCall = useRef<string | null>(null)
  useEffect(() => {
    if (!answeredCall.current || answeredCall.current !== selected.id || section !== 'chats') return
    answeredCall.current = null
    setCallMode(voiceMode())
    setCalling(true)
  }, [selected.id, selected.profile, section])
  // Edit Bot closes when another section opens.
  /** Edit profile from Settings or the profile strip: the section to go back to, and a switch to Bots that keeps the editor. */
  const profileEditReturn = useRef<Section | null>(null)
  const keepEditor = useRef(false)
  useEffect(() => {
    if (keepEditor.current) keepEditor.current = false
    else {
      setEditingBot(null)
      profileEditReturn.current = null
    }
  }, [section])
  /** The phone's Profiles card Edit (and Settings > Edit profile): Edit Bot for any profile, Bots or not, then back where it was opened. */
  const editProfile = (bot: Bot) => {
    setNewBot(false)
    setCarriedBot(null)
    if (section !== 'bots') {
      profileEditReturn.current = section
      keepEditor.current = true
      setSection('bots')
    }
    setEditingBot(bot)
  }
  /** New Bot from the bots sidebar: it opens on Bots wherever the sidebar is. */
  const newBotFromSide = () => {
    setEditingBot(null)
    setCarriedBot(null)
    profileEditReturn.current = null
    if (section !== 'bots') setSection('bots')
    setNewBot(true)
  }
  const closeBotEditor = () => {
    setEditingBot(null)
    const back = profileEditReturn.current
    profileEditReturn.current = null
    if (back) setSection(back)
  }
  // Read replies aloud: the open chat's reply, as its turn ends, unless a call speaks it.
  const readTurn = useRef(turnsDone)
  useEffect(() => {
    if (readTurn.current === turnsDone) return
    readTurn.current = turnsDone
    if (!calling && readsRepliesAloud() && lastReplyRef.current && document.hasFocus())
      void readAloud(`turn-${turnsDone}`, lastReplyRef.current, selected.profile).catch(() => undefined)
  }, [turnsDone])
  const lastReplyRef = useRef<string | null>(null)
  const lastReply = useMemo(() => {
    for (let i = transcript.items.length - 1; i >= 0; i--) {
      const item = transcript.items[i]!
      if (item.kind === 'user') return null
      if (item.kind === 'assistant' && item.text.trim()) return item.text
    }
    return null
  }, [transcript.items])
  lastReplyRef.current = lastReply
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !transcript.running) setTurnsDone(n => n + 1)
    wasRunning.current = transcript.running
  }, [transcript.running])
  const pulseChat = pulse.feed?.homeChatId || null
  // Pulse's own chat stays behind its screen, as on the phone.
  // Workstreams' chats stay with their bots, as on the phone.
  const botNames = useMemo(() => (roster.bots ?? []).map(bot => bot.name), [roster.bots])
  const { sessions: workSessions, byBot: workByBot } = useWorkSessions(botNames, connected)
  // Voice's rows: calls, Classic's chats and voice jobs under Voice, the plugin's archived ones listed again.
  const voiceProfiles = useMemo(() => [...new Set((list.rows ?? []).map(r => r.profile ?? ''))].sort(), [list.rows])
  const voice = useVoiceList(connected, voiceProfiles, `${list.rows?.length ?? 0}\t${list.archived.length}\t${list.rows?.[0]?.activeAt ?? 0}`)
  const listedRows = useMemo(() => {
    const rows = list.rows ? withVoice(list.rows, list.archived, voice) : list.rows
    return rows && (pulseChat || workSessions.size) ? rows.filter(row => row.id !== pulseChat && !workSessions.has(row.id)) : rows
  }, [list.rows, list.archived, voice, pulseChat, workSessions])
  // The open chat's bot's work: its Bot Chat shows a line under its title, and a workstream's chat goes back to it.
  const [workOpen, setWorkOpen] = useState(false)
  const openBotChat = selected.id ? roster.bots?.find(bot => bot.botChatId === selected.id) : undefined
  // The bots sidebar shows while the chat on screen is a bot's: its Bot Chat (or a new one) or one of its workstreams.
  const botsSideShown = botsSide && !!roster.bots?.length && (selected.botChat === true || !!openBotChat || workSessions.has(selected.id ?? ''))
  // Wherever the bots list shows: beside a bot's chat, a group chat, or New Bot and Edit Bot.
  const botsListShown = section === 'bots' || section === 'room' || (section === 'chats' && botsSideShown)
  const work = useWork(selected.profile, connected, section === 'chats' && (workOpen || botsSideShown || !!openBotChat || workSessions.has(selected.id ?? '')))
  const workItem: WorkItem | undefined = selected.id
    ? work.snapshot?.items.find(item => item.kind === 'workstream' && item.sessionId === selected.id)
    : undefined
  // A workstream's checklist is its chat's plan, ahead of Hermes' own todo list there.
  const workChecklist = workItem?.checklist
  const shownPlan = useMemo(() => (workChecklist?.length ? planFromChecklist(workChecklist) : transcript.plan), [workChecklist, transcript.plan])
  const delegates = useAgents(chat.liveId, connected, transcript.running)
  const [drafting, setDrafting] = useState(false)
  const followedUp = useFollowUps(transcript, connected && !calling ? (chat.liveId ?? undefined) : undefined, selected.profile, !drafting)
  const predictions = usePredictions(transcript, connected && !calling ? (chat.liveId ?? undefined) : undefined)
  // Hermes may have changed the goal, loop or heartbeat: a turn ended or a command answered.
  const outputs = useMemo(() => transcript.items.filter(item => item.kind === 'output').length, [transcript.items])
  const controlPulse = turnsDone + outputs
  const workBot = roster.bots?.find(bot => bot.name === (selected.profile ?? 'default'))
  // A bot's chat (its Bot Chat, one not resolved yet, or a workstream's) offers its work once the host answers with some.
  const workHere = !!openBotChat || !!workItem || selected.botChat === true
  const showWork = workOpen && workHere && (!!work.snapshot || !!work.error)
  // The bot's screen (Hermes' Bot Screen), offered only where the host can have one, as the phone checks.
  const screenProfile = selected.profile ?? 'default'
  const [screenOpen, setScreenOpen] = useState(false)
  const [screenHosts, setScreenHosts] = useState<Record<string, boolean>>({})
  useEffect(() => setScreenHosts({}), [status.url])
  useEffect(() => {
    if (!connected || screenHosts[screenProfile] !== undefined) return
    let live = true
    gateway
      .rpc<{ supported?: unknown }>('display.status', { profile: screenProfile })
      .then(answer => live && setScreenHosts(all => ({ ...all, [screenProfile]: answer?.supported === true })))
      .catch(() => live && setScreenHosts(all => ({ ...all, [screenProfile]: false })))
    return () => {
      live = false
    }
  }, [connected, screenProfile, screenHosts])
  useEffect(() => setScreenOpen(false), [screenProfile])
  // The chat's artifacts beside it, after the phone's In This Chat sheet.
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  // The side panel's tabs (Eric, 2026-11-20, option C, softer): the bot's Work, In This Chat and the chat's Files, where the chat has them, one open at a time.
  const panelTabs: PanelTab[] = [
    ...(workHere && (work.snapshot || work.error) ? (['work'] as const) : []),
    ...(selected.id ? (['chat'] as const) : []),
    ...(chat.cwd ? (['files'] as const) : [])
  ]
  const shownTab: PanelTab | null = artifactsOpen && selected.id ? 'chat' : showWork ? 'work' : filesOpen && chat.cwd ? 'files' : null
  const lastTab = useRef<PanelTab>('work')
  const openTab = (tab: PanelTab | null) => {
    if (tab) lastTab.current = tab
    setArtifactsOpen(tab === 'chat')
    setWorkOpen(tab === 'work')
    showFiles(tab === 'files')
  }
  const workDot = workHere ? workCount(work.snapshot) : null
  // The tabs show where there's more than one to pick between.
  const panelTabBar = shownTab && panelTabs.length > 1 ? <PanelTabs tabs={panelTabs} shown={shownTab} onPick={openTab} work={work.snapshot} /> : null
  // The list's and the side panel's widths, dragged by the lines beside them and kept on this device.
  const [listStored, setListStored] = useState(() => readWidth(LIST_COLUMN))
  const [panelStored, setPanelStored] = useState(() => readWidth(PANEL_COLUMN))
  const [listLive, setListLive] = useState<number | null>(null)
  const [panelLive, setPanelLive] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const resized = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  // The chat list hidden (the « at its top, ⌘\ or Ctrl+\, or a drag past its least width) until the » atop the rail brings it back.
  const [listHidden, setListHidden] = useState(readListHidden)
  const hideList = useCallback((hidden: boolean) => {
    setListHidden(hidden)
    writeListHidden(hidden)
  }, [])
  const listWidth = shownListWidth(listLive ?? listStored, windowWidth)
  const listTaken = section === 'chats' && listHidden ? 0 : (listWidth ?? Math.min(320, Math.max(240, windowWidth * 0.28)))
  const panelWidth = shownPanelWidth(panelLive ?? panelStored, windowWidth, listTaken)
  // A chat beside the open one: only where both fit, else the pane hides until the window widens.
  const [beside, setBeside] = useState<BesideChat | null>(null)
  const besideBot = beside ? roster.bots?.find(b => b.name === (beside.profile ?? 'default')) : undefined
  const besideFace = useReplyFace(besideBot)
  const besideFits = besideChatFits(windowWidth, listTaken)
  const sameProfileAs = (a?: string, b?: string) => (a ?? 'default').toLowerCase() === (b ?? 'default').toLowerCase()
  // The chats in windows of their own (up to three), from the main process.
  const [chatWindowIds, setChatWindowIds] = useState<string[]>([])
  useEffect(() => {
    const off = window.conduit.onChatWindows(setChatWindowIds)
    void window.conduit.chatWindows().then(setChatWindowIds)
    return off
  }, [])
  // A chat opened here closes its window of its own.
  useEffect(() => {
    if (selected.id && chatWindowIds.includes(selected.id)) window.conduit.closeChatWindows([selected.id])
  }, [selected.id, chatWindowIds])
  /** The pane's Open in New Window: the chat moves to a window of its own and the pane closes. */
  const moveBesideToWindow = (moving: BesideChat, author: string) => {
    void window.conduit.openChatWindow({ id: moving.id, profile: moving.profile, title: moving.title, author }).then(opened => {
      if (opened) setBeside(current => (current?.id === moving.id ? null : current))
    })
  }
  // Opening the pane's chat in the chat's column, or a chat of another profile, closes it.
  useEffect(() => {
    if (beside && (selected.id === beside.id || !sameProfileAs(selected.profile, beside.profile))) setBeside(null)
  }, [beside, selected.id, selected.profile])
  /** Open Beside: the row opens, and the chat on screen stays in the pane (an ordinary chat of the same profile only). */
  const openBeside = (row: ChatRow) => {
    const keeps = !!selected.id && !selected.botChat && selected.id !== row.id
    setSelected({ id: row.id, profile: row.profile, title: row.title })
    setBeside(keeps ? { id: selected.id!, profile: selected.profile, title: chat.title ?? selected.title } : null)
  }
  const swapBeside = () => {
    if (!beside) return
    setBeside(selected.id && !selected.botChat ? { id: selected.id, profile: selected.profile, title: chat.title ?? selected.title } : null)
    setSelected({ id: beside.id, profile: beside.profile, title: beside.title })
  }
  const commitList = (width: number | null) => {
    setListLive(null)
    setListStored(width)
    writeWidth(LIST_COLUMN, width)
  }
  const commitPanel = (width: number | null) => {
    setPanelLive(null)
    setPanelStored(width)
    writeWidth(PANEL_COLUMN, width)
  }
  // An artifact's Show in Chat: the message it came from, once its chat's transcript has it (after the phone's ArtifactReveal).
  const [revealRow, setRevealRow] = useState<{ sessionId: string; messageId: number; until: number } | null>(null)
  useEffect(() => {
    if (!revealRow || selected.id !== revealRow.sessionId) return
    if (Date.now() > revealRow.until) return setRevealRow(null)
    // The message itself, else the last one before it: a tool call keeps no row of its own.
    let best: { key: string; row: number } | null = null
    for (const item of transcript.items) {
      const row = /^row-(\d+)$/.exec(item.key)?.[1]
      if (row === undefined) continue
      const n = Number(row)
      if (n <= revealRow.messageId && (!best || n >= best.row)) best = { key: item.key, row: n }
    }
    if (!best) return
    const key = best.key
    setRevealRow(null)
    requestAnimationFrame(() => revealMessage(chatPane.current, key))
  }, [revealRow, selected.id, transcript.items])
  const [modelOpen, setModelOpen] = useState(false)
  const closeModel = useCallback(() => setModelOpen(false), [])
  const [contextOpen, setContextOpen] = useState(false)
  const closeContext = useCallback(() => setContextOpen(false), [])
  useEffect(() => {
    setModelOpen(false)
    setContextOpen(false)
  }, [selected.id])
  // Pinned replies: on this computer, per host, as the phone keeps them per device.
  const pinHost = status.url ?? ''
  const [pins, setPins] = useState<PinnedReply[]>(() => loadPins(pinHost))
  useEffect(() => setPins(loadPins(pinHost)), [pinHost])
  const updatePins = useCallback(
    (change: (current: PinnedReply[]) => PinnedReply[]) =>
      setPins(current => {
        const next = change(current)
        if (next !== current) savePins(pinHost, next)
        return next
      }),
    [pinHost]
  )
  const [pinSheet, setPinSheet] = useState<{ scope: 'chat' | 'all'; editing?: string } | null>(null)
  const [pinReveal, setPinReveal] = useState<{ pin: PinnedReply; expires: number } | null>(null)
  /** A row's Pin, Rename or Delete: shown at once, put back with the reason when Hermes refuses it. */
  const chatAction = useCallback(
    async (row: ChatRow, patch: { pinned?: boolean; title?: string } | null) => {
      list.patchRow(row.id, patch)
      if (patch === null && (selected.id === row.id || chat.storedId === row.id)) newChat()
      if (patch === null) setBeside(current => (current?.id === row.id ? null : current))
      if (patch === null) window.conduit.closeChatWindows([row.id])
      // A deleted chat's pins go with it.
      if (patch === null) updatePins(current => withoutChat(current, row.profile, row.id))
      try {
        await mutateSession(gateway.http, row.id, row.profile, patch)
      } catch (e) {
        void tell(t('Couldn’t change “{title}”: {reason}', { title: row.title, reason: e instanceof Error ? e.message : String(e) }))
      }
      list.refresh()
    },
    [list, selected.id, chat.storedId, newChat, updatePins]
  )
  // Move to Project: the chat's profile's projects with a folder, as the phone offers them.
  const moveTargets = useCallback(async (row: ChatRow): Promise<MoveTarget[]> => {
    const profile = row.profile && row.profile !== 'default' ? row.profile : undefined
    const response = await gateway.rpc('projects.tree', profile ? { preview_limit: 0, profile } : { preview_limit: 0 })
    return parseProjects(response).flatMap(p => (!p.isHome && p.path ? [{ id: p.id, title: p.title, path: p.path }] : []))
  }, [])
  const moveToProject = useCallback(
    async (row: ChatRow, target: MoveTarget) => {
      try {
        await moveChat(gateway.rpc, gateway.http, row.id, row.profile, target.path, status.sessionAuthority === true)
      } catch (e) {
        void tell(
          t('Couldn’t move “{title}” to {project}: {reason}', { title: row.title, project: target.title, reason: e instanceof Error ? e.message : String(e) })
        )
      }
    },
    [status.sessionAuthority]
  )
  // Stars and read state: on this computer, per host. Hermes' own unread flag is cleared too.
  const markHost = status.url ?? ''
  // Done chats, kept by the plugin for every Conduit (state/chatDone): read again as the list changes.
  const doneProfiles = useMemo(() => [...new Set((list.rows ?? []).map(r => r.profile ?? 'default'))].sort(), [list.rows])
  const doneHttp = useCallback((method: 'GET' | 'POST', path: string, body?: unknown) => gateway.http(method, path, body), [])
  const chatDone = useChatDone(doneHttp, connected, doneProfiles, `${list.rows?.length ?? 0}\t${list.rows?.[0]?.activeAt ?? 0}`, markHost)
  const isRowDone = useCallback((row: ChatRow) => isDone(chatDone.marks, row), [chatDone.marks])
  const [marks, setMarks] = useState<ChatMarks>(() => loadMarks(markHost))
  useEffect(() => setMarks(loadMarks(markHost)), [markHost])
  const updateMarks = useCallback(
    (change: (current: ChatMarks) => ChatMarks) =>
      setMarks(current => {
        const next = change(current)
        if (next !== current) saveMarks(markHost, next)
        return next
      }),
    [markHost]
  )
  const writeUnread = useCallback((row: ChatRow, unread: boolean) => {
    void mutateSession(gateway.http, row.id, row.profile, { unread }).catch(() => undefined)
  }, [])
  const openId = chat.storedId ?? selected.id
  const openRow = openId ? list.rows?.find(row => row.id === openId) : undefined
  useEffect(() => {
    if (!openRow) return
    updateMarks(current => markRead(current, openRow))
    if (openRow.unread) writeUnread(openRow, false)
  }, [openRow?.id, openRow?.activeAt, openRow?.unread, updateMarks, writeUnread])
  const toggleRead = useCallback(
    (row: ChatRow) => {
      const unread = isUnread(marks, row)
      updateMarks(current => (unread ? markRead(current, row) : markUnread(current, row)))
      if (unread ? row.unread : !row.unread) writeUnread(row, !unread)
    },
    [marks, updateMarks, writeUnread]
  )
  const connectionActions = useMemo(
    () => ({ respond: respondConnection, reissue: reissueConnection, wake: wakeConnection }),
    [respondConnection, reissueConnection, wakeConnection]
  )
  /** Bumped when a tapped takeover makes the chat Conduit's: the composer sends what's in it. */
  const [sendNow, setSendNow] = useState(0)
  const commands = useCommands(selected.profile ?? chatProfile ?? undefined, connected)
  const onSend = useCallback(
    async (text: string, attachments: StagedAttachment[] = [], options: { takeOver?: boolean; spoken?: boolean } = {}) => {
      let created: string | null | false
      // A bot's one chat never resets: /new compacts it, and a compaction carries no attachments.
      const botChat = selected.botChat === true || !!openBotChat
      if (botChat && attachments.length && isResetCommand(text)) {
        notice(t('This bot chat never resets. Remove the attachments to compact it instead.'), 'error')
        return false
      }
      if (looksLikeSlashCommand(text) && !attachments.length) {
        const outcome = await command(text, commands, { botChat })
        if (outcome.kind === 'new') return newChat()
        if (outcome.kind === 'model') setModelOpen(true)
        if (outcome.kind === 'prefill') setQuote(prefillRequest(withoutMentionNote(outcome.text), botTitle))
        created = outcome.created
      } else {
        created = await send(withMentionNote(text, roster.bots, selected.profile ?? 'default'), attachments, undefined, options)
        if (created === false) return false
        // The message answers the questions Hermes stopped waiting for here.
        clearExpired(chat.liveId)
      }
      if (created) {
        setSelected(s => ({ ...s, id: created }))
        void list.refresh()
      }
      return true
    },
    [send, command, notice, commands, newChat, list, botTitle, roster.bots, selected.profile, selected.botChat, openBotChat, chat.liveId]
  )
  // The bots a chat can tag, in their order: every shown bot but the chat's own.
  const mentionBots = useMemo(() => mentionCandidates(orderedRoster, '', selected.profile ?? 'default'), [orderedRoster, selected.profile])

  // A Bot Chat goes by its bot's name: Hermes titles every one "Bot Chat".
  const title = workItem
    ? shownTitle(workItem)
    : selected.botChat && selected.title
      ? selected.title
      : cleanTitle(chat.title || selected.title || '') || (selected.id ? '' : t('New chat'))

  /**
   * ⋯'s Branch on a reply, as the phone's: a new chat with the turns through
   * it, titled "Branch of …", made in this chat's profile and opened. The
   * authority branches its own rows (through the reply's row); `hermes
   * dashboard` makes a chat from a copy of them.
   */
  const branching = useRef(false)
  const branchFrom = useCallback(
    async (key: string) => {
      const parent = chat.liveId
      if (!parent || branching.current) return
      const plan = branchPlan(transcript.items, key)
      if (!plan) return notice(t('There is no message history to branch from.'), 'error')
      const profile = selected.profile
      const scoped = profile && profile !== 'default' ? { profile } : {}
      const branchTitle = t('Branch of {title}', { title: title || t('New chat') })
      branching.current = true
      try {
        let id: string
        if (status.sessionAuthority) {
          // Without the reply's row the branch would keep what came after it too.
          if (!plan.rowId && !plan.newest) throw new Error(t('Open the chat again to branch from this reply.'))
          const result = await authorityMutation<{ branched_session_id?: string }>(gateway.rpc, gateway.http, parent, profile, 'branch', {
            title: branchTitle,
            ...(plan.rowId ? { through_message_id: plan.rowId } : {})
          })
          if (!result?.branched_session_id) throw new Error(t('The chat didn’t open. Try again.'))
          id = result.branched_session_id
        } else {
          const made = await gateway.rpc<{ session_id?: string; stored_session_id?: string | null }>('session.create', {
            cols: 96,
            source: 'desktop',
            // The stored chat: Hermes keeps the branch under it, and a runtime id names no stored row.
            parent_session_id: chat.storedId ?? selected.id ?? parent,
            title: branchTitle,
            messages: plan.messages,
            ...scoped,
            ...(chat.cwd ? { cwd: chat.cwd } : {})
          })
          if (!made?.session_id) throw new Error(t('The chat didn’t open. Try again.'))
          await gateway.rpc('session.title', { session_id: made.session_id, title: branchTitle, ...scoped }).catch(() => undefined)
          // Hermes resumes a chat by its stored id, never the runtime one.
          id = made.stored_session_id || made.session_id
        }
        setSelected({ id, profile, title: branchTitle })
        void list.refresh()
      } catch (e) {
        notice(t('Could not branch conversation: {error}', { error: e instanceof Error ? e.message : String(e) }), 'error')
      } finally {
        branching.current = false
      }
    },
    [chat.liveId, chat.storedId, chat.cwd, transcript.items, selected.id, selected.profile, title, status.sessionAuthority, notice, list]
  )
  // Pinned replies in the open chat: ⋯'s Pin reply, the bar, and the list from the bar or the Chats list.
  const pinChat = chat.storedId ?? selected.id
  const chatPins = useMemo(() => pinsOfChat(pins, selected.profile, pinChat), [pins, selected.profile, pinChat])
  const revealPin = pinReveal && pinReveal.expires > Date.now() && pinReveal.pin.chat === pinChat ? pinReveal.pin : null
  const clearPinReveal = useCallback(() => setPinReveal(null), [])
  const refreshPins = useCallback(
    (next: PinnedReply[]) => {
      const byId = new Map(next.map(p => [p.id, p]))
      updatePins(current => current.map(p => byId.get(p.id) ?? p))
    },
    [updatePins]
  )
  const pinControls: PinControls | undefined =
    pinChat && !workItem
      ? {
          list: chatPins,
          pin: (item, passage) =>
            updatePins(current => [...current, newPin({ kind: 'assistant', ...item }, pinChat, selected.profile, title || t('Chat'), Date.now(), passage)]),
          unpin: pin => updatePins(current => current.filter(p => p.id !== pin.id)),
          label: pin => setPinSheet({ scope: 'chat', editing: pin.id }),
          showAll: () => setPinSheet({ scope: 'chat' }),
          refresh: refreshPins,
          reveal: revealPin,
          onRevealed: clearPinReveal
        }
      : undefined
  const pinChatTitle = (pin: PinnedReply) =>
    cleanTitle(list.rows?.find(r => r.id === pin.chat && (r.profile ?? 'default').toLowerCase() === pin.profile.toLowerCase())?.title ?? '') ||
    pin.chatTitle ||
    t('Chat')
  const openPin = (pin: PinnedReply) => {
    setPinSheet(null)
    setPinReveal({ pin, expires: Date.now() + 20_000 })
    if (pin.chat !== pinChat || (pin.profile || 'default').toLowerCase() !== (selected.profile || 'default').toLowerCase())
      setSelected({ id: pin.chat, profile: pin.profile === 'default' ? undefined : pin.profile, title: pinChatTitle(pin) })
    setSection('chats')
  }

  // Bots home: a bot opens its Bot Chat (or a new chat in its profile); Ask sends there once it's open.
  const lastBot = useRef<string | null>(null)
  const openBot = useCallback((bot: Bot) => {
    lastBot.current = bot.name
    setSelected({ id: bot.botChatId ?? null, profile: bot.name, title: bot.title, botChat: true })
    setSection('chats')
    setBotsSide(true)
  }, [])
  // Picking a bot on the strip opens its newest chat (its Bot Chat, which the list leaves out, when
  // that's newer), or a new chat when it has none, so the open chat matches the list.
  const chooseProfile = useCallback(
    (next: string | null) => {
      // Any change of profile closes the chat windows, and the chat kept beside.
      if (next && !sameProfileAs(next, chatProfile ?? undefined)) window.conduit.closeChatWindows()
      setChatProfile(next)
      if (next) setBeside(current => (current && !sameProfileAs(current.profile, next) ? null : current))
      if (!next) return
      const same = (name: string | undefined) => (name ?? 'default').toLowerCase() === next.toLowerCase()
      if (same(selected.profile)) return
      const newest = (listedRows ?? []).filter(row => same(row.profile)).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))[0]
      const bot = roster.bots?.find(b => same(b.name))
      if (bot?.botChatId && (bot.lastActive ?? 0) >= (newest?.activeAt ?? 0)) return openBot(bot)
      setSelected(newest ? { id: newest.id, profile: newest.profile, title: newest.title } : { id: null, profile: next })
    },
    [selected.profile, listedRows, roster.bots, openBot, chatProfile]
  )
  // A bot row's menu: Pin, Duplicate, Hide, Show and Delete. Answers what went wrong, if anything.
  const botAction = useCallback(
    async (kind: BotAction, bot: Bot): Promise<string | null> => {
      const rpc = (method: string, params?: Record<string, unknown>) => gateway.rpc(method, params)
      try {
        if (kind === 'pin' || kind === 'unpin') {
          if (!(await writeMeta(rpc, bot, { pinned: kind === 'pin' ? true : undefined }))) return t('Couldn’t save that change. Try again.')
        } else if (kind === 'hide' || kind === 'show') {
          if (!(await writeMeta(rpc, bot, { hidden: kind === 'hide' ? true : undefined }))) return t('Couldn’t save that change. Try again.')
        } else if (kind === 'duplicate') {
          const taken = [...(roster.bots ?? []), ...roster.hidden].map(b => b.name)
          const copy = await duplicateBot(rpc, bot, taken)
          if (!copy.lookSaved) return t('The bot was created, but its picture or look was not saved. Edit the bot to try again.')
        } else if (kind === 'delete') {
          if (!canDelete(bot)) return null
          if (
            !(await ask(
              `${t('Delete {name}?', { name: bot.title })}\n\n${t("This permanently removes the bot's profile, chats, memory and skills from the gateway.")}`,
              { confirm: t('Delete'), destructive: true }
            ))
          )
            return null
          await gateway.http('DELETE', `/api/profiles/${encodeURIComponent(bot.name)}`, undefined, 30000)
          forgetAvatars()
        }
        return null
      } catch (e) {
        return t('Couldn’t save that change: {error}', { error: e instanceof Error ? e.message : String(e) })
      } finally {
        void roster.refresh()
      }
    },
    [roster]
  )
  const pendingAsk = useRef<{ text: string; storedId: string | null; profile: string; resumed?: boolean } | null>(null)
  const askBot = useCallback(
    (bot: Bot, text: string) => {
      pendingAsk.current = { text, storedId: bot.botChatId ?? null, profile: bot.name }
      openBot(bot)
    },
    [openBot]
  )
  useEffect(() => {
    const ask = pendingAsk.current
    if (!ask || ask.profile !== selected.profile || ask.storedId !== selected.id) return
    if (ask.storedId) {
      // A Bot Chat waits until it has resumed (this render may still hold the chat open before it).
      if (loading) {
        ask.resumed = true
        return
      }
      if (error && ask.resumed) {
        pendingAsk.current = null
        return
      }
      if (!chat.liveId || (chat.storedId !== ask.storedId && !ask.resumed)) return
    }
    pendingAsk.current = null
    void onSend(ask.text)
  }, [selected, loading, error, chat.liveId, chat.storedId, onSend])
  const groupRooms = useRooms(connected)
  // The group chats in the person's order (synced as groups.order), a room it doesn't name first.
  const orderedRooms = useMemo(() => (groupRooms.rooms ? arrange(groupRooms.rooms, roomOrder.order, r => r.roomId, 'rooms') : groupRooms.rooms), [groupRooms.rooms, roomOrder.order])
  const roomInvites = useRoomInvites(connected, status.url ?? '')
  const [openInvite, setOpenInvite] = useState<string | null>(null)
  const shownInvite = openInvite ? roomInvites.invites.find(i => i.id === openInvite) : undefined
  const roomCopies = useRoomCopies(connected, status.url ?? '', roomInvites.capabilities)
  const roomDrafts = useRoomDrafts(connected, status.url ?? '', roomInvites.capabilities)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [openDraft, setOpenDraft] = useState<string | null>(null)
  const shownDraft = openDraft ? roomDrafts.drafts.find(d => d.id === openDraft) : undefined
  const refreshDraft = useCallback(
    async (started: boolean) => {
      await roomDrafts.refresh()
      if (started) await groupRooms.refresh()
    },
    [roomDrafts.refresh, groupRooms.refresh]
  )
  const [openRoom, setOpenRoom] = useState<Room | null>(null)
  /** The open room when someone else hosts it: read from this Hermes' copy, by its Link and room. */
  const [openCopy, setOpenCopy] = useState<string | null>(null)
  const shownCopy = openCopy ? roomCopies.copies.find(c => c.id === openCopy) : undefined
  const shownCopyRoom = useMemo(() => (shownCopy ? copyRoom(shownCopy) : null), [shownCopy])
  const shownCopyApprovals = useMemo(
    () => (shownCopy ? copyApprovals(roomCopies.approvals, shownCopy, roomCopies.copies) : []),
    [shownCopy, roomCopies.approvals, roomCopies.copies]
  )
  const copiesWaiting = useMemo(
    () => new Set(roomCopies.copies.filter(c => copyApprovals(roomCopies.approvals, c, roomCopies.copies).length).map(c => c.id)),
    [roomCopies.approvals, roomCopies.copies]
  )
  const showRoom = useCallback((room: Room) => {
    setOpenRoom(room)
    setOpenCopy(null)
    setSection('room')
  }, [])
  /** A draft that started: its card closes and its room opens. */
  const openDraftRoom = useCallback(
    (room: Room) => {
      setOpenDraft(null)
      showRoom(room)
    },
    [showRoom]
  )
  const runningProfiles = useMemo(() => {
    const names = new Set<string>()
    if (transcript.running && selected.profile) names.add(selected.profile)
    return names
  }, [transcript.running, selected.profile])

  // Needs you: the requests this window holds, and every profile's waiting list.
  const requests = useRequests()
  const profiles = useMemo(() => [...new Set((list.rows ?? []).map(r => r.profile ?? ''))].sort(), [list.rows])
  const waiting = useWaiting(connected, profiles)
  const waitingRows = useMemo(() => unmatchedWaiting(waiting.rows, requests), [waiting.rows, requests])
  // Combined dashboards: the other hosts' waits, badged, each opening through a switch.
  const keptHosts = useKeptHosts()
  const keptWaiting = useKeptWaiting(keptHosts)
  const otherWaiting = useMemo(() => otherHostsWaiting(keptWaiting, waiting.rows), [keptWaiting, waiting.rows])
  const savedHosts = status.hosts
  const badgeFor = useCallback((url: string) => hostBadge(savedHosts ?? [], url, hostName), [savedHosts])
  // ...and their chats, in All.
  const keptChats = useKeptChats(keptHosts, section === 'chats')
  const otherChats = useMemo(() => otherHostsChats(keptChats, list.rows ?? null), [keptChats, list.rows])
  // ...and their bots, on Bots Home.
  const otherBots = useKeptBots(keptHosts, botsListShown)
  // ...mixed with this host's in one order the person arranges, kept on this computer.
  const combinedCount = savedHosts ? savedHosts.filter(h => h.combined).length : null
  const mixedBotOrder = useMixedBotOrder(combinedCount === null ? null : combinedCount > 1)
  const savedHostUrls = useMemo(() => (savedHosts ?? []).map(h => h.url), [savedHosts])
  // A room started by dragging across dashboards brings the other's bots over your own Link to it.
  const farFor = useCallback(
    (host: string, name: string) =>
      farBotFor(
        name,
        otherBots.filter(o => o.host === host).map(o => o.bot.name),
        roomDrafts.ownBots
      ),
    [otherBots, roomDrafts.ownBots]
  )
  const hasOtherBots = otherBots.length > 0
  // ...and their group chats: each room once, under the host you talk in it from (Eric, 2026-11-20).
  const keptRooms = useKeptRooms(keptHosts, botsListShown)
  const groupChats = useMemo(
    () => combinedRooms(status.url ?? '', savedHostUrls, groupRooms.rooms ?? [], roomCopies.copies, keptRooms, copiesWaiting),
    [status.url, savedHostUrls, groupRooms.rooms, roomCopies.copies, keptRooms, copiesWaiting]
  )
  useEffect(() => {
    if (botsListShown && hasOtherBots) void roomDrafts.refreshPeople()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botsListShown, hasOtherBots])
  const createFarDraft = useCallback(
    async (name: string, bots: Bot[], far: OwnHermesBot[]): Promise<'made' | 'sending'> => {
      const agents = draftAgents(bots)
      if (!agents) throw new Error(t('Two of these bots would have the same @handle. Rename one, then try again.'))
      const bring: Record<string, string[]> = {}
      for (const bot of far) (bring[bot.linkId] ??= []).push(bot.profile)
      const outcome = await roomDrafts.create(name, agents, Object.keys(bring).sort(), chatProfile ?? 'default', bring)
      return outcome.kind === 'made' ? 'made' : 'sending'
    },
    [roomDrafts, chatProfile]
  )
  // ...and New Bot's choice of where the bot is made: this one, then each other kept connected.
  const newBotDashboards = useMemo<NewBotDashboard[] | undefined>(() => {
    if (!status.url || !badgeFor(status.url)) return undefined
    const live = keptHosts.filter(h => h.state === 'live')
    return [
      { url: status.url, name: hostName(status.url), badge: badgeFor(status.url), taken: [] },
      ...live.map(h => ({
        url: h.url,
        name: hostName(h.url),
        badge: badgeFor(h.url),
        taken: otherBots.filter(o => o.host === h.url).map(o => o.bot.name)
      }))
    ]
  }, [status.url, badgeFor, keptHosts, otherBots])
  // ...and the Artifacts page's chips: this one, then each other kept connected.
  const artifactDashboards = useMemo(
    () => (newBotDashboards ? newBotDashboards.map(({ url, name, badge }) => ({ url, name, badge })) : undefined),
    [newBotDashboards]
  )
  // ...and a Pulse chip each, with how many cards are new there.
  const keptPulse = useKeptPulse(keptHosts, section === 'pulse')
  const pulseUnseen = pulse.feed?.unseen ?? 0
  const pulseHostChips = useMemo(
    () => pulseChips(savedHosts ?? [], status.url ?? '', pulseUnseen, keptPulse, hostName),
    [savedHosts, status.url, pulseUnseen, keptPulse]
  )
  const needsCount = requests.length + waitingRows.length + otherWaiting.length
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])
  const expiredQuestions = useExpiredQuestions(chat.liveId)
  // Running and Needs approval on the list's rows: the gateway's live registry while the list shows, the
  // plugin's waiting list, and the open chat's own turn and requests.
  const liveProfiles = useMemo(() => (chatProfile ? [chatProfile] : profiles.slice(0, 8)), [chatProfile, profiles])
  const liveStatus = useLiveStatus(connected && section === 'chats' && !projectsOpen, liveProfiles, `${turnsDone}\t${list.rows?.length ?? 0}`)
  const runningIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, state] of liveStatus) if (state === 'working') ids.add(id)
    if (transcript.running && chat.storedId) ids.add(chat.storedId)
    return ids
  }, [liveStatus, transcript.running, chat.storedId])
  // A project's chats read as their chat rows do: the list's copy when it has one (Unread dot on projects).
  const projectChatUnread = useCallback(
    (chat: ProjectChat) => {
      if (!marks) return false
      const listed = list.rows?.find(r => r.id === chat.id)
      return isUnread(marks, listed ?? { id: chat.id, title: chat.title, pinned: false, profile: chat.profile, activeAt: chat.lastActive })
    },
    [marks, list.rows]
  )
  const waitingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, state] of liveStatus) if (state === 'waiting') ids.add(id)
    for (const row of waiting.rows) for (const id of row.sessionIds) ids.add(id)
    if (openRequests.length && chat.storedId) ids.add(chat.storedId)
    return ids
  }, [liveStatus, waiting.rows, openRequests.length, chat.storedId])

  /** The chats this window opened, by live id: a request's card outside its chat, and a notification's click. */
  const chats = useRef(new Map<string, ChatRef>())
  if (chat.liveId) chats.current.set(chat.liveId, { storedId: chat.storedId, profile: selected.profile, title: title || undefined })
  const titleFor = useCallback(
    (sessionId: string) => chats.current.get(sessionId)?.title ?? waiting.rows.find(row => row.sessionIds.includes(sessionId))?.title,
    [waiting.rows]
  )

  // The tray's count and the Dock's badge.
  useEffect(() => window.conduit.setWaiting(needsCount), [needsCount])

  // Notifications for what happens in a chat the user isn't looking at.
  const watching = useRef({ liveId: chat.liveId, onChats: section === 'chats' })
  watching.current = { liveId: chat.liveId, onChats: section === 'chats' }
  const notify = useCallback((spec: NotificationSpec, sessionId: string) => {
    if (!notificationsEnabled() || typeof Notification === 'undefined') return
    const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
    n.onclick = () => {
      window.conduit.window.show()
      const ref = chats.current.get(sessionId)
      if (ref?.storedId) {
        setSelected({ id: ref.storedId, profile: ref.profile, title: ref.title })
        setSection('chats')
      } else {
        setSection('needs')
      }
    }
  }, [])
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        const sid = event.session_id
        if (!sid) return
        if (event.type === 'session.title') {
          const t = (event.payload as { title?: unknown } | undefined)?.title
          const ref = chats.current.get(sid)
          if (ref && typeof t === 'string') chats.current.set(sid, { ...ref, title: cleanTitle(t) })
          return
        }
        if (event.type !== 'message.complete' || isWatching(sid, watching.current.liveId, watching.current.onChats)) return
        const spec = turnNotification(sid, event.payload, chats.current.get(sid))
        if (spec) notify(spec, sid)
      }),
    [notify]
  )
  const notified = useRef(new Set<string>())
  useEffect(() => {
    for (const request of requests) {
      if (notified.current.has(request.id)) continue
      notified.current.add(request.id)
      if (isWatching(request.sessionId, watching.current.liveId, watching.current.onChats)) continue
      notify(requestNotification(request, chats.current.get(request.sessionId)), request.sessionId)
    }
  }, [requests, notify])

  const openWaiting = useCallback(
    (row: WaitingRow) => {
      const known = (list.rows ?? []).find(r => row.sessionIds.includes(r.id))
      setSelected({ id: known?.id ?? row.sessionIds[0] ?? null, profile: known?.profile ?? row.profile, title: known?.title ?? row.title })
      setSection('chats')
    },
    [list.rows]
  )

  const openOtherWaiting = useCallback(async (row: KeptWaitingRow) => {
    if (!(await switchEndingCall(hostName(row.host)))) return
    openAfterSwitch(row)
    void window.conduit.switchHost(row.host)
  }, [])
  const statusUrl = status.url ?? ''
  const openOtherChat = useCallback(async (row: OtherChatRow) => {
    if (!(await switchEndingCall(hostName(row.host)))) return
    openChatAfterSwitch(row)
    void window.conduit.switchHost(row.host)
  }, [])
  useEffect(() => {
    if (!connected) return
    const row = takeChatAfterSwitch(statusUrl)
    if (!row) return
    setSelected({ id: row.id, profile: row.profile, title: row.title })
    setSection('chats')
  }, [connected, statusUrl])
  useEffect(() => {
    if (takePageAfterSwitch(statusUrl) === 'pulse') setSection('pulse')
  }, [statusUrl])
  // New Bot picked another dashboard: its sheet opens here with the words, once the roster is read.
  useEffect(() => {
    if (!connected || roster.bots === undefined) return
    const bot = takeNewBotAfterSwitch(statusUrl)
    if (!bot) return
    setCarriedBot(bot)
    setSection('bots')
    setNewBot(true)
  }, [connected, statusUrl, roster.bots])
  const createBotElsewhere = useCallback(async (url: string, bot: NewBotCarry) => {
    if (!(await switchEndingCall(hostName(url)))) return
    newBotAfterSwitch(url, bot)
    void window.conduit.switchHost(url)
  }, [])
  const openOtherBot = useCallback(async (other: OtherBot) => {
    if (!(await switchEndingCall(hostName(other.host)))) return
    openBotAfterSwitch(other)
    void window.conduit.switchHost(other.host)
  }, [])
  useEffect(() => {
    const bot = takeBotAfterSwitch(statusUrl, roster.bots)
    if (bot) openBot(bot)
  }, [statusUrl, roster.bots, openBot])
  const openOtherRoom = useCallback(async (other: OtherRoom) => {
    if (!(await switchEndingCall(hostName(other.host)))) return
    openRoomAfterSwitch(other)
    void window.conduit.switchHost(other.host)
  }, [])
  // A group chat opened on another host: open it here once its rooms or copies are read.
  useEffect(() => {
    if (!connected) return
    // Its copies only once they've been read: an unread list is empty, not missing the copy.
    const taken = takeRoomAfterSwitch(statusUrl, groupRooms.rooms, roomCopies.loaded ? roomCopies.copies : null)
    if (!taken) return
    if ('room' in taken) return showRoom(taken.room)
    setOpenCopy(taken.copy.id)
    setOpenRoom(null)
    setSection('room')
  }, [connected, statusUrl, groupRooms.rooms, roomCopies.loaded, roomCopies.copies, showRoom])
  // A wait opened on another host before the switch: open it here once connected.
  useEffect(() => {
    if (!connected || list.rows === undefined) return
    const row = takeOpenAfterSwitch(statusUrl)
    if (row) openWaiting(row)
  }, [connected, list.rows, statusUrl, openWaiting])

  // Calls from Hermes ring here too.
  const rings = useRings(connected, profiles)
  useCallPresence(connected && calling, selected.profile)
  const ring = rings.ringing.at(-1)
  // The wake phrase: heard offline while Conduit is connected and showing, never during a call or a ring.
  const [wakeRevision, setWakeRevision] = useState(0)
  useEffect(() => {
    const changed = () => setWakeRevision(n => n + 1)
    window.addEventListener(WAKE_EVENT, changed)
    return () => window.removeEventListener(WAKE_EVENT, changed)
  }, [])
  const [showing, setShowing] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const changed = () => setShowing(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const wakeList = useMemo(
    () => wakeBindings(wakeProfiles(status.url ?? ''), glowBots.map(bot => bot.name)),
    // wakeRevision: Settings changed the phrases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status.url, glowBots, wakeRevision]
  )
  const wakePhrases = connected && showing && !calling && !ring && wakeList.length ? JSON.stringify(wakeList.map(b => b.phrase)) : ''
  useEffect(() => window.conduit.wake.listen(wakePhrases ? (JSON.parse(wakePhrases) as string[]) : null), [wakePhrases])
  useEffect(() => () => window.conduit.wake.listen(null), [])
  // A phrase heard: voice on its profile, in a new chat or the one it continues, once that chat is open.
  const wakeCall = useRef<{ id: string | null; profile: string } | null>(null)
  const sameProfile = (a?: string, b?: string) => (a || 'default') === (b || 'default')
  useEffect(() => {
    const pending = wakeCall.current
    if (!pending || section !== 'chats' || selected.id !== pending.id || !sameProfile(selected.profile, pending.profile)) return
    wakeCall.current = null
    setCallMode(voiceMode())
    setCalling(true)
  }, [selected.id, selected.profile, section])
  const heardWake = useRef<(binding: WakeBinding) => void>(() => undefined)
  heardWake.current = binding => {
    if (calling) return
    const id = binding.fresh ? null : wakeChat(binding.profile, selected, list.rows)
    if (section === 'chats' && selected.id === id && sameProfile(selected.profile, binding.profile)) {
      setCallMode(voiceMode())
      setCalling(true)
      return
    }
    wakeCall.current = { id, profile: binding.profile }
    const row = id ? list.rows?.find(r => r.id === id) : undefined
    setSelected(id ? { id, profile: binding.profile, title: row?.title } : { id: null, profile: binding.profile })
    setSection('chats')
  }
  const wakeListRef = useRef(wakeList)
  wakeListRef.current = wakeList
  useEffect(
    () =>
      window.conduit.wake.onHeard(index => {
        const binding = wakeListRef.current[index]
        if (binding) heardWake.current(binding)
      }),
    []
  )
  const answerRing = (call: Ring) => {
    rings.dismiss(call.id)
    window.conduit.window.show()
    const known = (list.rows ?? []).find(r => call.sessionIds.includes(r.id))
    const id = known?.id ?? call.sessionIds.at(-1) ?? null
    if (!id) return
    const profile = known?.profile ?? call.profile
    if (selected.id === id && section === 'chats' && (selected.profile ?? '') === (profile ?? '')) {
      if (!calling) {
        setCallMode(voiceMode())
        setCalling(true)
      }
      return
    }
    answeredCall.current = id
    setSelected({ id, profile, title: known?.title ?? call.title })
    setSection('chats')
  }
  const declineRing = (call: Ring, missed: boolean) => {
    rings.dismiss(call.id)
    // A miss is the iPhone's to report (it may still be answered there), unless no iPhone is paired; a decline is the user's, from here.
    if (!missed) declineOnHost(call)
    else if (call.reportsMiss) declineOnHost(call, 'missed')
    if (missed && notificationsEnabled() && typeof Notification !== 'undefined')
      new Notification(call.name ? t('Missed call from {name}', { name: call.name }) : t('Missed call from Hermes'), {
        body: call.body || call.reason,
        tag: `missed-${call.id}`
      }).onclick = () => {
        window.conduit.window.show()
        answerRingChat(call)
      }
  }
  const answerRingChat = (call: Ring) => {
    const known = (list.rows ?? []).find(r => call.sessionIds.includes(r.id))
    const id = known?.id ?? call.sessionIds.at(-1) ?? null
    if (!id) return
    setSelected({ id, profile: known?.profile ?? call.profile, title: known?.title ?? call.title })
    setSection('chats')
  }
  // While an update started here has Hermes away, the banner follows it instead of a bare "reconnecting".
  const hostUpdate = useHostActions(status.url ?? '').update
  const updateAway = updateBanner(hostUpdate)
  useEffect(() => {
    if (connected && status.url) hostReachable(status.url)
  }, [connected, status.url, hostUpdate.kind])
  // The backdrop glows in the open chat's agent's color, and elsewhere in the profile in use's.
  const glowOf = useGlowColors(glowBots, status.url ?? '')
  const roomChatsServed = roomInvites.capabilities.includes(ROOM_CHATS_CAPABILITY)
  // Files in rooms with other people's agents go through the plugin, which reads their pictures back.
  const roomFilesStored = roomInvites.capabilities.includes(ROOM_FILES_CAPABILITY)
  const roomFilePictures = roomInvites.capabilities.includes(ROOM_FILE_PICTURES_CAPABILITY)
  const roomChoicesServed = roomInvites.capabilities.includes(ROOM_RULES_CAPABILITY)
  // What Hermes waits on in each bot's profile: its confirmations, and rooms' and linked people's asks.
  const presentProfiles = useMemo(() => (roster.bots?.length ? roster.bots.map(b => b.name) : ['default']), [roster.bots])
  const presented = usePresented(connected, status.url ?? '', roomInvites.capabilities, presentProfiles)
  const shownConfirm = presented.waiting[0]
  // A new room invite, and an ask Hermes waits on while the window isn't in front, as the phone's pushes.
  const inviteIds = roomInvites.loaded ? roomInvites.invites.filter(i => i.status === 'waiting' && !i.removed).map(i => i.id).join('\n') : null
  useEffect(() => {
    if (inviteIds === null || !status.url) return
    const fresh = newlyArrived(`conduit.notified.invites.${status.url}`, inviteIds ? inviteIds.split('\n') : [])
    if (!fresh.length || !notificationsEnabled() || typeof Notification === 'undefined') return
    for (const id of fresh) {
      const invite = roomInvites.invites.find(i => i.id === id)
      if (!invite) continue
      const spec = inviteNotification(invite)
      const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
      n.onclick = () => {
        window.conduit.window.show()
        setOpenInvite(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteIds, status.url])
  const askedAbout = useRef(new Set<string>())
  useEffect(() => {
    for (const item of presented.waiting) {
      if (askedAbout.current.has(item.prompt.id)) continue
      askedAbout.current.add(item.prompt.id)
      if (document.hasFocus() || !notificationsEnabled() || typeof Notification === 'undefined') continue
      const spec = askNotification(item.prompt, askerLine(item.prompt))
      const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
      n.onclick = () => window.conduit.window.show()
    }
  }, [presented.waiting])

  /** A room's private chat with one of your agents: kept, or made and told its room; Wrap Up asks it for notes once it's open. */
  const openRoomChatWith = useCallback(
    async (room: Room, agent: RoomChatAgent, wrapUp: boolean) => {
      const chats = roomChatsClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))
      const scoped = (profile: string) => (profile && profile !== 'default' ? { profile } : {})
      const opened = await openRoomChat(
        {
          chats: profile => chats.chats(profile),
          create: async profile => {
            const made = await gateway.rpc<{ session_id?: string; stored_session_id?: string | null }>('session.create', { cols: 96, source: 'desktop', ...scoped(profile) })
            if (!made?.session_id) throw new Error(t('The chat didn’t open. Try again.'))
            return { runtimeId: made.session_id, storedId: made.stored_session_id ?? null }
          },
          register: (roomId, chatId, profile) => chats.open(roomId, chatId, profile),
          // By the id it runs under, as a Bot Chat's title goes; the authority's is a rename.
          title: async (runtimeId, profile, title) => {
            if (status.sessionAuthority) await authorityMutation(gateway.rpc, gateway.http, runtimeId, profile, 'rename', { title })
            else await gateway.rpc('session.title', { session_id: runtimeId, title, ...scoped(profile) })
          },
          exists: async (chatId, profile) => {
            try {
              await gateway.http('GET', sessionPath(chatId, profile))
              return true
            } catch (e) {
              if ((e as { code?: unknown })?.code === 404) return false
              throw e
            }
          }
        },
        room.roomId,
        room.name,
        agent.profile
      )
      if (wrapUp) pendingAsk.current = { text: wrapUpPrompt(), storedId: opened.chatId, profile: agent.profile }
      setSelected({ id: opened.chatId, profile: agent.profile, title: opened.title })
      setSection('chats')
      list.refresh()
    },
    [status.sessionAuthority, list]
  )
  const roomLooks = useRoomLooks(connected, status.url ?? '', roomInvites.capabilities, roster.bots, glowOf)
  const personPicture = useMemo<PersonPicture>(
    () => ({ served: roomLooks.served, picture: roomLooks.you, saving: roomLooks.youSaving, set: roomLooks.setYou }),
    [roomLooks.served, roomLooks.you, roomLooks.youSaving, roomLooks.setYou]
  )
  // How the rooms over Links look: Bots Home's, or the open one's, each read at most every 30 s while the window shows.
  const looksRooms = useMemo(() => {
    if (!botsListShown) return { ids: [], over: [] }
    // The bots list's rooms over Links, and the open one's.
    const hosted = (groupRooms.rooms ?? []).filter(r => r.linked).map(r => r.roomId)
    const ids = new Set([...hosted, ...roomCopies.copies.map(c => c.roomId)])
    const over = new Set(roomCopies.copies.filter(isOver).map(c => c.roomId))
    if (section === 'room' && shownCopy) ids.add(shownCopy.roomId)
    if (section === 'room' && !shownCopy && openRoom?.members.some(m => m.peer)) ids.add(openRoom.roomId)
    return { ids: [...ids], over: [...over] }
  }, [botsListShown, section, shownCopy, openRoom, groupRooms.rooms, roomCopies.copies])
  const looksKey = `${looksRooms.ids.join(',')}|${looksRooms.over.join(',')}`
  const readLooks = roomLooks.read
  useEffect(() => {
    if (!looksRooms.ids.length) return
    const once = new Set(looksRooms.over)
    void readLooks(looksRooms.ids, once)
    return everyWhileVisible(() => void readLooks(looksRooms.ids, once), LOOKS_READ_MS)
    // The rooms are read again when the list of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looksKey, readLooks])
  const glow = glowOf(section === 'chats' ? (selected.profile ?? chatProfile) : chatProfile)
  useEffect(() => {
    document.documentElement.style.setProperty('--glow', glow)
  }, [glow])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--glow')
    },
    []
  )
  // Bots has no page of its own (Eric, 2026-11-20): it opens the bot last opened here, else the one used most recently.
  useEffect(() => {
    if (section !== 'bots' || newBot || editingBot) return
    const bots = orderedRoster ?? roster.bots
    if (!bots?.length) return
    const same = (name: string | null) => bots.find(b => b.name.toLowerCase() === name?.toLowerCase())
    openBot(same(lastBot.current) ?? [...bots].sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))[0])
  }, [section, newBot, editingBot, orderedRoster, roster.bots, openBot])
  const botsHomeProps: Omit<ComponentProps<typeof BotsHome>, 'side'> = {
    bots: orderedRoster,
    error: roster.error,
    runningProfiles: runningProfiles,
    rooms: orderedRooms,
    canStartRooms: groupRooms.capabilities?.supported === true && connected,
    onOpen: openBot,
    onOpenRoom: showRoom,
    onCreateRoom: groupRooms.create,
    // Beside a chat or a group chat, Edit Bot and New Bot open on Bots, and closing goes back.
    onEdit: connected ? editProfile : undefined,
    hidden: roster.hidden,
    onNewBot: connected ? newBotFromSide : undefined,
    onAction: connected ? botAction : undefined,
    notice: botNotice,
    onDismissNotice: () => setBotNotice(null),
    invites: roomInvites.rows,
    onOpenInvite: invite => setOpenInvite(invite.id),
    drafts: roomDrafts.rows,
    onOpenDraft: draft => setOpenDraft(draft.id),
    roomLooks: roomLooks.looks,
    otherBots: otherBots,
    badgeFor: badgeFor,
    onOpenOther: openOtherBot,
    hostUrl: statusUrl,
    savedHosts: savedHostUrls,
    mixedOrder: mixedBotOrder.order,
    onMoveMixed: mixedBotOrder.drop,
    onMoveBot: botOrder.drop,
    onMoveRoom: roomOrder.drop,
    farFor: farFor,
    onCreateFarDraft: roomDrafts.ownBots.length ? createFarDraft : undefined,
    onNewGroup: connected && groupRooms.capabilities?.supported === true
                ? () => {
                    setNewGroupOpen(true)
                    void roomDrafts.refresh()
                    void roomDrafts.refreshPeople()
                  }
                : undefined,
    copies: groupChats.copies,
    otherRooms: groupChats.others,
    onOpenOtherRoom: openOtherRoom,
    copiesWaiting: copiesWaiting,
    onOpenCopy: copy => {
              setOpenCopy(copy.id)
              setOpenRoom(null)
              setSection('room')
            },
    work: workByBot,
  }

  return (
    <GlowContext.Provider value={glowOf}>
      {shownConfirm && !ring ? (
        <ConfirmPanel
          key={shownConfirm.prompt.id}
          item={shownConfirm}
          more={presented.waiting.length - 1}
          onAnswer={(outcome, text) => presented.answer(shownConfirm, outcome, text)}
          onEdit={
            shownConfirm.prompt.sessionId
              ? () => {
                  // Hermes hears the user wants changes; the chat opens with the preview to rework and send.
                  presented.answer(shownConfirm, 'edit')
                  setSelected({ id: shownConfirm.prompt.sessionId, profile: shownConfirm.profile === 'default' ? undefined : shownConfirm.profile })
                  setSection('chats')
                  setQuote(prefillRequest(shownConfirm.prompt.preview, botTitle))
                }
              : undefined
          }
        />
      ) : null}
      {ring ? <IncomingCall key={ring.id} ring={ring} onAnswer={() => answerRing(ring)} onDecline={missed => declineRing(ring, missed)} /> : null}
      {status.phase !== 'open' ? (
        <div className="banner" role="status">
          <span className={updateAway === 'updating' || updateAway === 'restarting' ? 'spinner' : 'dot warn'} />
          {updateAway
            ? updateAwayText(updateAway)
            : status.phase === 'connecting'
              ? t('Connecting to Hermes…')
              : `${status.error ?? t('Not connected.')}${status.retryInSeconds ? ` ${t('Trying again in {seconds}s.', { seconds: status.retryInSeconds })}` : ''}`}
          {status.phase === 'reconnecting' ? <button onClick={() => void window.conduit.reconnect()}>{t('Try now')}</button> : null}
          {status.phase === 'reconnecting' && status.url ? <button onClick={onRepair}>{t('Repair Connection')}</button> : null}
        </div>
      ) : null}
      <CrashReportBanner />
      <div
        className="body"
        style={
          {
            ...(listWidth !== null ? { '--list-width': `${listWidth}px` } : {}),
            ...(panelWidth !== null ? { '--panel-width': `${panelWidth}px` } : {})
          } as CSSProperties
        }
      >
        <nav className="rail" aria-label={t('Sections')}>
          {section === 'chats' && listHidden ? (
            <button
              className="railbtn rail-show-list"
              aria-label={t('Show Sidebar')}
              title={`${t('Show Sidebar')} (${window.conduit.platform === 'darwin' ? '⌘\\' : 'Ctrl+\\'})`}
              onClick={() => hideList(false)}
            >
              <Icon name="chevronsRight" />
            </button>
          ) : null}
          <button
            className="railbtn"
            aria-label={t('Bots')}
            title={t('Bots')}
            aria-current={section === 'bots' || section === 'room' || (section === 'chats' && botsSideShown) ? 'page' : undefined}
            onClick={() => setSection('bots')}
          >
            <Icon name="bots" />
          </button>
          <button
            className="railbtn"
            aria-label={t('Chats')}
            title={t('Chats')}
            aria-current={section === 'chats' && !botsSideShown ? 'page' : undefined}
            onClick={() => {
              setBotsSide(false)
              setSection('chats')
            }}
          >
            <Icon name="chats" />
          </button>
          <button
            className="railbtn"
            aria-label={t('Tasks')}
            title={t('Tasks')}
            aria-current={section === 'tasks' ? 'page' : undefined}
            onClick={() => setSection('tasks')}
          >
            <Icon name="tasks" />
          </button>
          <button
            className="railbtn"
            aria-label={pulse.feed?.unseen ? t('Pulse, new cards') : t('Pulse')}
            title={t('Pulse')}
            aria-current={section === 'pulse' ? 'page' : undefined}
            onClick={() => setSection('pulse')}
          >
            <Icon name="pulse" />
            {pulse.feed?.unseen && section !== 'pulse' ? <span className="badge">{pulse.feed.unseen > 99 ? '99+' : pulse.feed.unseen}</span> : null}
          </button>
          <button
            className="railbtn"
            aria-label={t('Artifacts')}
            title={t('Artifacts')}
            aria-current={section === 'artifacts' ? 'page' : undefined}
            onClick={() => setSection('artifacts')}
          >
            <Icon name="paperclip" />
          </button>
          <button
            className="railbtn"
            aria-label={needsCount ? t('Needs you, {count}', { count: needsCount }) : t('Needs you')}
            title={t('Needs you')}
            aria-current={section === 'needs' ? 'page' : undefined}
            onClick={() => setSection('needs')}
          >
            <Icon name="bell" />
            {needsCount ? <span className="badge">{needsCount > 99 ? '99+' : needsCount}</span> : null}
          </button>
          <span className="spacer" />
          <button
            className="railbtn"
            aria-label={t('Settings')}
            title={t('Settings')}
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={() => setSection('settings')}
          >
            <Icon name="settings" />
          </button>
          <span
            className={`dot${connected ? '' : ' warn'}`}
            role="img"
            aria-label={connected ? t('Connected') : t('Not connected')}
            title={connected ? t('Connected to {host}', { host: status.hostLabel ?? '' }) : t('Not connected')}
          />
        </nav>
        {/* Chats stays mounted once shown, hidden while another section is open, so coming back doesn't rebuild every row and the open transcript. */}
        {chatsShown ? (
          <KeptPane away={section !== 'chats'}>
            {listHidden ? null : projectsOpen ? (
              <ProjectsPane
                profile={chatProfile}
                connected={connected}
                selectedId={chat.storedId ?? selected.id}
                onSelect={item => setSelected({ id: item.id, profile: item.profile ?? chatProfile ?? undefined, title: item.title })}
                onNewChat={folder => setSelected({ id: null, profile: chatProfile ?? undefined, folder })}
                onClose={() => setProjectsOpen(false)}
                isUnread={projectChatUnread}
                runningIds={runningIds}
                onHide={() => hideList(true)}
              />
            ) : botsSideShown && orderedRoster ? (
              <BotsHome {...botsHomeProps} side={{ openProfile: selected.profile ?? 'default' }} onHide={() => hideList(true)} />
            ) : (
              <ChatList
                rows={listedRows}
                error={list.error}
                updating={list.updating}
                selectedId={chat.storedId ?? selected.id}
                runningIds={runningIds}
                waitingIds={waitingIds}
                runningStatus={transcript.status}
                onSelect={(row: ChatRow) => setSelected({ id: row.id, profile: row.profile, title: row.title })}
                onOpenBeside={besideFits ? openBeside : undefined}
                canOpenBeside={row => row.id !== selected.id && row.id !== beside?.id && sameProfileAs(row.profile, selected.profile)}
                onNewChat={newChat}
                bots={roster.bots}
                profile={chatProfile}
                onProfile={chooseProfile}
                onEditProfile={connected ? editProfile : undefined}
                onPin={row => void chatAction(row, { pinned: !row.pinned })}
                onRename={(row, title) => void chatAction(row, { title })}
                marks={marks}
                onStar={row => updateMarks(current => toggleStar(current, row))}
                onToggleRead={toggleRead}
                isDone={chatDone.available ? isRowDone : undefined}
                onDone={chatDone.available ? chatDone.toggle : undefined}
                onDelete={async row => {
                  if (await ask(`${t('Delete conversation?')}\n\n${t('This permanently deletes the conversation and cannot be undone.')}`, { confirm: t('Delete'), destructive: true }))
                    void chatAction(row, null)
                }}
                onProjects={() => setProjectsOpen(true)}
                searchScope={markHost}
                onPinnedReplies={pins.length ? () => setPinSheet({ scope: 'all' }) : undefined}
                moveTargets={moveTargets}
                onMove={(row, target) => void moveToProject(row, target)}
                otherRows={otherChats}
                badgeFor={badgeFor}
                onOpenOther={openOtherChat}
                onHide={() => hideList(true)}
              />
            )}
            {listHidden ? null : (
              <ColumnDivider
                label={t('Chat list width')}
                bounds={LIST_COLUMN}
                sign={1}
                width={listWidth}
                onLive={setListLive}
                onCommit={commitList}
                onCollapse={() => hideList(true)}
              />
            )}
            <main className="chat" ref={chatPane}>
              <div className="chat-head soft">
                <div className="chat-titles">
                  <div className="chat-title-line">
                    {title ? <div className="chat-title">{title}</div> : null}
                    {workItem ? (
                      <span className={`status-chip tone-${workTone(workItem)}`} title={statusText(workItem)}>
                        <span className="status-chip-text">{statusText(workItem)}</span>
                      </span>
                    ) : null}
                  </div>
                  {/* A Bot Chat's work is counted on the Work tab and the panel button (Eric, 2026-11-20), not again under its name. */}
                  {workItem && workBot ? (
                    <button
                      className="chat-subtitle"
                      title={t('Back to {bot}', { bot: workBot.title })}
                      onClick={() => {
                        if (workBot.botChatId) openBot(workBot)
                      }}
                    >
                      {t('{bot}’s work · {ref}', { bot: workBot.title, ref: workItem.ref })}
                    </button>
                  ) : null}
                </div>
                <div className="chat-head-actions">
                  {/* Call and its voice mode, one pill (option C, softer). */}
                  <div className={`call-pill${calling ? ' on' : ''}`}>
                    <button
                      className="call-pill-call"
                      aria-label={calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(nextMode) })}
                      title={calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(nextMode) })}
                      disabled={!connected && !calling}
                      onClick={toggleCall}
                    >
                      <Icon name={calling ? 'phoneDown' : 'phone'} />
                      <span>{calling ? t('End call') : t('Call')}</span>
                    </button>
                    <span className="call-pill-line" aria-hidden="true" />
                    <span className="call-pill-mode">
                      <select
                        aria-label={t('Voice mode')}
                        title={t('Voice mode')}
                        value={calling ? callMode : nextMode}
                        onChange={e => switchCallMode(e.target.value as VoiceMode)}
                      >
                        {VOICE_MODES.map(mode => (
                          <option key={mode} value={mode}>
                            {voiceModeTitle(mode)}
                          </option>
                        ))}
                      </select>
                      <Icon name="chevronDown" />
                    </span>
                  </div>
                  {screenHosts[screenProfile] ? (
                    <button
                      className={`chat-head-toggle${screenOpen ? ' on' : ''}`}
                      aria-label={t("Bot's Screen")}
                      aria-pressed={screenOpen}
                      title={t("Bot's Screen")}
                      onClick={() => setScreenOpen(!screenOpen)}
                    >
                      <Icon name="screen" />
                    </button>
                  ) : null}
                  {panelTabs.length ? (
                    <button
                      className={`chat-head-toggle${shownTab ? ' on' : ''}`}
                      aria-label={shownTab ? t('Hide side panel') : t('Show side panel')}
                      aria-pressed={!!shownTab}
                      title={shownTab ? t('Hide side panel') : t('Show side panel')}
                      onClick={() => openTab(shownTab ? null : panelTabs.includes(lastTab.current) ? lastTab.current : panelTabs[0])}
                    >
                      <Icon name="sidePanel" />
                      {workDot && shownTab !== 'work' ? <span className={`chat-head-dot ${workDot.tone}`} aria-label={workDot.label} /> : null}
                    </button>
                  ) : null}
                </div>
              </div>
              {screenOpen ? <BotScreen profile={screenProfile} botName={botTitle} onClose={() => setScreenOpen(false)} /> : null}
              <FileLinks.Provider value={openPath}>
                <ConnectionActionsContext.Provider value={connectionActions}>
                  <Transcript
                    state={transcript}
                    loading={loading}
                    error={error}
                    requests={openRequests}
                    expired={expiredQuestions}
                    profile={selected.profile}
                    author={botTitle}
                    face={chatFace}
                    onQuote={setQuote}
                    onCommand={text => void onSend(text)}
                    teammates={glowBots}
                    display={chatDisplay}
                    sessionId={chat.liveId ?? undefined}
                    calls={chatCallList}
                    onOpenCall={setOpenCall}
                    followedUp={followedUp}
                    pins={pinControls}
                    onReact={chat.liveId ? reactTo : undefined}
                    onBranch={chat.liveId && !transcript.running ? branchFrom : undefined}
                  />
                </ConnectionActionsContext.Provider>
              </FileLinks.Provider>
              {pinSheet ? (
                <PinnedRepliesSheet
                  pins={pins}
                  open={{ profile: selected.profile, chat: pinChat }}
                  initialScope={pinSheet.scope}
                  editing={pinSheet.editing}
                  chatTitle={pinChatTitle}
                  onOpen={openPin}
                  onUnpin={pin => updatePins(current => current.filter(p => p.id !== pin.id))}
                  onLabel={(pin, label) => updatePins(current => current.map(p => (p.id === pin.id ? { ...p, label } : p)))}
                  onClose={() => setPinSheet(null)}
                />
              ) : null}
              {openCall && selected.id ? (
                <CallTranscriptSheet
                  profile={selected.profile}
                  chatId={selected.id}
                  callId={openCall}
                  onResume={!calling && connected && nextMode !== 'classic' ? call => resumeCall(openCall, call) : undefined}
                  onClose={() => setOpenCall(null)}
                />
              ) : null}
              {contextOpen && chat.liveId ? (
                <ContextPanel
                  chat={chat}
                  profile={selected.profile}
                  running={transcript.running}
                  onClose={closeContext}
                  onCompress={() => void onSend('/compress')}
                />
              ) : null}
              {modelOpen && chat.liveId ? (
                <ModelPicker
                  chat={chat}
                  profile={selected.profile}
                  onClose={closeModel}
                  setModel={setModel}
                  setReasoning={setReasoning}
                  setSpeed={setSpeed}
                  setYolo={setYolo}
                />
              ) : null}
              {asksConsent && isLive(callMode) ? (
                <ProviderConsentSheet mode={callMode} onAllow={() => setConsentGiven(n => n + 1)} onCancel={() => setCalling(false)} />
              ) : calling && callMode === 'gpt' ? (
                <GptLiveCall
                  key={callMode}
                  modeMenu={modeMenu}
                  pictureControls={pictureControls}
                  pictureNote={pictureNote}
                  profile={selected.profile}
                  chatId={selected.id}
                  items={transcript.items}
                  onSay={callSay}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onEnd={() => setCalling(false)}
                  onClassic={() => setCallMode('classic')}
                  requests={openRequests}
                  resume={resume ?? undefined}
                />
              ) : calling && (callMode === 'gemini' || callMode === 'qwen') ? (
                <GeminiLiveCall
                  key={callMode}
                  modeMenu={modeMenu}
                  pictureControls={pictureControls}
                  pictureNote={pictureNote}
                  provider={callMode}
                  profile={selected.profile}
                  chatId={selected.id}
                  items={transcript.items}
                  onSay={callSay}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onEnd={() => setCalling(false)}
                  onClassic={() => setCallMode('classic')}
                  requests={openRequests}
                  resume={resume ?? undefined}
                />
              ) : calling && callMode === 'grok' ? (
                <GrokLiveCall
                  key={callMode}
                  modeMenu={modeMenu}
                  pictureControls={pictureControls}
                  pictureNote={pictureNote}
                  profile={selected.profile}
                  chatId={selected.id}
                  items={transcript.items}
                  onSay={callSay}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onEnd={() => setCalling(false)}
                  onClassic={() => setCallMode('classic')}
                  requests={openRequests}
                  resume={resume ?? undefined}
                />
              ) : calling && callMode === 'local' ? (
                <LocalLiveCall
                  key={callMode}
                  modeMenu={modeMenu}
                  pictureControls={pictureControls}
                  pictureNote={pictureNote}
                  profile={selected.profile}
                  chatId={selected.id}
                  liveId={chat.liveId}
                  onCorrected={noteCorrection}
                  items={transcript.items}
                  onSay={callSay}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onEnd={() => setCalling(false)}
                  onClassic={() => setCallMode('classic')}
                  requests={openRequests}
                  resume={resume ?? undefined}
                />
              ) : calling ? (
                <VoiceCall
                  key={callMode}
                  modeMenu={modeMenu}
                  pictureControls={pictureControls}
                  profile={selected.profile}
                  onSay={callSay}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onStop={() => void stop()}
                  onEnd={() => setCalling(false)}
                />
              ) : null}
              <ControlDock liveId={chat.liveId} profile={selected.profile} connected={connected} pulse={controlPulse} />
              <AgentsDock
                agents={delegates.agents}
                running={transcript.running}
                chatKey={selected.id ?? 'new'}
                steer={delegates.steer}
                stop={delegates.stop}
                tail={delegates.tail}
                processes={delegates.processes}
                kill={delegates.kill}
              />
              <PlanDock plan={shownPlan} running={transcript.running} chatKey={selected.id ?? 'new'} />
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
                chatKey={selected.id ?? 'new'}
                onSendNow={sendQueuedNow}
                onEdit={(row, text) => editQueued(row, withMentionNote(text, roster.bots, selected.profile ?? 'default'))}
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
                running={transcript.running}
                disabled={!connected}
                model={chat.model}
                cwd={chat.cwd}
                onSend={onSend}
                replies={predictions.replies}
                onDraftPause={predictions.askDraft}
                onDrafting={setDrafting}
                onSuggestion={text => void onSend(text, [])}
                onStop={() => void stop()}
                focusKey={selected.id ?? 'new'}
                draftKey={chatDraft(selected.profile, selected.id)}
                canAttach
                dropZone={chatPane}
                voice={calling ? undefined : { profile: selected.profile }}
                mentionBots={mentionBots}
              />
            </main>
            {(artifactsOpen && selected.id) || showWork || (filesOpen && chat.cwd) || (beside && besideFits) ? (
              <ColumnDivider label={t('Side panel width')} bounds={PANEL_COLUMN} sign={-1} width={panelWidth} onLive={setPanelLive} onCommit={commitPanel} />
            ) : null}
            {artifactsOpen && selected.id ? (
              <ArtifactsPanel
                profile={selected.profile}
                sessionIds={[selected.id]}
                refreshKey={turnsDone}
                folder={chat.cwd}
                onShowInFolder={path => {
                  setArtifactsOpen(false)
                  openPath?.(path)
                }}
                onOpenChat={item => setRevealRow({ sessionId: item.sessionId, messageId: item.messageId, until: Date.now() + 20_000 })}
                onClose={() => setArtifactsOpen(false)}
                tabs={panelTabBar}
              />
            ) : showWork ? (
              <WorkPanel
                key={selected.profile ?? 'default'}
                profile={selected.profile}
                botName={workBot?.title ?? 'Hermes'}
                snapshot={work.snapshot}
                error={work.error}
                onReload={() => void work.reload()}
                onOpenChat={item => setSelected({ id: item.sessionId, profile: selected.profile, title: shownTitle(item) })}
                onClose={() => setWorkOpen(false)}
                tabs={panelTabBar}
              />
            ) : filesOpen && chat.cwd ? (
              <FilesPanel
                root={chat.cwd}
                profile={selected.profile}
                refreshKey={turnsDone}
                reveal={reveal}
                onInsertPath={path => setQuote(quoteRequest({ insert: pathForDraft(path) }))}
                onClose={() => showFiles(false)}
                tabs={panelTabBar}
              />
            ) : beside && besideFits ? (
              <BesideChatPane
                key={beside.id}
                chat={beside}
                sessionAuthority={status.sessionAuthority === true}
                connected={connected}
                author={besideBot?.title ?? 'Hermes'}
                face={besideFace}
                display={chatDisplay}
                onSwap={swapBeside}
                onClose={() => setBeside(null)}
                onOpenInWindow={
                  chatWindowIds.length < CHAT_WINDOW_LIMIT || chatWindowIds.includes(beside.id)
                    ? () => moveBesideToWindow(beside, roster.bots?.find(b => b.name === (beside.profile ?? 'default'))?.title ?? 'Hermes')
                    : undefined
                }
              />
            ) : null}
          </KeptPane>
        ) : null}
        {/* A group chat, New Bot and Edit Bot keep the bots beside them, as an open Bot Chat does. */}
        {section === 'room' || section === 'bots' ? (
          <BotsHome
            {...botsHomeProps}
            side={{ openRoomId: section === 'room' ? (shownCopy?.roomId ?? openRoom?.roomId) : undefined, openProfile: editingBot?.name }}
          />
        ) : null}
        {section === 'chats' ? null : section === 'bots' && newBot ? (
          <NewBot
            bots={[...(roster.bots ?? []), ...roster.hidden]}
            protocol={roster.protocol}
            dashboards={newBotDashboards}
            onCreateElsewhere={createBotElsewhere}
            carried={carriedBot}
            onClose={() => {
              setNewBot(false)
              setCarriedBot(null)
            }}
            onCreated={(bot, introduce, warning) => {
              setNewBot(false)
              setCarriedBot(null)
              setBotNotice(warning)
              void roster.refresh()
              if (bot) {
                if (introduce) askBot(bot, t('Hey, tell me about yourself!'))
                else openBot(bot)
              }
            }}
          />
        ) : section === 'bots' && editingBot ? (
          <BotEditor key={editingBot.name} bot={editingBot} onClose={closeBotEditor} onSaved={() => void roster.refresh()} />
        ) : section === 'bots' ? null : section === 'tasks' ? (
          <Tasks
            bots={orderedRoster}
            connected={connected}
            profile={chatProfile}
            // Only the list's profile: picking one here doesn't open its chats.
            onProfile={setChatProfile}
            onOpenRun={(run, job) => {
              if (!run.id) return
              setSelected({ id: run.id, profile: run.profile ?? job.profile, title: run.title })
              setSection('chats')
            }}
          />
        ) : section === 'artifacts' ? (
          <main className="needs artifacts-section">
            <div className="needs-inner">
              <ArtifactsPanel
                page
                profile={chatProfile ?? undefined}
                sessionIds={[]}
                kept={keptHosts}
                dashboards={artifactDashboards}
                onOpenOtherChat={item =>
                  openOtherChat({ host: item.dashboard, id: item.sessionId, title: item.sessionTitle ?? '', profile: item.dashboardProfile, pinned: false })
                }
                onOpenChat={item => {
                  setSelected({ id: item.sessionId, profile: chatProfile ?? undefined, title: item.sessionTitle })
                  setSection('chats')
                  setRevealRow({ sessionId: item.sessionId, messageId: item.messageId, until: Date.now() + 20_000 })
                }}
              />
            </div>
          </main>
        ) : section === 'pulse' ? (
          <PulsePage
            pulse={pulse}
            onOpenChat={(target, draft) => {
              setSelected({ id: target.id, profile: target.profile, title: target.title })
              setSection('chats')
              if (draft) setQuote(quoteRequest({ draft }))
            }}
            onOpenBoard={() => setSection('tasks')}
            chips={pulseHostChips}
            onPickHost={async url => {
              if (!(await switchEndingCall(hostName(url)))) return
              openPageAfterSwitch(url, 'pulse')
              void window.conduit.switchHost(url)
            }}
          />
        ) : section === 'room' && shownCopy && shownCopyRoom ? (
          <RoomView
            key={shownCopy.id}
            room={shownCopyRoom}
            readsStoredFiles={roomFilePictures && roomInvites.capabilities.includes(ROOM_FILES_LINKED_CAPABILITY)}
            people={{ canSetChoices: roomChoicesServed, freeBusy: roomInvites.freeBusy, canLeave: roomCopies.canLeave, onChanged: () => void roomCopies.refresh() }}
            looks={roomLooks.looks[shownCopy.roomId]}
            onOpenRoomChat={roomChatsServed ? (agent, wrapUp) => openRoomChatWith(shownCopyRoom, agent, wrapUp) : undefined}
            bots={roster.bots ?? []}
            connected={connected}
            canStop={false}
            canAttach={false}
            copy={shownCopy}
            onRefreshCopies={roomCopies.refresh}
            canPostInCopy={roomCopies.canPost}
            copyApprovals={shownCopyApprovals}
            copyAnswers={roomCopies.answers}
            onAnswerCopyApproval={(approval, choice) => void roomCopies.answer(approval, choice)}
            onLeaveCopy={
              canLeaveCopy(shownCopy, roomCopies.canLeave)
                ? async () => {
                    const kind = await roomCopies.leave(shownCopy)
                    void roomInvites.refresh()
                    return kind
                  }
                : undefined
            }
            onDeleteCopy={
              roomCopies.canForget
                ? async () => {
                    const invite = roomInvites.invites.find(i => i.id === shownCopy.id)
                    await roomCopies.remove(shownCopy, invite)
                    // Its invite, ended, would take its tile back.
                    if (invite) void roomInvites.remove(invite)
                    setOpenCopy(null)
                    setSection('bots')
                  }
                : undefined
            }
          />
        ) : section === 'room' && openRoom ? (
          <RoomView
            key={openRoom.roomId}
            room={openRoom}
            storesFiles={roomFilesStored}
            people={{
              canSetChoices: roomChoicesServed,
              freeBusy: roomInvites.freeBusy,
              canLeave: roomInvites.capabilities.includes(ROOM_LEAVE_CAPABILITY),
              onChanged: () => void groupRooms.refresh()
            }}
            readsStoredFiles={roomFilePictures}
            looks={roomLooks.looks[openRoom.roomId]}
            onOpenRoomChat={roomChatsServed ? (agent, wrapUp) => openRoomChatWith(openRoom, agent, wrapUp) : undefined}
            bots={roster.bots ?? []}
            connected={connected}
            canStop={groupRooms.capabilities?.canStop === true}
            canAttach={groupRooms.capabilities?.attachments === true}
            canEditSettings={groupRooms.capabilities?.context === true}
            canContinueDiscussions={groupRooms.capabilities?.canContinue === true}
            canApprove={groupRooms.capabilities?.canApprove === true}
          />
        ) : section === 'needs' ? (
          <NeedsYou
            requests={requests}
            waiting={waitingRows}
            otherWaiting={otherWaiting}
            badgeFor={badgeFor}
            onOpenOther={openOtherWaiting}
            listAvailable={waiting.available}
            titleFor={titleFor}
            onOpen={openWaiting}
            onOpenLive={sessionId => {
              if (sessionId === chat.liveId) setSection('chats')
            }}
            openLiveId={chat.liveId}
          />
        ) : (
          <Settings
            status={status}
            onAddHost={() => {
              reopenSettings()
              onAddHost()
            }}
            onEditHost={host => {
              reopenSettings()
              onEditHost(host)
            }}
            bots={(roster.bots ?? []).map(bot => ({ name: bot.name, title: bot.title }))}
            profile={selected.profile ?? 'default'}
            onEditProfile={
              connected
                ? () => {
                    const bot = roster.bots?.find(each => each.name === (selected.profile ?? 'default')) ?? roster.bots?.find(each => each.isDefault)
                    if (bot) editProfile(bot)
                  }
                : undefined
            }
            chatScale={chatScale}
            setChatScale={setChatScale}
            onShortcuts={() => setShortcutsOpen(true)}
            appsRequest={appsRequest}
            onAppsRequestTaken={() => setAppsRequest(null)}
            modelsRequest={modelsRequest}
            onModelsRequestTaken={() => setModelsRequest(null)}
            linkRequest={linkRequest}
            onLinkRequestTaken={() => setLinkRequest(null)}
            personPicture={personPicture}
            onNewChatWith={
              connected
                ? draft => {
                    // A new chat's canvas: what's sent from it goes only into the chat it makes (A new chat that something waits on).
                    setSelected({ id: null, profile: selected.profile })
                    setSection('chats')
                    setQuote(quoteRequest({ draft }))
                  }
                : undefined
            }
          />
        )}
      </div>
      {shortcutsOpen ? <ShortcutsSheet onClose={closeShortcuts} /> : null}
      {shownInvite ? (
        <RoomInviteCard
          invite={shownInvite}
          bots={roster.bots}
          freeBusy={roomInvites.freeBusy}
          onAnswer={roomInvites.answer}
          onRemove={invite => void roomInvites.remove(invite)}
          onRefresh={roomInvites.refresh}
          onClose={() => setOpenInvite(null)}
        />
      ) : null}
      {newGroupOpen ? (
        <NewGroupChat
          bots={roster.bots ?? []}
          people={roomDrafts.people}
          ownBots={roomDrafts.ownBots}
          peopleOffered={roomDrafts.served && roomDrafts.read}
          startsUnavailable={roomDrafts.read && !roomDrafts.startsAvailable}
          canLink={roomInvites.capabilities.includes('room-links')}
          onCreateRoom={groupRooms.create}
          onCreateDraft={(name, agents, links, bring) => roomDrafts.create(name, agents, links, chatProfile ?? 'default', bring)}
          onOpenRoom={showRoom}
          onClose={() => setNewGroupOpen(false)}
        />
      ) : null}
      {shownDraft ? (
        <RoomDraftCard
          draft={shownDraft}
          rooms={groupRooms.rooms}
          onStart={roomDrafts.start}
          onWithdraw={roomDrafts.withdraw}
          onDismiss={roomDrafts.dismiss}
          onRefresh={refreshDraft}
          onOpenRoom={openDraftRoom}
          onClose={() => setOpenDraft(null)}
        />
      ) : null}
    </GlowContext.Provider>
  )
}

/** A Settings page of rows moved off Settings home: its title and Back, as the other pages have. */
function SettingsSubpage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  useMouseBack(onBack)
  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}

/** A Settings row that opens a page: the whole row is the button, its label on the left, what's inside on the right. */
function SettingsLink({ label, detail, disabled, onOpen }: { label: string; detail: string; disabled?: boolean; onOpen: () => void }) {
  return (
    <button className="settings-link" disabled={disabled} onClick={onOpen}>
      <span className="settings-link-label">{label}</span>
      <span className="settings-link-detail">
        <span>{detail}</span>
        <Icon name="chevron" />
      </span>
    </button>
  )
}

function Settings({
  status,
  onAddHost,
  onEditHost,
  bots,
  profile,
  onEditProfile,
  chatScale,
  setChatScale,
  onShortcuts,
  appsRequest,
  onAppsRequestTaken,
  modelsRequest,
  onModelsRequestTaken,
  linkRequest,
  onLinkRequestTaken,
  personPicture,
  onNewChatWith
}: {
  status: ConnectionStatus
  onAddHost: () => void
  onEditHost: (host: HostSummary) => void
  bots: { name: string; title: string }[]
  profile: string
  /** Settings > Edit profile: the profile in use, in Edit Bot. */
  onEditProfile?: () => void
  chatScale: number
  setChatScale: (scale: number) => void
  onShortcuts: () => void
  appsRequest: AppsRequest | null
  onAppsRequestTaken: () => void
  /** Settings > Models for this profile, asked from Group Settings. */
  modelsRequest: ModelsRequest | null
  onModelsRequestTaken: () => void
  /** A Link invite opened from another app: Multiplayer opens it. */
  linkRequest: { url: string; at: number } | null
  onLinkRequestTaken: () => void
  /** The picture you show in rooms over Links. */
  personPicture: PersonPicture
  /** A new chat with `draft` in its composer, for the user to send (Try a test call, Have Hermes watch for this). */
  onNewChatWith?: (draft: string) => void
}) {
  const kept = useKeptHosts()
  const keptState = (url: string) => kept.find(h => h.url === url)?.state ?? null
  const [notifications, setNotifications] = useState(notificationsEnabled)
  const [readAloudOn, setReadAloudOn] = useState(readsRepliesAloud)
  const [page, setPage] = useState<
    'main' | 'usage' | 'models' | 'capabilities' | 'memory' | 'workspace' | 'advanced' | 'chat' | 'plugin' | 'vault' | 'appearance' | 'multiplayer' | 'voice' | 'calls'
  >('main')
  // Multiplayer shows while the host's plugin keeps Links.
  const [pluginCapabilities, setPluginCapabilities] = useState<string[]>([])
  const linksServed = pluginCapabilities.includes(ROOM_LINKS_CAPABILITY)
  useEffect(() => {
    if (status.phase !== 'open') return
    let live = true
    gateway
      .http('GET', PLUGIN_STATUS_PATH, undefined, 8_000)
      .then(body => {
        const plugin = pluginStatus(body)
        if (live) setPluginCapabilities(plugin.state === 'reported' ? plugin.capabilities : [])
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [status.phase, status.url])
  // The apps card's ask, taken once: Capabilities opens on Browse Apps with its picks.
  const [apps, setApps] = useState<AppsRequest | null>(null)
  useEffect(() => {
    if (!appsRequest) return
    setApps(appsRequest)
    setPage('capabilities')
    onAppsRequestTaken()
  }, [appsRequest, onAppsRequestTaken])
  // A link into Models, taken once: it opens on that profile.
  const [modelsProfile, setModelsProfile] = useState<{ profile: string; n: number } | null>(null)
  useEffect(() => {
    if (!modelsRequest) return
    setModelsProfile(modelsRequest)
    setPage('models')
    onModelsRequestTaken()
  }, [modelsRequest, onModelsRequestTaken])
  // A Link invite from another app, taken once: Multiplayer opens on it.
  const [linkInvite, setLinkInvite] = useState<{ url: string; at: number } | null>(null)
  useEffect(() => {
    if (!linkRequest) return
    setLinkInvite(linkRequest)
    setPage('multiplayer')
    onLinkRequestTaken()
  }, [linkRequest, onLinkRequestTaken])
  if (page === 'voice')
    return (
      <main className="settings">
        <SettingsSubpage title={t('Voice')} onBack={() => setPage('main')}>
          <dl className="settings-card">
            <dt>{t('Read Aloud')}</dt>
            <dd>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={readAloudOn}
                  onChange={e => {
                    setReadsRepliesAloud(e.target.checked)
                    setReadAloudOn(e.target.checked)
                  }}
                />
                {t('Read replies aloud')}
              </label>
              <p className="meta settings-caption">
                {t('Each reply in the open chat is read aloud as it finishes, in the voice below. Calls speak their own replies.')}
              </p>
              <ReadAloudVoiceSetting profile={profile} />
              <VoiceModeSettings profile={profile} />
            </dd>
            {status.url ? (
              <>
                <dt>{t('Wake phrase')}</dt>
                <dd>
                  <WakePhraseSettings host={status.url} profile={profile} />
                </dd>
              </>
            ) : null}
          </dl>
        </SettingsSubpage>
      </main>
    )
  if (page === 'calls')
    return (
      <main className="settings">
        <SettingsSubpage title={t('Calls from Hermes')} onBack={() => setPage('main')}>
          <div className="settings-card settings-card-single">
            <HermesCallSettings profile={profile} onNewChat={onNewChatWith} />
          </div>
        </SettingsSubpage>
      </main>
    )
  if (page === 'usage')
    return (
      <main className="settings">
        <UsagePage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'models')
    return (
      <main className="settings">
        <ModelsPage
          key={modelsProfile ? `link:${modelsProfile.n}` : 'models'}
          bots={bots}
          profile={modelsProfile?.profile ?? profile}
          onBack={() => {
            setModelsProfile(null)
            setPage('main')
          }}
        />
      </main>
    )
  if (page === 'appearance')
    return (
      <main className="settings">
        <AppearancePage host={status.url ?? ''} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'multiplayer' && status.url)
    return (
      <main className="settings">
        <MultiplayerPage
          host={status.url}
          capabilities={pluginCapabilities}
          bots={bots}
          profile={profile}
          invite={linkInvite}
          personPicture={personPicture}
          onBack={() => setPage('main')}
        />
      </main>
    )
  if (page === 'vault')
    return (
      <main className="settings">
        <VaultPage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'plugin')
    return (
      <main className="settings">
        <ConduitPluginPage onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'chat')
    return (
      <main className="settings">
        <ConfigPage
          title={t('Chat')}
          subtitle={t('Response behavior, visibility, and timezone')}
          sections={chatSections}
          bots={bots}
          profile={profile}
          onBack={() => setPage('main')}
        >
          <TakeoverSettings />
          <StepSummarySettings />
          <PredictiveSettings />
        </ConfigPage>
      </main>
    )
  if (page === 'workspace' || page === 'advanced')
    return (
      <main className="settings">
        <ConfigPage
          key={page}
          title={page === 'workspace' ? t('Workspace & safety') : t('Advanced')}
          subtitle={
            page === 'workspace'
              ? t('Working defaults and safeguards for this profile.')
              : t('Limits and runtime defaults for this profile. Most profiles never need to change these.')
          }
          sections={page === 'workspace' ? workspaceSections : advancedSections}
          bots={bots}
          profile={profile}
          onBack={() => setPage('main')}
        />
      </main>
    )
  if (page === 'memory')
    return (
      <main className="settings">
        <MemoryPage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'capabilities')
    return (
      <main className="settings">
        <CapabilitiesPage
          bots={bots}
          profile={profile}
          host={status.url}
          apps={apps}
          onBack={() => {
            setApps(null)
            setPage('main')
          }}
        />
      </main>
    )
  const methods = { password: t('User name and password'), token: t('Session token'), open: t('No sign-in') }
  return (
    <main className="settings">
      <h1>{t('Settings')}</h1>
      <section className="settings-group">
        <h2>{t('Connection')}</h2>
        <dl className="settings-card">
          <dt>{t('Connection')}</dt>
          <dd>
            {status.phase === 'open' ? t('Connected') : status.phase === 'connecting' ? t('Connecting…') : t('Not connected')}
            {status.phase === 'open' && status.sessionAuthority ? ` · ${t('session authority')}` : ''}
          </dd>
          <dt>Hermes</dt>
          <dd>
            <ul className="hosts">
              {(status.hosts?.length ? status.hosts : status.url ? [{ url: status.url, method: status.method ?? 'open', username: status.username }] : []).map(
                host => (
                  <li key={host.url} className={host.url === status.url ? 'current' : undefined}>
                    <span className="host-label" title={host.url}>
                      {hostName(host.url)}
                    </span>
                    {host.username ? <span className="meta">{host.username}</span> : null}
                    <span className="spacer" />
                    {host.url === status.url ? (
                      <>
                        <span className="meta">{t('In use')}</span>
                        <button className="link" onClick={() => onEditHost(host)}>
                          {t('Connection Setup')}
                        </button>
                      </>
                    ) : keptState(host.url) ? (
                      <span className="meta">{keptStateLabel(keptState(host.url)!)}</span>
                    ) : null}
                    {host.url === status.url ? null : (
                      <button className="link" onClick={() => void switchEndingCall(hostName(host.url)).then(ok => ok && window.conduit.switchHost(host.url))}>
                        {t('Switch')}
                      </button>
                    )}
                    {host.url !== status.url ? (
                      <button
                        className="link danger"
                        onClick={async () => {
                          if (await ask(t('Sign out of {host} on this computer?', { host: hostName(host.url) }))) {
                            composerDrafts.dropHost(host.url)
                            void window.conduit.removeHost(host.url)
                          }
                        }}
                      >
                        {t('Sign out')}
                      </button>
                    ) : null}
                  </li>
                )
              )}
            </ul>
            <button className="link add-host" onClick={onAddHost}>
              {t('Add another Hermes…')}
            </button>
          </dd>
          <dt>{t('Dashboard')}</dt>
          <dd>{status.url}</dd>
          <dt>{t('Signed in with')}</dt>
          <dd>
            {status.method ? methods[status.method] : '—'}
            {status.username ? ` (${status.username})` : ''}
          </dd>
          {status.url ? <HostActions host={status.url} connected={status.phase === 'open'} /> : null}
          <dt>{t('Profile')}</dt>
          <dd>
            <span>{bots.find(bot => bot.name === profile)?.title ?? profile}</span>{' '}
            <button className="link" disabled={!onEditProfile} onClick={onEditProfile}>
              {t('Edit profile')}
            </button>
          </dd>
        </dl>
      </section>
      <section className="settings-group">
        <h2>Hermes</h2>
        <dl className="settings-card">
          <SettingsLink label={t('Models')} detail={t('Chat model and helper models')} disabled={status.phase !== 'open'} onOpen={() => setPage('models')} />
          <SettingsLink label={t('Usage')} detail={t('Tokens, cost and provider quota')} disabled={status.phase !== 'open'} onOpen={() => setPage('usage')} />
          <SettingsLink label={t('Chat')} detail={t('Response behavior, visibility, and timezone')} disabled={status.phase !== 'open'} onOpen={() => setPage('chat')} />
          <SettingsLink label={t('Workspace & safety')} detail={t('Working directory, approvals, and privacy')} disabled={status.phase !== 'open'} onOpen={() => setPage('workspace')} />
          <SettingsLink label={t('Memory & delegation')} detail={t('Memory, compression, and child agents')} disabled={status.phase !== 'open'} onOpen={() => setPage('memory')} />
          <SettingsLink label={t('Advanced')} detail={t('Turn limits, terminal, and tool output')} disabled={status.phase !== 'open'} onOpen={() => setPage('advanced')} />
          <SettingsLink label={t('Capabilities')} detail={t('Skills, tools, connectors, and plugins')} disabled={status.phase !== 'open'} onOpen={() => setPage('capabilities')} />
          <SettingsLink label={t('Passwords & logins')} detail={t('Logins, cards and password managers Hermes signs in with')} disabled={status.phase !== 'open'} onOpen={() => setPage('vault')} />
          {linksServed ? (
            <SettingsLink label={t('Multiplayer')} detail={t("Rooms with other people's agents")} disabled={status.phase !== 'open'} onOpen={() => setPage('multiplayer')} />
          ) : null}
          <SettingsLink label={t('Conduit plugin')} detail={t('Version, updates and what it does here')} disabled={status.phase !== 'open'} onOpen={() => setPage('plugin')} />
        </dl>
      </section>
      <section className="settings-group">
        <h2>{t('Voice')}</h2>
        <dl className="settings-card">
          <SettingsLink label={t('Voice')} detail={t('Speech providers, credentials, and device opt-in')} onOpen={() => setPage('voice')} />
          <SettingsLink label={t('Calls from Hermes')} detail={t('When Hermes may phone you')} onOpen={() => setPage('calls')} />
        </dl>
      </section>
      <section className="settings-group">
        <h2>{t('App')}</h2>
        <dl className="settings-card">
          <SettingsLink label={t('Appearance')} detail={t('Choose how Conduit appears across the app.')} onOpen={() => setPage('appearance')} />
          <dt>{t('Chat text size')}</dt>
          <dd>
            <input
              className="text-size-slider"
              type="range"
              min={0}
              max={SCALES.length - 1}
              step={1}
              value={Math.max(0, SCALES.indexOf(chatScale))}
              onChange={e => setChatScale(SCALES[Number(e.target.value)] ?? 1)}
              aria-label={t('Chat text size')}
            />
            <span className="meta">{Math.round(chatScale * 100)}%</span>
          </dd>
          <dt>{t('Notifications')}</dt>
          <dd>
            <label className="toggle">
              <input
                type="checkbox"
                checked={notifications}
                onChange={e => {
                  setNotificationsEnabled(e.target.checked)
                  setNotifications(e.target.checked)
                }}
              />
              {t('When a reply finishes or something needs you in a chat you’re not looking at')}
            </label>
          </dd>
          <dt>{t('Language')}</dt>
          <dd>
            <select
              className="language-select"
              value={window.conduit.language.choice}
              onChange={e => {
                // The window reloads in the new language; come back to Settings.
                try {
                  sessionStorage.setItem(REOPEN_SECTION, 'settings')
                } catch {
                  // Opens on Chats instead.
                }
                window.conduit.setLanguage(e.target.value as LanguageChoice)
              }}
              aria-label={t('Language')}
            >
              <option value="system">{t('Same as this computer')}</option>
              {LANGUAGES.map(language => (
                <option key={language} value={language} lang={language}>
                  {LANGUAGE_NAMES[language]}
                </option>
              ))}
            </select>
          </dd>
          <SettingsLink label={t('Keyboard')} detail={t('Keyboard Shortcuts')} onOpen={onShortcuts} />
          <AppLockSetting />
          <AskDashboardSetting hosts={status.hosts?.length ?? 0} />
          <CombineDashboardsSetting hosts={status.hosts ?? []} />
        </dl>
      </section>
      <section className="settings-group">
        <h2>{t('Support')}</h2>
        <dl className="settings-card">
          <dt>{t('Last live call')}</dt>
          <dd>
            <LastCallTrace />
            <p className="meta">{t('The steps of the last Grok Live, Qwen Live, Local Live or GPT-Live call, without what was said, to paste into an issue.')}</p>
          </dd>
          <dt>{t('Last Read Aloud')}</dt>
          <dd>
            <LastCallTrace reading />
            <p className="meta">{t('How the last reply read aloud went: the voice and playback, without the reply’s words, to paste into an issue.')}</p>
          </dd>
          <dt>{t('Device reports')}</dt>
          <dd>
            <DeviceReportsSetting />
            <p className="meta">
              {t(
                'When part of Conduit stops or the window stops responding, it keeps a report of which part and why, never your messages, and asks once before sending it to Conduit’s developer.'
              )}
            </p>
          </dd>
        </dl>
      </section>
      <button
        className="secondary"
        onClick={() => {
          composerDrafts.dropHost(status.url ?? '')
          void window.conduit.signOut()
        }}
      >
        {(status.hosts?.length ?? 0) > 1 ? t('Sign out of {host}', { host: status.hostLabel ?? '' }) : t('Sign out')}
      </button>
    </main>
  )
}
