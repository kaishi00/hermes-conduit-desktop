import { micStep, startCallTrace, type CallTrace } from '../state/callTrace'
import { CallLines } from './CallLines'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CallBacks, callMeMarker, chatWork, jobWork, type CallWork } from '../state/callbacks'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { askedQuestionsForCall } from '../state/askedForCalls'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import {
  DATA_CHANNEL,
  NOTHING_TO_READ,
  NOTHING_TO_SEND,
  NO_REPLY,
  SENT_TO_CHAT,
  SESSION_PATH,
  SESSION_TIMEOUT_MS,
  START_TIMEOUT_MS,
  TurnAssembler,
  WAITING_FOR_CHAT,
  appendMessages,
  briefing,
  closeMessage,
  decode,
  gptLiveBilling,
  history,
  TIME_LIMIT_GOODBYE,
  apiLimitMinutes,
  gptLiveVoice,
  notStartedMessage,
  voiceNote,
  isEndCall,
  isReadBack,
  MEMORY_PATH,
  PERSONALITY_PATH,
  memoryText,
  personaText,
  sendsMemory,
  sendsPersona,
  readBack,
  replyPrompt,
  requestWords,
  sessionAnswer,
  withProfile,
  type Channel,
  type Dialect,
  type ServerEvent
} from '../state/gptLive'
import { newCallId, saveCall, type CallResume, type CallTurn } from '../state/voiceSave'
import type { PendingRequest } from '@shared/ipc'
import { answerApproval, answerQuestion, answerWords, isApprove, isDeny, requestUpdate } from '../state/liveRequests'
import { chatFinder, delegatedRead, delegatedSearch, findChatMarker, readChatMarker } from '../state/chatFinder'
import { JOB_STARTED, VoiceJobs, asksForBackground, jobFollowUpMarker, type VoiceJob } from '../state/voiceJobs'
import { CallCards } from './CallCards'
import { Icon } from './icons'
import { pictureNoteText, type PictureNote } from '../state/callPicture'
import { MicOrb } from './MicOrb'

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

type Phase = 'starting' | 'listening' | 'speaking' | 'ending' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  text: string
  open: boolean
}

/** Saying goodbye: the call closes once the model has finished, or after this at most. */
const END_GRACE_MS = 1500
const END_TIMEOUT_MS = 8000
/** A request Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
/** Words that end a GA call, whose delegations carry no "End call:" marker. */
const GOODBYE =
  /^(?:(?:ok(?:ay)?|alright|thanks?|thank you)[,.! ]*)*(?:good ?bye|bye(?: bye)?|hang up|end (?:the |this )?call)[,.! ]*(?:(?:thanks?|thank you)[.! ]*)?$/i

/**
 * A GPT-Live call in the open chat, after the phone's GPTLiveConversationController:
 * you talk with GPT-Live, and what you ask it to do goes to Hermes as the chat's
 * next message, with Hermes' reply told back to you in the call.
 */
