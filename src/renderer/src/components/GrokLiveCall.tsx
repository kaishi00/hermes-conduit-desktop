import { useEffect, useRef, useState, type ReactNode } from 'react'
import { micStep, startCallTrace, type CallTrace } from '../state/callTrace'
import { CALL_ME_WHEN_DONE, CallBacks, callbackScope, chatWork, jobWork, type CallWork } from '../state/callbacks'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { askedQuestionsForCall } from '../state/askedForCalls'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import { MEMORY_PATH, NO_REPLY, PERSONALITY_PATH, memoryText, personaText, replyPrompt, withProfile } from '../state/gptLive'
import {
  ASK_THREAD,
  BAD_ARGUMENTS,
  END_CONVERSATION,
  NOTHING_TO_READ,
  NO_REQUEST,
  QUEUED,
  READ_LAST_REPLY,
  SAMPLE_RATE,
  SENT,
  SOCKET_PATH,
  START_TIMEOUT_MS,
  UNKNOWN_TOOL,
  audioAppend,
  chatContext,
  closeReason,
  decode,
  grokSendsMemory,
  grokSendsPersona,
  instructions,
  pcmSamples,
  readReply,
  responseCreate,
  sessionUpdate,
  textTurn,
  toolOutput,
  type ServerEvent
} from '../state/grokLive'
import { MEMORY_RECALL_PATH, RECALL_MEMORY, SHOW_ON_SCREEN, canRecall, recallAnswer, screenCard, withCard, type ScreenCard } from '../state/liveCall'
import { newCallId, saveCall, type CallResume, type CallTurn } from '../state/voiceSave'
import type { PendingRequest } from '@shared/ipc'
import { ANSWER_APPROVAL, ANSWER_QUESTION, answerApproval, answerQuestion, requestUpdate } from '../state/liveRequests'
import { Icon } from './icons'
import { MicOrb } from './MicOrb'
import { openingTurn } from '../state/liveGreeting'
import { CallCards } from './CallCards'
import { FIND_CHAT, READ_CHAT, chatFinder } from '../state/chatFinder'
import { pictureNoteText, type PictureNote } from '../state/callPicture'
import { CANCEL_JOB, INTERRUPT_JOB, LIST_JOBS, START_JOB, VoiceJobs, type VoiceJob } from '../state/voiceJobs'
import { dashboardProfileQuery } from '../state/dashboardProfile'
import { RECONNECT_ATTEMPTS, isRefusalClose, reconnectDelayMs } from '@shared/liveReconnect'

interface Props {
  profile?: string
  /** The chat's saved session, which keeps the call's transcript when it ends. */
  chatId?: string | null
  /** The chat's turns so far, which the call starts knowing. */
  items: TranscriptItem[]
  /** Sends a request as the chat's next message. */
  onSay: (text: string) => void
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
  /** The approvals and questions the chat waits on, which the call can answer by voice. */
  requests?: PendingRequest[]
  /** Resume call: the saved call this one continues, its id and turns. */
  resume?: CallResume
}

type Phase = 'starting' | 'reconnecting' | 'listening' | 'speaking' | 'ending' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  /** The input item a user line shows, whose transcript comes whole each time. */
  item?: string | null
  text: string
  open: boolean
}

/** Saying goodbye: the call closes once the model's audio has played out, or after this at most. */
const END_GRACE_MS = 1000
const END_TIMEOUT_MS = 8000
/** A request Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
/** Conduit's own updates wait this long after the user last spoke. */
const USER_QUIET_MS = 2000
/** The microphone stays closed this long after the model's audio ends, so its tail isn't heard back. */
const ECHO_TAIL_MS = 300
/** 0.8 s of silence: longer than the turn detector's window, so a mute ends the user's turn. */
const SILENCE = new Float32Array(Math.round(SAMPLE_RATE * 0.8))

/**
 * A Grok Live call in the open chat, after the phone's Grok Live on the shared
 * live conversation controller: you talk with Grok, and what you ask it to do
 * goes to Hermes as the chat's next message, with Hermes' reply told back to
 * you in the call. Audio goes both ways as 24 kHz PCM over the plugin's relay.
 */
