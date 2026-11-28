/**
 * A chat's transcript as the window draws it: the stored history from
 * `session.resume`, then the live turn's events folded in as they arrive.
 * Pure functions, so the tests can play a turn's events through them.
 */
import { cleanUserText, isContextEngineSummary, withoutCompaction, type Attachment } from './text'

export { isContextEngineSummary, withoutCompaction }
import { isPlanTool, parsePlan, type Plan } from './plan'
import { t } from '../../../shared/i18n'
import { sideAgentNote } from './slash'
import { newNoteKey } from './chatNotes'
import { isQuestion } from './stepSummaries'
import { SHOW_TOOL, boardFrom, type Board } from './boards'
import { appliedOver, connectionFrom, type ConnectionCard } from './connections'
import { TIMELINE_KINDS, delegationReport, timelineNotice, type DelegationEntry } from './timeline'
import { silenceShown, streamShown } from './silence'

export interface UserItem {
  kind: 'user'
  key: string
  text: string
  /** Files and links the message named on its first lines. */
  attachments?: Attachment[]
  at?: number
  /** Sent from here and not yet confirmed by the gateway. */
  pending?: boolean
  /** Hermes took it into a running turn (Steer): part of that turn, not the start of a new one. */
  steer?: true
}

export interface AssistantItem {
  kind: 'assistant'
  key: string
  text: string
  at?: number
  streaming: boolean
  /** While streaming, everything received; `text` holds back a silence marker it could still become (silence.ts). */
  raw?: string
  /** Its stored row, which a reaction addresses; a live reply learns it from its first reaction. */
  rowId?: number
  /** Tapbacks on it, yours and the agent's, in the order they came (Hermes' display_metadata.reactions). */
  reactions?: Reaction[]
}

/** One reaction on a reply: one per author, the same emoji again takes it back (Hermes' Tapback rules). */
export interface Reaction {
  emoji: string
  /** `user` or `agent`. */
  author: string
  at?: number
}

/** The six reactions the picker offers, in order, as the phone's. */
export const TAPBACKS = ['👍', '👎', '❤️', '😂', '😮', '😢']

/** A reaction list as Hermes sends it (`message.react`'s answer, `message.reaction`, a row's metadata). */
export function reactionsFrom(value: unknown): Reaction[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Reaction[] => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    const emoji = typeof row?.emoji === 'string' ? row.emoji.trim() : ''
    const author = typeof row?.author === 'string' ? row.author.trim() : ''
    if (!emoji || !author) return []
    return [{ emoji, author, ...(typeof row!.at === 'number' ? { at: row!.at } : {}) }]
  })
}

/** A row's display_metadata, an object or its JSON. */
function metadataOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The list after `author` picks `emoji` (null takes theirs back), by Hermes' rules, keeping their place. */
export function applyingReaction(reactions: readonly Reaction[], emoji: string | null, author = 'user'): Reaction[] {
  const at = reactions.findIndex(r => r.author === author)
  const previous = at >= 0 ? reactions[at] : undefined
  const rest = reactions.filter(r => r.author !== author)
  if (!emoji || previous?.emoji === emoji) return rest
  const picked = { emoji, author, at: Date.now() / 1000 }
  return at >= 0 ? [...rest.slice(0, at), picked, ...rest.slice(at)] : [...rest, picked]
}

/** What a reaction on `key` addresses: its row, or the newest reply while no turn writes newer rows; null when it can't be named yet. */
export function reactionTarget(state: TranscriptState, key: string): { row_id: number } | { newest_role: 'assistant' } | null {
  const item = state.items.find(i => i.key === key)
  if (!item || item.kind !== 'assistant' || !item.text.trim()) return null
  if (item.rowId) return { row_id: item.rowId }
  const newest = [...state.items].reverse().find(i => i.kind === 'assistant')
  return !state.running && !state.newestUndrawn && newest?.key === key ? { newest_role: 'assistant' } : null
}

/** A reply's reactions (and its row, once known) replaced. */
export function setReactions(state: TranscriptState, key: string, reactions: Reaction[], rowId?: number): TranscriptState {
  let changed = false
  const items = state.items.map(item => {
    if (item.key !== key || item.kind !== 'assistant') return item
    changed = true
    return { ...item, reactions, ...(rowId ? { rowId } : {}) }
  })
  return changed ? { ...state, items } : state
}

export interface ThinkingItem {
  kind: 'thinking'
  key: string
  text: string
  streaming: boolean
}

export interface ToolItem {
  kind: 'tool'
  key: string
  toolId: string
  name: string
  context?: string
  summary?: string
  status: 'running' | 'done'
  durationS?: number
  at?: number
  /** What a finished conduit_show call showed. */
  board?: Board
  /** The call's arguments and result, cut to a readable length, for the card's details. */
  args?: string
  result?: string
  /** The call is known to have taken no arguments (an envelope that names its tool and gives none), unlike arguments not read yet. */
  noArgs?: true
}

/** A tool's arguments or result as the card's details show them: JSON indented, long text cut. */
export function toolDetail(value: unknown, limit = 4000): string | undefined {
  if (value == null) return undefined
  let text: string
  if (typeof value === 'string') {
    text = value.trim()
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') text = JSON.stringify(parsed, null, 2)
    } catch {
      // Plain text stays as it is.
    }
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? ''
    } catch {
      text = String(value)
    }
  }
  if (!text || text === '{}' || text === '[]') return undefined
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export interface NoticeItem {
  kind: 'notice'
  key: string
  text: string
  tone: 'error' | 'info'
}

/** The card Hermes waits on while the model connects something: Hermes' latest snapshot of the operation. */
export interface ConnectionItem {
  kind: 'connection'
  key: string
  card: ConnectionCard
}

/** What a slash command printed, or a side agent's answer: beside the turn, not part of it. */
export interface OutputItem {
  kind: 'output'
  key: string
  /** The command that printed it, when one did. */
  command?: string
  text: string
  /** Hermes' terminal output keeps its columns; Conduit's own notes are Markdown. */
  format: 'plain' | 'markdown'
}

/** A self-improvement review Hermes ran after a turn: what it saved to memory or skills. */
export interface ReviewItem {
  kind: 'review'
  key: string
  summary: string
  details: string[]
  at?: number
}

