/**
 * Gemini Live, after the phone's GeminiLiveTokenClient and GeminiLiveProtocol:
 * the Hermes host keeps GEMINI_API_KEY and mints a single-use Google token per
 * connection (`gemini-live/token`); the computer's main process opens Google's
 * socket with it (BidiGenerateContent), so the token never reaches the window.
 * Pure encode and decode here, so every message shape is testable.
 */
import { t } from '../../../shared/i18n'
import { RECALL_SPEC, TOOL_SPECS, liveInstructions, pcmBase64 } from './liveCall'
import type { PhoneTool } from './phoneReads'
import { WEB_SEARCH_SPEC } from './qwenLive'

export const STATUS_PATH = '/api/plugins/conduit_push/gemini-live/status'
export const TOKEN_PATH = '/api/plugins/conduit_push/gemini-live/token'
export const DEFAULT_MODEL = 'models/gemini-3.8-live'
export const INPUT_RATE = 16_000
export const OUTPUT_RATE = 24_000
export const START_TIMEOUT_MS = 15_000

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export type Availability = { ok: true; model: string } | { ok: false; reason: string | null }

/** The plugin's status: whether this host can mint Gemini Live tokens. */
export function availability(response: unknown): Availability {
  const r = (response ?? {}) as Row
  const reason = str(r.reason) ?? str(r.error)
  if (r.ok !== true || r.available !== true) return { ok: false, reason }
  return { ok: true, model: str(r.model) ?? DEFAULT_MODEL }
}

/** `gemini-3.8-live` → `models/gemini-3.8-live`. */
export const qualifiedModel = (model: string) => (model.startsWith('models/') ? model : `models/${model}`)

// MARK: Instructions

/** Where quick lookups go: Google Search (Gemini's own), the host's web search (a web_search function), or none. */
export type Search = 'google' | 'hermes' | 'none'

/** Where lookups go, as chosen in Settings, after the phone's GeminiLiveSearchMode; Qwen has no Google. */
export type SearchMode = 'automatic' | 'hermes' | 'google' | 'off'
const SEARCH_KEYS = { gemini: 'conduit.geminiLiveSearch', qwen: 'conduit.qwenLiveSearch' } as const

export function searchMode(provider: 'gemini' | 'qwen'): SearchMode {
  try {
    const saved = localStorage.getItem(SEARCH_KEYS[provider])
    return saved === 'hermes' || saved === 'off' || (saved === 'google' && provider === 'gemini') ? saved : 'automatic'
  } catch {
    return 'automatic'
  }
}

export function setSearchMode(provider: 'gemini' | 'qwen', mode: SearchMode): void {
  try {
    if (mode === 'automatic') localStorage.removeItem(SEARCH_KEYS[provider])
    else localStorage.setItem(SEARCH_KEYS[provider], mode)
  } catch {
    // Automatic next time.
  }
}

/** The call's lookups: automatic takes the host's web search when it has one, else Google (Qwen: none). */
export function resolvedSearch(mode: SearchMode, hostSearch: boolean, provider: 'gemini' | 'qwen'): Search {
  if (mode === 'off') return 'none'
  if (mode === 'hermes') return 'hermes'
  if (mode === 'google' && provider === 'gemini') return 'google'
  return hostSearch ? 'hermes' : provider === 'gemini' ? 'google' : 'none'
}

/**
 * Google's wording for a spent quota ("You exceeded your current quota…",
 * RESOURCE_EXHAUSTED), after the phone's isQuotaExhausted: Google Search is
 * metered on its own, so a call refused for it goes on without Search.
 */
export function quotaExhausted(reason: string): boolean {
  const text = reason.toLowerCase().replace(/_/g, ' ').split(/\s+/).join(' ')
  return text.includes('exceeded your current quota') || text.includes('resource exhausted') || text.includes('resource has been exhausted')
}

const LOOKUPS: Record<Search, string> = {
  google: 'For weather, news, sports, prices, and other quick facts from the web, use Google Search and answer directly.',
  // The answer is a turn of its own, after the call's turn ended: told only "first say 'Let me check.'", the model opened that turn with the same words again.
  hermes:
    'For weather, news, sports, prices, and other quick facts from the web, call web_search. Just before you call it, say a few words out loud so the user knows you\'re looking it up, in your own words and different each time (for example "One sec.", "Let me look that up." or "Checking now."). Say that only once per lookup: the result arrives a few seconds later as its own turn, and that turn opens straight with the answer, never with another "let me check". Never guess the answer before the result arrives; if it returns an error, say in a few words that the lookup failed.',
  none: 'You have no web search. A question that needs current information from the web (weather, news, prices) is work for Hermes: offer to ask Hermes for it.'
}

