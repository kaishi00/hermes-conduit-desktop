import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { gateway } from './gateway'
import type { ConnectionStatus, LanguageChoice, MenuAction } from '@shared/ipc'
import { BotsHome, type BotAction } from './components/BotsHome'
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
import { setDesktopCardsHost } from './state/desktopCards'
import { LIST_COLUMN, PANEL_COLUMN, besideChatFits, readWidth, shownListWidth, shownPanelWidth, writeWidth } from './state/columnWidths'
import { BesideChatPane, type BesideChat } from './components/BesideChat'
import { absolutePath, pathForDraft } from './state/workspace'
import { FileLinks } from './components/Markdown'
import { usePulse } from './state/usePulse'
import { Icon } from './components/icons'
import { NeedsYou } from './components/NeedsYou'
import { SignIn } from './components/SignIn'
import { TitleBar, hostName } from './components/TitleBar'
import { Transcript, prefillRequest, quoteRequest, revealMessage } from './components/Transcript'
import { forgetSummaries } from './state/stepSummaries'
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
import {
  isWatching,
  notificationsEnabled,
  requestNotification,
  setNotificationsEnabled,
  turnNotification,
  type ChatRef,
  type NotificationSpec
} from './state/notifications'
import { cleanTitle } from './state/text'
import type { StagedAttachment } from './state/attachments'
import type { QuoteRequest } from './state/quote'
import { looksLikeSlashCommand } from './state/slash'
import { UsagePage } from './components/UsagePage'
import { ModelsPage } from './components/ModelsPage'
import { HostActions } from './components/HostActions'
import { ArtifactsPanel } from './components/ArtifactsPanel'
import { CapabilitiesPage } from './components/CapabilitiesPage'
import { onAppsDirectory, type AppsRequest } from './state/appsDirectory'
import { MemoryPage } from './components/MemoryPage'
import { PlanDock } from './components/PlanDock'
import { AgentsDock } from './components/AgentsDock'
import { ControlDock } from './components/ControlDock'
import { useAgents } from './state/useAgents'
import { planFromChecklist } from './state/plan'
import { BotEditor } from './components/BotEditor'
import { TakeoverSettings } from './components/TakeoverSettings'
import { ConnectionActionsContext } from './components/ConnectionCardView'
import { NewBot } from './components/NewBot'
import { useChatDisplay } from './state/display'
import { ConfigPage } from './components/ConfigPage'
import { ConduitPluginPage } from './components/ConduitPluginPage'
import { VaultPage } from './components/VaultPage'
import { AppearancePage } from './components/AppearancePage'
import { ChatQueueDock } from './components/ChatQueueDock'
import { AppLockSetting, LockedScreen } from './components/AppLock'
import { StepSummarySettings } from './components/StepSummarySettings'
import { PredictiveSettings } from './components/PredictiveSettings'
import { advancedSections, chatSections, workspaceSections } from './state/profileConfig'
import { canDelete, duplicateBot, writeMeta } from './state/botActions'
import { WorkPanel } from './components/WorkPanel'
import { useWork, useWorkSessions } from './state/useWork'
import { shownTitle, statusText, stripText, type WorkItem } from './state/work'
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
import { IncomingCall } from './components/IncomingCall'
import { declineOnHost, useCallPresence, useRings, type Ring } from './state/rings'
import { VoiceModeSettings } from './components/VoiceModeSettings'
import { VOICE_MODE_EVENT, VOICE_MODES, setVoiceMode, voiceMode, voiceModeTitle, type VoiceMode } from './state/gptLive'
import { readAloud, readsRepliesAloud, setReadsRepliesAloud } from './state/readAloud'
import { useCommands } from './state/useCommands'
import { moveChat, mutateSession } from './state/chatActions'
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