/** A scheduled job's report a Bot Chat was only shown (the plugin's cron_bot_chat note), not a message of yours. */
export interface CronReportItem {
  kind: 'cron'
  key: string
  job: string
  report: string
  at?: number
}

/** A workstream's first message, the brief its coordinating bot wrote (the plugin's WORKER_PROMPT): not something the user typed. */
export interface BriefItem {
  kind: 'brief'
  key: string
  /** The coordinating bot's name. */
  bot: string
  /** What the bot asked for. */
  task: string
  /** The user's message the bot was answering, when the brief quotes it. */
  words?: string
  at?: number
}

/** Background agents finished: each one's goal, outcome and result, from the report Hermes wrote for the model. */
export interface DelegationItem {
  kind: 'delegation'
  key: string
  title: string
  entries: DelegationEntry[]
  at?: number
}

/** A voice call saved with the chat, where it started: never from the host's messages, added as the chat is drawn. */
export interface CallItem {
  kind: 'call'
  key: string
  callId: string
  startedAt: number
  endedAt: number
}

export type TranscriptItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | NoticeItem
  | OutputItem
  | ReviewItem
  | CronReportItem
  | BriefItem
  | DelegationItem
  | CallItem
  | ConnectionItem

const CRON_PREFIX = '[Cron job "'
const CRON_SUFFIX = '" report: shown in the chat, no reply asked for]'

/** The note's job and report, as the phone reads it (CronBotChatReport.parse). */
export function cronReport(raw: string): { job: string; report: string } | null {
  if (!raw.startsWith(CRON_PREFIX)) return null
  const text = raw.replace(/\r\n/g, '\n')
  const first = text.split('\n', 1)[0]!
  if (!first.endsWith(CRON_SUFFIX) || first.length <= CRON_PREFIX.length + CRON_SUFFIX.length) return null
  return { job: first.slice(CRON_PREFIX.length, -CRON_SUFFIX.length), report: text.slice(first.length).trim() }
}

const BRIEF_OPENING = "You're working on a task for "
const BRIEF_TASK = '\n\nTask:\n'
/** Where the plugin's go-ahead rules begin, after the task. */
const BRIEF_RULES = ["\nBefore a step that can't be undone", "\nHermes' approvals decide which steps"]
const BRIEF_WORDS = "\n\nThe user's message that "

/** A workstream's brief, as the phone reads it (WorkstreamBrief.parse): the bot, the task, and the user's words it quotes. */
export function workstreamBrief(raw: string): { bot: string; task: string; words?: string } | null {
  const text = raw.replace(/\r\n/g, '\n')
  if (!text.startsWith(BRIEF_OPENING)) return null
  // The user's words are quoted last, right before the task: their own "Task:" lines stay inside the quote.
  // A quote is read only ahead of the first ordinary mark: one in the task is the task's own text.
  const first = text.indexOf(BRIEF_TASK)
  if (first < 0) return null
  const quoted = text.indexOf(BRIEF_WORDS)
  const afterQuote = quoted >= 0 && quoted < first ? text.indexOf('»' + BRIEF_TASK, quoted) : -1
  const mark = afterQuote >= 0 ? afterQuote + 1 : first
  const head = text.slice(BRIEF_OPENING.length, mark)
  const comma = head.indexOf(', who coordinates')
  if (comma < 0) return null
  const bot = head.slice(0, comma).trim()
  let task = text.slice(mark + BRIEF_TASK.length)
  const rules = BRIEF_RULES.map(r => task.indexOf(r)).filter(i => i >= 0)
  if (rules.length) task = task.slice(0, Math.min(...rules))
  task = task.trim()
  if (!bot || !task) return null
  let words: string | undefined
  const quotedInHead = head.indexOf(BRIEF_WORDS)
  if (quotedInHead >= 0) {
    const open = head.indexOf('«', quotedInHead + BRIEF_WORDS.length)
    const close = head.lastIndexOf('»')
    if (open >= 0 && close > open) words = head.slice(open + 1, close).trim() || undefined
  }
  return words ? { bot, task, words } : { bot, task }
}

/** Whether the row says it is Hermes' summary (`_compressed_summary`, on the row or its metadata). */
function flaggedSummary(row: HistoryRow): boolean {
  const flag = (value: unknown) => value === true || value === 1
  return flag(row._compressed_summary) || flag(metadataOf(row.metadata)?._compressed_summary)
}

/** A user row: a cron report's note, a workstream's brief, or a message of yours. */
function userRow(key: string, raw: string, at?: number): UserItem | CronReportItem | BriefItem | null {
  if (isContextEngineSummary(raw)) return null
  const cron = cronReport(raw)
  if (cron) return { kind: 'cron', key, ...cron, at }
  const brief = workstreamBrief(raw)
  if (brief) return { kind: 'brief', key, ...brief, at }
  return userItem(key, raw, at)
}

const REVIEW_PREFIX = '💾 self-improvement review:'

/**
 * A review from its text, as the phone reads it (MessageNormalizer.reviewActivity):
 * `💾 Self-improvement review: Memory ➕ … · Skill ✏️ …`, each change a detail.
 * `unprefixed` takes a bare summary, as the live `review.summary` event sends.
 */
export function reviewFromText(raw: string, unprefixed = false): { summary: string; details: string[] } | null {
  const text = raw.trim()
  let body: string
  if (text.toLowerCase().startsWith(REVIEW_PREFIX)) body = text.slice(REVIEW_PREFIX.length).trim()
  else if (unprefixed) body = text.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  else return null
  if (!body) return null
  const details = body
    .split(' · ')
    .map(part => part.trim())
    .filter(part => ['➕', '✏️', '➖'].some(mark => part.includes(mark)))
  if (!details.length) return { summary: body, details: [] }
  const labels = new Set(
    details.flatMap(detail => {
      const lower = detail.toLowerCase()
      return lower.startsWith('user profile') ? [t('User profile')] : lower.startsWith('memory') ? [t('Memory')] : lower.startsWith('skill') ? [t('Skill')] : []
    })
  )
  const summary =
    labels.size === 1
      ? t('{label} updated', { label: [...labels][0]! })
      : labels.size > 1
        ? t('Memory and skills updated')
        : t('Self-improvement updates saved')
  return { summary, details }
}

