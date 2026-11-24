/**
 * Local Live, after the phone's LocalLiveProtocol and LocalLiveTurnRunner: a
 * live call through the user's own speech server (Hugging Face
 * speech-to-speech), relayed by the Conduit plugin's `local-live/socket`.
 * The server speaks the OpenAI Realtime dialect Grok Live reads, so audio and
 * transcripts decode as Grok's do. What is Local Live's own: a session.update
 * with no instructions or tools (the server's model is Hermes), and the turn
 * frames the plugin adds on the same socket. When the server asks its model
 * address for a reply, the plugin sends `conduit.turn`; Conduit runs it as
 * the chat's next message and streams Hermes' reply back as
 * `conduit.turn.delta`, then `conduit.turn.done`.
 */
import { t } from '../../../shared/i18n'
import { gateway } from '../gateway'
import type { ClarifyQuestion } from './needsYou'

export const STATUS_PATH = '/api/plugins/conduit_push/local-live/status'
export const KEY_PATH = '/api/plugins/conduit_push/local-live/key'
export const SOCKET_PATH = '/api/plugins/conduit_push/local-live/socket'
/** The OpenAI Realtime PCM rate, both ways. */
export const SAMPLE_RATE = 24_000
/** The relay closes a socket that sends nothing for 60 s: a muted call pings. */
export const KEEPALIVE_MS = 20_000
/** A speech server that just started can take a while to warm up. */
export const READY_TIMEOUT_MS = 90_000
/** What one delta carries at most, in code points (the plugin takes up to 8,000). */
export const MAX_DELTA = 4_000

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

// MARK: Client → server

/** Server turn detection that answers on its own and stops speaking when the user talks; no instructions or tools. */
export function sessionUpdate(): Row {
  const format = { type: 'audio/pcm', rate: SAMPLE_RATE }
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      audio: {
        input: { format, turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true } },
        output: { format }
      }
    }
  }
}

export const KEEPALIVE: Row = { type: 'conduit.ping' }
/** Interrupt: the server stops the reply it speaks, and one that shut its microphone for it listens again. */
export const RESPONSE_CANCEL: Row = { type: 'response.cancel' }

/** Words no one says, asked as the readiness check: its turn coming back proves the whole path works. */
export const readinessMarker = () => `conduit-ready-${crypto.randomUUID().toLowerCase()}`

/** An out-of-band response (conversation "none"), so the call's conversation never holds the marker. */
export const readinessCheck = (marker: string): Row => ({
  type: 'response.create',
  response: { conversation: 'none', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: marker }] }] }
})

export const turnDelta = (turnId: string, text: string): Row => ({ type: 'conduit.turn.delta', turn_id: turnId, text })
export const turnDone = (turnId: string): Row => ({ type: 'conduit.turn.done', turn_id: turnId })

/** `text` in pieces the plugin takes whole. */
export function deltaChunks(text: string): string[] {
  const points = [...text]
  if (points.length <= MAX_DELTA) return text ? [text] : []
  const chunks: string[] = []
  for (let i = 0; i < points.length; i += MAX_DELTA) chunks.push(points.slice(i, i + MAX_DELTA).join(''))
  return chunks
}

// MARK: Server → client

export type TurnFrame = { type: 'turn'; id: string; text: string } | { type: 'cancel'; id: string }

/** The plugin's turn frame; null for the speech server's own frames. */
export function turnFrame(text: string): TurnFrame | null {
  if (!text.includes('"conduit.turn')) return null
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return null
  }
  const id = str(o?.turn_id)
  if (!id) return null
  if (o.type === 'conduit.turn') return { type: 'turn', id, text: typeof o.text === 'string' ? o.text : '' }
  if (o.type === 'conduit.turn.cancel') return { type: 'cancel', id }
  return null
}

/** Whether the server stopped the reply it was speaking: playback stops with it. */
export function stopsPlayback(text: string): boolean {
  if (!text.includes('output_audio_buffer') && !text.includes('response.cancel') && !text.includes('"cancelled"')) return false
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return false
  }
  switch (o?.type) {
    case 'output_audio_buffer.clear':
    case 'output_audio_buffer.cleared':
    case 'response.cancel':
    case 'response.cancelled':
      return true
    case 'response.done':
      return ((o.response ?? {}) as Row).status === 'cancelled'
    default:
      return false
  }
}

// MARK: Status

