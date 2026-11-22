/**
 * Grok Live, after the phone's GrokLiveClient and GrokLiveProtocol: xAI's
 * realtime voice model, reached through the Conduit plugin's relay socket
 * (`grok-live/socket`), which adds the host's SuperGrok sign-in (or its
 * XAI_API_KEY) on the way. The credential never reaches Conduit. The events
 * follow OpenAI's Realtime API: session.update, input_audio_buffer.append,
 * conversation.item.create and response.create out; audio and transcript
 * deltas, function calls and response.done back.
 */
import { RECALL_SPEC, TOOL_SPECS, clockInstructions, liveInstructions, pcmBase64 } from './liveCall'
import type { PhoneTool } from './phoneReads'

export {
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
  pcmSamples,
  readReply
} from './liveCall'

export const STATUS_PATH = '/api/plugins/conduit_push/grok-live/status'
export const SOCKET_PATH = '/api/plugins/conduit_push/grok-live/socket'
export const DEFAULT_MODEL = 'grok-voice-latest'
/** PCM16 both ways, at the rate xAI's own voice clients use. */
export const SAMPLE_RATE = 24_000
export const TRANSCRIPTION_MODEL = 'grok-transcribe'
/** The session is ready once session.updated comes back, or the call fails after this. */
export const START_TIMEOUT_MS = 15_000

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export type Availability = { ok: true; model: string; voice: string | null; auth: string | null } | { ok: false; reason: string | null }

/** The line as kept: `auth` names the sign-in used (subscription or API key), never a secret, but the store leaves out any name like it. */
export function packGrokLine(line: Availability): unknown {
  if (!line.ok) return line
  const { auth, ...rest } = line
  return { ...rest, signIn: auth }
}

export function unpackGrokLine(kept: unknown): Availability | null {
  const r = (kept ?? {}) as Row
  if (r.ok === false) return { ok: false, reason: str(r.reason) }
  if (r.ok !== true || !str(r.model)) return null
  return { ok: true, model: str(r.model)!, voice: str(r.voice), auth: str(r.signIn) }
}

/** The plugin's status: whether this host can relay Grok Live. */
export function availability(response: unknown): Availability {
  const r = (response ?? {}) as Row
  const reason = str(r.reason) ?? str(r.detail) ?? str(r.error)
  if (r.ok !== true || r.available !== true) return { ok: false, reason }
  return { ok: true, model: str(r.model) ?? DEFAULT_MODEL, voice: str(r.voice), auth: str(r.auth) }
}

/** The credential the host uses, by name: never translated. */
export const via = (auth: string | null) => (auth === 'api_key' ? 'XAI_API_KEY' : 'SuperGrok')

// MARK: Close codes the relay sends

const CLOSE_REASONS: Record<number, string> = {
  4503: 'Grok Live needs xAI on the Hermes host.',
  4401: 'Dashboard sign-in required',
  4429: 'Too many Grok Live connections; try again shortly'
}

/** What a close from the relay means, for the call's failure line; null for an ordinary close. */
export function closeReason(code: number, reason: string): string | null {
  if (code === 1000 || code === 1005) return null
  return reason.trim() || CLOSE_REASONS[code] || null
}

// MARK: Tools

/** The shared tools as Realtime function tools. */
export const FUNCTION_TOOLS = TOOL_SPECS.map(tool => ({ type: 'function', ...tool }))

/** xAI's own search tools, run on xAI's side during the call. */
export const NATIVE_TOOLS = [{ type: 'web_search' }, { type: 'x_search' }]
/** Names xAI keeps for its own tools: a call by one of them is xAI's to run. */
const RESERVED = new Set(['web_search', 'x_search', 'browse_page', 'file_search'])

// MARK: Instructions

const DELEGATION =
  "\nYou can't see the user's email, messages, calendar and schedule, to-dos, health or patient portals, bank or other accounts, files or systems, and web lookups can't reach them either; their Hermes agent can. Whenever the user asks you to check, read, find, send or do anything there (\"what's on my plate today?\" included), call ask_thread with their request instead of saying you can't. If they only ask whether you can see it, say Hermes can check it for them. Never answer it from guesses or a web lookup, and if ask_thread fails, tell them plainly. Public facts anyone could look up (weather, news, sports, stock prices) aren't Hermes work: look them up with web_search or x_search on this call, never with ask_thread."
const CLAIMS =
  "\nOn this call ask_thread answers as soon as Hermes has the request. Never say anything was started, sent or done unless a tool's result said so; if a tool returns an error, tell the user plainly. Tools are only ever function calls: never speak a tool call, its name or its arguments."

/**
 * Grok's instructions: the shared ones with Grok's additions (Hermes work goes
 * to Hermes, no claims a tool didn't confirm, the computer's clock).
 */
