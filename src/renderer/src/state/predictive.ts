/**
 * Predictive suggested replies, after the phone's Predictive.swift: after a
 * reply settles in the open chat, the messages you'll most likely send next,
 * best first, from the plugin's `POST /predict` (0.80+), a no-tools fork of
 * the chat that saves nothing and answers only the device that asked. Off by
 * default and kept on this computer.
 *
 * Each kind may carry the user's own instructions (hermes-conduit#2970), kept
 * on this computer too, sent only with that kind's questions and only to a
 * plugin that reports `predict-custom-instructions` (0.189+).
 */
import type { TranscriptItem } from './transcript'

export const PREDICT_CAPABILITY = 'predict'
export const PREDICT_PATH = '/api/plugins/conduit_push/predict'
export const MINIMUM_PLUGIN = '0.80'
export const REPLY_COUNTS = [1, 3, 5] as const
export const DEFAULT_REPLY_COUNT = 3
export const REPLIES_WAIT_S = 20
/** A guess longer than this is dropped, never shortened: a chip shows its whole message. */
export const MAX_GUESS_LENGTH = 200
/** Clicks this soon after the row shows are ignored, so a click meant for something else doesn't send. */
export const TAP_GUARD_MS = 400

export type PredictModel = 'fast' | 'chat'

const REPLIES_KEY = 'conduit.predictive.replies'
const COUNT_KEY = 'conduit.predictive.replyCount'
const MODEL_KEY = 'conduit.predictive.model'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The default next time.
  }
}

export const repliesEnabled = () => read(REPLIES_KEY) === 'true'
export const setRepliesEnabled = (on: boolean) => {
  write(REPLIES_KEY, String(on))
  window.dispatchEvent(new Event(PREDICTIVE_EVENT))
}
export function replyCount(): number {
  const n = Number(read(COUNT_KEY))
  return (REPLY_COUNTS as readonly number[]).includes(n) ? n : DEFAULT_REPLY_COUNT
}
export const setReplyCount = (n: number) => write(COUNT_KEY, String(n))
export const predictModel = (): PredictModel => (read(MODEL_KEY) === 'chat' ? 'chat' : 'fast')
export const setPredictModel = (m: PredictModel) => write(MODEL_KEY, m)
/** Fired when the switch changes, so an open chat shows or drops its chips. */
export const PREDICTIVE_EVENT = 'conduit:predictive'

// The user's instructions for each kind of guess (hermes-conduit#2970).
export type PredictKind = 'replies' | 'draft' | 'turn'
export const INSTRUCTIONS_CAPABILITY = 'predict-custom-instructions'
export const INSTRUCTIONS_MINIMUM_PLUGIN = '0.189'
/** The plugin's limit, in code points as Python counts them. */
export const MAX_INSTRUCTIONS_CHARS = 1000
const INSTRUCTIONS_KEYS: Record<PredictKind, string> = {
  replies: 'conduit.predictive.replies.instructions',
  draft: 'conduit.predictive.pause.instructions',
  turn: 'conduit.predictive.followUp.instructions'
}

/** `text` cut to the plugin's limit at a whole character, so an emoji is never split. */
export function clipInstructions(text: string): string {
  if ([...text].length <= MAX_INSTRUCTIONS_CHARS) return text
  const pieces =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.segment)
      : [...text]
  let kept = ''
  let length = 0
  for (const piece of pieces) {
    const n = [...piece].length
    if (length + n > MAX_INSTRUCTIONS_CHARS) break
    kept += piece
    length += n
  }
  return kept
}

/** What's typed in Settings for `kind`, as kept. */
export const storedInstructions = (kind: PredictKind): string => read(INSTRUCTIONS_KEYS[kind]) ?? ''
/** The instructions `kind`'s questions carry, or null when there are none. */
export function instructions(kind: PredictKind): string | null {
  const text = clipInstructions(storedInstructions(kind)).trim()
  return text ? text : null
}
export const setInstructions = (kind: PredictKind, text: string) => {
  write(INSTRUCTIONS_KEYS[kind], clipInstructions(text))
  window.dispatchEvent(new CustomEvent(INSTRUCTIONS_EVENT, { detail: kind }))
}
/** Fired when a kind's instructions change: guesses made under the old ones go. */
export const INSTRUCTIONS_EVENT = 'conduit:predictive-instructions'