export interface LocalStatus {
  available: boolean
  reason: string | null
  modelAddress: string | null
  modelName: string
  apiKey: string | null
  lastRequestAt: number | null
  speechServerUrl: string | null
  /** The plugin runs each turn itself (or the server's own model answers): nothing to set up on the server. */
  drivesTurns: boolean
  ownModel: boolean
  /** The own model switch as set; null from a plugin before it (0.175.0), which shows no switch. */
  ownModelSetting: boolean | null
  answersAlone: boolean
  /** Agent mode's fast model on the host; null from a plugin without it. */
  front: FrontModel | null
}

/** `base` (the dashboard, maybe with a path prefix) joined with the route's path. */
export function modelAddress(base: string | null | undefined, path: string): string | null {
  const trimmed = base?.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  return trimmed + (path.startsWith('/') ? path : `/${path}`)
}

export function localStatus(response: unknown, dashboard: string | null | undefined): LocalStatus {
  const r = (response ?? {}) as Row
  const server = (r.speech_server ?? {}) as Row
  const apiKey = str(r.api_key)
  const path = str(r.model_path)
  const ownModel = server.own_model === true
  return {
    available: r.available === true,
    reason: str(r.reason) ?? str(r.detail),
    modelAddress: apiKey && path ? modelAddress(dashboard, path) : null,
    modelName: str(r.model_name) ?? 'conduit',
    apiKey,
    lastRequestAt: typeof r.last_request_at === 'number' ? r.last_request_at : null,
    speechServerUrl: str(server.url),
    drivesTurns: server.drive_turns === true || ownModel,
    ownModel,
    ownModelSetting: typeof server.own_model === 'boolean' ? server.own_model : null,
    answersAlone: r.answers_alone === true,
    front: frontModel(r)
  }
}

/** `value` as one shell word: as is when it's plain, else single-quoted. */
export function shellQuoted(value: string): string {
  if (value && /^[A-Za-z0-9\-_.:/=@%+,]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** The flags to start Hugging Face speech-to-speech with. */
export function serverFlags(status: LocalStatus): string | null {
  if (!status.modelAddress || !status.apiKey) return null
  return `--llm_backend chat-completions --responses_api_base_url ${shellQuoted(status.modelAddress)} --responses_api_api_key ${shellQuoted(status.apiKey)} --model_name ${shellQuoted(status.modelName)} --stream_batch_sentences 1 --num_pipelines 2`
}

/** The whole setup as one block for whoever runs the server (written for an agent to act on, so English). */
export function agentSetupText(status: LocalStatus): string | null {
  const flags = serverFlags(status)
  if (!flags || !status.modelAddress || !status.apiKey) return null
  const lines = ['Please point my Hugging Face speech-to-speech server at Conduit, so Hermes writes every reply it speaks.', '']
  if (status.speechServerUrl) lines.push(`Speech server: ${status.speechServerUrl} (the address my Hermes host connects to).`, '')
  lines.push(
    "Set its language model to Conduit's model address (OpenAI-compatible chat completions, streamed):",
    `- base URL: ${status.modelAddress}`,
    `- API key: ${status.apiKey}`,
    `- model name: ${status.modelName}`,
    '',
    'As start flags (add them, or replace the same flags; keep its speech-to-text, text-to-speech and other settings):',
    flags,
    '',
    'Notes:',
    '- --num_pipelines 2 lets Conduit listen and speak over two connections at once.',
    '- --stream_batch_sentences 1 speaks each sentence as soon as Hermes writes it.',
    `- The server's machine must reach the base URL. Check from there: curl -sS -H ${shellQuoted(`Authorization: Bearer ${status.apiKey}`)} ${shellQuoted(`${status.modelAddress}/models`)} should list the model "${status.modelName}".`,
    '- Restart the server after changing its flags (for example its systemd service), and check its log for the language model warming up without errors.',
    '- Keep the key private. Conduit can make a new one in Settings > Voice.'
  )
  return lines.join('\n')
}

// MARK: What's said

/**
 * A reply's words as the speech server says them, after the phone's
 * SpokenVisualSplitter: code, tables, pictures, bare addresses and file tags
 * are left out (the chat on screen shows them), and a link is said by its
 * title. Deltas split anywhere, so a line that may open a block is held until
 * it ends, and a possible link until it closes; prose goes as it comes.
 */
export class SpokenSplitter {
  /** Something was left out to be seen: the call says the rest is on screen. */
  leftOut = false
  private pending = ''
  private lineIsProse = false
  private fence: string | null = null

  feed(text: string): string {
    this.pending += text
    let spoken = ''
    let newline: number
    while ((newline = this.pending.search(/[\r\n]/)) >= 0) {
      // A "\r" may be the start of a "\r\n" still to come.
      if (this.pending[newline] === '\r' && newline === this.pending.length - 1) break
      const line = this.pending.slice(0, newline)
      const skip = this.pending[newline] === '\r' && this.pending[newline + 1] === '\n' ? 2 : 1
      this.pending = this.pending.slice(newline + skip)
      spoken += this.take(line, true)
      this.lineIsProse = false
    }
    return spoken + this.releaseProse()
  }

  /** Everything still held, at the end of the reply. */
  finish(): string {
    const spoken = this.pending ? this.take(this.pending, false) : ''
    this.pending = ''
    this.lineIsProse = false
    this.fence = null
    return spoken
  }

  private releaseProse(): string {
    if (this.fence || !this.pending) return ''
    if (!this.lineIsProse) {
      const start = this.pending.replace(/^[ \t]+/, '')
      // Too short to tell yet, or the start of a block.
      if (start.length < 3 || blockKind(start)) return ''
    }
    const cut = heldFrom(this.pending)
    if (cut <= 0) return ''
    const released = this.pending.slice(0, cut)
    this.pending = this.pending.slice(cut)
    const starts = !this.lineIsProse
    this.lineIsProse = true
    return this.speakable(starts ? lineStart(released) : released)
  }

  private take(line: string, ended: boolean): string {
    if (this.fence) {
      const trimmed = line.trim()
      // Only a bare marker closes it; ```bash inside a block is content.
      if (trimmed.startsWith(this.fence) && [...trimmed].every(c => c === this.fence![0])) this.fence = null
      return ''
    }
    const trimmed = line.trim()
    if (!this.lineIsProse && (blockKind(trimmed) || /^MEDIA:/i.test(trimmed))) {
      this.leftOut = true
      if (blockKind(trimmed) === 'code') this.fence = /^[`~]+/.exec(trimmed)![0]
      return ''
    }
    return this.speakable(this.lineIsProse ? line : lineStart(line)) + (ended ? '\n' : '')
  }

  /** Links said by their titles; pictures, file links and bare addresses left out. */
  private speakable(text: string): string {
    // Emphasis and code marks aren't said.
    text = text.replace(/[*`]+|__+/g, '')
    if (!text.includes('](') && !text.includes('http')) return text
    const spoken = text
      .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (_, image: string, title: string) => {
        this.leftOut = true
        return image ? '' : title
      })
      .replace(/https?:\/\/[^\s)]*[^\s).,;:!?]/g, () => {
        this.leftOut = true
        return ''
      })
    return spoken
  }
}

