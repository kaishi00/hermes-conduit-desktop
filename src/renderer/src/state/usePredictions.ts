import { useCallback, useEffect, useRef, useState } from 'react'
import { language } from '@shared/i18n'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus, serves } from './plugin'
import {
  ASK_AGAIN_RANGE,
  MAX_CHECKS,
  TURN_WAIT_S,
  followUpDelay,
  followUpEnabled,
  followUpId,
  isTransient,
  localTime,
  turnAnswer,
  turnBody,
  type TurnAnswer,
  DRAFT_WAIT_S,
  askable,
  draftBody,
  draftGuesses,
  pauseEnabled,
  type DraftGuesses,
  PREDICTIVE_EVENT,
  PREDICT_CAPABILITY,
  PREDICT_PATH,
  REPLIES_WAIT_S,
  guesses,
  predictModel,
  repliesBody,
  repliesEnabled,
  replyCount,
  settledReply,
  INSTRUCTIONS_CAPABILITY,
  INSTRUCTIONS_EVENT,
  instructions,
  type PredictKind
} from './predictive'
import { languageName } from './stepSummaries'
import type { TranscriptState } from './transcript'

// Whether this host's plugin answers predictions, asked again every ten minutes.
let served: { at: number; answer: Promise<boolean> } | null = null
export function predictionsServed(): Promise<boolean> {
  if (!served || Date.now() - served.at > 600_000) {
    served = {
      at: Date.now(),
      answer: gateway
        .http('GET', STATUS_PATH)
        .then(body => serves(pluginStatus(body), [PREDICT_CAPABILITY]))
        .catch(() => false)
    }
  }
  return served.answer
}

// Whether this host's plugin uses the user's instructions; an older one ignores them, so none are sent.
let instructionsAsked: { at: number; answer: Promise<boolean> } | null = null
export function instructionsServed(): Promise<boolean> {
  if (!instructionsAsked || Date.now() - instructionsAsked.at > 600_000) {
    instructionsAsked = {
      at: Date.now(),
      answer: gateway
        .http('GET', STATUS_PATH)
        .then(body => serves(pluginStatus(body), [INSTRUCTIONS_CAPABILITY]))
        .catch(() => false)
    }
  }
  return instructionsAsked.answer
}

/** The instructions `kind`'s question carries now: none on a plugin that would ignore them. */
async function sentInstructions(kind: PredictKind): Promise<string | null> {
  return (await instructionsServed()) ? instructions(kind) : null
}

/**
 * The open chat's suggested replies: asked once per settled reply, when it
 * settles or the chat opens on it, while Settings > Chat > Predictive has
 * them on. Empty while a turn runs, and gone once the chat moves on.
 */
export interface Predictions {
  /** Suggested replies to the settled reply, best first. */
  replies: string[]
  /** Asks about a paused draft, when While I pause is on and Hermes can be asked. */
  askDraft?: (draft: string) => Promise<DraftGuesses | null>
}