export function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  const [adding, setAdding] = useState(false)
  // A new host signed in (or the sign-in screen otherwise left): back to the app.
  const url = status?.url
  useEffect(() => setAdding(false), [url])
  // Model pickers open on the catalog kept from this host's last answer, never another host's.
  setCatalogHost(url ?? '')
  setTurnSurfaceHost(url ?? '')
  setDesktopCardsHost(url ?? '')
  // A host signed out or removed takes the summaries of its runs of steps with it.
  const hostList = status?.hosts?.map(h => h.url).join('\n')
  useEffect(() => {
    if (hostList !== undefined) forgetSummaries(hostList ? hostList.split('\n') : [])
  }, [hostList])

  if (!status) return <div className="app" />
  const signedOut = status.phase === 'signed-out' || (status.phase === 'failed' && !status.url)
  return (
    <div className="app">
      <TitleBar
        subtitle={signedOut ? undefined : status.hostLabel}
        hosts={status.hosts}
        currentUrl={status.url}
        onSwitch={url => void window.conduit.switchHost(url)}
      />
      {status.phase === 'locked' ? (
        <LockedScreen />
      ) : adding ? (
        <SignIn onCancel={() => setAdding(false)} />
      ) : signedOut || status.phase === 'failed' ? (
        <SignIn notice={status.error} />
      ) : (
        // Each host gets a fresh window state: its chats, bots and rooms are its own.
        <SummaryHost.Provider value={status.url ?? ''}>
          <Shell key={status.url} status={status} onAddHost={() => setAdding(true)} />
        </SummaryHost.Provider>
      )}
    </div>
  )
}

type Section = 'bots' | 'room' | 'chats' | 'tasks' | 'pulse' | 'artifacts' | 'needs' | 'settings'

const REOPEN_SECTION = 'conduit.reopen-section'

/** Settings after a language change reloads the window, else Chats. */
function reopenedSection(): Section {
  try {
    const saved = sessionStorage.getItem(REOPEN_SECTION)
    sessionStorage.removeItem(REOPEN_SECTION)
    return saved === 'settings' ? 'settings' : 'chats'
  } catch {
    return 'chats'
  }
}