/** A line's heading and list marks, which aren't said. */
const lineStart = (text: string) => text.replace(/^\s*(?:#{1,6}\s+|[-+•]\s+|>\s*)/, '')

function blockKind(text: string): 'code' | 'table' | 'image' | 'link' | null {
  if (text.startsWith('```') || text.startsWith('~~~')) return 'code'
  if (text.startsWith('|')) return 'table'
  if (text.startsWith('![')) return 'image'
  if ((text.startsWith('http://') || text.startsWith('https://')) && !text.includes(' ')) return 'link'
  return null
}

/** Where the held part of a line starts: an unclosed link, an address still being written, or what may begin one. */
export function heldFrom(text: string): number {
  let held = text.endsWith('\r') ? text.length - 1 : text.length
  // A "*" or "_" may be half of "**" or "__".
  if (/[*_]$/.test(text)) held = Math.min(held, text.length - 1)
  const open = text.lastIndexOf('[')
  if (open >= 0 && !text.slice(open).includes(')')) held = open > 0 && text[open - 1] === '!' ? open - 1 : open
  const address = text.lastIndexOf('http')
  if (address >= 0 && (address === 0 || text[address - 1] !== '(') && !text.slice(address).includes(' ') && address < held) held = address
  // "ht" starting a word may become an address, "!" an image; a "!" ending a word is the sentence's.
  const scheme = 'https://'
  for (let length = Math.min(scheme.length, text.length); length >= 1; length--) {
    if (text.endsWith(scheme.slice(0, length)) || (length === 1 && text.endsWith('!'))) {
      const start = text.length - length
      if (start === 0 || !/\p{L}/u.test(text[start - 1]!)) held = Math.min(held, start)
      break
    }
  }
  return held
}

// MARK: Plain yes or no

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow it|approve|approved|please do|sounds good|go for it)\b[\s.!,]*(please)?[\s.!]*$/i
const NO = /^(no|nope|nah|don't|do not|deny|denied|stop|cancel|don't do it|not now)\b[\s.!,]*(thanks|thank you)?[\s.!]*$/i

/** "once" for a plain yes, "deny" for a plain no, null for anything else. */
export function plainDecision(words: string): 'once' | 'deny' | null {
  const text = words.trim().replace(/^(um+|uh+|well|hmm+)[,\s]+/i, '')
  if (YES.test(text)) return 'once'
  if (NO.test(text)) return 'deny'
  return null
}

// MARK: Lines the call says itself (the speech server speaks them)

export const BUSY_LINE = () => t('Hermes is still busy in this chat. Try again in a moment.')
export const FAILURE_LINE = () => t("Hermes couldn't take that just now.")
export const ON_SCREEN_LINE = () => t('The rest is on your screen.')
export const NEEDS_INPUT_LINE = () => t('Hermes needs your answer in the chat before it can go on.')
export const approvalLine = (what: string) => {
  const clipped = what.length > 200 ? `${what.slice(0, 200)}…` : what
  return t('Hermes needs your OK to go on: {what}. Say yes to allow it once, or no.', { what: clipped })
}

export const PLUGIN_MISSING = () => t('Update the Conduit plugin on your Hermes host to use Local Live.')
export const ANSWERED_WITHOUT_HERMES = () =>
  t('Your speech server answered without asking Hermes. Check that its model address and key match Settings > Voice > Local Live, then restart it.')
export const READY_TIMED_OUT = () =>
  t("Your speech server didn't ask Hermes for a reply. Check that it's running and that its model address and key match Settings > Voice > Local Live.")
export const refusedLine = (reason: string) =>
  reason
    ? t('Your speech server refused the call: {reason}', { reason: reason.length > 200 ? `${reason.slice(0, 199)}…` : reason })
    : t('Your speech server refused the call.')

/** A question Hermes asks, read out with its numbered choices (the phone's HermesCallWaiting.spokenQuestion). */
export function spokenQuestion(question: ClarifyQuestion, mayLeaveBlank = false): string {
  let line = t('Hermes asks: {question}', { question: question.question })
  question.choices.forEach((choice, i) => (line += `\n${i + 1}. ${choice}`))
  line +=
    '\n' +
    (!question.choices.length
      ? t('Answer in your own words.')
      : question.multiSelect
        ? t('Say the numbers of your choices, you may pick several, or answer in your own words.')
        : t('Say the number of your choice, or answer in your own words.'))
  if (mayLeaveBlank) line += ` ${t('Or say skip to leave it blank.')}`
  return line
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10
}

/** Spoken choice numbers ("Two.", "number 3", "the first one", "one and three") as digits; other words as they are. */
export function spokenChoice(words: string): string {
  const text = words
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/\s+please$/, '')
  const parts = text.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean)
  const numbers = parts.map(part => {
    const word = part
      .replace(/^(?:number|option|choice|the)\s+/, '')
      .replace(/^(\w+)\s+one$/, (whole, ordinal: string) => (/(?:st|nd|rd|th)$/.test(ordinal) ? ordinal : whole))
    return /^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? null)
  })
  return parts.length && numbers.every(n => n !== null) ? numbers.join(', ') : words.trim()
}