export interface TranscriptState {
  items: TranscriptItem[]
  running: boolean
  /** The running turn's latest status line (`status.update`). */
  status?: string
  /** The agent's plan: the newest `todo` result, or `todo_state` from the resume. */
  plan?: Plan | null
  /**
   * Your messages waiting in the chat's queue on the Webapp (A chat's queue
   * on the Webapp): out of the transcript while the dock shows them, back
   * at their turn's `message.start`, which names the admission.
   */
  held?: { admission: string; item: UserItem }[]
  /**
   * Forwarded sends a live-work read saw start before their unnamed `message.start` came (useChat's applyLiveWork):
   * that start is theirs, never the next held one's.
   */
  readStarted?: string[]
  /**
   * The messages the last live-work read listed as waiting in the gateway's queue, by admission and place
   * (useChat's applyLiveWork): an unnamed `message.start` behind another app's message there is that one's.
   */
  ahead?: { admission: string; sequence: number }[]
  /**
   * Other apps' queued messages whose unnamed `message.start` already came (hermes-conduit 3420, 3444): a read
   * bringing their words in later doesn't wait for that start again.
   */
  otherStarts?: string[]
  /** The held sends brought back lately, by admission: a later read that names one doesn't draw it twice. */
  released?: string[]
  /**
   * Where the running turn's rows begin, from its `message.start`. A turn
   * with no row of the user's (a hidden one) has nothing else to say which
   * replies are its own.
   */
  turnFrom?: number
  /**
   * The last turn ended without drawing a reply (a hidden one): Hermes' newest
   * reply row may be that turn's, so the newest drawn reply without a row id
   * can't be named as "the newest reply" (desktop#701).
   */
  newestUndrawn?: boolean
}

export const emptyTranscript: TranscriptState = { items: [], running: false }

/** One stored row, as `session.resume` / `session.history` project it. */
export interface HistoryRow {
  role: string
  text?: string | null
  content?: unknown
  timestamp?: number | null
  row_id?: number | null
  display_kind?: string | null
  name?: string | null
  tool_name?: string | null
  context?: string | null
  reasoning?: string | null
  tool_call_id?: string | null
  [key: string]: unknown
}

let keyCounter = 0
const nextKey = (prefix: string) => `${prefix}-${++keyCounter}`

function rowText(row: HistoryRow): string {
  if (typeof row.text === 'string') return row.text
  if (typeof row.content === 'string') return row.content
  if (Array.isArray(row.content)) {
    return row.content
      .map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  return ''
}

/** Seconds or milliseconds to milliseconds. */
function toMillis(timestamp: number | null | undefined): number | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return undefined
  return timestamp < 1e11 ? timestamp * 1000 : timestamp
}

/** A person's message without what Hermes stored around it; null when nothing is left to show. */
function userItem(key: string, raw: string, at?: number): UserItem | null {
  const { text, attachments } = cleanUserText(raw)
  if (!text && !attachments.length) return null
  return { kind: 'user', key, text, at, ...(attachments.length ? { attachments } : {}) }
}