export function GptLiveCall({
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
  const [billing] = useState(gptLiveBilling)
  const [voice] = useState(() => gptLiveVoice(gptLiveBilling()))
  const [note, setNote] = useState<string | null>(null)

  const pc = useRef<RTCPeerConnection | null>(null)
  // The steps Diagnostics shows for the last call: GPT-Live's startup, never words.
  const trace = useRef<CallTrace | null>(null)
  const channel = useRef<RTCDataChannel | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const speaker = useRef<HTMLAudioElement | null>(null)
  const dialect = useRef<Dialect>('frameless')
  const turns = useRef(new TurnAssembler())
  const quiet = useRef<number | null>(null)
  const ended = useRef(false)
  const finder = useRef(chatFinder(profile))
  const [jobList, setJobList] = useState<VoiceJob[]>([])
  const jobs = useRef<VoiceJobs | null>(null)
  // "Call me when it's done": the call's jobs and its request in the chat, as they run.
  const callbacks = useRef<CallBacks | null>(null)
  const chatRequest = useRef<CallWork | null>(null)
  const syncWork = () => callbacks.current?.sync([...(jobs.current?.jobs ?? []).map(jobWork), ...(chatRequest.current ? [chatRequest.current] : [])])
  const jobDelegations = useRef(new Map<string, string>())
  // The call's background jobs: each result goes on the delegation that started it.
  useEffect(() => {
    const asked = new CallBacks(profile, note => {
      if (!ended.current) append(note, 'speakable', null)
    })
    callbacks.current = asked
    const kept = new VoiceJobs(
      profile,
      list => (setJobList(list), syncWork()),
      (notice, job) => {
        if (!ended.current) append(notice, 'speakable', jobDelegations.current.get(job.id) ?? null)
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
  const ending = useRef(false)
  const lineId = useRef(0)
  // The user's words since the last delegation: finished turns, and the one still being said.
  const words = useRef({ done: '', open: '' })
  // Requests for Hermes, one at a time in the chat.
  const queue = useRef<{ id: string; request: string }[]>([])
  const active = useRef<{ id: string; from: number; at: number; started: boolean } | null>(null)
  // The latest props, for the data channel's handlers.
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
    void saveCall(profile, callId.current, 'gpt-live', record.current, live.current.chatId, resumed.current?.from ?? 0)
  }

  const append = (text: string, channelName: Channel, delegationId: string | null) => {
    const dc = channel.current
    if (!dc || dc.readyState !== 'open') return false
    for (const message of appendMessages(text, channelName, delegationId, dialect.current)) dc.send(JSON.stringify(message))
    return true
  }

  const teardown = () => {
    save()
    if (quiet.current) window.clearTimeout(quiet.current)
    try {
      if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(closeMessage()))
    } catch {
      // Closing anyway.
    }
    channel.current?.close()
    pc.current?.close()
    mic.current?.getTracks().forEach(track => track.stop())
    speaker.current?.pause()
    channel.current = null
    pc.current = null
    mic.current = null
    setMicStream(null)
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

  const endSoon = (delay: number) => window.setTimeout(() => !ended.current && finish(), delay)

  const addLine = (who: Line['who'], text: string) =>
    setLines(current => {
      const last = current.at(-1)
      if (last && last.open && last.who === who) return [...current.slice(0, -1), { ...last, text: last.text + text }]
      const closed = current.map(line => (line.open ? { ...line, open: false } : line))
      return [...closed, { id: ++lineId.current, who, text, open: true }].slice(-8)
    })

  const closeLine = (who: Line['who'], transcript: string) =>
    setLines(current => {
      const index = current.findLastIndex(line => line.open && line.who === who)
      if (index < 0) return transcript.trim() ? [...current, { id: ++lineId.current, who, text: transcript.trim(), open: false }].slice(-8) : current
      const next = [...current]
      next[index] = { ...next[index]!, text: transcript.trim() || next[index]!.text, open: false }
      return next
    })

  // The next request goes once the chat is free.
  const pump = () => {
    if (active.current || live.current.running || ending.current) return
    const next = queue.current.shift()
    if (!next) return
    active.current = { id: next.id, from: live.current.turnsDone, at: Date.now(), started: false }
    live.current.onSay(next.request)
    chatRequest.current = chatWork(live.current.chatId, next.request, active.current.at)
    syncWork()
    append(SENT_TO_CHAT, 'speakable', next.id)
  }

  // An API-key call is billed by the minute: at the limit set, it says goodbye and ends.
  const limitTimer = useRef(0)
  const startLimit = () => {
    const minutes = billing === 'api' ? apiLimitMinutes() : 0
    if (!minutes || limitTimer.current) return
    limitTimer.current = window.setTimeout(() => {
      if (ended.current || ending.current) return
      setNote(t('This call reached its time limit on the API key.'))
      append(TIME_LIMIT_GOODBYE, 'speakable', null)
      ending.current = true
      setPhase('ending')
      mic.current?.getAudioTracks().forEach(track => (track.enabled = false))
      endSoon(END_TIMEOUT_MS)
    }, minutes * 60_000)
  }

  const delegate = (id: string, text: string) => {
    const said = [words.current.done, words.current.open].join(' ').trim()
    words.current = { done: '', open: '' }
    if (isEndCall(text) || (!text.trim() && GOODBYE.test(said))) {
      ending.current = true
      setPhase('ending')
      mic.current?.getAudioTracks().forEach(track => (track.enabled = false))
      endSoon(END_TIMEOUT_MS)
      return
    }
    // The user's spoken answer to what Hermes waits on in the chat.
    const reply = answerWords(text)
    if (isApprove(text) || isDeny(text) || reply !== null) {
      const answering = reply !== null ? answerQuestion(live.current.requests, reply) : answerApproval(live.current.requests, isApprove(text) ? 'once' : 'deny')
      void answering.then(result => append(result.next_question ?? result.message ?? result.error ?? '', 'speakable', id))
      return
    }
    // "Call me:": Hermes calls once the call's newest request is done (the job named, or all of them).
    let callMe = callMeMarker(text)
    if (callMe) {
      // "Call me: call me: …" asks once.
      for (let again = callMeMarker(callMe.rest); again; again = callMeMarker(callMe.rest))
        callMe = { scope: callMe.scope.kind === 'newest' ? again.scope : callMe.scope, rest: again.rest }
      const { scope, rest } = callMe
      if (rest) {
        // The work goes first, as this delegation; the call is asked for the request that takes it.
        const since = Date.now()
        words.current = { done: said, open: '' }
        delegate(id, rest)
        void callbacks.current
          ?.request(scope.kind === 'newest' ? { kind: 'next', since } : scope)
          .then(result => !ended.current && append(`[${result.message}]`, 'commentary', id))
        return
      }
      void callbacks.current?.request(scope).then(result => !ended.current && append(result.message, 'speakable', id))
      return
    }
    // Finding and reading the user's earlier chats, answered here.
    const lookFor = findChatMarker(text)
    if (lookFor !== null) {
      void finder.current.find(lookFor).then(result => !ended.current && append(delegatedSearch(result), 'speakable', id))
      return
    }
    const number = readChatMarker(text)
    if (number !== null) {
      void finder.current.read(number).then(result => !ended.current && append(delegatedRead(result), 'speakable', id))
      return
    }
    // Words for a running background job.
    const followUp = jobFollowUpMarker(text)
    if (followUp) {
      void jobs.current?.followUp(followUp.jobId, followUp.words).then(result => {
        if (!ended.current) append(`[${result.message ?? result.error ?? ''}]`, 'speakable', id)
      })
      return
    }
    if (isReadBack(text)) {
      const read = readBack(live.current.lastReply)
      if (!read) append(NOTHING_TO_READ, 'speakable', id)
      else {
        append(read.quiet, 'commentary', id)
        append(read.cue, 'speakable', id)
      }
      return
    }
    const request = requestWords(text, said)
    if (!request) {
      append(NOTHING_TO_SEND, 'commentary', id)
      return
    }
    // Work the user wants kept apart from the chat runs as a background job; its result comes on this delegation.
    if (asksForBackground(text) || asksForBackground(said)) {
      void jobs.current?.start(request).then(result => {
        if (ended.current) return
        if (result.status === 'started' && result.job_id) {
          jobDelegations.current.set(result.job_id, id)
          append(JOB_STARTED, 'speakable', id)
        } else append(`[${result.error ?? 'The job could not start.'}]`, 'speakable', id)
      })
      return
    }
    queue.current.push({ id, request })
    if (active.current || live.current.running) append(WAITING_FOR_CHAT, 'commentary', id)
    pump()
  }

  const handle = (event: ServerEvent) => {
    switch (event.type) {
      case 'started':
        trace.current?.step('Conversation started')
        setPhase(current => {
          if (current === 'starting') startLimit()
          return current === 'starting' ? 'listening' : current
        })
        return
      case 'input':
        words.current.open += event.text
        addLine('user', event.text)
        return
      case 'output':
        if (!ending.current) setPhase('speaking')
        addLine('assistant', event.text)
        return
      case 'turnDone':
        trace.current?.step(`Turn done: ${event.role}`)
        if (event.role === 'user') {
          const text = event.transcript.trim() || words.current.open.trim()
          words.current = { done: [words.current.done, text].filter(Boolean).join(' '), open: '' }
          closeLine('user', event.transcript)
          keep('user', text)
        } else if (event.role === 'assistant') {
          closeLine('assistant', event.transcript)
          keep('assistant', event.transcript)
          if (ending.current) endSoon(END_GRACE_MS)
          else setPhase('listening')
        }
        return
      case 'delegation':
        trace.current?.step('Delegated to Hermes')
        delegate(event.id, event.text)
        return
      case 'error':
        trace.current?.step(`Server error${event.code ? ` (${event.code})` : ''}`)
        // A late append after a close is expected noise.
        if (event.code === 'context_injection_incomplete') return
        setPhase(current => {
          if (current === 'starting') {
            window.setTimeout(() =>
              fail(
                event.message
                  ? t('GPT-Live refused the conversation: {message}', { message: event.message })
                  : t("GPT-Live didn't start the conversation. Try again.")
              )
            )
          }
          return current
        })
        return
      case 'closed':
        trace.current?.step('Conversation closed by the server')
        if (ending.current) {
          if (!ended.current) finish()
        } else fail(t('GPT-Live ended the conversation.'))
    }
  }

  const received = (text: string) => {
    const event = decode(text)
    if (!event) return
    if (dialect.current !== 'ga') return handle(event)
    for (const each of turns.current.receive(event)) {
      handle(each)
      if (ended.current) return
    }
    // The GA events have no turn.done: a quiet moment ends the open turn.
    if (quiet.current) window.clearTimeout(quiet.current)
    quiet.current = null
    if (turns.current.open)
      quiet.current = window.setTimeout(() => {
        quiet.current = null
        const done = turns.current.flush()
        if (done) handle(done)
      }, turns.current.quietMs)
  }

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let startTimer = 0
    const connect = async () => {
      trace.current = startCallTrace('GPT-Live')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        trace.current.step(micStep(stream))
        mic.current = stream
        setMicStream(stream)
        const peer = new RTCPeerConnection()
        pc.current = peer
        stream.getAudioTracks().forEach(track => peer.addTrack(track, stream))
        peer.ontrack = event => {
          const audio = speaker.current ?? new Audio()
          speaker.current = audio
          audio.autoplay = true
          audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
          void audio.play().catch(() => undefined)
        }
        peer.onconnectionstatechange = () => {
          trace.current?.step(`Connection ${peer.connectionState}`)
          if (peer.connectionState === 'failed') fail(t('The GPT-Live connection was lost.'))
        }
        const dc = peer.createDataChannel(DATA_CHANNEL)
        channel.current = dc
        dc.onmessage = event => typeof event.data === 'string' && received(event.data)
        dc.addEventListener('open', () => trace.current?.step('Data channel open'), { once: true })
        await peer.setLocalDescription(await peer.createOffer())
        // The whole offer, candidates included: the host sends it on in one request.
        await new Promise<void>(resolve => {
          if (peer.iceGatheringState === 'complete') return resolve()
          const done = () => peer.iceGatheringState === 'complete' && resolve()
          peer.addEventListener('icegatheringstatechange', done)
          window.setTimeout(resolve, 3000)
        })
        if (ended.current) return
        // A resumed call is seeded with the saved call's turns, a fresh one with the chat's.
        const seed = history(
          resumed.current?.turns ??
            items.flatMap((item): { role: 'user' | 'assistant'; text: string }[] =>
              item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
            )
        )
        // The persona and memory only when switched on; a host without them starts the call without.
        const [persona, memory] = await Promise.all([
          sendsPersona() ? gateway.http('GET', withProfile(PERSONALITY_PATH, profile)).then(personaText, () => '') : '',
          sendsMemory() ? gateway.http('GET', withProfile(MEMORY_PATH, profile)).then(memoryText, () => '') : ''
        ])
        const asked = await askedQuestionsForCall(profile)
        if (ended.current) return
        const told = briefing(language(), persona, memory, asked)
        const body: Record<string, unknown> = { sdp: peer.localDescription?.sdp ?? '', billing, briefing: told }
        if (seed.length) body.history = seed
        if (voice) body.voice = voice
        trace.current.step(`Session requested (${String(billing)}, ${peer.iceGatheringState} ICE, ${seed.length} history items)`)
        const answer = sessionAnswer(await gateway.http('POST', withProfile(SESSION_PATH, profile), body, SESSION_TIMEOUT_MS), billing)
        trace.current.step(`Session answered (${answer.dialect} events, briefing ${answer.briefingApplied ? 'applied' : 'sent after start'})`)
        if (ended.current) return
        dialect.current = answer.dialect
        setNote(voiceNote(voice, answer.voice))
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
        // Given with the session where the host takes it; otherwise once it starts.
        if (!answer.briefingApplied) {
          const sendBriefing = () => append(told, 'instructions', null)
          if (dc.readyState === 'open') sendBriefing()
          else dc.addEventListener('open', sendBriefing, { once: true })
        }
        startTimer = window.setTimeout(() => {
          setPhase(current => {
            if (current === 'starting') window.setTimeout(() => fail(notStartedMessage(voice, billing)))
            return current
          })
        }, START_TIMEOUT_MS)
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
      window.clearTimeout(limitTimer.current)
      ended.current = true
      teardown()
    }
  }, [])

  // A request's reply: told on its delegation once its turn ends, then the next request goes.
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
      append(lastReply?.trim() ? replyPrompt(lastReply) : NO_REPLY, 'speakable', current.id)
      pump()
      return
    }
    // Never started (the chat refused it): let it go, so the call isn't stuck.
    const timer = window.setTimeout(() => {
      if (active.current === current && !current.started) {
        active.current = null
        chatRequest.current = null
        syncWork()
        append(NO_REPLY, 'speakable', current.id)
        pump()
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [running, turnsDone, lastReply])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mic.current?.getAudioTracks().forEach(track => (track.enabled = !next && !ending.current))
  }

  // What Hermes waits on in the chat, told to the model: it asks the user and answers only with their words.
  useEffect(() => {
    for (const request of requests) {
      if (told.current.has(request.id)) continue
      const update = requestUpdate(request)
      if (update && append(update, 'speakable', null)) told.current.add(request.id)
    }
  }, [requests])

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'listening'
        ? muted
          ? t('Muted')
          : t('Listening')
        : phase === 'speaking'
          ? t('Speaking')
          : phase === 'ending'
            ? t('Speaking')
            : t('Interrupted')
  const badge = billing === 'api' ? t('API key · billed per minute') : t('ChatGPT plan')

  // A picture on the call's chat: GPT-Live sees none, so it hears that Hermes has it.
  useEffect(() => {
    if (pictureNote && !ended.current) append(pictureNoteText(pictureNote, false), 'commentary', null)
  }, [pictureNote?.id])

  return (
    <>
      <CallCards cards={[]} jobs={jobList} />
      <div
        className={`voice-call live phase-${phase === 'starting' ? 'starting' : phase === 'failed' ? 'failed' : phase === 'speaking' ? 'speaking' : 'listening'}`}
        role="region"
        aria-label={t('Voice call')}
      >
        <div className="voice-call-status">
          <MicOrb stream={micStream} active={phase === 'listening' && !muted} />
          <div className="voice-call-words">
            <strong>{status}</strong>
            {problem ? (
              <span className="voice-call-problem">{problem}</span>
            ) : (
              <span className="meta">{note ? `${t('GPT-Live')} · ${badge} · ${note}` : `${t('GPT-Live')} · ${badge}`}</span>
            )}
            {modeMenu}
          </div>
        </div>
        <CallLines lines={lines} />
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