/**
 * The instructions for Gemini (and Qwen, on the same shell): the shared ones,
 * with quick facts looked up where `search` says, and the request
 * acknowledged as it goes (its ask_thread call stays open until Hermes replies).
 */
export function instructions(options: {
  language?: string
  persona?: string
  memory?: string
  recall?: boolean
  asked?: string
  chat?: string
  search?: Search
  asksFirst?: boolean
  phoneNow?: string
  phoneTools?: PhoneTool[]
}): string {
  return liveInstructions({
    ...options,
    lookups: LOOKUPS[options.search ?? 'google'],
    announces: true
  })
}

// MARK: Client → server

/**
 * The tools as Gemini declarations: OpenAPI types in capitals; ask_thread and
 * read_last_reply NON_BLOCKING (the call stays open while the model talks on),
 * end_conversation BLOCKING.
 */
export function functionDeclarations(recall = false, webSearch = false, phoneTools: PhoneTool[] = []): Row[] {
  const upper = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(upper)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : upper(v)]))
    return value
  }
  // The phone's reads answer in a moment: the model waits for them.
  const blocking = new Set(['end_conversation', 'show_on_screen', 'list_jobs', 'cancel_job', 'call_me_when_done', 'set_ask_first', ...phoneTools.map(tool => tool.name)])
  return [...TOOL_SPECS, ...(recall ? [RECALL_SPEC] : []), ...(webSearch ? [WEB_SEARCH_SPEC] : []), ...phoneTools].map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: upper(tool.parameters),
    behavior: blocking.has(tool.name) ? 'BLOCKING' : 'NON_BLOCKING'
  }))
}

/** The session's setup: audio replies, the instructions, the tools (with Google Search or the host's web_search), and both transcriptions. */
/**
 * `resumption`: Gemini's session resumption, as on the phone. `{}` asks for
 * handles; a handle continues that session on a new connection (after a
 * GoAway, or a socket that dropped or stopped taking frames). Qwen has none.
 */
export function setupMessage(
  model: string,
  systemInstruction: string,
  voice?: string | null,
  recall = false,
  search: Search = 'google',
  resumption?: { handle?: string | null },
  phoneTools: PhoneTool[] = []
): Row {
  const generationConfig: Row = { responseModalities: ['AUDIO'] }
  if (voice) generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
  return {
    setup: {
      model: qualifiedModel(model),
      generationConfig,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{ functionDeclarations: functionDeclarations(recall, search === 'hermes', phoneTools) }, ...(search === 'google' ? [{ googleSearch: {} }] : [])],
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false },
        // The user's speech always interrupts the model.
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'
      },
      contextWindowCompression: { slidingWindow: {} },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(resumption ? { sessionResumption: resumption.handle ? { handle: resumption.handle } : {} } : {})
    }
  }
}

/** One microphone chunk at 16 kHz. */
export const audioMessage = (samples: Float32Array): Row => ({
  realtimeInput: { audio: { mimeType: `audio/pcm;rate=${INPUT_RATE}`, data: pcmBase64(samples) } }
})

/** The microphone was muted mid-utterance: the server ends the user's turn now. */
export const audioStreamEnd = (): Row => ({ realtimeInput: { audioStreamEnd: true } })

/** A message from Conduit for a call that has no open function call to answer on. */
export const textTurn = (text: string): Row => ({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } })

export type Scheduling = 'WHEN_IDLE' | 'SILENT'

/** A function call's answer; a NON_BLOCKING one's `scheduling` goes in both places Google reads it. */
export function toolResponse(id: string, name: string, result: Record<string, string>, scheduling?: Scheduling): Row {
  const response: Row = { ...result }
  const functionResponse: Row = { id, name }
  if (scheduling) {
    response.scheduling = scheduling
    functionResponse.scheduling = scheduling
  }
  functionResponse.response = response
  return { toolResponse: { functionResponses: [functionResponse] } }
}

// MARK: Server → client

export type ServerEvent =
  | { type: 'ready' }
  | { type: 'audio'; pcm: string }
  | { type: 'input'; text: string }
  | { type: 'output'; text: string }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'toolCall'; id: string; name: string; args: Record<string, string> }
  | { type: 'toolCancel'; ids: string[] }
  | { type: 'goAway' }
  | { type: 'resumption'; handle: string | null; resumable: boolean }