export function usePredictions(state: TranscriptState, sessionId: string | undefined): Predictions {
  const [enabled, setEnabled] = useState(repliesEnabled)
  const [pausing, setPausing] = useState(pauseEnabled)
  const [answer, setAnswer] = useState<{ key: string; replies: string[] } | null>(null)
  const asked = useRef(new Set<string>())
  const reply = sessionId ? settledReply(state.items, state.running) : null
  const key = reply && sessionId ? `${sessionId}|${reply}` : null

  useEffect(() => {
    const changed = () => {
      setEnabled(repliesEnabled())
      setPausing(pauseEnabled())
    }
    // Replies made under instructions since edited go; the next reply asks with the new ones.
    const edited = (e: Event) => {
      if ((e as CustomEvent).detail === 'replies') setAnswer(null)
    }
    window.addEventListener(PREDICTIVE_EVENT, changed)
    window.addEventListener(INSTRUCTIONS_EVENT, edited)
    return () => {
      window.removeEventListener(PREDICTIVE_EVENT, changed)
      window.removeEventListener(INSTRUCTIONS_EVENT, edited)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !key || !sessionId || asked.current.has(key)) return
    asked.current.add(key)
    let live = true
    let done = false
    void (async () => {
      if (!(await predictionsServed())) return void (done = true)
      try {
        const sent = await sentInstructions('replies')
        const body = repliesBody(sessionId, replyCount(), languageName(language()), predictModel(), sent)
        const response = await gateway.http('POST', PREDICT_PATH, body, (REPLIES_WAIT_S + 5) * 1000)
        // Answered under instructions edited meanwhile: dropped.
        if (live && (await sentInstructions('replies')) === sent) setAnswer({ key, replies: guesses(response) })
      } catch {
        // No chips for this reply: Conduit doesn't ask again for it.
      }
      done = true
    })()
    return () => {
      live = false
      // Left before the answer came: coming back asks again.
      if (!done) asked.current.delete(key)
    }
  }, [enabled, key, sessionId])

  const askDraft = useCallback(
    async (draft: string): Promise<DraftGuesses | null> => {
      if (!sessionId || !askable(draft) || !(await predictionsServed())) return null
      try {
        const sent = await sentInstructions('draft')
        const body = draftBody(sessionId, draft, replyCount(), languageName(language()), predictModel(), sent)
        const answer = draftGuesses(await gateway.http('POST', PREDICT_PATH, body, (DRAFT_WAIT_S + 3) * 1000))
        // Answered under instructions edited meanwhile: dropped.
        return (await sentInstructions('draft')) === sent ? answer : null
      } catch {
        return null
      }
    },
    [sessionId]
  )

  return { replies: enabled && key && answer?.key === key ? answer.replies : [], askDraft: pausing && sessionId ? askDraft : undefined }
}

// A gateway that refused `display_kind` takes no hidden prompts: no more follow-ups this run.
let refusesHidden = false