function Shell({ status, onAddHost }: { status: ConnectionStatus; onAddHost: () => void }) {
  // Before any picture is read for this host.
  useState(forgetAvatars)
  const connected = status.phase === 'open'
  const [section, setSection] = useState<Section>(reopenedSection)
  // `folder`: a new chat started in a project works there.
  const [selected, setSelected] = useState<{ id: string | null; profile?: string; title?: string; botChat?: boolean; folder?: string }>({ id: null })
  const [projectsOpen, setProjectsOpen] = useState(false)
  const list = useChatList(connected)
  const {
    transcript,
    chat,
    loading,
    error,
    send,
    stop,
    command,
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
    resendLost
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
    } else if (action === 'search') {
      setSection('chats')
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
  const glowBots = useMemo(() => [...(roster.bots ?? []), ...roster.hidden], [roster.bots, roster.hidden])
  // Thinking and Tool cards as the profile's settings say; read again after a visit to Settings.
  const chatDisplay = useChatDisplay(selected.profile, connected, section === 'chats')
  const botTitle = roster.bots?.find(b => b.name === (selected.profile ?? 'default'))?.title ?? 'Hermes'
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
            showFiles(true)
          }
        : null,
    [cwd, showFiles]
  )
  // Each reply's end reads the open folders again: the agent may have changed files.
  const [turnsDone, setTurnsDone] = useState(0)
  const [calling, setCalling] = useState(false)
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
        window.alert(t('That file isn’t a picture Conduit can show.'))
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
      window.alert(t('Conduit couldn’t capture the screen. On a Mac, allow Screen Recording for Conduit in System Settings, then try again.'))
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
  useEffect(() => setEditingBot(null), [section])
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
  const work = useWork(selected.profile, connected, section === 'chats' && (workOpen || !!openBotChat || workSessions.has(selected.id ?? '')))
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
  const showWork = workOpen && (!!openBotChat || !!workItem)
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
  const listWidth = shownListWidth(listLive ?? listStored, windowWidth)
  const panelWidth = shownPanelWidth(panelLive ?? panelStored, windowWidth, listWidth ?? Math.min(320, Math.max(240, windowWidth * 0.28)))
  // A chat beside the open one: only where both fit, else the pane hides until the window widens.
  const [beside, setBeside] = useState<BesideChat | null>(null)
  const besideFits = besideChatFits(windowWidth, listWidth ?? Math.min(320, Math.max(240, windowWidth * 0.28)))
  const sameProfileAs = (a?: string, b?: string) => (a ?? 'default').toLowerCase() === (b ?? 'default').toLowerCase()
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
      // A deleted chat's pins go with it.
      if (patch === null) updatePins(current => withoutChat(current, row.profile, row.id))
      try {
        await mutateSession(gateway.http, row.id, row.profile, patch)
      } catch (e) {
        window.alert(t('Couldn’t change “{title}”: {reason}', { title: row.title, reason: e instanceof Error ? e.message : String(e) }))
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
        window.alert(
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
      if (looksLikeSlashCommand(text) && !attachments.length) {
        const outcome = await command(text, commands)
        if (outcome.kind === 'new') return newChat()
        if (outcome.kind === 'model') setModelOpen(true)
        if (outcome.kind === 'prefill') setQuote(prefillRequest(withoutMentionNote(outcome.text), botTitle))
        created = outcome.created
      } else {
        created = await send(withMentionNote(text, roster.bots, selected.profile ?? 'default'), attachments, undefined, options)
        if (created === false) return false
      }
      if (created) {
        setSelected(s => ({ ...s, id: created }))
        void list.refresh()
      }
      return true
    },
    [send, command, commands, newChat, list, botTitle, roster.bots, selected.profile]
  )
  // The bots a chat can tag, in their order: every shown bot but the chat's own.
  const mentionBots = useMemo(() => mentionCandidates(roster.bots, '', selected.profile ?? 'default'), [roster.bots, selected.profile])

  // A Bot Chat goes by its bot's name: Hermes titles every one "Bot Chat".
  const title = workItem
    ? shownTitle(workItem)
    : selected.botChat && selected.title
      ? selected.title
      : cleanTitle(chat.title || selected.title || '') || (selected.id ? '' : t('New chat'))

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
          pin: item => updatePins(current => [...current, newPin({ kind: 'assistant', ...item }, pinChat, selected.profile, title || t('Chat'))]),
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
  const openBot = useCallback((bot: Bot) => {
    setSelected({ id: bot.botChatId ?? null, profile: bot.name, title: bot.title, botChat: true })
    setSection('chats')
  }, [])
  // Picking a bot on the strip opens its newest chat (its Bot Chat, which the list leaves out, when
  // that's newer), or a new chat when it has none, so the open chat matches the list.
  const chooseProfile = useCallback(
    (next: string | null) => {
      setChatProfile(next)
      // Any change of profile closes the chat kept beside.
      if (next) setBeside(current => (current && !sameProfileAs(current.profile, next) ? null : current))
      if (!next) return
      const same = (name: string | undefined) => (name ?? 'default').toLowerCase() === next.toLowerCase()
      if (same(selected.profile)) return
      const newest = (listedRows ?? []).filter(row => same(row.profile)).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))[0]
      const bot = roster.bots?.find(b => same(b.name))
      if (bot?.botChatId && (bot.lastActive ?? 0) >= (newest?.activeAt ?? 0)) return openBot(bot)
      setSelected(newest ? { id: newest.id, profile: newest.profile, title: newest.title } : { id: null, profile: next })
    },
    [selected.profile, listedRows, roster.bots, openBot]
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
            !window.confirm(
              `${t('Delete {name}?', { name: bot.title })}\n\n${t("This permanently removes the bot's profile, chats, memory and skills from the gateway.")}`
            )
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
  const [openRoom, setOpenRoom] = useState<Room | null>(null)
  const showRoom = useCallback((room: Room) => {
    setOpenRoom(room)
    setSection('room')
  }, [])
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
  const needsCount = requests.length + waitingRows.length
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])
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

  // Calls from Hermes ring here too.
  const rings = useRings(connected, profiles)
  useCallPresence(connected && calling, selected.profile)
  const ring = rings.ringing.at(-1)
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
    // A miss is the iPhone's to report (it may still be answered there); a decline is the user's, from here.
    if (!missed) declineOnHost(call)
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
  // The backdrop glows in the open chat's agent's color, and elsewhere in the profile in use's.
  const glowOf = useGlowColors(glowBots, status.url ?? '')
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
  return (
    <GlowContext.Provider value={glowOf}>
      {ring ? <IncomingCall key={ring.id} ring={ring} onAnswer={() => answerRing(ring)} onDecline={missed => declineRing(ring, missed)} /> : null}
      {status.phase !== 'open' ? (
        <div className="banner" role="status">
          <span className="dot warn" />
          {status.phase === 'connecting'
            ? t('Connecting to Hermes…')
            : `${status.error ?? t('Not connected.')}${status.retryInSeconds ? ` ${t('Trying again in {seconds}s.', { seconds: status.retryInSeconds })}` : ''}`}
          {status.phase === 'reconnecting' ? <button onClick={() => void window.conduit.reconnect()}>{t('Try now')}</button> : null}
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
          <button
            className="railbtn"
            aria-label={t('Bots')}
            title={t('Bots')}
            aria-current={section === 'bots' || section === 'room' ? 'page' : undefined}
            onClick={() => setSection('bots')}
          >
            <Icon name="bots" />
          </button>
          <button
            className="railbtn"
            aria-label={t('Chats')}
            title={t('Chats')}
            aria-current={section === 'chats' ? 'page' : undefined}
            onClick={() => setSection('chats')}
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
        {section === 'chats' ? (
          <>
            {projectsOpen ? (
              <ProjectsPane
                profile={chatProfile}
                connected={connected}
                selectedId={chat.storedId ?? selected.id}
                onSelect={item => setSelected({ id: item.id, profile: item.profile ?? chatProfile ?? undefined, title: item.title })}
                onNewChat={folder => setSelected({ id: null, profile: chatProfile ?? undefined, folder })}
                onClose={() => setProjectsOpen(false)}
                isUnread={projectChatUnread}
                runningIds={runningIds}
              />
            ) : (
              <ChatList
                rows={listedRows}
                error={list.error}
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
                onPin={row => void chatAction(row, { pinned: !row.pinned })}
                onRename={(row, title) => void chatAction(row, { title })}
                marks={marks}
                onStar={row => updateMarks(current => toggleStar(current, row))}
                onToggleRead={toggleRead}
                isDone={chatDone.available ? isRowDone : undefined}
                onDone={chatDone.available ? chatDone.toggle : undefined}
                onDelete={row => {
                  if (window.confirm(`${t('Delete conversation?')}\n\n${t('This permanently deletes the conversation and cannot be undone.')}`))
                    void chatAction(row, null)
                }}
                onProjects={() => setProjectsOpen(true)}
                searchScope={markHost}
                onPinnedReplies={pins.length ? () => setPinSheet({ scope: 'all' }) : undefined}
                moveTargets={moveTargets}
                onMove={(row, target) => void moveToProject(row, target)}
              />
            )}
            <ColumnDivider label={t('Chat list width')} bounds={LIST_COLUMN} sign={1} width={listWidth} onLive={setListLive} onCommit={commitList} />
            <main className="chat" ref={chatPane}>
              <div className="chat-head">
                <div className="chat-titles">
                  {title ? <div className="chat-title">{title}</div> : null}
                  {openBotChat && work.snapshot && stripText(work.snapshot) ? (
                    <button
                      className={`chat-subtitle work-line${work.snapshot.needsYou ? ' needs' : ''}`}
                      aria-expanded={workOpen}
                      title={t('Shows this bot’s work')}
                      onClick={() => {
                        if (!workOpen) {
                          showFiles(false)
                          setArtifactsOpen(false)
                        }
                        setWorkOpen(!workOpen)
                      }}
                    >
                      {stripText(work.snapshot)}
                    </button>
                  ) : workItem && workBot ? (
                    <button
                      className="chat-subtitle"
                      title={t('Back to {bot}', { bot: workBot.title })}
                      onClick={() => {
                        if (workBot.botChatId) openBot(workBot)
                      }}
                    >
                      {t('{bot}’s work · {ref} · {status}', { bot: workBot.title, ref: workItem.ref, status: statusText(workItem) })}
                    </button>
                  ) : null}
                </div>
                <div className="chat-head-actions">
                  <select
                    className="chat-head-mode"
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
                  <button
                    className={`chat-head-button${calling ? ' on' : ''}`}
                    aria-label={calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(nextMode) })}
                    title={calling ? t('End call') : t('Voice call in {mode}', { mode: voiceModeTitle(nextMode) })}
                    disabled={!connected && !calling}
                    onClick={toggleCall}
                  >
                    <Icon name={calling ? 'phoneDown' : 'phone'} />
                  </button>
                  {selected.id ? (
                    <button
                      className={`chat-head-button${artifactsOpen ? ' active' : ''}`}
                      aria-label={t('In This Chat')}
                      aria-pressed={artifactsOpen}
                      title={t('In This Chat')}
                      onClick={() => {
                        if (!artifactsOpen) setWorkOpen(false)
                        setArtifactsOpen(!artifactsOpen)
                      }}
                    >
                      <Icon name="paperclip" />
                    </button>
                  ) : null}
                  {chat.cwd && (!filesOpen || artifactsOpen) ? (
                    <button
                      className="chat-head-button"
                      aria-label={t('Files')}
                      title={t('Files')}
                      onClick={() => {
                        setArtifactsOpen(false)
                        setWorkOpen(false)
                        showFiles(true)
                      }}
                    >
                      <Icon name="folder" />
                    </button>
                  ) : null}
                  {screenHosts[screenProfile] ? (
                    <button
                      className={`chat-head-button${screenOpen ? ' active' : ''}`}
                      aria-label={t("Bot's Screen")}
                      aria-pressed={screenOpen}
                      title={t("Bot's Screen")}
                      onClick={() => setScreenOpen(!screenOpen)}
                    >
                      <Icon name="screen" />
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
                    profile={selected.profile}
                    author={botTitle}
                    onQuote={setQuote}
                    onCommand={text => void onSend(text)}
                    teammates={glowBots}
                    display={chatDisplay}
                    sessionId={chat.liveId ?? undefined}
                    calls={chatCallList}
                    onOpenCall={setOpenCall}
                    followedUp={followedUp}
                    pins={pinControls}
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
              />
            ) : showWork ? (
              <WorkPanel
                profile={selected.profile}
                botName={workBot?.title ?? 'Hermes'}
                snapshot={work.snapshot}
                error={work.error}
                onReload={() => void work.reload()}
                onOpenChat={item => setSelected({ id: item.sessionId, profile: selected.profile, title: shownTitle(item) })}
                onClose={() => setWorkOpen(false)}
              />
            ) : filesOpen && chat.cwd ? (
              <FilesPanel
                root={chat.cwd}
                profile={selected.profile}
                refreshKey={turnsDone}
                reveal={reveal}
                onInsertPath={path => setQuote(quoteRequest({ insert: pathForDraft(path) }))}
                onClose={() => showFiles(false)}
              />
            ) : beside && besideFits ? (
              <BesideChatPane
                key={beside.id}
                chat={beside}
                sessionAuthority={status.sessionAuthority === true}
                connected={connected}
                author={roster.bots?.find(b => b.name === (beside.profile ?? 'default'))?.title ?? 'Hermes'}
                display={chatDisplay}
                onSwap={swapBeside}
                onClose={() => setBeside(null)}
              />
            ) : null}
          </>
        ) : section === 'bots' && newBot ? (
          <NewBot
            bots={[...(roster.bots ?? []), ...roster.hidden]}
            protocol={roster.protocol}
            onClose={() => setNewBot(false)}
            onCreated={(bot, introduce, warning) => {
              setNewBot(false)
              setBotNotice(warning)
              void roster.refresh()
              if (bot) {
                if (introduce) askBot(bot, t('Hey, tell me about yourself!'))
                else openBot(bot)
              }
            }}
          />
        ) : section === 'bots' && editingBot ? (
          <BotEditor key={editingBot.name} bot={editingBot} onClose={() => setEditingBot(null)} onSaved={() => void roster.refresh()} />
        ) : section === 'bots' ? (
          <BotsHome
            bots={roster.bots}
            error={roster.error}
            runningProfiles={runningProfiles}
            rooms={groupRooms.rooms}
            canStartRooms={groupRooms.capabilities?.supported === true && connected}
            onOpen={openBot}
            onAsk={askBot}
            onOpenRoom={showRoom}
            onCreateRoom={groupRooms.create}
            onEdit={connected ? setEditingBot : undefined}
            hidden={roster.hidden}
            onNewBot={connected ? () => setNewBot(true) : undefined}
            onAction={connected ? botAction : undefined}
            notice={botNotice}
            onDismissNotice={() => setBotNotice(null)}
            work={workByBot}
            onWork={bot => {
              openBot(bot)
              if (bot.botChatId) {
                showFiles(false)
                setWorkOpen(true)
              }
            }}
          />
        ) : section === 'tasks' ? (
          <Tasks
            bots={roster.bots}
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
          />
        ) : section === 'room' && openRoom ? (
          <RoomView
            key={openRoom.roomId}
            room={openRoom}
            bots={roster.bots ?? []}
            connected={connected}
            canStop={groupRooms.capabilities?.canStop === true}
            canAttach={groupRooms.capabilities?.attachments === true}
            canEditSettings={groupRooms.capabilities?.context === true}
            canContinueDiscussions={groupRooms.capabilities?.canContinue === true}
          />
        ) : section === 'needs' ? (
          <NeedsYou
            requests={requests}
            waiting={waitingRows}
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
            onAddHost={onAddHost}
            bots={(roster.bots ?? []).map(bot => ({ name: bot.name, title: bot.title }))}
            profile={selected.profile ?? 'default'}
            chatScale={chatScale}
            setChatScale={setChatScale}
            onShortcuts={() => setShortcutsOpen(true)}
            appsRequest={appsRequest}
            onAppsRequestTaken={() => setAppsRequest(null)}
          />
        )}
      </div>
      {shortcutsOpen ? <ShortcutsSheet onClose={closeShortcuts} /> : null}
    </GlowContext.Provider>
  )
}

