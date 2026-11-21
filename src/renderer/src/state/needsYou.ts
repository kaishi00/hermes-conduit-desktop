/**
 * Needs you: what Hermes is waiting on the user for.
 *
 * - Requests: the gateway's `approval` and `clarify` server requests for the
 *   chats this window has open, answered on their cards.
 * - The waiting list: the Conduit plugin's `GET /waiting` (one per profile),
 *   every chat of a profile with a wait, the phone's Needs you list
 *   (hermes-conduit issue 1705). It only reads; a row opens its chat, where
 *   the resume replays the request as a card.
 * - Its questions: what a bot asked that waits past its turn (work_propose,
 *   and clarify questions kept after they ran out, notifier 0.189.0). Each is a
 *   row that opens the chat that asked, as the phone's (open-only, Eric
 *   2026-11-05); the Work panel's card answers it with a tap.
 */
import type { PendingRequest } from '../../../shared/ipc'
import { cleanTitle } from './text'
import { inputPromptView } from './inputPrompts'
import { t } from '../../../shared/i18n'

export const WAITING_PATH = '/api/plugins/conduit_push/waiting'

/** How often the waiting list is read while the window is on screen, as the phone does. */
export const WAITING_POLL_MS = 20_000

export interface WaitingRow {
  id: string
  kind: 'approval' | 'question'
  /** The ids the chat goes by (stored and live). */
  sessionIds: string[]
  title: string
  summary: string
  /** A question batch's size. */
  questions: number
  /** When the wait began, in milliseconds. */
  at: number
  profile?: string
}

export function waitingPath(profile?: string): string {
  return profile ? `${WAITING_PATH}?profile=${encodeURIComponent(profile)}` : WAITING_PATH
}

export function waitingFromResponse(body: unknown, profile?: string): WaitingRow[] {
  const list = body && typeof body === 'object' ? (body as { waiting?: unknown }).waiting : undefined
  const rows: WaitingRow[] = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || (item.kind !== 'approval' && item.kind !== 'question')) continue
    const at = typeof item.at === 'number' ? item.at : 0
    rows.push({
      id: item.id,
      kind: item.kind,
      sessionIds: Array.isArray(item.session_ids) ? item.session_ids.filter((s): s is string => typeof s === 'string') : [],
      title: cleanTitle(typeof item.title === 'string' ? item.title : '') || 'A chat',
      summary: typeof item.summary === 'string' ? item.summary : '',
      questions: typeof item.questions === 'number' ? item.questions : 0,
      at: at > 0 && at < 1e11 ? at * 1000 : at,
      profile
    })
  }
  return [...rows, ...askedRows(body, profile)]
}

/** A row for a question that waits past its turn (from /waiting's questions). */
export const isAsked = (row: WaitingRow) => row.id.startsWith('asked-')

/** The questions a /waiting read lists past their turn, as rows that open the chat that asked. */
function askedRows(body: unknown, profile?: string): WaitingRow[] {
  const list = body && typeof body === 'object' ? (body as { questions?: unknown }).questions : undefined
  if (!Array.isArray(list)) return []
  const rows: WaitingRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const sessionIds = Array.isArray(item.session_ids) ? item.session_ids.filter((s): s is string => typeof s === 'string' && !!s) : []
    // A row opens its chat, so one with no chat to open isn't listed.
    if (typeof item.id !== 'string' || !item.id || item.status !== 'open' || !sessionIds.length) continue
    const at = typeof item.at === 'number' ? item.at : 0
    rows.push({
      // A question's id is its bot's (P7): the profile and its chat keep two bots', or two hosts', apart,
      // while one Hermes saved at two addresses still lists it once.
      id: `asked-${profile ?? ''}-${item.id}-${sessionIds[0]}`,
      kind: 'question',
      sessionIds,
      title: cleanTitle(typeof item.chat_title === 'string' ? item.chat_title : '') || 'A chat',
      summary: typeof item.text === 'string' ? item.text.trim() : '',
      questions: 1,
      at: at > 0 && at < 1e11 ? at * 1000 : at,
      profile
    })
  }
  return rows
}