/** A string that is itself JSON comes through, up to four levels of string-encoded JSON; anything else stands as it is. */
function jsonValue(value: unknown): unknown {
  let current = value
  for (let depth = 0; typeof current === 'string' && depth < 4; depth++) {
    const trimmed = current.trim()
    if (!trimmed) return null
    try {
      current = JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  return current
}

/** The bridge's own names, which `tool_call` can never have run; connector batches keep the wrapper. */
const WRAPPER_TOOL = 'tool_call'
const BRIDGE_NAMES = new Set(['tool_call', 'tool_search', 'tool_describe'])
const CONNECTOR_PREFIX = 'connectors__'

/** The deferred wrapper's name, which a saved call row carries instead of the tool that ran. */
function isWrapperName(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === WRAPPER_TOOL
}

/**
 * The one tool a deferred `tool_call` envelope runs, as Hermes resolves it:
 * `{"calls":[{name, arguments}]}` or the legacy `{name, arguments}`, either
 * level possibly a JSON string. Null for a batch, a connector call, or a
 * malformed envelope — those keep the wrapper (the phone's ToolSearchBridge
 * is the reference for the shape).
 */
function unwrappedCall(envelope: unknown): { name: string; arguments: unknown } | null {
  const object = jsonValue(envelope)
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const record = object as Record<string, unknown>
  let entry: unknown = record
  if (record.calls != null) {
    const calls = jsonValue(record.calls)
    if (!Array.isArray(calls) || calls.length !== 1) return null
    entry = calls[0]
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const call = entry as Record<string, unknown>
  const name = typeof call.name === 'string' ? call.name.trim() : ''
  if (!name || BRIDGE_NAMES.has(name.toLowerCase()) || name.toLowerCase().startsWith(CONNECTOR_PREFIX)) return null
  return { name, arguments: call.arguments }
}

export function fromHistory(rows: HistoryRow[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const row of rows) {
    if (row.display_kind === 'hidden') continue
    if (row.display_kind && TIMELINE_KINDS.has(row.display_kind)) {
      // A timeline event, its text written for the model: the notice, or the agents' report.
      const at = toMillis(row.timestamp)
      const key = row.row_id != null ? `row-${row.row_id}` : nextKey('h')
      const raw = rowText(row)
      const projected = typeof row.display_content === 'string' ? row.display_content : null
      const title = timelineNotice(row.display_kind, raw, row.display_metadata, projected)!
      const entries = row.display_kind === 'async_delegation_complete' && projected === null ? delegationReport(raw) : null
      items.push(entries ? { kind: 'delegation', key, title, entries, at } : { kind: 'notice', key, text: title, tone: 'info' })
      continue
    }
    const at = toMillis(row.timestamp)
    const key = row.row_id != null ? `row-${row.row_id}` : nextKey('h')
    switch (row.role) {
      case 'user': {
        const own = withoutCompaction(rowText(row), flaggedSummary(row))
        const item = own === null ? null : userRow(key, own, at)
        if (item) items.push(item.kind === 'user' && row.display_kind === 'steer' ? { ...item, steer: true } : item)
        break
      }
      case 'assistant': {
        if (typeof row.reasoning === 'string' && row.reasoning.trim()) {
          items.push({ kind: 'thinking', key: `${key}-r`, text: row.reasoning.trim(), streaming: false })
        }
        // A reply that is only Hermes' silence marker shows nothing (issue 2700).
        const text = silenceShown(withoutCompaction(rowText(row), flaggedSummary(row)) ?? '').trim()
        const reactions = reactionsFrom(metadataOf(row.display_metadata)?.reactions)
        if (text)
          items.push({
            kind: 'assistant',
            key,
            text,
            at,
            streaming: false,
            ...(row.row_id != null ? { rowId: row.row_id } : {}),
            ...(reactions.length ? { reactions } : {})
          })
        break
      }
      case 'system': {
        const review = row.display_kind ? null : reviewFromText(rowText(row))
        if (review) items.push({ kind: 'review', key, ...review, at })
        break
      }
      case 'tool': {
        // A deferred call keeps the wrapper's name and envelope in saved
        // history; the envelope names the tool that ran, so a resumed row is
        // drawn under it with the tool's own arguments, as the live events
        // and the phone draw it.
        const wrapper = isWrapperName(row.name) ? unwrappedCall(row.args) : null
        const shownName = wrapper?.name ?? row.name ?? 'tool'
        const given = wrapper ? wrapper.arguments : row.args
        const args = toolDetail(given)
        items.push({
          kind: 'tool',
          key,
          toolId: row.tool_call_id ?? key,
          name: shownName,
          context: row.context ?? undefined,
          status: 'done',
          at,
          // A show that answered only {ok: true} drew the cards it was given.
          board: boardFrom(shownName, rowText(row), given) ?? undefined,
          args,
          result: toolDetail(rowText(row)),
          ...(wrapper && args === undefined ? { noArgs: true as const } : {})
        })
        break
      }
      default:
        break
    }
  }
  return items
}

/** Stops whatever is still streaming: a tool line or the turn's end comes next. */
function seal(items: TranscriptItem[]): TranscriptItem[] {
  let changed = false
  const next = items.flatMap((item): TranscriptItem[] => {
    if (item.kind === 'assistant' && item.streaming) {
      changed = true
      // A finished reply: no closing marker, and nothing at all when it was only one.
      const { raw, ...rest } = item
      const text = silenceShown(raw ?? item.text)
      return text.trim() ? [{ ...rest, text, streaming: false }] : []
    }
    if (item.kind === 'thinking' && item.streaming) {
      changed = true
      return [{ ...item, streaming: false }]
    }
    return [item]
  })
  return changed ? next : items
}

/** Events whose text a reply or its reasoning grows by, which a frame's worth of can go as one. */
export const STREAMING_DELTAS: ReadonlySet<string> = new Set(['message.delta', 'reasoning.delta'])

/**
 * A frame's worth of a chat's events, with each run of the same delta in a
 * row joined into one, so the transcript changes once per run instead of per
 * chunk. Order holds, and anything else (a seal, a tool, the end) stays
 * where it was.
 */
export function coalesceDeltas<E extends { type: string; session_id?: string; payload?: unknown }>(events: readonly E[]): E[] {
  const out: E[] = []
  const textOf = (e: E) => {
    const text = (e.payload as { text?: unknown } | undefined)?.text
    return STREAMING_DELTAS.has(e.type) && typeof text === 'string' && text ? text : null
  }
  for (const event of events) {
    const last = out[out.length - 1]
    const text = textOf(event)
    const lastText = last ? textOf(last) : null
    if (last && text !== null && lastText !== null && last.type === event.type && last.session_id === event.session_id) {
      out[out.length - 1] = { ...last, payload: { ...(last.payload as object), text: lastText + text } }
      continue
    }
    out.push(event)
  }
  return out
}

function appendStreaming(items: TranscriptItem[], kind: 'assistant' | 'thinking', text: string): TranscriptItem[] {
  const last = items[items.length - 1]
  if (last && last.kind === 'assistant' && kind === 'assistant' && last.streaming) {
    const raw = (last.raw ?? last.text) + text
    return [...items.slice(0, -1), { ...last, raw, text: streamShown(raw) }]
  }
  if (last && last.kind === kind && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }]
  }
  const base = kind === 'assistant' ? seal(items) : items
  const item: TranscriptItem =
    kind === 'assistant'
      ? { kind: 'assistant', key: nextKey('a'), raw: text, text: streamShown(text), at: Date.now(), streaming: true }
      : { kind: 'thinking', key: nextKey('t'), text, streaming: true }
  return [...base, item]
}

function payloadOf(event: { payload?: unknown }): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export function applyEvent(state: TranscriptState, event: { type: string; payload?: unknown; session_id?: string; admission_id?: string }): TranscriptState {
  const payload = payloadOf(event)
  switch (event.type) {
    case 'connection.request':
    case 'connection.update': {
      const card = connectionFrom(payload, event.session_id ?? '')
      return card ? showConnection(state, card) : state
    }
    case 'message.start': {
      // A prompt sent while the earlier turn was running joins the end of that turn's
      // rows before it is confirmed, so its own row never sits between a board and the
      // reply that named it (issue 550).
      const items = promotePending(state.items)
      const started = { ...state, running: true, status: undefined, items, turnFrom: items.length }
      const admission = event.admission_id ?? str(payload.admission_id)
      if (admission) return releaseHeld(started, admission)
      // `hermes dashboard` relays a forwarded message's own turn without naming it: the oldest held one
      // (liveWork.ts). The Webapp names every turn's admission, so this never guesses there.
      if (state.readStarted?.length) return { ...started, readStarted: state.readStarted.slice(1) }
      const oldest = state.held?.[0]?.admission
      // Another app's message listed ahead of the oldest held one (or with none held) starts first: this start is
      // its turn, and the held send waits for its own (hermes-conduit 3420, 3444).
      const other = otherStartAhead(state, oldest)
      if (other) return { ...started, otherStarts: [...(state.otherStarts ?? []).slice(-7), other] }
      return oldest ? releaseHeld(started, oldest) : started
    }
    case 'message.delta': {
      const text = payload.text
      if (text === null) return { ...state, items: seal(state.items) }
      if (typeof text !== 'string' || !text) return state
      // Turn events only confirm prompts that were queued before this turn began; a
      // prompt sent during it keeps its mark until its own message.start (issue 550).
      return { ...state, running: true, items: appendStreaming(confirmPending(state.items, state.turnFrom), 'assistant', text) }
    }
    // `thinking.delta` is the terminal UI's spinner face, not the model's reasoning.
    case 'reasoning.delta': {
      const text = str(payload.text)
      if (!text) return state
      return { ...state, items: appendStreaming(state.items, 'thinking', text) }
    }
    case 'message.interim': {
      const text = silenceShown(str(payload.text) ?? '')
      if (!text.trim() || payload.already_streamed === true) return { ...state, items: seal(state.items) }
      return {
        ...state,
        items: [...seal(state.items), { kind: 'assistant', key: nextKey('a'), text, at: Date.now(), streaming: false }]
      }
    }
    case 'tool.start': {
      const toolId = str(payload.tool_id) ?? nextKey('tool')
      const item: ToolItem = {
        kind: 'tool',
        key: `tool-${toolId}`,
        toolId,
        name: str(payload.name) ?? 'tool',
        context: str(payload.context) ?? str(payload.preview),
        status: 'running',
        at: Date.now()
      }
      return { ...state, items: [...seal(state.items), item] }
    }
    case 'tool.complete': {
      const toolId = str(payload.tool_id)
      const started = state.items.find((item): item is ToolItem => item.kind === 'tool' && item.toolId === toolId)
      const plan = isPlanTool(str(payload.name) ?? started?.name) ? parsePlan(payload.result) : null
      const items = state.items.map(item =>
        item.kind === 'tool' && item.toolId === toolId
          ? {
              ...item,
              status: 'done' as const,
              summary: str(payload.summary) ?? item.summary,
              board: boardFrom(item.name, payload.result, payload.args) ?? item.board,
              args: toolDetail(payload.args) ?? item.args,
              result: toolDetail(payload.result) ?? item.result,
              durationS: typeof payload.duration_s === 'number' ? payload.duration_s : item.durationS
            }
          : item
      )
      return plan ? { ...state, items, plan } : { ...state, items }
    }
    case 'status.update': {
      const text = str(payload.text)
      return text ? { ...state, status: text } : state
    }
    case 'message.complete': {
      let items = seal(confirmPending(state.items, state.turnFrom))
      const finalText = silenceShown(str(payload.text) ?? str(payload.rendered) ?? '')
      const lastUser = items.map(i => i.kind).lastIndexOf('user')
      // A hidden turn has no row of the user's: its replies are the ones since its start, not since
      // the last message, or a reply sent whole (no deltas) after an earlier one is dropped (desktop#432).
      const repliedThisTurn = items.slice(Math.max(lastUser + 1, state.turnFrom ?? 0)).some(i => i.kind === 'assistant')
      const drew = repliedThisTurn || !!finalText?.trim()
      if (finalText?.trim() && !repliedThisTurn) {
        items = [...items, { kind: 'assistant', key: nextKey('a'), text: finalText.trim(), at: Date.now(), streaming: false }]
      }
      // The reply's stored row, when the gateway names it: reply speeds and reactions find it by that.
      // Only a reply this turn drew: a hidden turn that drew none leaves an earlier turn's reply alone.
      const persisted = payload.persisted_turn as { final_assistant_row_id?: unknown } | null | undefined
      const finalRow = persisted?.final_assistant_row_id
      if (typeof finalRow === 'number' && Number.isInteger(finalRow) && finalRow > 0 && !items.some(i => i.kind === 'assistant' && i.rowId === finalRow)) {
        const at = items.map(i => i.kind === 'assistant').lastIndexOf(true)
        const last = items[at]
        if (at > lastUser && at >= (state.turnFrom ?? 0) && last?.kind === 'assistant' && !last.rowId) items = items.map((item, i) => (i === at ? { ...last, rowId: finalRow } : item))
      }
      // Tools the turn ended without finishing (a stop) aren't running any more.
      items = items.map(item => (item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'done' as const } : item))
      const status = str(payload.status)
      if (status === 'error') {
        const error = str(payload.error) ?? str(payload.failure_reason) ?? t('The turn failed.')
        items = [...items, { kind: 'notice', key: nextKey('n'), text: error, tone: 'error' }]
      } else if (status === 'interrupted') {
        items = [...items, { kind: 'notice', key: nextKey('n'), text: t('Stopped'), tone: 'info' }]
      }
      return { ...state, items, running: false, status: undefined, turnFrom: undefined, newestUndrawn: drew ? undefined : true }
    }
    case 'message.reaction': {
      // The agent reacted (or a reaction changed elsewhere): the row's whole list. A live reply
      // with no row yet is the newest of that role, the agent tool's default, and learns its row.
      const rowId = typeof payload.row_id === 'number' && Number.isInteger(payload.row_id) && payload.row_id > 0 ? payload.row_id : null
      if (!rowId) return state
      const reactions = reactionsFrom(payload.reactions)
      const known = state.items.find(i => i.kind === 'assistant' && i.rowId === rowId)
      if (known) return setReactions(state, known.key, reactions)
      if (str(payload.role) !== 'assistant') return state
      const live = [...state.items].reverse().find(i => i.kind === 'assistant' && !i.rowId)
      return live ? setReactions(state, live.key, reactions, rowId) : state
    }
    case 'user.message': {
      // Sent from another client of this chat (the phone).
      const item = userRow(nextKey('u'), str(payload.text) ?? '', Date.now())
      if (!item) return state
      const steer = item.kind === 'user' && str(payload.display_kind) === 'steer'
      return { ...state, items: [...seal(state.items), steer ? { ...item, steer: true } : item] }
    }
    case 'review.summary': {
      const review = reviewFromText(str(payload.text) ?? str(payload.content) ?? '', true)
      if (!review) return state
      const details = Array.isArray(payload.details) ? payload.details.filter((d): d is string => typeof d === 'string' && !!d.trim()) : []
      const all = [...new Set([...review.details, ...details])]
      return { ...state, items: [...seal(state.items), { kind: 'review', key: nextKey('rv'), summary: review.summary, details: all, at: Date.now() }] }
    }
    case 'btw.complete':
    case 'background.complete': {
      const note = sideAgentAnswer(event)
      return note ? addOutput(state, { text: note, format: 'markdown' }) : state
    }
    case 'message.interrupted':
    case 'session.interrupted':
      return { ...state, running: false, status: undefined, items: seal(state.items) }
    case 'error': {
      const text = str(payload.message)
      if (!text) return state
      return { ...state, items: [...state.items, { kind: 'notice', key: nextKey('n'), text, tone: 'error' }] }
    }
    default:
      return state
  }
}