export function GrokLiveCall({
  profile,
  chatId,
  items,
  onSay,
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
  const ended = useRef(false)
  const ending = useRef(false)
  const ready = useRef(false)
  // The greeting goes once per call, at the first ready, never on a reconnect.
  const opened = useRef(false)
  const mutedRef = useRef(false)
  const lineId = useRef(0)
  // The conversation's state, for when Conduit may speak up.
  const responding = useRef(false)
  const wantsResponse = useRef(false)
  const userSpeaking = useRef(false)
  const userSpokeAt = useRef(0)
  const answered = useRef(new Set<string>())
  // xAI has no session resumption: a dropped connection opens a new session, and a call from the old one can't be answered on it.
  const connection = useRef(0)
  const attempt = useRef(0)
  const callConnection = useRef(new Map<string, number>())
  const spoken = useRef('')
  // Updates for the model (Hermes' replies), sent once the conversation is quiet.
  const updates = useRef<string[]>([])
  // Requests for Hermes, one at a time in the chat.
  const queue = useRef<string[]>([])
  const active = useRef<{ from: number; at: number; started: boolean } | null>(null)
  // The latest props, for the socket's handlers.
  const live = useRef({ running, turnsDone, lastReply, onSay, chatId, requests })
  live.current = { running, turnsDone, lastReply, onSay, chatId, requests }
  // Requests the model was told about, so each is told once.
  const told = useRef(new Set<string>())
  // The call's finished turns, kept with the chat when it ends.
  const record = useRef<CallTurn[]>([])
  const callId = useRef(resume?.callId ?? newCallId())
  const resumed = useRef(resume)
  const saved = useRef(false)
  const keep = (role: CallTurn['role'], text: string) => text.trim() && record.current.push({ role, text: text.trim(), at: Date.now() / 1000 })
  const save = () => {
    if (saved.current) return
    saved.current = true
    void saveCall(profile, callId.current, 'grok-live', record.current, live.current.chatId, resumed.current?.from ?? 0)
  }

  const send = (message: Record<string, unknown>) => {
    if (socket.current) window.conduit.liveSend(socket.current, JSON.stringify(message))
  }

  // A response waits while one is running: it goes once that one is done.
  const respond = () => {
    if (responding.current) wantsResponse.current = true
    else {
      responding.current = true
      send(responseCreate())
    }
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

  // Hangs up, also after a failure (whose screen stays until it's closed).
  const finish = () => {
    if (!ended.current) {
      ended.current = true
      trace.current?.end(ending.current ? 'the call ended' : 'hung up')
      teardown()
    }
    onEnd()
  }

  // Closes once the goodbye has played out, or at the timeout.
  const endCall = () => {
    if (ending.current) return
    ending.current = true
    setPhase('ending')
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

  // The next request goes once the chat is free.
  const pump = () => {
    if (active.current || live.current.running || ending.current) return
    const next = queue.current.shift()
    if (!next) return
    active.current = { from: live.current.turnsDone, at: Date.now(), started: false }
    live.current.onSay(next)
    chatRequest.current = chatWork(live.current.chatId, next, active.current.at)
    syncWork()
  }

  const answer = (id: string, result: Record<string, string>, speaks = true) => {
    if ((callConnection.current.get(id) ?? connection.current) !== connection.current) return void trace.current?.step('Tool answer dropped: its connection was replaced')
    trace.current?.step(`Tool answered: ${result.status ?? 'ok'}`)
    send(toolOutput(id, result))
    if (speaks) respond()
  }

  const toolCall = (event: Extract<ServerEvent, { type: 'toolCall' }>) => {
    // The arguments event and the finished item carry the same call: run it once.
    if (answered.current.has(event.id)) return
    answered.current.add(event.id)
    callConnection.current.set(event.id, connection.current)
    trace.current?.step(`Tool call: ${event.name}`)
    if (event.args.invalid_arguments) return answer(event.id, BAD_ARGUMENTS)
    switch (event.name) {
      case ASK_THREAD: {
        const request = (event.args.request ?? '').trim()
        if (!request) return answer(event.id, NO_REQUEST)
        const waits = !!active.current || live.current.running
        queue.current.push(request)
        pump()
        return answer(event.id, waits ? QUEUED : SENT)
      }
      case CALL_ME_WHEN_DONE:
        void (callbacks.current?.request(callbackScope(event.args)) ?? Promise.resolve({ status: 'unavailable', message: 'Not in a call.' })).then(
          result => !ended.current && answer(event.id, result)
        )
        return
      case START_JOB:
        void jobs.current?.start(event.args.instructions ?? '').then(result => !ended.current && answer(event.id, result))
        return
      case LIST_JOBS: {
        const result = jobs.current?.list() ?? { summary: 'No background jobs are running.' }
        return answer(event.id, result)
      }
      case CANCEL_JOB:
        void jobs.current?.cancel(event.args.job_id).then(result => !ended.current && answer(event.id, result))
        return
      case INTERRUPT_JOB:
        void (jobs.current?.followUp(event.args.job_id ?? '', event.args.message ?? '') ?? Promise.resolve({ status: 'error', error: 'No jobs.' })).then(
          result => !ended.current && answer(event.id, result)
        )
        return
      case FIND_CHAT:
        // Grok holds its turn on every call: one search, not three.
        void finder.current.find(event.args.query ?? '', false).then(result => !ended.current && answer(event.id, result))
        return
      case READ_CHAT:
        void finder.current.read(event.args.number ?? '').then(result => !ended.current && answer(event.id, result))
        return
      case SHOW_ON_SCREEN: {
        const { card, result } = screenCard(event.args, ++cardId.current)
        if (card) setCards(current => withCard(current, card))
        return answer(event.id, result)
      }
      case READ_LAST_REPLY: {
        const reply = live.current.lastReply?.trim()
        return answer(event.id, reply ? readReply(reply) : NOTHING_TO_READ)
      }
      case ANSWER_APPROVAL:
        void answerApproval(live.current.requests, event.args.choice ?? '').then(result => !ended.current && answer(event.id, result))
        return
      case ANSWER_QUESTION:
        void answerQuestion(live.current.requests, event.args.answer ?? '').then(result => !ended.current && answer(event.id, result))
        return
      case RECALL_MEMORY: {
        // Grok holds its turn on every call, as on the phone.
        const query = (event.args.query ?? '').trim()
        if (!query) return answer(event.id, { status: 'error', error: 'No query was given.' })
        void gateway
          .http('POST', withProfile(MEMORY_RECALL_PATH, profile), { query }, 15_000)
          .then(recallAnswer, (e: unknown) => ({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
          .then(result => !ended.current && answer(event.id, result))
        return
      }
      case END_CONVERSATION:
        // Left unanswered: the call closes once the goodbye has played.
        return endCall()
      default:
        return answer(event.id, UNKNOWN_TOOL)
    }
  }

  const sendOpening = () => {
    const opening = openingTurn()
    if (opened.current || !opening) return
    opened.current = true
    trace.current?.step('Opening sent')
    send(textTurn(opening))
    respond()
  }

  const handle = (event: ServerEvent) => {
    switch (event.type) {
      case 'ready':
        attempt.current = 0
        if (!ready.current) {
          ready.current = true
          trace.current?.step('Session ready (server VAD, 700 ms silence, 300 ms padding)')
          setPhase('listening')
        }
        sendOpening()
        return
      case 'responseStarted':
        responding.current = true
        return
      case 'responseDone':
        responding.current = false
        // A response cut off before its whole transcript keeps what was said of it.
        keep('assistant', spoken.current)
        spoken.current = ''
        if (wantsResponse.current) {
          wantsResponse.current = false
          respond()
        }
        setLines(current => current.map(line => (line.open && line.who === 'assistant' ? { ...line, open: false } : line)))
        return
      case 'speechStarted':
        // The user cut in: the server drops its response, and playback stops now.
        userSpeaking.current = true
        userSpokeAt.current = Date.now()
        trace.current?.speechStarted()
        stopPlayback()
        return
      case 'speechStopped':
        trace.current?.speechStopped()
        userSpeaking.current = false
        userSpokeAt.current = Date.now()
        return
      case 'input':
        userSpokeAt.current = Date.now()
        userLine(event.itemId, event.text, event.final)
        if (event.final) keep('user', event.text)
        return
      case 'audio':
        if (ended.current) return
        play(event.pcm)
        return
      case 'output':
        spoken.current += event.text
        assistantLine(event.text)
        return
      case 'outputDone':
        spoken.current = ''
        keep('assistant', event.text)
        assistantLine(event.text, true)
        return
      case 'toolCall':
        toolCall(event)
        return
      case 'error':
        trace.current?.step(ready.current ? 'Server error' : 'Server refused the setup')
        if (!ready.current)
          fail(event.message ? t('Grok Live refused the connection: {reason}', { reason: event.message }) : t('Grok Live refused the connection.'))
    }
  }

  // Shows speaking while the model's audio plays; sends Hermes' replies once the conversation is quiet.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ended.current || !ready.current) return
      const speaking = playing()
      if (!ending.current) setPhase(current => (current === 'failed' ? current : speaking ? 'speaking' : 'listening'))
      const quiet = !responding.current && !speaking && !userSpeaking.current && Date.now() - userSpokeAt.current > USER_QUIET_MS
      if (quiet && !ending.current && updates.current.length) {
        send(textTurn(updates.current.shift()!))
        respond()
      }
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let startTimer = 0
    let told = ''
    let recall = false
    const stopListening = window.conduit.onLive(event => {
      if (event.id !== socket.current) return
      // The relay passes frames on once xAI's socket is up.
      if (event.type === 'open') {
        trace.current?.step('Socket open, setup sent')
        send(sessionUpdate(told, undefined, recall))
      } else if (event.type === 'message') {
        const decoded = decode(event.data)
        if (decoded) handle(decoded)
      } else if (event.type === 'close') {
        socket.current = null
        trace.current?.step(`Socket closed (${event.code ?? 'no code'})`)
        if (ending.current) return void (!ended.current && finish())
        if (!isRefusalClose(event.code, event.reason)) {
          // A live call that dropped opens a new session at once; a setup that failed is tried again after a pause.
          if (ready.current) return void reopen(0)
          if (attempt.current < RECONNECT_ATTEMPTS && connection.current > 0) return void retryAfter(attempt.current)
        }
        const reason = closeReason(event.code, event.reason)
        if (!ready.current) fail(reason ? t("Couldn't connect to Grok Live: {reason}", { reason }) : t("Couldn't connect to Grok Live."))
        else fail(reason ? t('Grok Live refused the connection: {reason}', { reason }) : t('The connection to Hermes dropped.'))
      }
    })
    const openSocket = async (): Promise<boolean> => {
      trace.current?.step('Opening the socket')
      const opened = await window.conduit.liveOpen(SOCKET_PATH, dashboardProfileQuery(profile))
      if (!opened.ok) {
        trace.current?.step('The socket did not open')
        if (attempt.current < RECONNECT_ATTEMPTS && connection.current > 0) return retryAfter(attempt.current), false
        fail(t("Couldn't connect to Grok Live: {reason}", { reason: opened.error }))
        return false
      }
      if (ended.current) {
        window.conduit.liveClose(opened.id)
        return false
      }
      socket.current = opened.id
      window.clearTimeout(startTimer)
      startTimer = window.setTimeout(() => {
        if (!ready.current) fail(t("Couldn't connect to Grok Live."))
      }, START_TIMEOUT_MS)
      return true
    }
    // A new connection, and so a new xAI session: what the old one was saying stops.
    const reopen = (next: number) => {
      if (ended.current) return
      attempt.current = next
      connection.current += 1
      if (ready.current) {
        ready.current = false
        responding.current = false
        stopPlayback()
        setPhase('reconnecting')
        trace.current?.step('Connection lost: opening a new session')
      }
      void openSocket()
    }
    const retryAfter = (failed: number) => {
      window.clearTimeout(startTimer)
      trace.current?.step(`Setup failed: trying again in ${reconnectDelayMs(failed) / 1000} s`)
      window.setTimeout(() => !ended.current && reopen(failed + 1), reconnectDelayMs(failed))
    }
    const connect = async () => {
      trace.current = startCallTrace('Grok Live')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        trace.current.step(micStep(stream))
        mic.current = stream
        setMicStream(stream)
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        context.current = ctx
        const turns = items.flatMap((item): { role: 'user' | 'assistant'; text: string }[] =>
          item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
        )
        // The persona and memory only when switched on; a host without them starts the call without.
        const [persona, memory] = await Promise.all([
          grokSendsPersona() ? gateway.http('GET', withProfile(PERSONALITY_PATH, profile)).then(personaText, () => '') : '',
          grokSendsMemory()
            ? gateway.http('GET', withProfile(MEMORY_PATH, profile)).then(
                r => ({ text: memoryText(r), recall: canRecall(r) }),
                () => ({ text: '', recall: false })
              )
            : { text: '', recall: false }
        ])
        const asked = await askedQuestionsForCall(profile)
        if (ended.current) return
        recall = memory.recall
        told = instructions({ language: language(), persona, memory: memory.text, recall, asked, chat: chatContext(resumed.current?.turns ?? turns, !!resumed.current) })
        if (!(await openSocket())) return
        // The microphone, as 24 kHz PCM, while the call listens.
        const source = ctx.createMediaStreamSource(stream)
        const node = ctx.createScriptProcessor(2048, 1, 1)
        processor.current = node
        node.onaudioprocess = event => {
          if (!ready.current || ended.current || ending.current || mutedRef.current) return
          // While the model talks on the speakers, its own voice isn't sent back.
          if (ctx.currentTime < playUntil.current + ECHO_TAIL_MS / 1000) return
          const samples = event.inputBuffer.getChannelData(0)
          trace.current?.audio(samples, SAMPLE_RATE)
          send(audioAppend(samples))
        }
        source.connect(node)
        node.connect(ctx.destination)
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
      window.clearTimeout(startTimer)
      stopListening()
      ended.current = true
      teardown()
    }
  }, [])

  // A request's reply: told once its turn ends, then the next request goes.
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
    // Never started (the chat refused it): let it go, so the call isn't stuck.
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

  // What Hermes waits on in the chat: told once the conversation is quiet, and answered only with the user's words.
  useEffect(() => {
    for (const request of requests) {
      if (told.current.has(request.id)) continue
      told.current.add(request.id)
      const update = requestUpdate(request)
      if (update) updates.current.push(update)
    }
  }, [requests])

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
        : phase === 'speaking' || phase === 'ending'
          ? t('Speaking')
          : t('Interrupted')

  // A picture on the call's chat: Grok Live sees none, so it hears that Hermes has it.
  useEffect(() => {
    if (pictureNote && !ended.current) updates.current.push(pictureNoteText(pictureNote, false))
  }, [pictureNote?.id])

  return (
    <>
      <CallCards cards={cards} jobs={jobList} />
      <div
        className={`voice-call live phase-${phase === 'starting' ? 'starting' : phase === 'failed' ? 'failed' : phase === 'speaking' ? 'speaking' : 'listening'}`}
        role="region"
        aria-label={t('Voice call')}
      >
        <div className="voice-call-status">
          <MicOrb stream={micStream} active={phase === 'listening' && !muted} />
          <div className="voice-call-words">
            <strong>{status}</strong>
            {problem ? <span className="voice-call-problem">{problem}</span> : modeMenu ? null : <span className="meta">{t('Grok Live')}</span>}
            {modeMenu}
          </div>
        </div>
        {lines.length ? (
          <ol className="voice-call-lines" aria-live="polite">
            {lines.map(line => (
              <li key={line.id} className={line.who === 'user' ? 'voice-call-line said' : 'voice-call-line'}>
                {line.text}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="voice-call-buttons">
          {pictureControls}
          {phase === 'failed' ? (
            <button className="secondary" onClick={onClassic}>
              {t('Classic voice')}
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