/** Whether Conduit is in front and the window shown. */
function useOnScreen(): boolean {
  const [on, setOn] = useState(() => document.hasFocus() && document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setOn(document.hasFocus() && document.visibilityState === 'visible')
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return on
}

/**
 * Hermes follows up, after the phone's: while the chat is on screen,
 * settled and unwritten, Hermes is asked after the chosen wait (then when
 * it asks, held to 30 s–15 min) whether it has something useful to add, at
 * most 4 checks per reply and one hidden turn per message the user sends.
 * The reply to a hidden turn is tagged "Hermes followed up": this returns
 * those replies by `followUpId`, which outlasts a reload of the history.
 */
export function useFollowUps(state: TranscriptState, sessionId: string | undefined, profile: string | undefined, draftEmpty: boolean): Set<string> {
  const [enabled, setEnabled] = useState(followUpEnabled)
  const onScreen = useOnScreen()
  const [tick, setTick] = useState(0)
  const [tagged, setTagged] = useState<Set<string>>(() => new Set())
  const reply = sessionId ? settledReply(state.items, state.running) : null
  // The reply's key too, so a follow-up worded like the answer still counts as new.
  const anchor = reply && sessionId ? `${sessionId}|${state.items[state.items.length - 1].key}|${reply}` : null
  const userKey = sessionId ? `${sessionId}|${state.items.filter(i => i.kind === 'user').length}` : null
  const clock = useRef({ anchor: null as string | null, checks: 0, nextAt: 0, stopped: false, idleSince: Date.now(), replyAt: Date.now(), idle: false })
  const spent = useRef(new Set<string>())
  const pendingTag = useRef<string | null>(null)
  const live = useRef({ anchor, draftEmpty, onScreen, enabled, sessionId, profile, userKey })
  live.current = { anchor, draftEmpty, onScreen, enabled, sessionId, profile, userKey }

  useEffect(() => {
    const changed = () => setEnabled(followUpEnabled())
    window.addEventListener(PREDICTIVE_EVENT, changed)
    return () => window.removeEventListener(PREDICTIVE_EVENT, changed)
  }, [])

  // A new settled reply starts the clock over; the one after a hidden turn wears the tag.
  const c = clock.current
  if (anchor !== c.anchor) {
    if (anchor && pendingTag.current && anchor.startsWith(`${pendingTag.current}|`)) {
      const text = state.items[state.items.length - 1]
      if (text?.kind === 'assistant') {
        const id = followUpId(state.items.filter(i => i.kind === 'user').length, text.text)
        pendingTag.current = null
        queueMicrotask(() => setTagged(current => new Set(current).add(id)))
      }
    }
    clock.current = { anchor, checks: 0, nextAt: 0, stopped: false, idleSince: Date.now(), replyAt: Date.now(), idle: false }
  }

  const ready = enabled && !!anchor && !!sessionId && onScreen && draftEmpty && !refusesHidden
  useEffect(() => {
    const now = Date.now()
    const c = clock.current
    if (!ready) {
      c.idle = false
      return
    }
    // Back on screen, or the draft emptied: the wait starts over.
    if (!c.idle) {
      c.idle = true
      c.idleSince = now
    }
    if (c.stopped || c.checks >= MAX_CHECKS || (userKey && spent.current.has(userKey))) return
    const due = Math.max(c.nextAt, c.idleSince + followUpDelay() * 1000)
    const timer = window.setTimeout(() => void check(anchor!), Math.max(0, due - now))
    return () => window.clearTimeout(timer)

    async function check(asked: string) {
      const c = clock.current
      const now = live.current
      if (c.anchor !== asked || !now.enabled || !now.onScreen || !now.draftEmpty || !now.sessionId || !(await predictionsServed())) return
      c.checks += 1
      const sent = await sentInstructions('turn')
      const body = turnBody(
        now.sessionId,
        { lastReplyS: (Date.now() - c.replyAt) / 1000, onScreenS: (Date.now() - c.idleSince) / 1000, check: c.checks, localTime: localTime() },
        languageName(language()),
        predictModel(),
        sent
      )
      let answer: TurnAnswer
      try {
        answer = turnAnswer(await gateway.http('POST', PREDICT_PATH, body, (TURN_WAIT_S + 5) * 1000))
      } catch (e) {
        if (clock.current !== c) return
        if (isTransient(e) && c.checks < MAX_CHECKS) c.nextAt = Date.now() + ASK_AGAIN_RANGE[0] * 1000
        else c.stopped = true
        return setTick(n => n + 1)
      }
      const after = live.current
      // Still the same reply on screen, nobody writing, the switch still on.
      if (clock.current !== c || after.anchor !== asked || !after.enabled || !after.onScreen || !after.draftEmpty || !after.sessionId) return
      // Decided under follow-up instructions edited meanwhile: asked again with the new ones, within the reply's checks.
      if ((await sentInstructions('turn')) !== sent) {
        if (c.checks < MAX_CHECKS) c.nextAt = Date.now() + ASK_AGAIN_RANGE[0] * 1000
        else c.stopped = true
        return setTick(n => n + 1)
      }
      if (answer.takeTurn && answer.nudge) {
        c.stopped = true
        if (after.userKey) spent.current.add(after.userKey)
        const params: Record<string, unknown> = { session_id: after.sessionId, text: answer.nudge, display_kind: 'hidden' }
        if (after.profile) params.profile = after.profile
        pendingTag.current = after.sessionId
        try {
          await gateway.rpc('prompt.submit', params)
        } catch (e) {
          // Nothing reached Hermes: the user's message keeps its follow-up.
          pendingTag.current = null
          if (after.userKey) spent.current.delete(after.userKey)
          if (/display_kind/.test(e instanceof Error ? e.message : String(e))) refusesHidden = true
          else c.stopped = false
        }
      } else if (answer.askAgain !== null && c.checks < MAX_CHECKS) c.nextAt = Date.now() + answer.askAgain * 1000
      else c.stopped = true
      setTick(n => n + 1)
    }
  }, [ready, anchor, userKey, tick])

  return tagged
}