function Settings({
  status,
  onAddHost,
  bots,
  profile,
  chatScale,
  setChatScale,
  onShortcuts,
  appsRequest,
  onAppsRequestTaken
}: {
  status: ConnectionStatus
  onAddHost: () => void
  bots: { name: string; title: string }[]
  profile: string
  chatScale: number
  setChatScale: (scale: number) => void
  onShortcuts: () => void
  appsRequest: AppsRequest | null
  onAppsRequestTaken: () => void
}) {
  const [notifications, setNotifications] = useState(notificationsEnabled)
  const [readAloudOn, setReadAloudOn] = useState(readsRepliesAloud)
  const [page, setPage] = useState<
    'main' | 'usage' | 'models' | 'capabilities' | 'memory' | 'workspace' | 'advanced' | 'chat' | 'plugin' | 'vault' | 'appearance'
  >('main')
  // The apps card's ask, taken once: Capabilities opens on Browse Apps with its picks.
  const [apps, setApps] = useState<AppsRequest | null>(null)
  useEffect(() => {
    if (!appsRequest) return
    setApps(appsRequest)
    setPage('capabilities')
    onAppsRequestTaken()
  }, [appsRequest, onAppsRequestTaken])
  if (page === 'usage')
    return (
      <main className="settings">
        <UsagePage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'models')
    return (
      <main className="settings">
        <ModelsPage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  if (page === 'appearance')
    return (
      <main className="settings">
        <AppearancePage onBack={() => setPage('main')} />
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
      <dl>
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
                    <span className="meta">{t('In use')}</span>
                  ) : (
                    <button className="link" onClick={() => void window.conduit.switchHost(host.url)}>
                      {t('Switch')}
                    </button>
                  )}
                  {host.url !== status.url ? (
                    <button
                      className="link danger"
                      onClick={() => {
                        if (window.confirm(t('Sign out of {host} on this computer?', { host: hostName(host.url) }))) {
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
        <AppLockSetting />
        <dt>{t('Models')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('models')}>
            {t('Chat model and helper models')}
          </button>
        </dd>
        <dt>{t('Chat')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('chat')}>
            {t('Response behavior, visibility, and timezone')}
          </button>
        </dd>
        <dt>{t('Workspace & safety')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('workspace')}>
            {t('Working directory, approvals, and privacy')}
          </button>
        </dd>
        <dt>{t('Memory & delegation')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('memory')}>
            {t('Memory, compression, and child agents')}
          </button>
        </dd>
        <dt>{t('Advanced')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('advanced')}>
            {t('Turn limits, terminal, and tool output')}
          </button>
        </dd>
        <dt>{t('Capabilities')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('capabilities')}>
            {t('Skills, tools, connectors, and plugins')}
          </button>
        </dd>
        <dt>{t('Conduit plugin')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('plugin')}>
            {t('Version, updates and what it does here')}
          </button>
        </dd>
        <dt>{t('Passwords & logins')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('vault')}>
            {t('Logins, cards and password managers Hermes signs in with')}
          </button>
        </dd>
        <dt>{t('Usage')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('usage')}>
            {t('Tokens, cost and provider quota')}
          </button>
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
        <dt>{t('Voice')}</dt>
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
            {t('Each reply in the open chat is read aloud with Hermes’ voice as it finishes. Calls speak their own replies.')}
          </p>
          <VoiceModeSettings profile={profile} />
        </dd>
        <dt>{t('Calls from Hermes')}</dt>
        <dd>
          <HermesCallSettings profile={profile} />
        </dd>
        <dt>{t('Last live call')}</dt>
        <dd>
          <LastCallTrace />
          <p className="meta">{t('The steps of the last Grok Live, Qwen Live, Local Live or GPT-Live call, without what was said, to paste into an issue.')}</p>
        </dd>
        <dt>{t('Last Read Aloud')}</dt>
        <dd>
          <LastCallTrace reading />
          <p className="meta">{t('How the last reply read aloud went: Hermes’ voice and playback, without the reply’s words, to paste into an issue.')}</p>
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
        <dt>{t('Appearance')}</dt>
        <dd>
          <button className="link" onClick={() => setPage('appearance')}>
            {t('Choose how Conduit appears across the app.')}
          </button>
        </dd>
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
        <dt>{t('Keyboard')}</dt>
        <dd>
          <button className="link" onClick={onShortcuts}>
            {t('Keyboard Shortcuts')}
          </button>
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
        <dt>{t('Connection')}</dt>
        <dd>
          {status.phase === 'open' ? t('Connected') : status.phase === 'connecting' ? t('Connecting…') : t('Not connected')}
          {status.phase === 'open' && status.sessionAuthority ? ` · ${t('session authority')}` : ''}
        </dd>
      </dl>
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
