/**
 * Ask before sending to Hermes, after the phone's (hermes-conduit #451,
 * #1223): with it on, a live call holds each new request as its draft, the
 * model asks the user, and it goes to Hermes only on the user's own yes, read
 * from their words (heldAnswer.ts), never the model's reading of them. "Send
 * it to Hermes" in the user's words sends the next request at once.
 * Corrections to running work and read-backs never wait. Settings > Voice
 * sets how a call starts; the call screen's switch, or asking the model,
 * changes it for that call. The model-facing text is the phone's.
 */
import { heldRequestAnswer, saysSendToHermes, type HeldAnswer } from './heldAnswer'
import { ASKED_ANSWER_LEAD, REQUEST_WORDS_WAIT_MS, RequestWords, withUserWords } from './requestWords'

const KEY = 'conduit.liveAskFirst'

/** Whether a live call starts asking first; off unless switched on. */
export function liveAsksFirst(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function setLiveAsksFirst(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'true')
    else localStorage.removeItem(KEY)
  } catch {
    // Off next time.
  }
}

// MARK: What the model is told (not UI copy)

/** Whether the call starts asking first, after the rules that say how it works. */
export const askFirstInstructions = (on: boolean) =>
  on
    ? '\n\nAsking first is on for this call: a new request goes to Hermes only once the user OKs it.'
    : '\n\nAsking first is off for this call: new requests go to Hermes straight away.'

export const SEND_REQUEST = 'send_request'
export const SET_ASK_FIRST = 'set_ask_first'

/** The tool-calling modes' rule (Gemini, Qwen, Grok, Local Live's agent). */
export const ASK_FIRST_RULE =
  '\nAsking first: when it is on for this call, a new request waits for the user\'s OK. start_job and ask_thread then answer waiting_for_ok: tell the user in a few words what you\'ll do and ask whether to go ahead. When they say yes in any words, call send_request. When they change it, call start_job or ask_thread again with the new request; it replaces the waiting one. When they say no, drop it. When they tell you to send it to Hermes, it goes at once. Corrections to running work never wait. When the user asks you to check with them before sending things to Hermes, or to stop checking, call set_ask_first.'

/** GPT-Live's rule, for its delegations. */
export const DELEGATED_ASK_FIRST_RULE =
  'Asking first: when it is on for this call, a new delegation waits for the user\'s OK, and Conduit answers that it is waiting. Then tell the user in a few words what you\'ll send to Hermes and ask whether to send it. When they say yes in any words, delegate "Send:". When they change it, delegate the new request; Conduit holds it again, and Hermes gets the user\'s own words, changes included. When they say no, drop it. When they tell you to send it to Hermes, it goes at once. Until Conduit says a request went to Hermes, don\'t say it\'s sent, being sent or on its way: acknowledge with something like "Okay" instead. Corrections ("Job 2: …") and read-backs never wait. When the user asks you to check with them before sending things to Hermes, delegate "Mode: ask first"; to stop checking, delegate "Mode: send directly".'

export const ASK_FIRST_TOOL_SPECS: { name: string; description: string; parameters: Record<string, unknown> }[] = [
  {
    name: SEND_REQUEST,
    description:
      "Send the request that is waiting for the user's OK to Hermes, once they said yes to it in any words. Only after start_job or ask_thread answered waiting_for_ok and the user answered your question. Its result arrives later on this call.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: SET_ASK_FIRST,
    description:
      "Turn asking first on or off for this call, when the user asks you to check with them before sending requests to Hermes, or to stop checking. While it is on, each new request waits for the user's OK.",
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', description: '"on" to ask first, "off" to send requests straight away.' } },
      required: ['mode']
    }
  }
]

/** A switch on the call screen reaches the model as a quiet note. */
export const switchedNote = (on: boolean, dropped = false) =>
  on
    ? "[Background only. The user turned on asking first for this call: from now on, Hermes gets a new request only once the user OKs it. Don't respond to this note now.]"
    : dropped
      ? "[Background only. The user turned off asking first for this call: new requests go to Hermes straight away again. The request that was waiting wasn't sent: if the user still wants it, ask for it again. Don't respond to this note now.]"
      : "[Background only. The user turned off asking first for this call: new requests go to Hermes straight away again. Don't respond to this note now.]"