const withInstructions = (text: string | null | undefined) => (text ? { custom_instructions: text } : {})

export function repliesBody(sessionId: string, count: number, language: string, model: PredictModel, instructions?: string | null) {
  return {
    session_id: sessionId,
    kind: 'replies',
    count: Math.min(Math.max(count, 1), 5),
    language,
    model,
    wait_s: REPLIES_WAIT_S,
    ...withInstructions(instructions)
  }
}

/** The route's guesses, best first: blank or over-long ones dropped, repeats once, ties in the host's order. */
export function guesses(answer: unknown): string[] {
  const list = ((answer ?? {}) as Record<string, unknown>).replies
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  return list
    .flatMap((item, index) => {
      const r = (item ?? {}) as Record<string, unknown>
      const text = typeof r.text === 'string' ? r.text.trim() : ''
      if (!text || [...text].length > MAX_GUESS_LENGTH) return []
      const key = text.toLocaleLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      const p = typeof r.p === 'number' && Number.isFinite(r.p) ? Math.min(1, Math.max(0, r.p)) : 0.5
      return [{ text, p, index }]
    })
    .sort((a, b) => b.p - a.p || a.index - b.index)
    .map(g => g.text)
}

/**
 * The settled reply a chat ends on, as the key its guesses are kept under;
 * null while a turn runs, or when the chat ends on anything but a reply
 * (a notice, a failed turn, your own message).
 */
export function settledReply(items: TranscriptItem[], running: boolean): string | null {
  if (running) return null
  const last = items[items.length - 1]
  if (!last || last.kind !== 'assistant' || last.streaming || !last.text.trim()) return null
  const text = last.text.trim()
  return `${items.filter(i => i.kind === 'user').length}:${text.length}:${text.slice(-120)}`
}

// While I pause: guesses for an unsent draft.
const PAUSE_KEY = 'conduit.predictive.pause'
const PAUSE_DELAY_KEY = 'conduit.predictive.pauseDelay'
export const PAUSE_DELAYS = [0.8, 1.2, 2, 3, 5] as const
export const DEFAULT_PAUSE_DELAY = 1.2
export const DRAFT_WAIT_S = 4
/** A draft shorter than this isn't asked about. */
export const MIN_DRAFT_CHARS = 3
/** The plugin's limit, counted in code points as Python counts them: a longer draft isn't asked about rather than cut short. */
export const MAX_DRAFT_CHARS = 2000
const MAX_NEXT_CHARS = 60

export const pauseEnabled = () => read(PAUSE_KEY) === 'true'
export const setPauseEnabled = (on: boolean) => {
  write(PAUSE_KEY, String(on))
  window.dispatchEvent(new Event(PREDICTIVE_EVENT))
}
export function pauseDelay(): number {
  const n = Number(read(PAUSE_DELAY_KEY))
  return (PAUSE_DELAYS as readonly number[]).includes(n) ? n : DEFAULT_PAUSE_DELAY
}
export const setPauseDelay = (n: number) => write(PAUSE_DELAY_KEY, String(n))

/** Whether a draft is asked about: long enough to guess at, short enough to send whole. */
export function askable(draft: string): boolean {
  const length = [...draft].length
  return draft.trim().length >= MIN_DRAFT_CHARS && length <= MAX_DRAFT_CHARS
}

export function draftBody(sessionId: string, draft: string, count: number, language: string, model: PredictModel, instructions?: string | null) {
  return {
    session_id: sessionId,
    kind: 'draft',
    draft,
    count: Math.min(Math.max(count, 1), 5),
    language,
    model,
    wait_s: DRAFT_WAIT_S,
    ...withInstructions(instructions)
  }
}

export interface DraftGuesses {
  /** Words that finish the draft, starting where it stops (a leading space when a new word starts). */
  next: string[]
  /** Whole messages the draft probably means. */
  replies: string[]
}

/** The route's answer about a draft. */
export function draftGuesses(answer: unknown): DraftGuesses {
  const raw = ((answer ?? {}) as Record<string, unknown>).next
  const seen = new Set<string>()
  const next = (Array.isArray(raw) ? raw : []).flatMap(item => {
    const text = typeof (item as Record<string, unknown> | null)?.text === 'string' ? ((item as Record<string, unknown>).text as string) : ''
    const line = (/^\s/.test(text) ? ' ' : '') + text.trim().replace(/\s+/g, ' ')
    if (!line.trim() || [...line].length > MAX_NEXT_CHARS || seen.has(line)) return []
    seen.add(line)
    return [line]
  })
  return { next, replies: guesses(answer) }
}