/**
 * A connection frame: it updates the card it belongs to (an older frame
 * changes nothing), or opens one when it's still open. A settled operation
 * this chat never showed opens no card (#1988, #1993).
 */
export function showConnection(state: TranscriptState, card: ConnectionCard): TranscriptState {
  const index = state.items.findIndex(item => item.kind === 'connection' && item.card.opId === card.opId)
  if (index < 0) return card.settled ? state : { ...state, items: [...state.items, { kind: 'connection', key: nextKey('c'), card }] }
  const shown = state.items[index] as ConnectionItem
  const next = appliedOver(card, shown.card)
  if (!next) return state
  const items = [...state.items]
  items[index] = { ...shown, card: next }
  return { ...state, items }
}

/** The connection card still waiting on the user, if any. */
export function openConnection(state: TranscriptState): ConnectionCard | null {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!
    if (item.kind === 'connection' && !item.card.settled) return item.card
  }
  return null
}

/** A command's output or a note, after what's there (a live reply's words stay above it). */
export function addOutput(state: TranscriptState, output: { command?: string; text: string; format: OutputItem['format'] }): TranscriptState {
  // A key no other launch gives, as the chat keeps its notes across them (chatNotes.ts).
  return { ...state, items: [...seal(state.items), { kind: 'output', key: newNoteKey(), ...output }] }
}