export const modeAnswer = (on: boolean) =>
  on
    ? "Asking first is on for this call: each new request waits for the user's OK. Tell the user in a few words."
    : 'Asking first is off for this call: new requests go to Hermes straight away. Tell the user in a few words.'

/** The request with what the user said when asked, so Hermes reads their own words. */
export function adding(words: string | null, request: string): string {
  const said = words?.trim()
  return said ? `${request}${ASKED_ANSWER_LEAD}${said}"` : request
}

/** "Mode: ask first" → true, "Mode: send directly" → false, at the very start of a delegation. */
export function modeMarker(request: string): boolean | null {
  const match = /^\s*mode\s*:\s*(ask first|send directly)\b/i.exec(request)
  return match ? match[1]!.toLowerCase() === 'ask first' : null
}

/** "Send:" at the very start of a delegation: the model took the answer as a yes. */
export const isSendMarker = (request: string) => /^\s*send\s*:/i.test(request)

const HELD_PREFIX = '[Not sent to Hermes yet'
export const HELD_FOR_OK = `${HELD_PREFIX}: the user OKs each new request first. Hermes gets their own words since the last request that went, so tell them in a few words what you'll send, all of what they asked for since then, and ask whether to send it. When they say yes, delegate "Send:"; when they change it, delegate the new request. Until Conduit says it went, don't say it's sent or being sent, and never say "Send:" aloud.]`
export const WAITING_FOR_ANSWER =
  "Not sent yet: Conduit is waiting for the user's answer to come through. Don't say it's sent or being sent; Conduit tells you when it goes."
export const NOT_READY_YET = "Not sent: the user isn't ready yet. It keeps waiting for their OK; don't say it's sent."
export const DROPPED = 'Not sent: the user said no, so Conduit dropped the waiting request. Nothing is waiting now.'
export const NOTHING_WAITING = "[Nothing is waiting to be sent to Hermes. Ask the user what they want done.]"

// MARK: The call's held request

/** Where a held request goes once the user OKs it. */
export type HeldTool = 'ask_thread' | 'start_job'

export interface Draft {
  tool: HeldTool
  request: string
  /** When it was held: an answer is the user's words after this. */
  heldAt: number
  /** What the user said for it, sent with it (requestWords.ts). */
  said: string[]
}

/** A new request: held for the user's OK, or sent now as `request`, the user's own words with it. */
export type Asked = { held: Record<string, string> } | { request: string }

export type Release =
  | { send: true; tool: HeldTool; request: string }
  | { send: false; result: Record<string, string> }

/** Words this soon after the request's own are still the request (its transcript trails the call). */
const ANSWER_GAP_MS = 1000
/** How long "send it to Hermes" counts for the next request. */
const SEND_NOW_WINDOW_MS = 20_000
/** How long a yes still being transcribed is waited for. */
const LATE_YES_MS = 3000
const NOT_ANSWERED_YET = "Not sent: the user hasn't answered yet. Wait for their OK, then call send_request."

/**
 * One call's asking first for the tool-calling modes: the switch, the held
 * request, and the user's latest words, fed from the call's transcript.
 */
export class AskFirst {
  on: boolean
  draft: Draft | null = null
  private sendNowAt: number | null = null
  /** The user's current line and when its last words came. */
  private line = ''
  private lineAt = 0
  private lineOpen = false
  /** What the user said that no request carried yet. */
  private readonly words: RequestWords

  constructor(
    on: boolean,
    private readonly now: () => number = Date.now,
    private readonly lateYesMs = LATE_YES_MS,
    private readonly wordsWaitMs = REQUEST_WORDS_WAIT_MS
  ) {
    this.on = on
    this.words = new RequestWords(now)
  }

