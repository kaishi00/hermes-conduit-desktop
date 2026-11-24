/**
 * A chat's saved voice calls, after the phone's VoiceCallChatLink and
 * VoiceChatCallTranscriptSheet: the plugin keeps each live call's turns with
 * the chat it was attached to, and lists every chat's calls beside the voice
 * tags (`voice/tags`'s `chat_calls`). The chat shows a card where each call
 * started; the card opens what was said, read from `voice/chat-calls` when
 * it's opened, so a call made on the phone shows here too.
 */
import { gateway } from '../gateway'
import { t } from '../../../shared/i18n'
import { withProfile } from './gptLive'
import type { CallItem, TranscriptItem } from './transcript'

export const TAGS_PATH = '/api/plugins/conduit_push/voice/tags'
export const CHAT_CALLS_PATH = '/api/plugins/conduit_push/voice/chat-calls'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const seconds = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

export interface ChatCall {
  callId: string
  chatId: string
  engine: string | null
  /** Milliseconds since 1970. */
  startedAt: number
  endedAt: number
}

/** The calls `voice/tags` lists with `chatId`, oldest first; none from a plugin that predates the list. */
export function chatCalls(response: unknown, chatId: string): ChatCall[] {
  const list = ((response ?? {}) as Row).chat_calls
  if (!Array.isArray(list)) return []
  const calls: ChatCall[] = []
  for (const raw of list as Row[]) {
    if (!raw || typeof raw !== 'object') continue
    const callId = str(raw.call_id)
    const started = seconds(raw.started_at)
    if (!callId || raw.chat_id !== chatId || started === null) continue
    const ended = Math.max(started, seconds(raw.ended_at) ?? started)
    calls.push({ callId, chatId, engine: str(raw.engine), startedAt: started * 1000, endedAt: ended * 1000 })
  }
  return calls.sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * The chat's items with a card for each call, placed before the first item
 * after the call started (or at the end). Items without a time stay where they are.
 * A chat holding only its newest stored pages (`moreAbove`) leaves out the calls
 * from before its first timed item: their place is in a page not read yet, and
 * drawn on top of the rows held they would stay there as each page is read in.
 */
export function withCalls(items: TranscriptItem[], calls: ChatCall[], moreAbove = false): TranscriptItem[] {
  if (!calls.length) return items
  const out: TranscriptItem[] = []
  let next = 0
  if (moreAbove) {
    const first = items.find(item => 'at' in item && typeof item.at === 'number') as { at: number } | undefined
    while (first && next < calls.length && calls[next]!.startedAt < first.at) next++
  }
  const card = (call: ChatCall): CallItem => ({
    kind: 'call',
    key: `call-${call.callId}`,
    callId: call.callId,
    startedAt: call.startedAt,
    endedAt: call.endedAt
  })
  for (const item of items) {
    const at = 'at' in item && typeof item.at === 'number' ? item.at : null
    while (at !== null && next < calls.length && calls[next]!.startedAt < at) out.push(card(calls[next++]!))
    out.push(item)
  }
  while (next < calls.length) out.push(card(calls[next++]!))
  return out
}

/** `65_000` → `1m 5s`: the two largest units, as the phone's card shows the length. */
export function callLength(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return m ? `${h}h ${m}m` : `${h}h`
  if (m) return s ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

export interface CallTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface CallTranscript {
  engine: string | null
  turns: CallTurn[]
  /** How many turns the host holds for the call: where a resumed call's turns continue. */
  count: number
}

/** One call's turns from `voice/chat-calls`; null when the host no longer has it. */
export function callTranscript(response: unknown, callId: string): CallTranscript | null {
  const calls = ((response ?? {}) as Row).calls
  if (!Array.isArray(calls)) return null
  const call = (calls as Row[]).find(c => c && typeof c === 'object' && c.call_id === callId)
  if (!call) return null
  const turns: CallTurn[] = []
  const stored = Array.isArray(call.turns) ? (call.turns as Row[]) : []
  for (const turn of stored) {
    const text = typeof turn?.text === 'string' ? turn.text.trim() : ''
    if (text && (turn.role === 'user' || turn.role === 'assistant')) turns.push({ role: turn.role, text })
  }
  return turns.length ? { engine: str(call.engine), turns, count: stored.length } : null
}

/** Who said a line, as the phone's transcript names them. */
export function speaker(role: CallTurn['role'], engine: string | null): string | null {
  if (role === 'user') return t('You')
  switch (engine) {
    case 'gpt-live':
      return 'GPT-Live'
    case 'grok-live':
      return 'Grok'
    case 'gemini-live':
      return 'Gemini'
    case 'qwen-live':
      return 'Qwen'
    case 'local-live':
      return 'Hermes'
    default:
      return null
  }
}

const query = (path: string, params: Record<string, string>) => `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`

/** The chat's saved calls; none when the host can't say. */
export async function loadChatCalls(profile: string | undefined, chatId: string): Promise<ChatCall[]> {
  try {
    return chatCalls(await gateway.http('GET', withProfile(TAGS_PATH, profile)), chatId)
  } catch {
    return []
  }
}

/** One call's transcript, read when its card is opened. */
export async function loadCallTranscript(profile: string | undefined, chatId: string, callId: string): Promise<CallTranscript | null> {
  return callTranscript(await gateway.http('GET', query(withProfile(CHAT_CALLS_PATH, profile), { chat_id: chatId, call_id: callId })), callId)
}