// MARK: Corrections

export type Correction = 'redirected' | 'queued' | 'rejected'

/**
 * Words the user said while Hermes was still on the call's last turn, put into
 * that reply (the phone's redirect): `redirected` when the reply goes on with
 * them, `queued` when Hermes runs them after it, `rejected` when nothing was
 * running to take them. A Hermes without session.redirect gets session.steer.
 */
export async function correctTurn(sessionId: string, text: string, profile?: string): Promise<Correction> {
  const params: Record<string, unknown> = { session_id: sessionId, text }
  if (profile) params.profile = profile
  try {
    const result = await gateway.rpc<{ status?: string } | null>('session.redirect', params)
    const status = result?.status?.toLowerCase()
    return status === 'redirected' || status === 'queued' ? status : 'rejected'
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!/unknown method|method not found|not supported/i.test(message)) throw e
    const result = await gateway.rpc<{ status?: string } | null>('session.steer', params)
    return result && result.status !== 'rejected' ? 'redirected' : 'rejected'
  }
}

// MARK: Agent mode (your fast model answers first)

/**
 * After the phone's Live > Local: the plugin's fast model
 * (voice.local_live.front_model) holds the conversation with these
 * instructions and tools, and the tools run here, as on Grok Live. Hermes
 * work goes to the chat with ask_thread, and Hermes' reply comes back as a
 * typed turn the speech server asks the fast model about.
 */