  /**
   * The user's words as they're transcribed, a piece at a time or (`whole`)
   * the line so far; "send it to Hermes" sends their next request.
   */
  heard(text: string, whole = false): void {
    if (!this.lineOpen || whole) this.line = ''
    this.lineOpen = true
    this.line += text
    this.lineAt = this.now()
    this.words.heard(text, whole)
    if (this.on && saysSendToHermes(this.line, whole)) this.sendNowAt = this.now()
  }

  /** The model spoke: the user's next words start a new line. */
  modelSpoke(): void {
    this.lineOpen = false
    this.words.modelSpoke()
  }

  /**
   * A new request from the model: held while asking first is on, else sent
   * now with what the user said for it, marked as theirs (hermes-conduit
   * issue 3236).
   */
  async ask(tool: HeldTool, request: string): Promise<Asked> {
    const said = await this.words.take(this.wordsWaitMs)
    const held = this.hold(tool, request, said)
    return held ? { held } : { request: withUserWords(said, request) }
  }

  /** A correction to running work, with what the user said themselves. */
  async withWords(message: string): Promise<string> {
    return withUserWords(await this.words.take(this.wordsWaitMs), message)
  }

  /** Switches it for this call; switched off, a held request is let go. */
  set(on: boolean): boolean {
    const dropped = !on && this.draft !== null
    this.on = on
    if (!on) this.draft = null
    this.sendNowAt = null
    return dropped
  }

  /** The model's set_ask_first. */
  setMode(mode: string | undefined): Record<string, string> {
    const value = (mode ?? '').trim().toLowerCase()
    if (value !== 'on' && value !== 'off') return { error: 'mode must be on or off' }
    const dropped = this.set(value === 'on')
    const said = modeAnswer(value === 'on')
    return {
      status: value,
      message: dropped ? `${said} The request that was waiting wasn't sent: if the user still wants it, ask for it again.` : said
    }
  }

  /** Holds a new request while asking first is on, answered so the model asks; null sends it now. */
  hold(tool: HeldTool, request: string, said: string[] = []): Record<string, string> | null {
    const saidSend = this.sendNowAt !== null && this.now() - this.sendNowAt < SEND_NOW_WINDOW_MS
    this.sendNowAt = null
    if (!this.on || saidSend) {
      this.draft = null
      return null
    }
    this.draft = { tool, request, heldAt: this.lineAt, said }
    return {
      status: 'waiting_for_ok',
      message: `Not sent yet: the user OKs each new request before it goes to Hermes. Tell them in a few words what you'll send and ask whether to send it. When they say yes, call send_request; when they change it, call ${tool} again with the new request.`
    }
  }

  /** The model's send_request: the held request goes only on the user's own yes. */
  async release(): Promise<Release> {
    const waiting = this.draft
    if (!waiting) return { send: false, result: { error: 'Nothing is waiting to be sent. Ask the user what they want Hermes to do.' } }
    if (this.lineAt - waiting.heldAt <= ANSWER_GAP_MS) return { send: false, result: { status: 'waiting_for_ok', message: NOT_ANSWERED_YET } }
    const answer = await this.heardAnswer()
    // Another request replaced it meanwhile: that one waits for its own answer.
    if (this.draft !== waiting) return { send: false, result: { status: 'waiting_for_ok', message: NOT_ANSWERED_YET } }
    switch (answer.kind) {
      case 'yes':
        this.draft = null
        // Their yes, and anything said while it waited, was this request's: none of it goes with the next one.
        this.words.skip()
        return { send: true, tool: waiting.tool, request: withUserWords(waiting.said, adding(answer.addition, waiting.request)) }
      case 'no':
      case 'notYet':
        if (answer.change) {
          this.draft = null
          return {
            send: false,
            result: { status: 'changed', message: `Not sent: the user changed it ("${answer.change}"). Call ${waiting.tool} again with the request as they want it now.` }
          }
        }
        if (answer.kind === 'notYet')
          return { send: false, result: { status: 'waiting_for_ok', message: "Not sent: the user isn't ready yet. Wait for their OK, then call send_request." } }
        this.draft = null
        return { send: false, result: { status: 'dropped', message: "Not sent: the user said no, so it won't go to Hermes. Tell them in a few words." } }
      default:
        return {
          send: false,
          result: {
            status: 'waiting_for_ok',
            message: `Not sent: the user's answer wasn't a yes. If they changed the request, call ${waiting.tool} again with it; otherwise ask whether to send it, and call send_request once they say yes.`
          }
        }
    }
  }