export function addNotice(state: TranscriptState, text: string, tone: NoticeItem['tone'] = 'info'): TranscriptState {
  return { ...state, items: [...state.items, { kind: 'notice', key: nextKey('n'), text, tone }] }
}

/**
 * Rows read in from the stored transcript before the chat's, drawn above
 * them: a chat opened on its newest page reads the page before it when the
 * reader scrolls up (`olderRows`). A too-long chat's note stays on top, and
 * a row the chat already draws — paging by offset can serve it twice while
 * the chat writes — isn't drawn again.
 */
export function prependOlder(state: TranscriptState, items: TranscriptItem[]): TranscriptState {
  const known = new Set(state.items.map(item => item.key))
  const fresh = items.filter(item => !known.has(item.key))
  if (!fresh.length) return state
  let at = 0
  while (at < state.items.length && state.items[at]!.key === 'long-chat') at++
  // The turn boundary is an index: rows read above it move it down by just the new rows.
  const turnFrom = state.turnFrom === undefined ? undefined : state.turnFrom + fresh.length
  return { ...state, items: [...state.items.slice(0, at), ...fresh, ...state.items.slice(at)], turnFrom }
}

/**
 * The rows `kept` draws above the first one `state` draws too: the pages a
 * reader scrolled up through, when the chat is read again on its newest
 * page. Nothing when the two share no row, since rows between them would
 * be missing.
 */
export function olderPagesOf(kept: TranscriptState, state: TranscriptState): TranscriptItem[] {
  const drawn = new Set(state.items.map(item => item.key))
  const at = kept.items.findIndex(item => item.key !== 'long-chat' && drawn.has(item.key))
  return at <= 0 ? [] : kept.items.slice(0, at).filter(item => item.key !== 'long-chat')
}

/**
 * A running turn's reply so far, less what the chat's rows already draw. A
 * resume's `inflight.assistant` is everything the turn has streamed, and a
 * turn working through tools has stored its earlier parts as rows of their
 * own, so drawing it whole says them twice (seen on a reconnect mid-turn,
 * desktop#485's hand check). Rows that don't lead the text leave it whole.
 */
export function inflightRemainder(state: TranscriptState, text: string): string {
  let last = -1
  state.items.forEach((item, i) => {
    if (item.kind === 'user') last = i
  })
  let rest = text
  for (const item of state.items.slice(last + 1)) {
    if (item.kind !== 'assistant') continue
    const said = item.text.trim()
    const ahead = rest.trimStart()
    if (!said) continue
    if (!ahead.startsWith(said)) break
    rest = ahead.slice(said.length)
  }
  return rest.trimStart()
}

/**
 * A queued prompt's own turn starts: its rows go after the earlier turn's rows,
 * but only the oldest pending row is confirmed. The rest stay queued for theirs.
 */
function promotePending(items: TranscriptItem[]): TranscriptItem[] {
  const pending = items.filter((item): item is UserItem => item.kind === 'user' && !!item.pending)
  if (!pending.length) return items
  return [
    ...items.filter(item => !(item.kind === 'user' && item.pending)),
    ...pending.map((item, i) => (i === 0 ? { ...item, pending: false as const } : item))
  ]
}

/** Confirm pending prompts, unless `keepFrom` says they arrived after the turn these events belong to. */
function confirmPending(items: TranscriptItem[], keepFrom?: number): TranscriptItem[] {
  if (!items.some(item => item.kind === 'user' && item.pending)) return items
  return items.map((item, i) =>
    item.kind === 'user' && item.pending && (keepFrom === undefined || i < keepFrom) ? { ...item, pending: false } : item
  )
}

export function addPendingUser(state: TranscriptState, text: string, attachments: Attachment[] = [], key = nextKey('u')): TranscriptState {
  const item: UserItem = userItem(key, text, Date.now()) ?? { kind: 'user' as const, key, text, at: Date.now() }
  const all = [...attachments, ...(item.attachments ?? [])]
  return { ...state, items: [...state.items, { ...item, ...(all.length ? { attachments: all } : {}), pending: true }] }
}

/** A pending message taken back whole: its words went back to the composer, so it leaves the transcript. */
export function withdrawPendingUser(state: TranscriptState): TranscriptState {
  const index = state.items.map(i => i.kind === 'user' && i.pending).lastIndexOf(true)
  if (index < 0) return state
  // A pending row taken back above the turn boundary moves the boundary up with it.
  const turnFrom = state.turnFrom === undefined || state.turnFrom <= index ? state.turnFrom : state.turnFrom - 1
  return { ...state, items: state.items.filter((_, i) => i !== index), turnFrom }
}

/** A send that failed: its bubble goes, with the reason in its place. */
export function failPendingUser(state: TranscriptState, error: string): TranscriptState {
  const index = state.items.map(i => i.kind === 'user' && i.pending).lastIndexOf(true)
  if (index < 0) return state
  const items = [...state.items]
  items.splice(index + 1, 0, { kind: 'notice', key: nextKey('n'), text: `Not sent: ${error}`, tone: 'error' })
  items[index] = { ...(items[index] as UserItem), pending: false }
  return { ...state, items }
}

