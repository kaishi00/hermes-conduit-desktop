import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import type { PendingRequest } from '@shared/ipc'
import { VOICE_MODE_EVENT, setVoiceMode, voiceMode, type VoiceMode } from '../state/gptLive'
import { AFTER_CALL_STALL_MS, afterCallStep, afterFailedSend, callChatId, leftByCall, type AfterCall } from '../state/afterCall'
import { consented, isLive } from '../state/consent'
import type { CallResume } from '../state/voiceSave'
import type { CallTranscript } from '../state/voiceCalls'
import { dataUrlBlob, type CallPicture, type PictureKind, type PictureNote } from '../state/callPicture'
import { modelFrame, stageFile } from '../state/picture'
import { archiveClassicChat, tagVoiceSession } from '../state/voiceList'
import { useCallPresence } from '../state/rings'
import { lastReplyOf } from '../state/transcriptReads'
import { useTranscriptValue, type TranscriptStore } from '../state/transcriptStore'
import type { TranscriptItem } from '../state/transcript'
import type { StagedAttachment } from '../state/attachments'
import type { HeaderCall } from './ChatHeader'
import { VoiceModeCapsule } from './VoiceModeCapsule'
import { CallPictureControls } from './CallPictureControls'
import { ProviderConsentSheet } from './ProviderConsent'
import { GptLiveCall } from './GptLiveCall'
import { GeminiLiveCall } from './GeminiLiveCall'
import { GrokLiveCall } from './GrokLiveCall'
import { LocalLiveCall } from './LocalLiveCall'
import { VoiceCall } from './VoiceCall'

const NO_ITEMS: TranscriptItem[] = []

export interface ChatCallOptions {
  /** The chat's profile and stored id (null for a new chat, which a call's first message makes). */
  profile: string | undefined
  chatId: string | null
  liveId: string | null | undefined
  connected: boolean
  store: TranscriptStore
  running: boolean
  /** Counts the chat's finished turns, so the call hears each reply end. */
  turnsDone: number
  onStop: () => void
  /** Local Live's correction of what it heard, put in the chat's transcript. */
  onCorrected: (text: string, redirected?: boolean) => void
  /** A notice for the person: the main window's dialog, or a chat page's notice line. */
  tell: (message: string) => void
}

/** What the call's screen reads that the chat makes later in its render: its open requests and its send. */
export interface ChatCallView {
  requests: PendingRequest[]
  /** The chat's send: a call's words go as the user's, spoken, taking the chat over. */
  onSend: (text: string, attachments: StagedAttachment[], options: { takeOver?: boolean; spoken?: boolean }) => Promise<boolean | string | void>
}

export interface ChatCallState {
  calling: boolean
  /** The running call's mode (Classic after a live mode failed). */
  mode: VoiceMode
  /** The mode the next call takes, picked beside the call button or in Settings > Voice. */
  nextMode: VoiceMode
  /** Starts a call in the mode Settings > Voice has, or ends the one running. */
  toggle: () => void
  /** Starts a call in the mode Settings > Voice has (a wake phrase, a ring answered). */
  start: () => void
  end: () => void
  /** A saved call's Resume: a live call in its chat that continues it, on the mode picked now. */
  resume: (callId: string, call: CallTranscript) => void
  /** The Call pill's controls, for the chat's header. */
  header: HeaderCall
  /** The call's screen, drawn over the chat while it runs; null otherwise. */
  view: (late: ChatCallView) => ReactNode
}

/**
 * A chat's voice call, wherever the chat is drawn: the main window's chat
 * pane, or another combined dashboard's chat docked there, whose call runs in
 * its own page and so reads and sends through that dashboard (Eric,
 * 2026-11-22). Its mode, consent, a picture shown on it, Resume, Classic's
 * own chat filed under Voice, and the call presence its dashboard holds.
 * A call is the chat's: the caller ends it when another chat opens.
 */
