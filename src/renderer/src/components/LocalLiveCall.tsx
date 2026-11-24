import { micStep, startCallTrace, type CallTrace } from '../state/callTrace'
import { CallLines } from './CallLines'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CALL_ME_WHEN_DONE, CallBacks, callbackScope, chatWork, jobWork, type CallWork } from '../state/callbacks'
import { language, t } from '@shared/i18n'
import type { PendingRequest } from '@shared/ipc'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import { gateway } from '../gateway'
import { askedQuestionsForCall } from '../state/askedForCalls'
import { PERSONALITY_PATH, NO_REPLY, personaText, replyPrompt, withProfile } from '../state/gptLive'
import { FUNCTION_TOOLS, audioAppend, decode, pcmSamples, responseCreate, textTurn } from '../state/grokLive'
import {
  ASK_THREAD,
  BAD_ARGUMENTS,
  END_CONVERSATION,
  NOTHING_TO_READ,
  NO_REQUEST,
  QUEUED,
  READ_LAST_REPLY,
  SENT,
  UNKNOWN_TOOL,
  chatContext,
  clockInstructions,
  liveInstructions,
  readReply,
  SHOW_ON_SCREEN,
  screenCard,
  withCard,
  type ScreenCard
} from '../state/liveCall'
import {
  ANSWERED_WITHOUT_HERMES,
  BUSY_LINE,
  FAILURE_LINE,
  KEEPALIVE,
  KEEPALIVE_MS,
  NEEDS_INPUT_LINE,
  ON_SCREEN_LINE,
  PLUGIN_MISSING,
  RESPONSE_CANCEL,
  READY_TIMED_OUT,
  READY_TIMEOUT_MS,
  SAMPLE_RATE,
  SOCKET_PATH,
  SpokenSplitter,
  approvalLine,
  deltaChunks,
  plainDecision,
  readinessCheck,
  readinessMarker,
  refusedLine,
  sessionUpdate,
  spokenChoice,
  spokenQuestion,
  stopsPlayback,
  turnDelta,
  turnDone,
  turnFrame,
  correctTurn,
  AGENT_INSTRUCTIONS,
  AGENT_LOOKUPS,
  STATUS_PATH,
  agentConfigure,
  agentFrame,
  frontModel,
  lateResultText,
  localLiveAgent,
  localLivePersona,
  toolResult,
  type AgentFrame
} from '../state/localLive'
import { ANSWER_APPROVAL, ANSWER_QUESTION, answerApproval, answerQuestion, openQuestion, requestUpdate } from '../state/liveRequests'
import { approvalView, clarifyQuestions } from '../state/needsYou'
import { newCallId, saveCall, type CallResume, type CallTurn } from '../state/voiceSave'
import { Icon } from './icons'
import { MicOrb } from './MicOrb'
import { spokenGreeting } from '../state/liveGreeting'
import { AskFirst, SEND_REQUEST, SET_ASK_FIRST, liveAsksFirst, switchedNote } from '../state/askFirst'
import { AskFirstButton } from './AskFirstButton'
import { CallCards } from './CallCards'
import { FIND_CHAT, READ_CHAT, chatFinder } from '../state/chatFinder'
import { pictureNoteText, type PictureNote } from '../state/callPicture'
import { CANCEL_JOB, INTERRUPT_JOB, LIST_JOBS, START_JOB, VoiceJobs, type VoiceJob } from '../state/voiceJobs'
import { dashboardProfilePath, dashboardProfileQuery } from '../state/dashboardProfile'
import { RECONNECT_ATTEMPTS, isRefusalClose, reconnectDelayMs } from '@shared/liveReconnect'
import { NO_PHONE_READS, loadPhoneReads, phoneTool, readPhone, type PhoneReads } from '../state/phoneReads'
import { ECHO_TAIL_MS, SpeakerGate, echoDelay, micLatency, talksOver } from '../state/speakerGate'

interface Props {
  profile?: string
  /** The chat's saved session, which keeps the call's transcript when it ends. */
  chatId?: string | null
  /** The chat's live session, which takes the user's corrections to the reply running there. */
  liveId?: string | null
  /** The chat's turns, whose newest reply is spoken as it is written. */
  items: TranscriptItem[]
  /** Sends a turn as the chat's next message. */
  onSay: (text: string) => void
  /** Shows words the call put into the running reply in the chat. */
  onCorrected?: (text: string) => void
  /** A reply is running in the chat. */
  running: boolean
  /** Counts the chat's finished turns: the next one after a send is its reply. */
  turnsDone: number
  /** The chat's newest reply. */
  lastReply: string | null
  onEnd: () => void
  /** The mode menu under the call's status, which moves the call to another mode. */
  modeMenu?: ReactNode
  /** Show a picture: the button on the call's row, and the waiting picture's chip. */
  pictureControls?: ReactNode
  /** A picture shown or taken off the call's chat, for the call to hear about (and Gemini and Qwen to see). */
  pictureNote?: PictureNote | null
  /** Ends this call and starts a Classic one in its place. */
  onClassic: () => void
  /** The approvals and questions the chat waits on, which a spoken yes, no or answer takes. */
  requests?: PendingRequest[]
  /** Resume call: the saved call this one continues, its id and turns. */
  resume?: CallResume
}