/**
 * History rows of conduit_show calls without their board: session.resume
 * leaves tool answers out. A finished row still under the wrapper's name
 * counts too, since only the REST page says which tool it ran.
 */
export function missingBoards(state: TranscriptState): string[] {
  return state.items.flatMap(item =>
    item.kind === 'tool' && !item.board && (item.name.toLowerCase() === SHOW_TOOL || (item.status === 'done' && isWrapperName(item.name))) ? [item.toolId] : []
  )
}

/** The tool ids a full history read still has to settle, minus those a read already failed to settle. */
export function missingToolIds(state: TranscriptState, skip: ReadonlySet<string> = new Set()): string[] {
  const ids = new Set<string>()
  for (const item of state.items) {
    if (item.kind !== 'tool' || skip.has(item.toolId)) continue
    const boardMissing = !item.board && (item.name.toLowerCase() === SHOW_TOOL || (item.status === 'done' && isWrapperName(item.name)))
    const detailsMissing = item.status === 'done' && !item.result && !item.board
    if (boardMissing || detailsMissing) ids.add(item.toolId)
  }
  return [...ids]
}

/** History rows without the call's details (session.resume leaves them out), or a board to draw. */
export function missingDetails(state: TranscriptState, skip: ReadonlySet<string> = new Set()): boolean {
  return missingToolIds(state, skip).length > 0
}

/**
 * The boards of conduit_show rows and every row's arguments and result, from
 * their answers by tool call id (the REST transcript has them). A call made
 * through the deferred `tool_call` wrapper resumes under that name, while its
 * answer's row names the tool that ran (`conduit_show`), so the board is read
 * and the row shown under the tool it ran, with the tool's own arguments —
 * as the live events and the phone do (desktop#389).
 */
export function attachBoards(
  state: TranscriptState,
  answers: Map<string, string>,
  args: Map<string, string> = new Map(),
  names: Map<string, string> = new Map()
): TranscriptState {
  let changed = false
  const items = state.items.map(item => {
    if (item.kind !== 'tool') return item
    const named = names.get(item.toolId)
    const answer = answers.get(item.toolId)
    // A wrapped call shows the tool's own arguments, not the wrapper's envelope:
    // the envelope counts when it names the tool the answer verified, which also
    // covers a row fromHistory already unwrapped to a tool that took no arguments.
    const rawArgs = args.get(item.toolId)
    const unwrapped = unwrappedCall(rawArgs)
    const verified = !!unwrapped && !!named && unwrapped.name.toLowerCase() === named.toLowerCase()
    const shownArgs = verified ? unwrapped.arguments : rawArgs
    // A show that answered only {ok: true} drew the cards it was given, so the restore reads them too.
    const board = item.board ?? (answer === undefined ? null : boardFrom(named ?? item.name, answer, shownArgs))
    const result = item.result ?? (answer === undefined ? undefined : toolDetail(answer))
    // A row drawn under another tool's name (an envelope that diverged from its answer) holds
    // that tool's arguments: the page's replace them, as they fill a row that had none.
    const renamed = !!named && named.toLowerCase() !== item.name.toLowerCase() && !isWrapperName(item.name) && rawArgs !== undefined
    const given = (renamed ? undefined : item.args) ?? (shownArgs !== undefined ? toolDetail(shownArgs) : undefined)
    const noArgs = (renamed ? undefined : item.noArgs) ?? (verified && given === undefined ? (true as const) : undefined)
    if ((!named || named === item.name) && board === (item.board ?? null) && result === item.result && given === item.args && noArgs === item.noArgs) return item
    changed = true
    const next: ToolItem = { ...item, ...(named && named !== item.name ? { name: named } : {}), ...(board ? { board } : {}), result, args: given }
    if (noArgs) next.noArgs = noArgs
    else delete next.noArgs
    return next
  })
  return changed ? { ...state, items } : state
}

/**
 * The tool details a kept copy of the chat already had (boards, results,
 * arguments), filled into a fresh resume's rows by tool call id, so opening
 * the chat again doesn't read the REST page for answers that never change
 * (desktop#293). Only blanks are filled, as in attachBoards.
 */
export function withKeptDetails(state: TranscriptState, kept: TranscriptState | null | undefined): TranscriptState {
  if (!kept) return state
  const details = new Map<string, ToolItem>()
  // Only a kept row with its arguments stands in: one without them (a live board's answer carries none)
  // leaves the row to the REST page, the only place they come from. A call known to take none has them all.
  for (const item of kept.items)
    if (item.kind === 'tool' && (item.args !== undefined || item.noArgs) && (item.board || item.result !== undefined)) details.set(item.toolId, item)
  if (!details.size) return state
  let changed = false
  const items = state.items.map(item => {
    if (item.kind !== 'tool') return item
    const known = details.get(item.toolId)
    if (!known) return item
    // The kept row names the tool the page's answer verified. A fresh resume
    // can still say tool_call (an envelope that won't read), or name another
    // tool than the one that ran (an envelope that diverged from its answer):
    // either way the verified name wins, so every open draws the same row.
    // A kept row still under the wrapper's name says nothing.
    const name = isWrapperName(known.name) ? item.name : known.name
    const diverged = name !== item.name && !isWrapperName(item.name)
    const board = item.board ?? known.board
    const result = item.result ?? known.result
    // An envelope that named another tool gave that tool's arguments, not this one's.
    const args = diverged ? known.args : (item.args ?? known.args)
    const noArgs = diverged ? known.noArgs : (item.noArgs ?? known.noArgs)
    if (name === item.name && board === item.board && result === item.result && args === item.args && noArgs === item.noArgs) return item
    changed = true
    const next: ToolItem = { ...item, ...(name !== item.name ? { name } : {}), ...(board ? { board } : {}), result, args }
    if (noArgs) next.noArgs = noArgs
    else delete next.noArgs
    return next
  })
  return changed ? { ...state, items } : state
}

/** Each call's arguments in a page of `/api/sessions/{id}/messages`, from the assistant rows' tool_calls, by call id. */
export function toolArgs(raw: unknown): Map<string, string> {
  const args = new Map<string, string>()
  const messages = (raw as { messages?: unknown } | null)?.messages
  for (const row of Array.isArray(messages) ? (messages as { role?: string; tool_calls?: unknown }[]) : []) {
    if (row.role !== 'assistant' || !Array.isArray(row.tool_calls)) continue
    for (const call of row.tool_calls as { id?: unknown; function?: { arguments?: unknown } }[]) {
      if (typeof call?.id === 'string' && typeof call.function?.arguments === 'string') args.set(call.id, call.function.arguments)
    }
  }
  return args
}