/** One frame can carry several events (audio, a transcription and turnComplete together). */
export function decode(text: string): ServerEvent[] {
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return []
  }
  if (!o || typeof o !== 'object') return []
  const events: ServerEvent[] = []
  if (o.setupComplete !== undefined) events.push({ type: 'ready' })
  const content = o.serverContent as Row | undefined
  if (content && typeof content === 'object') {
    const parts = ((content.modelTurn as Row | undefined)?.parts ?? []) as Row[]
    for (const part of Array.isArray(parts) ? parts : []) {
      const inline = part.inlineData as Row | undefined
      const mime = str(inline?.mimeType)
      const data = str(inline?.data)
      if (mime?.startsWith('audio/pcm') && data) events.push({ type: 'audio', pcm: data })
    }
    const heard = str((content.inputTranscription as Row | undefined)?.text)
    if (heard) events.push({ type: 'input', text: heard })
    const said = str((content.outputTranscription as Row | undefined)?.text)
    if (said) events.push({ type: 'output', text: said })
    if (content.interrupted === true) events.push({ type: 'interrupted' })
    if (content.turnComplete === true) events.push({ type: 'turnComplete' })
  }
  const calls = (o.toolCall as Row | undefined)?.functionCalls
  for (const call of Array.isArray(calls) ? (calls as Row[]) : []) {
    const id = str(call.id)
    const name = str(call.name)
    if (!id || !name) continue
    const args: Record<string, string> = {}
    const raw = call.args && typeof call.args === 'object' ? (call.args as Row) : {}
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue
      args[key] = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    events.push({ type: 'toolCall', id, name, args })
  }
  const cancelled = (o.toolCallCancellation as Row | undefined)?.ids
  if (Array.isArray(cancelled) && cancelled.length) events.push({ type: 'toolCancel', ids: cancelled.filter((id): id is string => typeof id === 'string') })
  if (o.goAway !== undefined) events.push({ type: 'goAway' })
  const update = o.sessionResumptionUpdate as Row | undefined
  if (update && typeof update === 'object') events.push({ type: 'resumption', handle: str(update.newHandle) ?? null, resumable: update.resumable === true })
  return events
}

/** Why Google closed the socket, for the call's failure line; null for an ordinary close. */
export const closeReason = (code: number, reason: string): string | null => (code === 1000 || code === 1005 ? null : reason.trim() || null)

// MARK: Voices

/** Google's prebuilt voices for native-audio models, in Google's order, with the phone's styles. */
export const VOICES: [string, () => string][] = [
  ['Zephyr', () => t('Bright')],
  ['Puck', () => t('Upbeat')],
  ['Charon', () => t('Informative')],
  ['Kore', () => t('Firm')],
  ['Fenrir', () => t('Excitable')],
  ['Leda', () => t('Youthful')],
  ['Orus', () => t('Firm')],
  ['Aoede', () => t('Breezy')],
  ['Callirrhoe', () => t('Easy-going')],
  ['Autonoe', () => t('Bright')],
  ['Enceladus', () => t('Breathy')],
  ['Iapetus', () => t('Clear')],
  ['Umbriel', () => t('Easy-going')],
  ['Algieba', () => t('Smooth')],
  ['Despina', () => t('Smooth')],
  ['Erinome', () => t('Clear')],
  ['Algenib', () => t('Gravelly')],
  ['Rasalgethi', () => t('Informative')],
  ['Laomedeia', () => t('Upbeat')],
  ['Achernar', () => t('Soft')],
  ['Alnilam', () => t('Firm')],
  ['Schedar', () => t('Even')],
  ['Gacrux', () => t('Mature')],
  ['Pulcherrima', () => t('Forward')],
  ['Achird', () => t('Friendly')],
  ['Zubenelgenubi', () => t('Casual')],
  ['Vindemiatrix', () => t('Gentle')],
  ['Sadachbia', () => t('Lively')],
  ['Sadaltager', () => t('Knowledgeable')],
  ['Sulafat', () => t('Warm')]
]

const VOICE_KEY = 'conduit.geminiLiveVoice'

/** The voice picked here; '' leaves the host's (or Gemini's) default. */
export function geminiVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setGeminiVoice(voice: string): void {
  try {
    if (voice) localStorage.setItem(VOICE_KEY, voice)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    // The default next time.
  }
}

// MARK: Settings (kept on this computer, each off until switched on: it sends that text to Google)

const MEMORY_KEY = 'conduit.geminiLiveMemory'
const PERSONA_KEY = 'conduit.geminiLivePersonality'

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

export const geminiSendsMemory = () => flag(MEMORY_KEY)
export const geminiSendsPersona = () => flag(PERSONA_KEY)
export const setGeminiSendsMemory = (on: boolean) => setFlag(MEMORY_KEY, on)
export const setGeminiSendsPersona = (on: boolean) => setFlag(PERSONA_KEY, on)