// Hermes follows up: while a chat is on screen, settled and unwritten, Hermes is asked now and then whether it has something to add.
const FOLLOW_UP_KEY = 'conduit.predictive.followUp'
const FOLLOW_UP_DELAY_KEY = 'conduit.predictive.followUpDelay'
export const FOLLOW_UP_DELAYS = [30, 60, 120, 300] as const
export const DEFAULT_FOLLOW_UP_DELAY = 60
export const MAX_CHECKS = 4
export const TURN_WAIT_S = 30
export const ASK_AGAIN_RANGE = [30, 900] as const

export const followUpEnabled = () => read(FOLLOW_UP_KEY) === 'true'
export const setFollowUpEnabled = (on: boolean) => {
  write(FOLLOW_UP_KEY, String(on))
  window.dispatchEvent(new Event(PREDICTIVE_EVENT))
}
export function followUpDelay(): number {
  const n = Number(read(FOLLOW_UP_DELAY_KEY))
  return (FOLLOW_UP_DELAYS as readonly number[]).includes(n) ? n : DEFAULT_FOLLOW_UP_DELAY
}
export const setFollowUpDelay = (n: number) => write(FOLLOW_UP_DELAY_KEY, String(n))

/** The day and time where the user is, as the phone sends it ("Thursday 14:05"). */
export function localTime(date = new Date()): string {
  const day = date.toLocaleDateString('en-US', { weekday: 'long' })
  return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export interface TurnFacts {
  lastReplyS: number
  onScreenS: number
  check: number
  localTime?: string
}

export function turnBody(sessionId: string, facts: TurnFacts, language: string, model: PredictModel, instructions?: string | null) {
  return {
    ...withInstructions(instructions),
    session_id: sessionId,
    kind: 'turn',
    count: 1,
    language,
    model,
    wait_s: TURN_WAIT_S,
    facts: {
      last_reply_s: Math.max(0, Math.round(facts.lastReplyS)),
      on_screen_s: Math.max(0, Math.round(facts.onScreenS)),
      check: Math.min(Math.max(facts.check, 1), MAX_CHECKS),
      max_checks: MAX_CHECKS,
      ...(facts.localTime ? { local_time: facts.localTime } : {})
    }
  }
}

export interface TurnAnswer {
  takeTurn: boolean
  nudge: string | null
  /** Seconds, held to 30 s–15 min; null when Hermes didn't ask to be asked again. */
  askAgain: number | null
}

export function turnAnswer(answer: unknown): TurnAnswer {
  const r = (answer ?? {}) as Record<string, unknown>
  const nudge = typeof r.nudge === 'string' && r.nudge.trim() ? r.nudge : null
  const again = typeof r.ask_again_in_seconds === 'number' && Number.isFinite(r.ask_again_in_seconds) ? Math.round(r.ask_again_in_seconds) : null
  return {
    takeTurn: r.take_turn === true && !!nudge,
    nudge,
    askAgain: again === null ? null : Math.min(Math.max(again, ASK_AGAIN_RANGE[0]), ASK_AGAIN_RANGE[1])
  }
}

/** A check the host can't answer for a while, asked again 30 s later: busy (429, 503), slow (504, 408), another 5xx but 501, or no connection. */
export function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const status = Number(/\b(\d{3})\b/.exec(message)?.[1])
  if (status) return status === 429 || status === 408 || (status >= 500 && status !== 501)
  return /timed? ?out|took too long|too many|try again|still running|busy|network|not connected|ECONN|socket/i.test(message)
}

/** A reply by the messages the user had sent before it and its text; the hidden turn adds no message of the user's. */
export const followUpId = (userMessages: number, text: string) => `${userMessages}|${text.trim()}`

/** The keys of the replies to tag: of replies alike, the last, since the follow-up comes after the answer. */
export function followedUpKeys(items: TranscriptItem[], ids: Set<string> | undefined): Set<string> {
  const last = new Map<string, string>()
  let users = 0
  for (const item of items) {
    if (item.kind === 'user') users++
    else if (item.kind === 'assistant' && ids?.size) {
      const id = followUpId(users, item.text)
      if (ids.has(id)) last.set(id, item.key)
    }
  }
  return new Set(last.values())
}