export function instructions(options: {
  language?: string
  persona?: string
  memory?: string
  recall?: boolean
  asked?: string
  chat?: string
  now?: Date
  timeZone?: string
  asksFirst?: boolean
  phoneNow?: string
  phoneTools?: PhoneTool[]
}): string {
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  return liveInstructions({
    ...options,
    lookups:
      'For weather, news, sports, stock prices, and other public facts, look them up yourself with web_search (the web) or x_search (posts on X) and answer on this call; never send them to Hermes.',
    announces: false,
    extra: DELEGATION + CLAIMS + clockInstructions(options.now ?? new Date(), timeZone)
  })
}

// MARK: Client → server

/** The session's configuration: server turn detection, PCM both ways, the instructions and the tools (recall_memory when the host's memory provider can be searched). */
export function sessionUpdate(text: string, voice?: string | null, recall = false, phoneTools: PhoneTool[] = []): Row {
  const session: Row = {
    instructions: text,
    // Fast replies: this is a conversation, the work goes to Hermes.
    reasoning: { effort: 'none' },
    turn_detection: { type: 'server_vad', silence_duration_ms: 700, prefix_padding_ms: 300 },
    audio: {
      input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE }, transcription: { model: TRANSCRIPTION_MODEL } },
      output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } }
    },
    tools: [
      ...NATIVE_TOOLS,
      ...FUNCTION_TOOLS,
      ...(recall ? [{ type: 'function', ...RECALL_SPEC }] : []),
      ...phoneTools.map(tool => ({ type: 'function', ...tool }))
    ],
    tool_choice: 'auto'
  }
  if (voice) session.voice = voice
  return { type: 'session.update', session }
}

/** A message from Conduit the model answers (with `response.create` after it). */
export const textTurn = (text: string): Row => ({
  type: 'conversation.item.create',
  item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
})

/** A function call's answer. */
export const toolOutput = (callId: string, result: Record<string, string>): Row => ({
  type: 'conversation.item.create',
  item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) }
})

export const responseCreate = (): Row => ({ type: 'response.create' })

/** One microphone chunk: float samples at 24 kHz as base64 PCM16 (little-endian). */
export function audioAppend(samples: Float32Array): Row {
  return { type: 'input_audio_buffer.append', audio: pcmBase64(samples) }
}

// MARK: Server → client

export type ServerEvent =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'responseStarted' }
  | { type: 'responseDone' }
  | { type: 'speechStarted' }
  | { type: 'speechStopped' }
  /** The user's words in one item, whole each time; `final` once it's the completed transcript. */
  | { type: 'input'; itemId: string | null; text: string; final: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'output'; text: string }
  | { type: 'outputDone'; text: string }
  | { type: 'toolCall'; id: string; name: string; args: Record<string, string> }

/** One frame's meaning; unknown types are ignored. */
export function decode(text: string): ServerEvent | null {
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  switch (o.type) {
    case 'session.updated':
      return { type: 'ready' }
    case 'error': {
      const e = (o.error ?? {}) as Row
      return { type: 'error', message: str(e.message) ?? str(o.message) ?? str(e.code) ?? '' }
    }
    case 'response.created':
      return { type: 'responseStarted' }
    case 'response.done':
      return { type: 'responseDone' }
    case 'input_audio_buffer.speech_started':
      return { type: 'speechStarted' }
    case 'input_audio_buffer.speech_stopped':
      return { type: 'speechStopped' }
    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = str(o.transcript)
      if (!transcript) return null
      return { type: 'input', itemId: str(o.item_id), text: transcript, final: o.status !== 'in_progress' }
    }
    case 'response.output_audio.delta':
    case 'response.audio.delta': {
      const pcm = str(o.delta)
      return pcm ? { type: 'audio', pcm } : null
    }
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta': {
      const delta = str(o.delta)
      return delta ? { type: 'output', text: delta } : null
    }
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done': {
      const transcript = str(o.transcript)
      return transcript ? { type: 'outputDone', text: transcript } : null
    }
    case 'response.function_call_arguments.done':
      return functionCall(o)
    case 'response.output_item.done': {
      // The finished function_call item carries the same call: a fallback when the arguments event never came.
      const item = (o.item ?? {}) as Row
      return item.type === 'function_call' ? functionCall(item) : null
    }
    default:
      return null
  }
}

/** A call by one of Conduit's tools; arguments as strings. A call whose arguments aren't a JSON object is marked, never run with none. */
function functionCall(o: Row): ServerEvent | null {
  const id = str(o.call_id)
  const name = str(o.name)
  if (!id || !name || RESERVED.has(name)) return null
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

// MARK: Settings (kept on this computer, each off until switched on: it sends that text to xAI)

const MEMORY_KEY = 'conduit.grokLiveMemory'
const PERSONA_KEY = 'conduit.grokLivePersonality'

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

export const grokSendsMemory = () => flag(MEMORY_KEY)
export const grokSendsPersona = () => flag(PERSONA_KEY)
export const setGrokSendsMemory = (on: boolean) => setFlag(MEMORY_KEY, on)
export const setGrokSendsPersona = (on: boolean) => setFlag(PERSONA_KEY, on)