export interface ApprovalChoice {
  choice: string
  label: string
  tone: 'primary' | 'plain' | 'danger'
}

const CHOICE_LABELS = (): Record<string, [string, ApprovalChoice['tone']]> => ({
  once: [t('Allow once'), 'primary'],
  session: [t('Allow for this chat'), 'plain'],
  always: [t('Always allow'), 'plain'],
  deny: [t('Deny'), 'danger']
})

/** The buttons an approval offers, in the order Hermes lists them. */
export function approvalChoices(params: Record<string, unknown>): ApprovalChoice[] {
  const listed = Array.isArray(params.choices) ? params.choices.filter((c): c is string => typeof c === 'string') : []
  const choices = listed.length ? listed : ['once', 'deny']
  return choices.map(choice => {
    const known = CHOICE_LABELS()[choice]
    return { choice, label: known?.[0] ?? choice.charAt(0).toUpperCase() + choice.slice(1), tone: known?.[1] ?? 'plain' }
  })
}

export interface ApprovalView {
  description: string
  command?: string
  choices: ApprovalChoice[]
}

export function approvalView(params: Record<string, unknown>): ApprovalView {
  const description = typeof params.description === 'string' && params.description.trim() ? params.description.trim() : t('Hermes wants to run a command.')
  const command = typeof params.command === 'string' && params.command.trim() ? params.command : undefined
  return { description, command, choices: approvalChoices(params) }
}

export interface ClarifyQuestion {
  qid: string
  question: string
  choices: string[]
  multiSelect: boolean
}

export function clarifyQuestions(params: Record<string, unknown>): ClarifyQuestion[] {
  const list = Array.isArray(params.questions) ? params.questions : []
  const out: ClarifyQuestion[] = []
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const q = raw as Record<string, unknown>
    const question = typeof q.question === 'string' ? q.question : ''
    if (!question) return
    out.push({
      qid: typeof q.qid === 'string' ? q.qid : String(index),
      question,
      choices: Array.isArray(q.choices) ? q.choices.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [],
      multiSelect: q.multi_select === true
    })
  })
  return out
}

/** The answers a batch already locked (a replay after a reconnect carries them); `null` is a skip. */
export function lockedAnswers(params: Record<string, unknown>): Record<string, string | null> {
  const answers = params.answers
  if (!answers || typeof answers !== 'object') return {}
  const out: Record<string, string | null> = {}
  for (const [qid, value] of Object.entries(answers as Record<string, unknown>)) {
    out[qid] = typeof value === 'string' ? value : value === null ? null : JSON.stringify(value)
  }
  return out
}

/** One line for a request in the Needs you list. */
export function requestSummary(request: PendingRequest): string {
  if (request.method === 'approval') return approvalView(request.params).description
  const input = inputPromptView(request)
  if (input) return input.title
  const questions = clarifyQuestions(request.params)
  const first = questions[0]?.question ?? t('Hermes has a question.')
  return questions.length > 1 ? t('{question} (+{count} more)', { question: first, count: questions.length - 1 }) : first
}

/** The waiting rows no live request already shows, so a wait is listed once. */
export function unmatchedWaiting(rows: WaitingRow[], requests: PendingRequest[]): WaitingRow[] {
  const live = new Set(requests.map(r => r.sessionId))
  // A question that waits past its turn is a wait of its own, not the request its chat holds now.
  return rows.filter(row => isAsked(row) || !row.sessionIds.some(id => live.has(id)))
}

/**
 * The ids a chat goes by, for finding its window (`chatWindowOf`): the
 * stored id the window knows it by, and the ids a waiting row lists with
 * this session's (stored and live), so a chat popped out from a row, never
 * opened here, is found before its window has opened its session.
 */
export function chatIdsOf(sessionId: string, storedId: string | null | undefined, rows: readonly WaitingRow[]): string[] {
  const ids = new Set<string>()
  if (storedId) ids.add(storedId)
  for (const row of rows) if (row.sessionIds.includes(sessionId)) for (const id of row.sessionIds) if (id && id !== sessionId) ids.add(id)
  return [...ids]
}