export function useChatCall(options: ChatCallOptions): ChatCallState {
  const { profile, chatId, liveId, connected, store, running, turnsDone, onStop, onCorrected, tell } = options
  // The chat's send and requests as its last render drew the call (view below).
  const late = useRef<ChatCallView | null>(null)
  const [calling, setCalling] = useState(false)
  // The call's mode, read as it starts: Settings > Voice, or Classic after a GPT-Live call failed.
  const [callMode, setCallMode] = useState<VoiceMode>('classic')
  // A live mode asks once before sending the call to its company; Allow redraws with the call.
  const [, setConsentGiven] = useState(0)
  const asksConsent = calling && isLive(callMode) && !consented(callMode)
  // Resume call, from a saved call's card: a live call in its chat that continues it, on the mode picked now.
  const [resume, setResume] = useState<CallResume | null>(null)
  useEffect(() => {
    if (!calling) setResume(null)
  }, [calling])
  // The mode is set with the call, never a render later: a Classic call drawn first would open the microphone.
  const start = () => {
    setCallMode(voiceMode())
    setCalling(true)
  }
  const toggle = () => {
    if (!calling) setCallMode(voiceMode())
    setResume(null)
    setCalling(!calling)
  }
  const resumeCall = (callId: string, call: CallTranscript) => {
    setResume({ callId, turns: call.turns, from: call.count })
    setCallMode(voiceMode())
    setCalling(true)
  }
  // A call's mode menu, or the picker beside the call button during a call: Voice settings keep the
  // mode picked, and the call ends and starts again in it, in the same chat. Its own mode leaves it be.
  const switchMode = (mode: VoiceMode) => {
    setVoiceMode(mode)
    if (!calling || mode === callMode) return
    setResume(null)
    setCallMode(mode)
  }
  const modeMenu = <VoiceModeCapsule mode={callMode} onPick={switchMode} />
  // The mode the next call takes, picked beside the call button or in Settings > Voice.
  const [nextMode, setNextMode] = useState<VoiceMode>(voiceMode)
  useEffect(() => {
    const changed = () => setNextMode(voiceMode())
    window.addEventListener(VOICE_MODE_EVENT, changed)
    return () => window.removeEventListener(VOICE_MODE_EVENT, changed)
  }, [])

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
        tell(t('That file isn’t a picture Conduit can show.'))
        return
      }
      setCallPicture({ id, kind, attachment, frame })
      setPictureNote({ id, kind, change: 'shown', frame })
    } catch {
      tell(t('Conduit couldn’t load that picture. Try again.'))
    } finally {
      setPictureBusy(false)
    }
  }
  const screenshotForCall = async () => {
    setPictureBusy(true)
    const shot = await window.conduit.screenshot().catch(() => null)
    setPictureBusy(false)
    if (!shot) {
      tell(t('Conduit couldn’t capture the screen. On a Mac, allow Screen Recording for Conduit in System Settings, then try again.'))
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
  const sayToChat = async (words: string, fromCall: object): Promise<boolean> => {
    const picture = waitingPicture.current
    if (picture) {
      waitingPicture.current = null
      setCallPicture(null)
    }
    const send = late.current?.onSend
    if (!send) return false
    const sent = await send(words, picture ? [picture.attachment] : [], { takeOver: true, spoken: true }).catch(() => false as const)
    // A new chat the call made names itself in the answer: remember that id, not whatever
    // chat the user opened next (issue 550).
    // The send can resolve after this call ended: only its own generation may write the id.
    if (typeof sent === 'string' && callSent.current === fromCall) {
      sentCreated.current = sent
      setCreatedByCall(sent)
    }
    // The chat didn't open, or was left while it opened: the call says the words didn't go.
    if (sent === false) tell(t('That didn’t reach the chat. Try again.'))
    return sent !== false
  }
  // This call's own token: a send that resolves after the call ended can't write the next call's id.
  const callSent = useRef({})
  /** The id this call's own send created, when it created one. */
  const sentCreated = useRef<string | null>(null)
  // The same id as state: a Classic call files its chat once the send that made it has resolved, and
  // the chat can open before it does (desktop#529: a send still in flight never claims another chat).
  const [createdByCall, setCreatedByCall] = useState<string | null>(null)
  const callSay = (words: string) => void sayToChat(words, callSent.current)
  const pictureControls = (
    <CallPictureControls
      waiting={callPicture}
      busy={pictureBusy}
      onPick={file => void showPicture(file, 'picture')}
      onScreenshot={() => void screenshotForCall()}
      onRemove={removeCallPicture}
    />
  )

  // A chat a Classic call made (started with no chat open) is filed under Voice, and archived when the
  // call ends so Hermes Desktop's list keeps the chats people work in; the chat list shows it still.
  // Only a chat the call's own request made: never one opened while the call waited (desktop#538).
  const classicFresh = useRef<{ fresh: boolean; chat: { id: string; profile?: string } | null }>({ fresh: false, chat: null })
  useEffect(() => {
    const kept = classicFresh.current
    if (calling && callMode === 'classic') {
      if (!kept.fresh && !kept.chat && !chatId) kept.fresh = true
      if (kept.fresh && !kept.chat && chatId && chatId === createdByCall) {
        kept.chat = { id: chatId, profile }
        void tagVoiceSession(profile, chatId, 'classic').catch(() => undefined)
      }
      return
    }
    if (kept.chat) void archiveClassicChat(kept.chat.profile, kept.chat.id).catch(() => undefined)
    classicFresh.current = { fresh: false, chat: null }
  }, [calling, callMode, chatId, profile, createdByCall])

  // While a call runs here, its dashboard holds the user's call presence, so a call from Hermes doesn't ring over it.
  useCallPresence(connected && calling, profile)

  // A call's transcript and last reply: a call draws them as they stream, so only a call reads them every frame.
  const items = useTranscriptValue(store, state => (calling ? state.items : null)) ?? NO_ITEMS
  const lastReply = useTranscriptValue(store, state => (calling ? lastReplyOf(state.items) : null))

  // What a live call left unsent at hang-up goes once the chat is free (hermes-conduit issue 3185).
  const [left, setLeft] = useState<AfterCall | null>(null)
  // A call hands them over as it unmounts, with the callback it was first drawn with, so its chat is
  // kept here: the one it started in (with the id a new chat got from it), not the chat whose opening
  // ended the call.
  const callChat = useRef({ chatId, calling: false })
  if (calling && !callChat.current.calling) {
    callSent.current = {}
    sentCreated.current = null
    if (createdByCall !== null) setCreatedByCall(null)
  }
  callChat.current = { chatId: callChatId(callChat.current.chatId, callChat.current.calling, calling, chatId, sentCreated.current), calling }
  const callLeft = (requests: string[]) => setLeft(kept => leftByCall(kept, callChat.current.chatId, requests))
  // Drawn again once a send no reply followed has been waited on long enough.
  const [stallTick, setStallTick] = useState(0)
  useEffect(() => {
    const step = afterCallStep(left, { chatId, calling, running, turnsDone, at: Date.now() })
    if (step.left !== left) setLeft(step.left)
    if (step.send === undefined) {
      if (!step.left || step.left.sentWhen === null || calling || running) return
      const timer = window.setTimeout(() => setStallTick(tick => tick + 1), Math.max(0, step.left.sentWhen + AFTER_CALL_STALL_MS - Date.now()) + 50)
      return () => window.clearTimeout(timer)
    }
    // One the chat didn't take: the rest would wait on a reply that never comes, so they go with it.
    const sentFrom = step.left
    void sayToChat(step.send, callSent.current).then(sent => {
      if (!sent) setLeft(now => afterFailedSend(now, sentFrom))
    })
  }, [left, chatId, calling, running, turnsDone, stallTick])

  const end = () => setCalling(false)
  const view = (drawn: ChatCallView): ReactNode => {
    late.current = drawn
    const requests = drawn.requests
    const live = {
      modeMenu,
      pictureControls,
      pictureNote,
      profile,
      chatId,
      items,
      onSay: callSay,
      running,
      turnsDone,
      lastReply,
      onEnd: end,
      onLeft: callLeft,
      onClassic: () => setCallMode('classic'),
      requests,
      resume: resume ?? undefined
    }
    return asksConsent && isLive(callMode) ? (
      <ProviderConsentSheet mode={callMode} onAllow={() => setConsentGiven(n => n + 1)} onCancel={end} />
    ) : calling && callMode === 'gpt' ? (
      <GptLiveCall key={callMode} {...live} />
    ) : calling && (callMode === 'gemini' || callMode === 'qwen') ? (
      <GeminiLiveCall key={callMode} {...live} provider={callMode} />
    ) : calling && callMode === 'grok' ? (
      <GrokLiveCall key={callMode} {...live} />
    ) : calling && callMode === 'local' ? (
      <LocalLiveCall key={callMode} {...live} liveId={liveId} onCorrected={onCorrected} />
    ) : calling ? (
      <VoiceCall
        key={callMode}
        modeMenu={modeMenu}
        pictureControls={pictureControls}
        profile={profile}
        onSay={callSay}
        running={running}
        turnsDone={turnsDone}
        lastReply={lastReply}
        onStop={onStop}
        onEnd={end}
      />
    ) : null
  }

  return {
    calling,
    mode: callMode,
    nextMode,
    toggle,
    start,
    end,
    resume: resumeCall,
    header: { calling, mode: calling ? callMode : nextMode, disabled: !connected, onToggle: toggle, onMode: switchMode },
    view
  }
}