  /** The user's words reach the transcript a moment after the model heard them: a non-answer gets a moment to become one. */
  private async heardAnswer(): Promise<HeldAnswer> {
    const deadline = this.now() + this.lateYesMs
    for (;;) {
      const answer = heldRequestAnswer(this.line)
      if (answer.kind !== 'other' || this.now() >= deadline) return answer
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}

// MARK: GPT-Live's delegations

/** What a delegation, or the user's finished words, does while asking first. */
export type DelegatedStep =
  /** Nothing of asking first's: the delegation goes on as usual (sent now). */
  | { kind: 'pass' }
  | { kind: 'reply'; delegationId: string; text: string; channel: 'speakable' | 'commentary' }
  /** The held request goes, its reply on `delegationId`. */
  | { kind: 'send'; delegationId: string; request: string; background: boolean }

interface DelegatedDraft {
  request: string
  background: boolean
  /** The delegation that held it: sent on the user's words alone, its reply follows there. */
  delegationId: string
  /** The model's turn ended since it was held: it asked the user. */
  asked: boolean
  /** A delegation made on the user's answer before their words came: answered once they do. */
  pending: string | null
  pendingIsSend: boolean
}

export const ALREADY_SENT =
  "Conduit already sent that request to Hermes; its reply follows on the delegation that sent it. Don't send it again or ask what to send."
const SENT_WINDOW_MS = 20_000
const UNSPACED = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/

/** Short words with no question in them: when the model said "Send:" on them, they can be a yes. */
const couldBeAYes = (words: string) => !/[?？]/.test(words) && !UNSPACED.test(words) && words.trim().split(/\s+/).length <= 5

/**
 * GPT-Live's asking first, after the phone's GPTLiveDelegationBridge: a new
 * delegation is held while it's on; the next delegation, or the user's
 * finished words once the model asked, carry the answer, which their own
 * words decide. Pure, so the call screen only carries out its steps.
 */
export class DelegatedAskFirst {
  on: boolean
  draft: DelegatedDraft | null = null
  private sentAt = 0

  constructor(
    on: boolean,
    private readonly now: () => number = Date.now
  ) {
    this.on = on
  }

  /** "Mode: ask first" / "Mode: send directly": the answer for the model, or null for any other delegation. */
  mode(id: string, text: string): DelegatedStep | null {
    const on = modeMarker(text)
    if (on === null) return null
    const dropped = !on && this.draft !== null
    this.set(on)
    const said = on
      ? "Asking first is on for this call: each new request waits for the user's OK."
      : 'Asking first is off for this call: new requests go to Hermes straight away.'
    return {
      kind: 'reply',
      delegationId: id,
      text: dropped ? `${said} The request that was waiting wasn't sent: if the user still wants it, delegate it again.` : said,
      channel: 'commentary'
    }
  }

  set(on: boolean): boolean {
    const dropped = !on && this.draft !== null
    this.on = on
    if (!on) this.draft = null
    return dropped
  }

  /** The model finished a turn: with a request held, it has asked. */
  modelFinishedTurn(): void {
    if (this.draft) this.draft.asked = true
  }

  /**
   * A delegation, after the markers that never wait (answers, chats, jobs'
   * follow-ups, read-backs). `said`: the user's words since the last one;
   * `request` and `background`: what it would send now.
   */
  delegation(id: string, text: string, said: string, request: string, background: boolean): DelegatedStep {
    const isSend = isSendMarker(text)
    const routing = text.replace(/^\s*send\s*:/i, '').trim()
    const shape = heldRequestAnswer(routing)
    const bare = shape.kind !== 'other' && (shape.kind === 'yes' ? shape.addition === null : shape.change === null)
    // Text that is only an answer, or the user's words again, is no request of its own.
    const own = isSend || shape.kind !== 'other' || routing === said.trim() ? '' : routing
    const waiting = this.draft
    if (waiting) {
      if (!said.trim()) {
        waiting.pending = id
        waiting.pendingIsSend = isSend || waiting.pendingIsSend
        // Rewritten with nothing from the user yet: the change is the model's to ask about.
        if (own) return this.hold(id, own, background)
        return { kind: 'reply', delegationId: id, text: WAITING_FOR_ANSWER, channel: 'commentary' }
      }
      return this.settle(waiting, said, own, isSend, id)
    }
    if (isSend || (bare && saysSendToHermes(routing))) {
      if (this.now() - this.sentAt < SENT_WINDOW_MS) return { kind: 'reply', delegationId: id, text: ALREADY_SENT, channel: 'commentary' }
      return { kind: 'reply', delegationId: id, text: NOTHING_WAITING, channel: 'speakable' }
    }
    if (!request || !this.on || saysSendToHermes(said || text)) return { kind: 'pass' }
    return this.hold(id, request, background)
  }

  /**
   * The user finished speaking. With a delegation waiting for these words,
   * they answer it; once the model asked, a plain yes or no settles the
   * request without the delegation GPT-Live often never makes.
   */
  userFinished(words: string): DelegatedStep | null {
    const waiting = this.draft
    if (!waiting || !words.trim()) return null
    if (waiting.pending) {
      const id = waiting.pending
      waiting.pending = null
      return this.settle(waiting, words, '', waiting.pendingIsSend, id)
    }
    if (saysSendToHermes(words)) return this.send(waiting, waiting.request, waiting.delegationId)
    if (!waiting.asked) return null
    const answer = heldRequestAnswer(words)
    if (answer.kind === 'yes') return this.send(waiting, adding(answer.addition, waiting.request), waiting.delegationId)
    if (answer.kind === 'no' && answer.change === null) {
      this.draft = null
      return { kind: 'reply', delegationId: waiting.delegationId, text: DROPPED, channel: 'commentary' }
    }
    return null
  }

  /** Marks a request sent, so a "Send:" right after it isn't a second one. */
  sent(): void {
    this.sentAt = this.now()
  }

  private hold(id: string, request: string, background: boolean): DelegatedStep {
    this.draft = { request, background: background || (this.draft?.background ?? false), delegationId: id, asked: false, pending: null, pendingIsSend: false }
    return { kind: 'reply', delegationId: id, text: HELD_FOR_OK, channel: 'speakable' }
  }

  private send(waiting: DelegatedDraft, request: string, id: string): DelegatedStep {
    this.draft = null
    this.sent()
    return { kind: 'send', delegationId: id, request, background: waiting.background }
  }

  /** What the user's answer does to the held request: their words decide, whatever the model wrote. */
  private settle(waiting: DelegatedDraft, answer: string, own: string, isSend: boolean, id: string): DelegatedStep {
    if (saysSendToHermes(answer)) return this.send(waiting, own || waiting.request, id)
    const heard = heldRequestAnswer(answer)
    switch (heard.kind) {
      case 'yes':
        return this.send(waiting, adding(heard.addition, waiting.request), id)
      case 'no':
        if (heard.change === null) {
          this.draft = null
          return { kind: 'reply', delegationId: id, text: DROPPED, channel: 'commentary' }
        }
        return this.hold(id, own || adding(heard.change, waiting.request), waiting.background)
      case 'notYet':
        if (heard.change === null) {
          waiting.pending = null
          return { kind: 'reply', delegationId: id, text: NOT_READY_YET, channel: 'commentary' }
        }
        return this.hold(id, own || adding(heard.change, waiting.request), waiting.background)
      default:
        if (own) return this.hold(id, own, waiting.background)
        // The model said "Send:": it took them as a yes, unless they ask something or say more than a yes would.
        if (isSend && couldBeAYes(heard.words)) return this.send(waiting, adding(heard.words, waiting.request), id)
        return this.hold(id, adding(heard.words, waiting.request), waiting.background)
    }
  }
}