export const FRONT_MODEL_KEYS = {
  baseUrl: 'voice.local_live.front_model.base_url',
  model: 'voice.local_live.front_model.model',
  apiKey: 'voice.local_live.front_model.api_key'
} as const

export interface FrontModel {
  configured: boolean
  available: boolean
  baseUrl: string | null
  model: string | null
  hasKey: boolean
  reason: string | null
}

/** The status's front_model; null from a plugin without agent mode. */
export function frontModel(response: unknown): FrontModel | null {
  const raw = ((response ?? {}) as Row).front_model
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Row
  return {
    configured: r.configured === true,
    available: r.available === true,
    baseUrl: str(r.base_url),
    model: str(r.model),
    hasKey: r.has_key === true,
    reason: str(r.reason)
  }
}

/** Sent before the session.update, so the plugin answers every utterance after the readiness check with the fast model. */
export const agentConfigure = (instructions: string, tools: unknown[]): Row => ({ type: 'conduit.agent', instructions, tools })

/** A tool's answer; `speak` asks for it to be said even if the fast model stopped waiting. */
export const toolResult = (callId: string, result: Record<string, string>, speak = false): Row => ({
  type: 'conduit.tool.result',
  call_id: callId,
  output: JSON.stringify(Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))),
  speak
})

export type AgentFrame = { type: 'toolCall'; id: string; name: string; args: Record<string, string> } | { type: 'late'; id: string }

/** The plugin's agent-mode frame; null for anything else. Arguments as strings, as Grok's are. */
export function agentFrame(text: string): AgentFrame | null {
  if (!text.includes('"conduit.tool.')) return null
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return null
  }
  const id = str(o?.call_id)
  if (!id) return null
  if (o.type === 'conduit.tool.late') return { type: 'late', id }
  if (o.type !== 'conduit.tool.call') return null
  const name = str(o.name)
  if (!name) return null
  let parsed: unknown = {}
  if (o.arguments && typeof o.arguments === 'object') parsed = o.arguments
  else if (typeof o.arguments === 'string' && o.arguments.trim()) {
    try {
      parsed = JSON.parse(o.arguments)
    } catch {
      parsed = null
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { type: 'toolCall', id, name, args: { invalid_arguments: 'true' } }
  const args: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Row)) {
    if (value === null || value === undefined) continue
    args[key] = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  return { type: 'toolCall', id, name, args }
}

/** A tool's answer that came after the fast model stopped waiting, as a turn it reports. */
export function lateResultText(name: string, result: Record<string, string>): string {
  const body = Object.entries(result)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  return `Update from ${name}, which answered late:\n${body}\nTell the user what matters from it, briefly.`
}

/** Added to the shared live instructions in agent mode (written for the model, so not translated). */
export const AGENT_INSTRUCTIONS =
  "\nYou answer first on this call and Hermes does the real work, but to the user you are one assistant: never call yourself a front, a relay or a go-between, and never say you're passing something on. You can't see the user's email, messages, calendar and schedule, to-dos, health, bank or other accounts, files or systems yourself; Hermes can. Whenever the user asks you to check, read, find, send or do anything there (\"what's on my plate today?\" included), call ask_thread with their request instead of saying you can't, and never answer it from guesses." +
  "\nOn this call ask_thread answers as soon as Hermes has the request. Never say anything was started, sent or done unless a tool's result said so; if a tool returns an error, tell the user plainly. Tools are only ever function calls: never speak a tool call, its name or its arguments."

/** Public facts go to Hermes: the fast model has no web of its own here. */
export const AGENT_LOOKUPS =
  "You can't look anything up on this call: for weather, news, sports, prices and other facts you don't know, call ask_thread and let Hermes find them."

const AGENT_KEY = 'conduit.localLiveAgent'
const PERSONA_KEY = 'conduit.localLivePersonality'

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function setFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true')
    else localStorage.removeItem(key)
  } catch {
    // Off next time.
  }
}

/** Your fast model answers first (agent mode); off, Hermes answers each turn. */
export const localLiveAgent = () => flag(AGENT_KEY)
export const setLocalLiveAgent = (on: boolean) => setFlag(AGENT_KEY, on)
/** The fast model speaks with SOUL.md, which then goes to its server. */
export const localLivePersona = () => flag(PERSONA_KEY)
export const setLocalLivePersona = (on: boolean) => setFlag(PERSONA_KEY, on)
