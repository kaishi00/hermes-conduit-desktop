import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { useRecorder } from '../state/useRecorder'
import { stopReading } from '../state/readAloud'
import { blobToBase64, speak, spokenText, transcribe } from '../state/voice'
import { MAX_TURN_S, callStep, micScale, type CallPhase } from '../state/call'
import { speechOutput } from '../state/speechOutput'
import { speakHere } from '../state/speechServerSpeech'
import { afterReply, continuousConversation, pushToTalk } from '../state/classicVoice'
import { Icon } from './icons'

interface Props {
  profile?: string
  /** Sends what was said as the chat's next message. */
  onSay: (text: string) => void
  /** A reply is running in the chat. */
  running: boolean
  /** Counts the chat's finished turns: the next one after a send is the answer to speak. */
  turnsDone: number
  /** The chat's newest reply, spoken when its turn ends. */
  lastReply: string | null
  /** Stops the running reply. */
  onStop: () => void
  onEnd: () => void
  /** The mode menu under the call's status, which moves the call to another mode. */
  modeMenu?: ReactNode
  /** Show a picture: the button on the call's row, and the waiting picture's chip. */
  pictureControls?: ReactNode
}

/**
 * A Classic voice call in the open chat, as the phone's Classic mode: it
 * listens until you stop talking, sends what Hermes heard as your message,
 * and speaks the reply with Hermes' voice, then listens again. Every turn is
 * the chat's own, typed or spoken. With push to talk on, a turn is the
 * microphone button held down; with Continuous Conversation off, the call
 * waits after each reply for you to start the next turn (classicVoice.ts).
 */