/** Each tool row's answer in a page of `/api/sessions/{id}/messages`, by tool call id. */
export function toolAnswers(raw: unknown): Map<string, string> {
  const answers = new Map<string, string>()
  const messages = (raw as { messages?: unknown } | null)?.messages
  for (const row of Array.isArray(messages) ? (messages as HistoryRow[]) : []) {
    if (row.role === 'tool' && typeof row.tool_call_id === 'string') answers.set(row.tool_call_id, rowText(row))
  }
  return answers
}

/**
 * Each tool row's tool name in that page, by tool call id: the tool that ran,
 * which a wrapped call's resume row doesn't name. The REST rows carry it as
 * `tool_name`; `name` is the field the desktop's resume events use.
 */
export function toolNames(raw: unknown): Map<string, string> {
  const names = new Map<string, string>()
  const messages = (raw as { messages?: unknown } | null)?.messages
  for (const row of Array.isArray(messages) ? (messages as HistoryRow[]) : []) {
    const name = row.tool_name ?? row.name
    if (row.role === 'tool' && typeof row.tool_call_id === 'string' && typeof name === 'string' && name) names.set(row.tool_call_id, name)
  }
  return names
}

/** A send the chat's queue took behind the running turn: its bubble waits in the dock, out of the transcript. */
/** The oldest message the last read listed ahead of `held` (any, with none held) that nothing here holds and whose start hasn't come. */
export function otherStartAhead(state: TranscriptState, held: string | undefined): string | undefined {
  const rows = state.ahead ?? []
  const mine = held === undefined ? Infinity : (rows.find(row => row.admission === held)?.sequence ?? Infinity)
  const holding = new Set((state.held ?? []).map(h => h.admission))
  return rows
    .filter(row => row.sequence < mine && !holding.has(row.admission) && !(state.otherStarts ?? []).includes(row.admission))
    .sort((a, b) => a.sequence - b.sequence)[0]?.admission
}

export function holdSent(state: TranscriptState, key: string, admission: string): TranscriptState {
  const item = state.items.find((i): i is UserItem => i.kind === 'user' && i.key === key)
  if (!item) return state
  const { items, turnFrom } = joinAround(state.items, state.items.indexOf(item), state.turnFrom)
  return {
    ...state,
    items,
    turnFrom,
    held: [...(state.held ?? []).filter(h => h.admission !== admission), { admission, item: { ...item, pending: false } }]
  }
}

/**
 * Its turn started (or it went into the running one): the message comes back, after what's there. `steer`: it
 * went into the running turn (Send now), so it is part of that turn.
 */
export function releaseHeld(state: TranscriptState, admission: string, steer = false): TranscriptState {
  const held = state.held?.find(h => h.admission === admission)
  if (!held) return state
  return {
    ...state,
    items: [...seal(state.items), { ...held.item, at: Date.now(), ...(steer ? { steer: true as const } : {}) }],
    held: state.held!.filter(h => h !== held),
    released: [...(state.released ?? []).slice(-15), admission]
  }
}

/**
 * A message of the gateway's queue whose turn a live-work read names as running, that this transcript doesn't
 * hold (the chat was reopened while it waited, or another app sent it): it comes in from its queued words,
 * once, as a held one would.
 */
export function startQueuedWords(state: TranscriptState, admission: string, text: string): TranscriptState {
  if (state.held?.some(h => h.admission === admission)) return releaseHeld(state, admission)
  if (state.released?.includes(admission) || !text.trim()) return state
  return releaseHeld({ ...state, held: [...(state.held ?? []), { admission, item: { kind: 'user', key: nextKey('u'), text } }] }, admission)
}

/** Withdrawn or discarded: it never runs, so it never comes back. */
export function dropHeld(state: TranscriptState, admission: string): TranscriptState {
  if (!state.held?.some(h => h.admission === admission)) return state
  return { ...state, held: state.held.filter(h => h.admission !== admission) }
}

/** Edited: the new words wait as a new admission at the back of the line. */
export function reholdEdited(state: TranscriptState, admission: string, edited: string, text: string): TranscriptState {
  const held = state.held?.find(h => h.admission === admission)
  const rest = (state.held ?? []).filter(h => h.admission !== admission && h.admission !== edited)
  const item: UserItem = held ? { ...held.item, text } : { kind: 'user', key: nextKey('u'), text }
  return { ...state, held: [...rest, { admission: edited, item }] }
}

/**
 * The items without the one at `index`; a reply its bubble had split in two is one again. `turnFrom`, the running
 * turn's first item, moves up with a row taken from above it, and an earlier turn's reply is never joined to this
 * turn's (a delta that came before the queued send's receipt drew the live reply below the bubble, desktop#701).
 */
function joinAround(items: TranscriptItem[], index: number, turnFrom?: number): { items: TranscriptItem[]; turnFrom?: number } {
  const before = items[index - 1]
  const after = items[index + 1]
  const rest = items.filter((_, i) => i !== index)
  const from = turnFrom === undefined || turnFrom <= index ? turnFrom : turnFrom - 1
  const across = turnFrom !== undefined && index - 1 < turnFrom && index + 1 >= turnFrom
  if (before?.kind !== 'assistant' || after?.kind !== 'assistant' || across) return { items: rest, turnFrom: from }
  const joined: AssistantItem = { ...before, text: before.text + after.text, streaming: after.streaming }
  return { items: [...rest.slice(0, index - 1), joined, ...rest.slice(index + 1)], turnFrom: from }
}

/**
 * A `/btw` or `/background` answer's note, or null when the event isn't one
 * (a step summary's question, from here or the phone, labels a run instead).
 */
export function sideAgentAnswer(event: { type: string; payload?: unknown }): string | null {
  if (event.type !== 'btw.complete' && event.type !== 'background.complete') return null
  const payload = payloadOf(event)
  const text = str(payload.text)
  if (!text || (event.type === 'btw.complete' && isQuestion(str(payload.question)))) return null
  return sideAgentNote(event.type === 'btw.complete' ? 'btw' : 'background', str(payload.task_id) ?? '', text, str(payload.question))
}