type Phase = 'starting' | 'reconnecting' | 'listening' | 'speaking' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  item?: string | null
  text: string
  open: boolean
}

/** A turn Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
const SILENCE = new Float32Array(Math.round(SAMPLE_RATE * 0.8))
/** Agent mode: Conduit's own updates wait this long after the user last spoke. */
const USER_QUIET_MS = 2000
/** Saying goodbye: the call closes once the audio has played out, or after this at most. */
const END_GRACE_MS = 1000
const END_TIMEOUT_MS = 8000

/** The reply the call follows, from its send until its turn ends. */
interface Follow {
  /** The turn ends once the chat has finished this many turns. */
  until: number
  at: number
  started: boolean
  /** Assistant items the chat had before the send: not this reply's. */
  before: Set<string>
  /** What of each of this reply's items was spoken. */
  spoken: Map<string, string>
}

/**
 * A Local Live call in the open chat, after the phone's Local Live: you talk
 * through your own speech server, everything you say goes to Hermes as the
 * chat's next message, and Hermes' reply is spoken by that server as it is
 * written. Audio goes both ways as 24 kHz PCM over the plugin's relay, which
 * hands Conduit each turn the server asks for.
 */
export function LocalLiveCall({
  profile,
  chatId,
  liveId,
  items,
  onSay,
  onCorrected,
  running,
  turnsDone,
  lastReply,
  onEnd,
  modeMenu,
  pictureControls,
  pictureNote,
  onClassic,
  requests = [],
  resume
}: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [problem, setProblem] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  // Local Live's agent instructions' parts, built again for each connection.
  // What the user's phone lets Local Live read (phoneReads), asked as an agent call starts.
  const phoneRef = useRef<PhoneReads>(NO_PHONE_READS)
  const agentWith = useRef<Parameters<typeof liveInstructions>[0] | null>(null)
  // Agent mode's asking first: the call's held request and its switch, starting as Settings say.
  const askFirst = useRef(new AskFirst(liveAsksFirst()))
  const [asking, setAsking] = useState(askFirst.current.on)
  const [agentMode, setAgentMode] = useState(false)
  // The microphone, for the orb's level.
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [cards, setCards] = useState<ScreenCard[]>([])
  const cardId = useRef(0)
  const finder = useRef(chatFinder(profile))
  const [jobList, setJobList] = useState<VoiceJob[]>([])
  const jobs = useRef<VoiceJobs | null>(null)
  // "Call me when it's done": the call's jobs and its request in the chat, as they run.
  const callbacks = useRef<CallBacks | null>(null)
  const chatRequest = useRef<CallWork | null>(null)
  const syncWork = () => callbacks.current?.sync([...(jobs.current?.jobs ?? []).map(jobWork), ...(chatRequest.current ? [chatRequest.current] : [])])
  // The call's background jobs: a settled one is told at the next quiet moment.
  useEffect(() => {
    const asked = new CallBacks(profile, note => {
      if (!ended.current) updates.current.push(note)
    })
    callbacks.current = asked
    const kept = new VoiceJobs(
      profile,
      list => (setJobList(list), syncWork()),
      notice => {
        if (!ended.current) updates.current.push(notice)
      }
    )
    jobs.current = kept
    // Jobs an earlier call in this chat left come back; this call's are kept with it.
    kept.keepWith(chatId)
    return () => {
      kept.dispose()
      void asked.hangUp()
    }
  }, [])

  const socket = useRef<string | null>(null)
  // The steps Diagnostics shows for the last call: kinds and levels, never words.
  const trace = useRef<CallTrace | null>(null)
  const context = useRef<AudioContext | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const sources = useRef(new Set<AudioBufferSourceNode>())
  const playUntil = useRef(0)
  // The microphone on the speakers: closed while the server's reply arrives and plays.
  const gate = useRef<SpeakerGate>(null!)
  gate.current ??= new SpeakerGate(talksOver())
  const echo = useRef(0)
  /** The words shown of the reply now arriving. */
  const shown = useRef('')
  const ended = useRef(false)
  const ready = useRef(false)
  // The greeting goes once per call, never on a reconnect's check.
  const greeted = useRef(false)
  const mutedRef = useRef(false)
  const lineId = useRef(0)
  // The readiness check: its marker, and whether its (unspoken) response is still going.
  const marker = useRef<string | null>(null)
  const checking = useRef(false)
  // The plugin's open turn, and the Hermes reply it speaks.
  const turn = useRef<{ id: string; spoke: boolean } | null>(null)
  const follow = useRef<Follow | null>(null)
  const splitter = useRef(new SpokenSplitter())
  const told = useRef(new Set<string>())
  // Agent mode: the fast model's instructions, and the conversation's state for when Conduit may speak up.
  const agent = useRef<string | null>(null)
  const ending = useRef(false)
  const responding = useRef(false)
  const wantsResponse = useRef(false)
  const userSpeaking = useRef(false)
  const userSpokeAt = useRef(0)
  const updates = useRef<string[]>([])
  const queue = useRef<string[]>([])
  const active = useRef<{ from: number; at: number; started: boolean } | null>(null)
  const answered = useRef(new Set<string>())
  // A dropped connection opens a new session, as on the phone; a call from the old one can't be answered on it.
  const connection = useRef(0)
  const attempt = useRef(0)
  const callConnection = useRef(new Map<string, number>())
  // Answers the fast model may have stopped waiting for, by call: said as an update when the plugin says so.
  const answers = useRef(new Map<string, { name: string; result: Record<string, string> }>())
  const live = useRef({ items, running, turnsDone, lastReply, onSay, onCorrected, chatId, requests, liveId })
  live.current = { items, running, turnsDone, lastReply, onSay, onCorrected, chatId, requests, liveId }
  // The call's finished turns, kept with the chat when it ends.
  const record = useRef<CallTurn[]>([])
  const callId = useRef(resume?.callId ?? newCallId())
  const resumed = useRef(resume)
  const saved = useRef(false)
  const keep = (role: CallTurn['role'], text: string) => text.trim() && record.current.push({ role, text: text.trim(), at: Date.now() / 1000 })
  const save = () => {
    if (saved.current) return
    saved.current = true
    void saveCall(profile, callId.current, 'local-live', record.current, live.current.chatId, resumed.current?.from ?? 0)
  }

  const send = (message: Record<string, unknown>) => {
    if (socket.current) window.conduit.liveSend(socket.current, JSON.stringify(message))
  }

  const playing = () => (context.current ? context.current.currentTime < playUntil.current : false)

  const stopPlayback = () => {
    for (const source of sources.current) {
      try {
        source.stop()
      } catch {
        // Already ended.
      }
    }
    sources.current.clear()
    playUntil.current = 0
  }

  const play = (pcm: string) => {
    const ctx = context.current
    if (!ctx) return
    const samples = pcmSamples(pcm)
    if (!samples.length) return
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + 0.02, playUntil.current)
    source.start(at)
    playUntil.current = at + buffer.duration
    sources.current.add(source)
    source.onended = () => sources.current.delete(source)
  }

  const teardown = () => {
    save()
    if (socket.current) window.conduit.liveClose(socket.current)
    socket.current = null
    processor.current?.disconnect()
    processor.current = null
    mic.current?.getTracks().forEach(track => track.stop())
    mic.current = null
    setMicStream(null)
    stopPlayback()
    void context.current?.close().catch(() => undefined)
    context.current = null
  }

  const fail = (message: string) => {
    if (ended.current) return
    ended.current = true
    trace.current?.end('failed')
    teardown()
    setProblem(message)
    setPhase('failed')
  }

  const finish = () => {
    if (!ended.current) {
      ended.current = true
      trace.current?.end('the call ended')
      teardown()
    }
    onEnd()
  }

  const userLine = (item: string | null, text: string, final: boolean) =>
    setLines(current => {
      const index = item ? current.findIndex(line => line.who === 'user' && line.item === item) : -1
      if (index >= 0) {
        const next = [...current]
        next[index] = { ...next[index]!, text, open: !final }
        return next
      }
      const closed = current.map(line => (line.open && line.who === 'assistant' ? { ...line, open: false } : line))
      return [...closed, { id: ++lineId.current, who: 'user' as const, item, text, open: !final }].slice(-8)
    })

  const assistantLine = (text: string, whole = false) =>
    setLines(current => {
      const index = current.findLastIndex(line => line.open && line.who === 'assistant')
      if (index >= 0) {
        const next = [...current]
        next[index] = { ...next[index]!, text: whole ? text : next[index]!.text + text, open: !whole }
        return next
      }
      if (whole && current.at(-1)?.who === 'assistant' && current.at(-1)?.text === text) return current
      return [...current, { id: ++lineId.current, who: 'assistant' as const, text, open: !whole }].slice(-8)
    })

  // MARK: Agent mode

  // A response waits while one is running: it goes once that one is done.
  const respond = () => {
    if (responding.current) wantsResponse.current = true
    else {
      responding.current = true
      send(responseCreate())
    }
  }

  // Closes once the goodbye has played out, or at the timeout.
  const endCall = () => {
    if (ending.current) return
    ending.current = true
    const started = Date.now()
    const check = () => {
      if (ended.current) return
      if (Date.now() - started > END_TIMEOUT_MS || (!playing() && !responding.current)) {
        window.setTimeout(() => !ended.current && finish(), END_GRACE_MS)
        return
      }
      window.setTimeout(check, 250)
    }
    window.setTimeout(check, 250)
  }

  // The next request goes to the chat once it's free.
  const pump = () => {
    if (active.current || live.current.running || ending.current) return
    const next = queue.current.shift()
    if (!next) return
    active.current = { from: live.current.turnsDone, at: Date.now(), started: false }
    live.current.onSay(next)
    chatRequest.current = chatWork(live.current.chatId, next, active.current.at)
    syncWork()
  }

  const answer = (id: string, name: string, result: Record<string, string>, speak = false) => {
    if ((callConnection.current.get(id) ?? connection.current) !== connection.current) return void trace.current?.step('Tool answer dropped: its connection was replaced')
    trace.current?.step(`Tool answered: ${result.status ?? 'ok'}`)
    if (speak) answers.current.set(id, { name, result })
    send(toolResult(id, result, speak))
  }

  // A request for the chat: it goes once the chat is free.
  const toChat = (request: string) => {
    const waits = !!active.current || live.current.running
    queue.current.push(request)
    pump()
    return waits ? QUEUED : SENT
  }

  const toolCall = (event: Extract<AgentFrame, { type: 'toolCall' }>) => {
    if (answered.current.has(event.id)) return
    answered.current.add(event.id)
    callConnection.current.set(event.id, connection.current)
    trace.current?.step(`Tool call: ${event.name}`)
    if (event.args.invalid_arguments) return answer(event.id, event.name, BAD_ARGUMENTS)
    switch (event.name) {
      case ASK_THREAD: {
        const request = (event.args.request ?? '').trim()
        if (!request) return answer(event.id, event.name, NO_REQUEST)
        const held = askFirst.current.hold(ASK_THREAD, request)
        if (held) return answer(event.id, event.name, held)
        return answer(event.id, event.name, toChat(request))
      }
      case SEND_REQUEST:
        void askFirst.current.release().then(release => {
          if (ended.current) return
          if (!release.send) return answer(event.id, event.name, release.result, true)
          if (release.tool === ASK_THREAD) return answer(event.id, event.name, toChat(release.request), true)
          void jobs.current?.start(release.request).then(result => !ended.current && answer(event.id, event.name, result, true))
        })
        return
      case SET_ASK_FIRST: {
        const result = askFirst.current.setMode(event.args.mode)
        setAsking(askFirst.current.on)
        return answer(event.id, event.name, result)
      }
      case CALL_ME_WHEN_DONE:
        void (callbacks.current?.request(callbackScope(event.args)) ?? Promise.resolve({ status: 'unavailable', message: 'Not in a call.' })).then(
          result => !ended.current && answer(event.id, event.name, result, true)
        )
        return
      case START_JOB: {
        const held = askFirst.current.hold(START_JOB, (event.args.instructions ?? '').trim())
        if (held) return answer(event.id, event.name, held)
        void jobs.current?.start(event.args.instructions ?? '').then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      }
      case LIST_JOBS: {
        const result = jobs.current?.list() ?? { summary: 'No background jobs are running.' }
        return answer(event.id, event.name, result, true)
      }
      case CANCEL_JOB:
        void jobs.current?.cancel(event.args.job_id).then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      case INTERRUPT_JOB:
        void (jobs.current?.followUp(event.args.job_id ?? '', event.args.message ?? '') ?? Promise.resolve({ status: 'error', error: 'No jobs.' })).then(
          result => !ended.current && answer(event.id, event.name, result, true)
        )
        return
      case FIND_CHAT:
        void finder.current.find(event.args.query ?? '').then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      case READ_CHAT:
        void finder.current.read(event.args.number ?? '').then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      case SHOW_ON_SCREEN: {
        const { card, result } = screenCard(event.args, ++cardId.current)
        if (card) setCards(current => withCard(current, card))
        return answer(event.id, event.name, result, true)
      }
      case READ_LAST_REPLY: {
        const reply = live.current.lastReply?.trim()
        return answer(event.id, event.name, reply ? readReply(reply) : NOTHING_TO_READ)
      }
      case ANSWER_APPROVAL:
        void answerApproval(live.current.requests, event.args.choice ?? '').then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      case ANSWER_QUESTION:
        void answerQuestion(live.current.requests, event.args.answer ?? '').then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      case END_CONVERSATION:
        answer(event.id, event.name, { status: 'ending' })
        return endCall()
      default: {
        // One of the phone's reads the user lets Local Live make; the fast model speaks from its answer.
        const tool = phoneTool(phoneRef.current, event.name)
        if (!tool) return answer(event.id, event.name, UNKNOWN_TOOL)
        void readPhone(profile, 'local-live', tool, event.args).then(result => !ended.current && answer(event.id, event.name, result, true))
        return
      }
    }
  }

  const onAgentFrame = (frame: AgentFrame) => {
    if (frame.type === 'toolCall') return toolCall(frame)
    // The fast model stopped waiting: its answer is said as an update.
    const kept = answers.current.get(frame.id)
    if (!kept) return
    answers.current.delete(frame.id)
    updates.current.push(lateResultText(kept.name, kept.result))
  }

  // MARK: Turns

  // What the open turn said so far ends a line (or nothing was said yet).
  const endedLine = useRef(true)

  /** Words for the open turn, without blank lines: a line break ends a sentence for the server. */
  const delta = (id: string, text: string) => {
    let words = text.replace(/[ \t]*\n[\s]*/g, '\n')
    if (endedLine.current) words = words.replace(/^\s+/, '')
    if (!words) return
    endedLine.current = words.endsWith('\n')
    for (const chunk of deltaChunks(words)) send(turnDelta(id, chunk))
  }

  /** A line of the call's own after what the turn said. */
  const line = (id: string, text: string) => delta(id, `${endedLine.current ? '' : '\n'}${text}`)

  const closeTurn = (id: string) => {
    splitter.current = new SpokenSplitter()
    endedLine.current = true
    turn.current = null
    send(turnDone(id))
  }

  /** Hermes' words, as they come, into the open turn. */
  const speak = (text: string) => {
    const current = turn.current
    if (!current || !text) return
    current.spoke = true
    const spoken = splitter.current.feed(text)
    if (spoken) delta(current.id, spoken)
  }

  /** Ends the open turn: what was held is said, and the screen's part named. */
  const endTurn = () => {
    const current = turn.current
    if (!current) return
    const rest = splitter.current.finish()
    if (rest) delta(current.id, rest)
    if (splitter.current.leftOut) line(current.id, ON_SCREEN_LINE())
    closeTurn(current.id)
  }

  /** A line of the call's own in place of the rest of Hermes' reply. */
  const say = (id: string, text: string) => {
    if (turn.current?.id !== id) return
    turn.current.spoke = true
    if (text) line(id, text)
    closeTurn(id)
  }

  const assistantItems = () => live.current.items.filter((item): item is Extract<TranscriptItem, { kind: 'assistant' }> => item.kind === 'assistant')

  /** Follows the reply running now: only what it writes from here on is spoken. */
  const followRunning = () => {
    const before = new Set<string>()
    const spoken = new Map<string, string>()
    for (const item of assistantItems()) {
      if (item.streaming) spoken.set(item.key, item.text)
      else before.add(item.key)
    }
    follow.current = { until: live.current.turnsDone + 1, at: Date.now(), started: live.current.running, before, spoken }
  }

  /** Hermes took the user's answer: the reply it goes on with is spoken in this turn. */
  const goOn = (id: string) => {
    if (!live.current.running) return say(id, '')
    if (!follow.current) followRunning()
  }

  /** The words of a turn the server asks for: an answer to what waits, or the chat's next message. */
  const runTurn = async (id: string, words: string) => {
    if (!words) return say(id, '')
    const waiting = live.current.requests
    // A plain yes or no to the approval Hermes waits on: it goes on, and its reply is spoken in this turn.
    const approval = waiting.find(r => r.method === 'approval')
    const decision = approval ? plainDecision(words) : null
    if (approval && decision) {
      const result = await answerApproval(waiting, decision)
      if (ended.current || turn.current?.id !== id) return
      if (result.status === 'sent') return goOn(id)
    } else if (approval) {
      // Anything else while it waits: the call says again what it waits on.
      const view = approvalView(approval.params)
      return say(id, approvalLine(view.description || view.command || ''))
    }
    // The answer to the question Hermes asks: its next question is read out, or its reply goes on here.
    const clarify = waiting.find(r => r.method === 'clarify' && openQuestion(r))
    if (clarify) {
      const result = await answerQuestion(waiting, spokenChoice(words))
      if (ended.current || turn.current?.id !== id) return
      if (result.status === 'answered') {
        const next = openQuestion(clarify)
        if (next) return say(id, spokenQuestion(next, clarifyQuestions(clarify.params).length > 1))
        return goOn(id)
      }
    }
    // The user spoke again while Hermes was still on the call's last turn: the words go into that reply.
    const sessionId = live.current.liveId
    if (follow.current && live.current.running && sessionId) {
      const correction = await correctTurn(sessionId, words, profile)
      if (ended.current || turn.current?.id !== id) return
      if (correction !== 'rejected') {
        // What the reply said before the user cut in isn't said again; Hermes' words from here are this turn's.
        live.current.onCorrected?.(words)
        const queued = correction === 'queued'
        followRunning()
        if (queued && follow.current) follow.current.until += 1
        return
      }
      // The reply ended meanwhile: the words are a turn of their own.
      follow.current = null
    }
    // Hermes is on a turn the call didn't send (typed, or from another device): the chat can't take another yet.
    if (live.current.running || follow.current) return say(id, BUSY_LINE())
    const before = new Set(assistantItems().map(item => item.key))
    follow.current = { until: live.current.turnsDone + 1, at: Date.now(), started: false, before, spoken: new Map() }
    live.current.onSay(words)
  }

  const onTurn = (id: string, text: string) => {
    const words = text.trim()
    // The readiness check's ask: answered with nothing, so the server says nothing.
    if (marker.current && words === marker.current) {
      // The greeting, once per call, is the check's answer: the server reads it as written, and it's the cue to talk.
      const greeting = greeted.current ? null : spokenGreeting()
      if (greeting) {
        greeted.current = true
        checking.current = false
        trace.current?.step("Greeting sent as the check's answer")
        for (const chunk of deltaChunks(greeting)) send(turnDelta(id, chunk))
      }
      send(turnDone(id))
      if (!ready.current) becomeReady()
      return
    }
    checking.current = false
    // The plugin cancels a turn before sending the next: whatever was open has nobody waiting.
    turn.current = { id, spoke: false }
    splitter.current = new SpokenSplitter()
    endedLine.current = true
    void runTurn(id, words).catch(() => say(id, FAILURE_LINE()))
  }

  // MARK: Readiness

  const startCheck = () => {
    const words = readinessMarker()
    marker.current = words
    checking.current = true
    send(readinessCheck(words))
  }

  const becomeReady = () => {
    attempt.current = 0
    if (ready.current) return
    ready.current = true
    trace.current?.step(agent.current ? 'Session ready (agent mode, server VAD)' : 'Session ready (Hermes answers each turn, server VAD)')
    setPhase('listening')
    // A server that never ends the check's response mustn't hide the call's own replies.
    window.setTimeout(() => (checking.current = false), 5000)
  }

  // MARK: The server's frames

  const onFrame = (text: string) => {
    const tool = agent.current ? agentFrame(text) : null
    if (tool) return onAgentFrame(tool)
    const frame = turnFrame(text)
    if (frame) {
      if (frame.type === 'turn') onTurn(frame.id, frame.text)
      else if (turn.current?.id === frame.id) {
        turn.current = null
        splitter.current = new SpokenSplitter()
      }
      return
    }
    if (!checking.current && stopsPlayback(text)) {
      stopPlayback()
      gate.current.replyEnded()
    }
    const event = decode(text)
    if (!event) return
    switch (event.type) {
      case 'ready':
        if (!marker.current) startCheck()
        return
      case 'error':
        trace.current?.step(marker.current ? 'Server error' : 'Server refused the setup')
        // Before the session is set up, the server refused it; a server that can't take the check goes ready anyway.
        if (!marker.current) return fail(refusedLine(event.message))
        if (!ready.current) {
          checking.current = false
          becomeReady()
        }
        return
      case 'responseStarted':
        if (checking.current) return
        responding.current = true
        gate.current.replyStarted()
        return
      case 'responseDone':
        if (checking.current) {
          checking.current = false
          // The check's response ended without its ask reaching this call: the server's model isn't Hermes here.
          if (!ready.current) fail(ANSWERED_WITHOUT_HERMES())
          return
        }
        responding.current = false
        gate.current.replyEnded()
        if (wantsResponse.current) {
          wantsResponse.current = false
          respond()
        }
        return
      case 'speechStarted':
        userSpeaking.current = true
        userSpokeAt.current = Date.now()
        trace.current?.speechStarted()
        stopPlayback()
        gate.current.replyEnded()
        return
      case 'speechStopped':
        trace.current?.speechStopped()
        userSpeaking.current = false
        userSpokeAt.current = Date.now()
        return
      case 'input':
        userSpokeAt.current = Date.now()
        askFirst.current.heard(event.text, true)
        userLine(event.itemId, event.text, event.final)
        if (event.final) keep('user', event.text)
        return
      case 'audio':
        if (!checking.current && !ended.current && gate.current.audio(responding.current)) play(event.pcm)
        return
      case 'output':
        askFirst.current.modelSpoke()
        if (checking.current || !gate.current.words(responding.current)) return
        shown.current += event.text
        assistantLine(event.text)
        return
      case 'outputDone': {
        if (checking.current) return
        const heard = shown.current
        shown.current = ''
        // Interrupted: the line and the saved call keep what was heard of it, not the words nobody played.
        if (gate.current.dropped) {
          keep('assistant', heard)
          setLines(current => current.map(line => (line.open && line.who === 'assistant' ? { ...line, open: false } : line)))
          return
        }
        keep('assistant', event.text)
        assistantLine(event.text, true)
        return
      }
      default:
        return
    }
  }

  // Shows speaking while the server's audio plays.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ended.current || !ready.current) return
      const speaking = playing() || gate.current.replying
      setPhase(current => (current === 'failed' ? current : speaking ? 'speaking' : 'listening'))
      // Agent mode: Hermes' replies and what it waits on go to the fast model once the conversation is quiet.
      const quiet = !responding.current && !speaking && !userSpeaking.current && Date.now() - userSpokeAt.current > USER_QUIET_MS
      if (agent.current && quiet && !ending.current && !turn.current && updates.current.length) {
        send(textTurn(updates.current.shift()!))
        respond()
      }
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let readyTimer = 0
    let keepalive = 0
    const stopListening = window.conduit.onLive(event => {
      if (event.id !== socket.current) return
      if (event.type === 'open') {
        trace.current?.step('Socket open, setup sent')
        // Told asking first as the call's switch is now, a reconnect included.
        if (agent.current) send(agentConfigure(agentWith.current ? liveInstructions({ ...agentWith.current, asksFirst: askFirst.current.on }) : agent.current, [
            ...FUNCTION_TOOLS,
            ...phoneRef.current.tools.map(tool => ({ type: 'function', ...tool }))
          ]))
        send(sessionUpdate())
      } else if (event.type === 'message') onFrame(event.data)
      else if (event.type === 'close') {
        socket.current = null
        trace.current?.step(`Socket closed (${event.code ?? 'no code'})`)
        if (ended.current) return
        if (!isRefusalClose(event.code, event.reason)) {
          // A live call that dropped opens a new session at once; a setup that failed is tried again after a pause.
          if (ready.current) return void reopen(0)
          if (attempt.current < RECONNECT_ATTEMPTS && connection.current > 0) return void retryAfter(attempt.current)
        }
        const reason = event.reason.trim() || (event.code === 1000 || event.code === 1005 ? '' : String(event.code))
        if (!ready.current) fail(refusedLine(reason))
        else fail(reason ? refusedLine(reason) : t('The connection to Hermes dropped.'))
      }
    })
    const openSocket = async (): Promise<boolean> => {
      trace.current?.step('Opening the socket')
      const opened = await window.conduit.liveOpen(SOCKET_PATH, dashboardProfileQuery(profile))
      if (!opened.ok) {
        trace.current?.step('The socket did not open')
        if (attempt.current < RECONNECT_ATTEMPTS && connection.current > 0) return retryAfter(attempt.current), false
        fail(/\b404\b/.test(opened.error) ? PLUGIN_MISSING() : t('Could not open the Local Live connection.'))
        return false
      }
      if (ended.current) {
        window.conduit.liveClose(opened.id)
        return false
      }
      socket.current = opened.id
      window.clearTimeout(readyTimer)
      readyTimer = window.setTimeout(() => {
        if (!ready.current) fail(READY_TIMED_OUT())
      }, READY_TIMEOUT_MS)
      return true
    }
    // A new connection, and so a new session: what the old one was saying stops, and the new one is checked again.
    const reopen = (next: number) => {
      if (ended.current) return
      attempt.current = next
      connection.current += 1
      marker.current = null
      checking.current = false
      if (ready.current) {
        ready.current = false
        responding.current = false
        stopPlayback()
        gate.current.replyEnded()
        setPhase('reconnecting')
        trace.current?.step('Connection lost: opening a new session')
      }
      void openSocket()
    }
    const retryAfter = (failed: number) => {
      window.clearTimeout(readyTimer)
      trace.current?.step(`Setup failed: trying again in ${reconnectDelayMs(failed) / 1000} s`)
      window.setTimeout(() => !ended.current && reopen(failed + 1), reconnectDelayMs(failed))
    }
    const connect = async () => {
      trace.current = startCallTrace('Local Live')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        trace.current.step(micStep(stream))
        mic.current = stream
        setMicStream(stream)
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        context.current = ctx
        if (localLiveAgent()) {
          // Agent mode when the host has a fast model; without one, Hermes answers each turn.
          const status = await gateway.http('GET', dashboardProfilePath(STATUS_PATH, profile), undefined, 30_000).catch(() => null)
          if (frontModel(status)?.available) {
            const persona = localLivePersona() ? await gateway.http('GET', withProfile(PERSONALITY_PATH, profile)).then(personaText, () => '') : ''
            const turns = live.current.items.flatMap((item): { role: 'user' | 'assistant'; text: string }[] =>
              item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
            )
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
            const [asked, phoneReads] = await Promise.all([askedQuestionsForCall(profile), loadPhoneReads(profile, 'local-live')])
            phoneRef.current = phoneReads
            setAgentMode(true)
            agentWith.current = {
              lookups: AGENT_LOOKUPS,
              announces: false,
              extra: AGENT_INSTRUCTIONS + clockInstructions(new Date(), timeZone),
              language: language(),
              persona,
              asked,
              chat: chatContext(resumed.current?.turns ?? turns, !!resumed.current),
              phoneNow: phoneReads.context,
              phoneTools: phoneReads.tools
            }
            agent.current = liveInstructions(agentWith.current)
          }
          if (ended.current) return
        }
        if (!(await openSocket())) return
        const source = ctx.createMediaStreamSource(stream)
        const node = ctx.createScriptProcessor(2048, 1, 1)
        processor.current = node
        echo.current = echoDelay(ctx, micLatency(stream), node.bufferSize / ctx.sampleRate)
        trace.current?.step(
          gate.current.talkOver
            ? 'Microphone open while a reply plays (talk over it on the speaker)'
            : `Microphone closed while a reply arrives and plays, and ${Math.round(echo.current * 1000 + ECHO_TAIL_MS)} ms after`
        )
        node.onaudioprocess = event => {
          if (!ready.current || ended.current || mutedRef.current) return
          // While the server talks on the speakers, its own voice isn't sent back.
          if (gate.current.holds(ctx, playUntil.current, echo.current)) return
          const samples = event.inputBuffer.getChannelData(0)
          trace.current?.audio(samples, SAMPLE_RATE)
          send(audioAppend(samples))
        }
        source.connect(node)
        node.connect(ctx.destination)
        keepalive = window.setInterval(() => send(KEEPALIVE), KEEPALIVE_MS)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
          fail(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
        else if (e instanceof DOMException && e.name === 'NotFoundError') fail(t('No microphone found.'))
        else fail(message)
      }
    }
    void connect()
    return () => {
      window.clearTimeout(readyTimer)
      window.clearInterval(keepalive)
      stopListening()
      ended.current = true
      teardown()
    }
  }, [])

  // The followed reply: its new words are spoken as they're written, and its end ends the turn.
  useEffect(() => {
    const current = follow.current
    if (!current || ended.current) return
    if (running) current.started = true
    for (const item of items) {
      if (item.kind !== 'assistant' || current.before.has(item.key)) continue
      const said = current.spoken.get(item.key)
      if (said === undefined) {
        // A new paragraph of the reply, after a tool ran.
        if (current.spoken.size) speak('\n')
        current.spoken.set(item.key, item.text)
        speak(item.text)
      } else if (item.text.length > said.length && item.text.startsWith(said)) {
        current.spoken.set(item.key, item.text)
        speak(item.text.slice(said.length))
      }
    }
    if (!running && turnsDone >= current.until) {
      follow.current = null
      // A reply whose words never streamed is said whole.
      if (turn.current && !turn.current.spoke && lastReply?.trim()) speak(lastReply)
      endTurn()
      return
    }
    if (running || current.started) return
    // Never started (the chat refused it): let it go, so the call isn't stuck.
    const timer = window.setTimeout(() => {
      if (follow.current === current && !current.started) {
        follow.current = null
        if (turn.current) say(turn.current.id, FAILURE_LINE())
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [items, running, turnsDone, lastReply])

  // Agent mode: a request's reply is told once its turn ends, then the next request goes.
  useEffect(() => {
    const current = active.current
    if (!current || ended.current) return
    if (running) {
      current.started = true
      return
    }
    if (turnsDone !== current.from) {
      active.current = null
      chatRequest.current = null
      syncWork()
      updates.current.push(lastReply?.trim() ? replyPrompt(lastReply) : NO_REPLY)
      pump()
      return
    }
    const timer = window.setTimeout(() => {
      if (active.current === current && !current.started) {
        active.current = null
        chatRequest.current = null
        syncWork()
        updates.current.push(NO_REPLY)
        pump()
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [running, turnsDone, lastReply])

  // What Hermes waits on: said in the open turn and answered by the user's next words, or in agent mode told to the fast model.
  useEffect(() => {
    for (const request of requests) {
      if (told.current.has(request.id)) continue
      told.current.add(request.id)
      const current = turn.current
      if (!current) {
        const update = agent.current ? requestUpdate(request) : null
        if (update) updates.current.push(update)
        continue
      }
      if (request.method === 'approval') {
        const view = approvalView(request.params)
        say(current.id, approvalLine(view.description || view.command || ''))
      } else {
        const question = openQuestion(request)
        say(current.id, question ? spokenQuestion(question, clarifyQuestions(request.params).length > 1) : NEEDS_INPUT_LINE())
      }
    }
  }, [requests])

  // The microphone is closed while the server talks, so this is how the user cuts in: what plays stops, and the
  // server is told, since one that shuts its own microphone while it speaks listens again only then.
  const interrupt = () => {
    if (!gate.current.replying && !playing()) return
    trace.current?.step('Interrupt pressed')
    stopPlayback()
    gate.current.interrupt()
    send(RESPONSE_CANCEL)
    setPhase(current => (current === 'speaking' ? 'listening' : current))
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    // A muted microphone sends nothing: a short silence ends the user's turn now.
    if (next && ready.current) send(audioAppend(SILENCE))
  }

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'reconnecting'
        ? t('Reconnecting…')
      : phase === 'listening'
        ? muted
          ? t('Muted')
          : t('Listening')
        : phase === 'speaking'
          ? t('Speaking')
          : t('Interrupted')

  // A picture on the call's chat: Local Live sees none, so it hears that Hermes has it.
  useEffect(() => {
    if (pictureNote && !ended.current) updates.current.push(pictureNoteText(pictureNote, false))
  }, [pictureNote?.id])

  return (
    <>
      <CallCards cards={cards} jobs={jobList} />
      <div className={`voice-call live phase-${phase}`} role="region" aria-label={t('Voice call')}>
        <div className="voice-call-status">
          <MicOrb stream={micStream} active={phase === 'listening' && !muted} />
          <div className="voice-call-words">
            <strong>{status}</strong>
            {problem ? <span className="voice-call-problem">{problem}</span> : modeMenu ? null : <span className="meta">{t('Local Live')}</span>}
            {modeMenu}
          </div>
        </div>
        <CallLines lines={lines} />
        <div className="voice-call-buttons">
          {pictureControls}
          {agentMode ? (
            <AskFirstButton
              on={asking}
              onToggle={() => {
                const on = !askFirst.current.on
                const dropped = askFirst.current.set(on)
                setAsking(on)
                updates.current.push(switchedNote(on, dropped))
              }}
            />
          ) : null}
          {phase === 'failed' ? (
            <button className="secondary" onClick={onClassic}>
              {t('Classic voice')}
            </button>
          ) : null}
          {phase === 'speaking' ? (
            <button className="secondary" onClick={interrupt}>
              {t('Interrupt')}
            </button>
          ) : null}
          <button
            className={`voice-call-round${muted ? ' on' : ''}`}
            aria-label={muted ? t('Unmute microphone') : t('Mute microphone')}
            title={muted ? t('Unmute microphone') : t('Mute microphone')}
            disabled={phase === 'failed'}
            onClick={toggleMute}
          >
            <Icon name={muted ? 'micOff' : 'mic'} />
          </button>
          <button className="voice-call-round end" aria-label={t('End call')} title={t('End call')} onClick={finish}>
            <Icon name="phoneDown" />
          </button>
        </div>
      </div>
    </>
  )
}