export function VoiceCall({ profile, onSay, running, turnsDone, lastReply, onStop, onEnd, modeMenu, pictureControls }: Props) {
  const recorder = useRecorder()
  const [phase, setPhase] = useState<CallPhase>('starting')
  const [muted, setMuted] = useState(false)
  const mutedNow = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [heard, setHeard] = useState('')
  // A sent turn that never started (Hermes dropped it): after a while, Listen goes on without it.
  const [stalled, setStalled] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  /** Stops this computer's voice while it speaks a reply. */
  const stopComputer = useRef<(() => void) | null>(null)
  const ended = useRef(false)
  const waitingFrom = useRef<number | null>(null)
  const voice = useRef({ heard: false, loudAt: 0, quietSince: 0 })
  // Read as the call starts: a change in Settings applies to the next call.
  const [holdToTalk] = useState(pushToTalk)
  const [continuous] = useState(continuousConversation)
  /** The microphone button is held down (push to talk). */
  const holding = useRef(false)

  const listen = async () => {
    if (ended.current) return
    voice.current = { heard: false, loudAt: 0, quietSince: performance.now() }
    setPhase('listening')
    if (!(await recorder.start())) return setPhase('failed')
    // Let go before the microphone opened: that's the whole turn.
    if (holdToTalk && !holding.current && !ended.current) void finishTurn()
  }

  /** After a reply, or a turn that heard nothing: listen again, or wait for you. */
  const next = () => {
    if (ended.current) return
    const step = afterReply({ muted: mutedNow.current, pushToTalk: holdToTalk, continuous })
    if (step === 'listen') void listen()
    else setPhase(step)
  }

  // Start listening, and let go of everything on hang-up.
  useEffect(() => {
    // Set again on every mount: StrictMode mounts twice with the same ref.
    ended.current = false
    stopReading()
    // Classic can't start while a reply runs: it waits for the reply, then listens.
    if (running) {
      waitingFrom.current = turnsDone
      setPhase('thinking')
    } else if (holdToTalk) setPhase('ready')
    else void listen()
    return () => {
      ended.current = true
      recorder.cancel()
      audio.current?.pause()
      stopComputer.current?.()
    }
  }, [])

  useEffect(() => {
    if (recorder.error === 'denied')
      setProblem(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
    else if (recorder.error === 'missing') setProblem(t('No microphone found.'))
    else if (recorder.error) setProblem(recorder.error)
  }, [recorder.error])

  // While listening: the end of what was said is a pause after speech. Heard each frame from the
  // microphone, with the orb moved on the page, not drawn again through React (desktop#545).
  const orb = useRef<HTMLSpanElement | null>(null)
  const elapsedNow = useRef(0)
  elapsedNow.current = recorder.elapsed
  const finishNow = useRef(finishTurn)
  finishNow.current = finishTurn
  useEffect(() => {
    if (phase !== 'listening' || !recorder.recording) return
    let finished = false
    const unsubscribe = recorder.onLevel(level => {
      if (orb.current) orb.current.style.transform = `scale(${micScale(level)})`
      if (finished) return
      const step = callStep(voice.current, level, performance.now(), elapsedNow.current)
      voice.current = step.state
      // Held down, a pause never ends the turn; letting go does (or the longest turn).
      if (step.done && (!holdToTalk || elapsedNow.current >= MAX_TURN_S)) {
        finished = true
        void finishNow.current()
      }
    })
    return () => {
      unsubscribe()
      if (orb.current) orb.current.style.transform = ''
    }
  }, [phase, recorder.recording, recorder.onLevel])

  async function finishTurn() {
    setPhase('hearing')
    const recording = await recorder.stop()
    if (ended.current) return
    if (!recording) return next()
    try {
      const words = await transcribe(await blobToBase64(recording.blob), recording.mime, profile)
      if (ended.current) return
      // Quiet audio, or Hermes heard nothing: listen again, or wait (push to talk, Continuous Conversation off).
      if (!words) return next()
      setHeard(words)
      setProblem(null)
      waitingFrom.current = turnsDone
      setPhase('thinking')
      onSay(words)
    } catch (e) {
      if (ended.current) return
      setProblem(t("Hermes couldn't transcribe that: {error}", { error: e instanceof Error ? e.message : String(e) }))
      setPhase('failed')
    }
  }

  // The reply's turn ended: speak it, then listen.
  useEffect(() => {
    if (phase !== 'thinking' || waitingFrom.current === null || turnsDone === waitingFrom.current || running) return
    waitingFrom.current = null
    const words = spokenText(lastReply ?? '')
    if (!words) return next()
    setPhase('speaking')
    const output = speechOutput(profile)
    if (output !== 'hermes') {
      const spoken = speakHere(words, output, profile)
      stopComputer.current = spoken.stop
      spoken.done
        .catch(e => {
          if (ended.current) return
          const error = e instanceof Error ? e.message : String(e)
          setProblem(output === 'server' ? t("Your speech server couldn't read this aloud: {error}", { error }) : t("This computer couldn't read this aloud: {error}", { error }))
        })
        .finally(() => {
          // Interrupted: the interrupt already moved on.
          if (stopComputer.current !== spoken.stop) return
          stopComputer.current = null
          next()
        })
      return
    }
    speak(words, profile)
      .then(url => {
        if (ended.current) return
        const player = new Audio(url)
        audio.current = player
        player.onended = () => {
          audio.current = null
          next()
        }
        return player.play()
      })
      .catch(e => {
        if (ended.current) return
        setProblem(t("Hermes couldn't read this aloud: {error}", { error: e instanceof Error ? e.message : String(e) }))
        next()
      })
  }, [turnsDone, running, phase])

  useEffect(() => {
    setStalled(false)
    if (phase !== 'thinking' || running) return
    const timer = window.setTimeout(() => setStalled(true), 8000)
    return () => window.clearTimeout(timer)
  }, [phase, running])

  const interrupt = () => {
    if (phase === 'speaking') {
      audio.current?.pause()
      audio.current = null
      const stop = stopComputer.current
      stopComputer.current = null
      stop?.()
      // Interrupting means you want to talk: listen now, unless muted or holding to talk.
      if (mutedNow.current) setPhase('muted')
      else if (holdToTalk) setPhase('ready')
      else void listen()
    } else if (phase === 'thinking') {
      onStop()
    }
  }

  const toggleMute = () => {
    if (muted) {
      setMuted(false)
      mutedNow.current = false
      if (phase === 'muted') next()
      return
    }
    setMuted(true)
    mutedNow.current = true
    if (phase === 'listening' || phase === 'ready') {
      recorder.cancel()
      setPhase('muted')
    }
  }

  // Push to talk: press to talk (a press while Hermes speaks stops it), let go to send, slide off to cancel.
  const press = () => {
    if (muted) return
    if (phase === 'speaking') {
      audio.current?.pause()
      audio.current = null
      const stop = stopComputer.current
      stopComputer.current = null
      stop?.()
    } else if (phase !== 'ready' && phase !== 'failed') return
    holding.current = true
    setProblem(null)
    void listen()
  }
  const release = () => {
    if (!holding.current) return
    holding.current = false
    if (phase === 'listening' && recorder.recording) void finishTurn()
  }
  const slideOff = () => {
    if (!holding.current) return
    holding.current = false
    if (phase === 'listening') {
      recorder.cancel()
      setPhase('ready')
    }
  }

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'listening'
        ? t('Listening')
        : phase === 'hearing' || phase === 'thinking'
          ? t('Thinking')
          : phase === 'speaking'
            ? t('Speaking')
            : phase === 'muted'
              ? t('Muted')
              : phase === 'ready'
                ? holdToTalk
                  ? t('Hold the microphone to talk')
                  : t('Ready')
                : t('Interrupted')

  return (
    <div className={`voice-call phase-${phase}`} role="region" aria-label={t('Voice call')}>
      <div className="voice-call-status">
        <span ref={orb} className="voice-call-orb" />
        <div className="voice-call-words">
          <strong>{status}</strong>
          {problem ? (
            <span className="voice-call-problem">{problem}</span>
          ) : heard ? (
            <span className="meta">{heard}</span>
          ) : modeMenu ? null : (
            <span className="meta">{t('Classic voice')}</span>
          )}
          {modeMenu}
        </div>
      </div>
      <div className="voice-call-buttons">
        {pictureControls}
        {phase === 'failed' ? (
          <button className="secondary" onClick={() => void listen()}>
            {t('Try again')}
          </button>
        ) : phase === 'ready' && !holdToTalk ? (
          <button className="secondary" onClick={() => void listen()}>
            {t('Listen')}
          </button>
        ) : phase === 'thinking' && !running && stalled ? (
          holdToTalk ? (
            <button className="secondary" onClick={() => setPhase('ready')}>
              {t('Listen')}
            </button>
          ) : (
          <button className="secondary" onClick={() => void listen()}>
            {t('Listen')}
          </button>
          )
        ) : null}
        {phase === 'speaking' || (phase === 'thinking' && running) ? (
          <button className="secondary" onClick={interrupt}>
            {t('Interrupt')}
          </button>
        ) : null}
        {holdToTalk ? (
          <button
            className={`voice-call-round${phase === 'listening' ? ' on' : ''}`}
            aria-label={t('Hold to talk')}
            title={t('Hold to talk')}
            disabled={muted}
            onPointerDown={e => {
              // Only the main button talks: a right-click's menu can swallow its release.
              if (e.button !== 0) return
              e.currentTarget.setPointerCapture?.(e.pointerId)
              press()
            }}
            onPointerUp={e => {
              if (e.button !== 0) return
              // Let go outside the button: that's a slide off, which cancels.
              const box = e.currentTarget.getBoundingClientRect()
              const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
              if (inside) release()
              else slideOff()
            }}
            onPointerCancel={slideOff}
            // Focus moved while a key held it: no keyup will come, so that cancels.
            onBlur={slideOff}
            onKeyDown={e => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault()
                press()
              }
            }}
            onKeyUp={e => {
              if (e.key === ' ' || e.key === 'Enter') release()
            }}
          >
            <Icon name="mic" />
          </button>
        ) : null}
        <button
          className={`voice-call-round${muted ? ' on' : ''}`}
          aria-label={muted ? t('Unmute microphone') : t('Mute microphone')}
          title={muted ? t('Unmute microphone') : t('Mute microphone')}
          onClick={toggleMute}
        >
          <Icon name={muted ? 'micOff' : 'mic'} />
        </button>
        <button className="voice-call-round end" aria-label={t('End call')} title={t('End call')} onClick={onEnd}>
          <Icon name="phoneDown" />
        </button>
      </div>
    </div>
  )
}
