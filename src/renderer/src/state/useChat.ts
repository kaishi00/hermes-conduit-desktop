import {
  CALL_TAKEOVER_WAIT_MS,
  TAKEOVER_MAX_IDS,
  TAKEOVER_PATH,
  isSessionNotOwned,
  owner,
  refusalDetails,
  runTakeover,
  takesOverAutomatically,
  takingOverMessage
} from './chatTakeover'
import { connectionFrom, connectionOwner, type ConnectionCard } from './connections'
import { isRuntimeGone } from './runtimeGone'
import { gateway, GatewayError } from '../gateway'
import { forgetTranscripts, keepTranscript, keptTranscript } from './transcriptCache'
import { TranscriptStore } from './transcriptStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { contextFromUsage, parseBreakdown, type ContextWindow } from './context'
import { parsePlan } from './plan'
import {
  addNotice,
  addOutput,
  addPendingUser,
  applyEvent,
  coalesceDeltas,
  STREAMING_DELTAS,
  dropHeld,
  holdSent,
  releaseHeld,
  reholdEdited,
  attachBoards,
  withKeptDetails,
  emptyTranscript,
  failPendingUser,
  withdrawPendingUser,
  openConnection,
  showConnection,
  fromHistory,
  missingDetails,
  toolArgs,
  toolAnswers,
  toolNames,
  applyingReaction,
  prependOlder,
  reactionTarget,
  reactionsFrom,
  setReactions,
  type Reaction,
  type HistoryRow,
  type TranscriptItem,
  type TranscriptState
} from './transcript'
import type { GatewayEventMessage } from '../../../shared/ipc'
import { promptText, releaseHeldImages, titlePreview, uploadAttachments, type StagedAttachment } from './attachments'
import type { Attachment } from './text'
import { helpText, parseSlashCommand, parseSlashResult, wantsDispatch, type SlashCommand, type SlashResult } from './slash'
import { t } from '../../../shared/i18n'
import { lostRows, queueFrom, refusalMeansSettled, resendWords, type QueuedPrompt } from './chatQueue'
import { discardTurnSurface, reportTurnSurface } from './turnSurface'
import { readsRepliesAloud } from './readAloud'
import { dashboardProfilePath } from './dashboardProfile'
import { authorityModelPick } from './chatActions'
import { isResumeTooLong, LONG_CHAT_PAGE, LONG_CHAT_PAGES, newestPageItems, newestRows, olderRows, rowsSince, settleRunning } from './longChat'
import { knownChatLength, noteChatLength } from './chatLength'

type Action =
  | { type: 'reset'; state: TranscriptState }
  | { type: 'boards'; answers: Map<string, string>; args: Map<string, string>; names: Map<string, string> }
  | { type: 'event'; event: { type: string; payload?: unknown } }
  | { type: 'pending'; text: string; attachments?: Attachment[]; key?: string }
  /** The queue took a send behind the running turn, or a dock action settled one. */
  | { type: 'held'; key: string; admission: string }
  | { type: 'released' | 'dropped'; admission: string }
  | { type: 'edited'; admission: string; edited: string; text: string }
  | { type: 'failed'; error: string }
  | { type: 'withdrawn' }
  /** A reply's reactions, painted at once and then as Hermes saved them. */
  | { type: 'reactions'; key: string; reactions: Reaction[]; rowId?: number }
  /** The stored page before the chat's rows, drawn above them. */
  | { type: 'older'; items: TranscriptItem[] }
  | { type: 'output'; command?: string; text: string; format: 'plain' | 'markdown' }
  | { type: 'notice'; text: string; tone?: 'error' | 'info' }

/** The boards and tool details a chat's history showed: session.resume leaves the tool answers out, its REST transcript has them. */
async function loadBoards(state: TranscriptState, storedId: string, profile: string | undefined, current: () => boolean, dispatch: (action: Action) => void) {
  if (!missingDetails(state)) return
  const path = `/api/sessions/${encodeURIComponent(storedId)}/messages?order=latest&limit=500&inline_images=false${profile && profile !== 'default' ? `&profile=${encodeURIComponent(profile)}` : ''}`
  try {
    const page = await gateway.http('GET', path)
    const answers = toolAnswers(page)
    if (current() && answers.size) dispatch({ type: 'boards', answers, args: toolArgs(page), names: toolNames(page) })
  } catch {
    // The rows stay as steps.
  }
}

/** A chat's open: its resume, the rows it draws instead of the resume's own messages, and how far back those reach. */
interface OpenTranscript {
  result: ResumeResult
  /** The newest stored rows, oldest first; null when the resume carried the chat's messages. */
  rows: HistoryRow[] | null
  /** Rows the chat has before the ones drawn, unread until the reader scrolls up. */
  older?: { offset: number; more: boolean }
  /** Hermes refused the whole resume (4130), so the rows stand under a note saying why. */
  tooLong?: boolean
}

/**
 * A chat's resume, and the rows it opens on. A resume carries the chat's whole
 * history — up to `sessions.max_resume_messages` rows — which the renderer then
 * lays out in one go, so a chat past one stored page opens on that page and
 * reads the pages before it as the reader scrolls up (boundedOpen,
 * longChat.ts). One Hermes refuses to resume whole (4130) falls back to the
 * compact resume under a note, which still takes messages, and brings its
 * newest stored rows; without them the refusal stands, since it says what to do.
 */
async function resumeChat(params: Record<string, unknown>, storedId: string, profile: string | undefined): Promise<OpenTranscript> {
  const http = (method: 'GET', path: string) => gateway.http(method, path)
  // A chat the list says fits one page resumes whole, without that page read first (chatLength.ts).
  const fits = (knownChatLength(storedId) ?? LONG_CHAT_PAGE) < LONG_CHAT_PAGE
  const bounded = fits ? null : await boundedOpen(http, params, storedId, profile).catch(() => null)
  if (bounded) return bounded
  try {
    const result = await gateway.rpc<ResumeResult>('session.resume', params)
    // What it carried is the chat's length, for the next open: one that grew past a page is read in pages then.
    noteChatLength(storedId, result.messages?.length)
    return { result, rows: null }
  } catch (e) {
    if (!isResumeTooLong(e)) throw e
    const compact = { ...params, omit_messages: true }
    const result = await gateway.rpc<ResumeResult>('session.resume', compact)
    const stored = result.stored_session_id ?? storedId
    const rows = await newestRows(http, stored, profile).catch(() => [] as HistoryRow[])
    // No rows to draw: the refusal, which says what to do, beats a note over nothing.
    if (!rows.length) throw e
    // Read again after its pages, so its turn and its rows are as they are now (longChat.ts).
    if (result.running)
      return {
        ...(await settleRunning(() => gateway.rpc<ResumeResult>('session.resume', compact), held => rowsSince(http, held, stored, profile), result, rows)),
        tooLong: true
      }
    return { result, rows, tooLong: true }
  }
}

/**
 * A chat past one stored page, opened on that page: its newest rows are read
 * from the REST transcript first, and only then does the chat resume without
 * its messages, so the renderer never lays out a whole history to show the
 * newest (desktop#291). A shorter chat — or one with nothing stored yet, or a
 * gateway that won't resume compact — answers null, and the whole resume runs
 * as it did. Only a chat whose length the list didn't give, or gave as a page
 * or more, comes here.
 */
async function boundedOpen(
  http: (method: 'GET', path: string) => Promise<unknown>,
  params: Record<string, unknown>,
  storedId: string,
  profile: string | undefined
): Promise<OpenTranscript | null> {
  const rows = await newestRows(http, storedId, profile)
  if (rows.length < LONG_CHAT_PAGE) return null
  const compact = { ...params, omit_messages: true }
  const result = await gateway.rpc<ResumeResult>('session.resume', compact)
  const stored = result.stored_session_id ?? storedId
  const older = { offset: rows.length, more: rows.length >= LONG_CHAT_PAGE }
  if (!result.running) return { result, rows, older }
  // Read again after its pages, so its turn and its rows are as they are now (longChat.ts).
  const settled = await settleRunning(() => gateway.rpc<ResumeResult>('session.resume', compact), held => rowsSince(http, held, stored, profile), result, rows)
  return { result: settled.result, rows: settled.rows, older: { ...older, offset: settled.rows.length } }
}

/** The transcript a resume draws: its rows, or a chat opened on its newest stored rows with their tool details. */
function resumedTranscript(result: ResumeResult, rows: HistoryRow[] | null, tooLong = false): TranscriptState {
  const state: TranscriptState = {
    items: rows ? newestPageItems(rows, tooLong) : fromHistory(result.messages ?? []),
    running: result.running === true,
    plan: parsePlan(result.todo_state)
  }
  return rows ? attachBoards(state, toolAnswers({ messages: rows }), toolArgs({ messages: rows }), toolNames({ messages: rows })) : state
}

function reducer(state: TranscriptState, action: Action): TranscriptState {
  switch (action.type) {
    case 'reset':
      return action.state
    case 'boards':
      return attachBoards(state, action.answers, action.args, action.names)
    case 'event':
      return applyEvent(state, action.event)
    case 'pending':
      return addPendingUser(state, action.text, action.attachments, action.key)
    case 'held':
      return holdSent(state, action.key, action.admission)
    case 'released':
      return releaseHeld(state, action.admission)
    case 'dropped':
      return dropHeld(state, action.admission)
    case 'edited':
      return reholdEdited(state, action.admission, action.edited, action.text)
    case 'failed':
      return failPendingUser(state, action.error)
    case 'withdrawn':
      return withdrawPendingUser(state)
    case 'output':
      return addOutput(state, action)
    case 'notice':
      return addNotice(state, action.text, action.tone)
    case 'reactions':
      return setReactions(state, action.key, action.reactions, action.rowId)
    case 'older':
      return prependOlder(state, action.items)
  }
}

interface ResumeResult {
  session_id: string
  stored_session_id?: string | null
  messages?: HistoryRow[]
  running?: boolean | null
  inflight?: { assistant?: string; streaming?: boolean } | null
  info?: ChatInfo
  /** The agent's plan (Hermes 0.21+), for a chat whose last plan is older than the loaded page. */
  todo_state?: unknown
  /** A connection card still waiting on the user: reopening the chat brings it back. */
  pending_connection?: unknown
  /** The chat's queue, on the Webapp's listener. */
  pending?: unknown
}

/** An open connection card the resume brought back. */
function withPendingConnection(state: TranscriptState, result: ResumeResult): TranscriptState {
  const card = result.pending_connection ? connectionFrom(result.pending_connection, result.session_id) : null
  return card ? showConnection(state, card) : state
}

interface CreateResult {
  session_id: string
  stored_session_id?: string
  info?: ResumeResult['info']
}

/** The parts of Hermes' session info the window shows. */
interface ChatInfo {
  title?: string
  model?: string
  provider?: string
  cwd?: string
  profile_name?: string | null
  reasoning_effort?: string
  fast?: boolean
  service_tier?: string
  yolo?: boolean
}

export interface OpenChat {
  /** The stored id (the chat list's), once there is one. */
  storedId: string | null
  /** The live id the gateway's events carry. */
  liveId: string | null
  title?: string
  model?: string
  provider?: string
  cwd?: string
  /** Hermes' effort word: "none" is off, empty the model's own default. */
  reasoning?: string
  speed?: 'normal' | 'fast' | 'ultrafast'
  yolo?: boolean
  /** How full the context window is, once Hermes says. */
  context?: ContextWindow
}

/** The chat's settings from a session info Hermes sent (resume, create, `session.info`, a `config.set`). */
export function chatSettings(info: ChatInfo | null | undefined): Partial<OpenChat> {
  if (!info) return {}
  const out: Partial<OpenChat> = {}
  if (typeof info.model === 'string' && info.model) out.model = info.model
  if (typeof info.provider === 'string' && info.provider) out.provider = info.provider
  if (typeof info.cwd === 'string' && info.cwd) out.cwd = info.cwd
  if (typeof info.reasoning_effort === 'string') out.reasoning = info.reasoning_effort
  if (typeof info.fast === 'boolean') out.speed = !info.fast ? 'normal' : (info.service_tier ?? '').toLowerCase() === 'ultrafast' ? 'ultrafast' : 'fast'
  if (typeof info.yolo === 'boolean') out.yolo = info.yolo
  return out
}

/** What a model pick got from Hermes. */
export type ModelSwitch = { kind: 'switched'; deferred: boolean } | { kind: 'confirm'; message: string } | { kind: 'failed'; message: string }

const uuid = () => crypto.randomUUID()

/**
 * What a slash command leaves for the window: a new chat, words for the
 * composer, or the stored id of the chat it had to start.
 */
export type CommandOutcome =
  | { kind: 'new' }
  | { kind: 'prefill'; text: string; created: string | null }
  | { kind: 'done'; created: string | null }
  /** Never ran: the chat it was typed in didn't open, or was left while it opened. Its words go back to the composer. */
  | { kind: 'unsent' }
  /** `/model` alone: the Model panel. */
  | { kind: 'model'; created: string | null }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One open chat: resumes it, folds its live events into the transcript,
 * sends and stops. `storedId` null is a new chat, created on the first send.
 */
/**
 * `botChat`: a new chat is the bot's one Bot Chat, made hidden and titled "Bot Chat" as the phone makes it.
 * `folder`: where a new chat works, a project's folder (the phone's New Chat in a project).
 */
/** A new chat's session came back after another chat opened (the phone's "A new chat that something waits on"). */
class ChatMovedOn extends Error {}

/** The longest a delta waits when no frame comes (a hidden window). */
const DELTA_FLUSH_MS = 100

/** `host`: the dashboard this window shows, which keeps its own transcripts. */
export function useChat(storedId: string | null, profile: string | undefined, sessionAuthority: boolean, connected: boolean, botChat = false, folder?: string, host = '') {
  // A chat this window opens on, kept from before (a dashboard switch remounts it), draws on the first frame.
  // Held outside React state, so only what reads it runs as a reply streams (transcriptStore.ts).
  const [transcriptStore] = useState(() => new TranscriptStore((storedId && connected ? keptTranscript(storedId, profile, host) : null) ?? emptyTranscript))
  const dispatchNow = useCallback((action: Action) => transcriptStore.set(reducer(transcriptStore.get(), action)), [transcriptStore])
  /** The transcript as it is now, for a callback or a cleanup. */
  const [transcriptRef] = useState(() => ({ get current() { return transcriptStore.get() } }))
  /**
   * A reply's deltas wait for the next frame and go as one (coalesceDeltas),
   * so a fast stream changes the transcript once a frame rather than per
   * chunk (desktop#197). Anything else this hook does goes after them.
   */
  const deltas = useRef<GatewayEventMessage[]>([])
  const frame = useRef<{ raf: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const cancelFrame = () => {
    if (!frame.current) return
    cancelAnimationFrame(frame.current.raf)
    clearTimeout(frame.current.timer)
    frame.current = null
  }
  const flushDeltas = useCallback(() => {
    cancelFrame()
    const events = deltas.current
    if (!events.length) return
    deltas.current = []
    // A chat switched since: its deltas aren't this transcript's.
    for (const event of coalesceDeltas(events)) if (event.session_id === liveId.current) dispatchNow({ type: 'event', event })
  }, [dispatchNow])
  const dispatch = useCallback(
    (action: Action) => {
      flushDeltas()
      dispatchNow(action)
    },
    [flushDeltas, dispatchNow]
  )
  useEffect(() => () => cancelFrame(), [])
  const [chat, setChat] = useState<OpenChat>({ storedId, liveId: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const liveId = useRef<string | null>(null)
  const request = useRef(0)
  /** Model and run settings chosen for a new draft chat before `session.create` runs. */
  const draftOverrides = useRef<Pick<OpenChat, 'model' | 'provider' | 'reasoning' | 'speed' | 'yolo'>>({})
  /**
   * The new chat's `session.create` while it's out. A model or run setting
   * picked meanwhile waits for it, then goes to the session it made: the
   * create already took the picks as they stood when it left (desktop#431).
   */
  const creating = useRef<Promise<unknown> | null>(null)
  /** False when the chat left the screen while its create was out: the pick was for a chat that's gone. */
  const createSettled = useCallback(async (): Promise<boolean> => {
    const run = creating.current
    if (!run) return true
    return run.then(
      () => true,
      e => !(e instanceof ChatMovedOn)
    )
  }, [])
  /** A chat this hook just created: selecting it in the list mustn't resume it over its first turn. */
  const created = useRef<string | null>(null)
  /** The open chat's resume while it runs (settles, never rejects): a send or command waits for it (desktop#298). */
  const openingChat = useRef<Promise<void> | null>(null)
  /** The chat whose transcript the store holds, so a switch while offline doesn't show the last chat's rows (desktop#283). */
  const drawn = useRef<string | null>(storedId)
  const chatRef = useRef(chat)
  chatRef.current = chat
  /** True only for a connected, unsaved new chat (never while an existing chat is still resuming). */
  const isDraft = useCallback(() => connected && !liveId.current && !chatRef.current.storedId, [connected])
  const pickDraft = useCallback((patch: Pick<OpenChat, 'model' | 'provider' | 'reasoning' | 'speed' | 'yolo'>) => {
    draftOverrides.current = { ...draftOverrides.current, ...patch }
    setChat(c => ({ ...c, ...patch }))
  }, [])
  /** Another app holds the chat and Take over automatically is off: the offer, naming who holds it. */
  const [takeover, setTakeover] = useState<{ surface?: string; busy: boolean } | null>(null)
  /** The open chat's queue on the Webapp; empty on `hermes dashboard`, which keeps none. */
  const [queue, setQueue] = useState<QueuedPrompt[]>([])
  const queueRef = useRef(queue)
  queueRef.current = queue
  /** The stored rows before the open chat's drawn ones, and whether it has more (longChat.ts). */
  const [older, setOlder] = useState<{ offset: number; more: boolean } | null>(null)
  const olderNow = useRef<{ offset: number; more: boolean } | null>(null)
  olderNow.current = older
  /** Whether the page before the chat's drawn rows is on its way. */
  const [loadingOlder, setLoadingOlder] = useState(false)
  const olderLoading = useRef(false)

  // Resume when the chat (or the connection) changes.
  useEffect(() => {
    // A dropped connection clears what was kept, whatever is open, before any return below
    // (desktop#201). It also drops what this re-run's cleanup just kept: React runs that first.
    if (!connected) forgetTranscripts(host)
    // A chat just created here: its first turn is already drawn, so no resume, but leaving it keeps it.
    if (storedId && storedId === created.current) {
      drawn.current = storedId
      return () => keepTranscript(storedId, profile, transcriptRef.current, host)
    }
    created.current = null
    const ticket = ++request.current
    liveId.current = null
    openingChat.current = null
    draftOverrides.current = {}
    // A create still out belongs to the chat that just left: a pick in this one mustn't wait on it and be dropped.
    creating.current = null
    // A resume this re-run abandons can't clear it any more: its finally is fenced by the ticket.
    setLoading(false)
    setTakeover(null)
    setQueue([])
    olderNow.current = null
    setOlder(null)
    setChat(storedId || !folder ? { storedId, liveId: null } : { storedId, liveId: null, cwd: folder })
    setError(null)
    if (!storedId) {
      drawn.current = null
      dispatch({ type: 'reset', state: emptyTranscript })
      return
    }
    if (!connected) {
      // The chat that was open stays drawn through a drop; another one picked meanwhile starts blank.
      if (drawn.current !== storedId) dispatch({ type: 'reset', state: emptyTranscript })
      drawn.current = storedId
      return
    }
    setLoading(true)
    // A chat left a moment ago draws as it was while its resume runs, which replaces it (desktop#201).
    const cached = keptTranscript(storedId, profile, host)
    drawn.current = storedId
    dispatch({ type: 'reset', state: cached ?? emptyTranscript })
    const params: Record<string, unknown> = { session_id: storedId, cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    // The transcript without every stored picture's bytes; the session authority refuses the flag.
    if (!sessionAuthority) params.inline_images = false
    openingChat.current = resumeChat(params, storedId, profile)
      .then(open => {
        if (ticket !== request.current) return
        const { result, rows } = open
        liveId.current = result.session_id
        setChat({
          storedId: result.stored_session_id ?? storedId,
          liveId: result.session_id,
          title: result.info?.title,
          ...chatSettings(result.info)
        })
        // The rows the pages before this one still hold are read as the reader scrolls up.
        olderNow.current = open.older ?? null
        setOlder(open.older ?? null)
        // The tool answers the kept copy had come along, so only new ones are read (desktop#293).
        let state = withKeptDetails(resumedTranscript(result, rows, open.tooLong), cached)
        if (result.running && result.inflight?.assistant) {
          state = applyEvent(state, { type: 'message.delta', payload: { text: result.inflight.assistant } })
        }
        state = withPendingConnection(state, result)
        dispatch({ type: 'reset', state })
        setQueue(queueFrom(result.pending) ?? [])
        if (!rows) void loadBoards(state, result.stored_session_id ?? storedId, profile, () => ticket === request.current, dispatch)
        // How full the window is, before the first reply ticks it.
        gateway
          .rpc('session.usage', { session_id: result.session_id })
          .then(usage => contextFromUsage(usage))
          .catch(() => null)
          // Before the first call Hermes may not know the window yet; its breakdown does.
          .then(async context => context ?? parseBreakdown(await gateway.rpc('session.context_breakdown', { session_id: result.session_id })).window)
          .then(context => {
            if (context && ticket === request.current) setChat(c => ({ ...c, context }))
          })
          .catch(() => undefined)
      })
      .catch(e => {
        if (ticket !== request.current) return
        dispatch({ type: 'reset', state: emptyTranscript })
        // A Kanban worker reached anyway (a link, a kept row): only the board may run it.
        if (e instanceof GatewayError && e.code === 4132)
          setError(t("This chat is a Kanban task's worker, so only the board can run it. Open the task on the Kanban board and check its Worker Log."))
        else setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (ticket !== request.current) return
        setLoading(false)
        openingChat.current = null
      })
    // Leaving the chat keeps its transcript for coming back.
    return () => keepTranscript(storedId, profile, transcriptRef.current, host)
  }, [storedId, profile, sessionAuthority, connected, folder, host])

  // Live events for this chat.
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (!event.session_id || event.session_id !== liveId.current) return
        if (event.type === 'session.info') {
          const settings = chatSettings(event.payload as ChatInfo | undefined)
          setChat(c => ({ ...c, ...settings }))
          const rows = queueFrom((event.payload as { pending?: unknown } | undefined)?.pending)
          if (rows) setQueue(rows)
          return
        }
        if (event.type === 'session.usage' || event.type === 'message.complete') {
          const context = contextFromUsage((event.payload as { usage?: unknown } | undefined)?.usage)
          if (context) setChat(c => ({ ...c, context }))
          if (event.type === 'session.usage') return
        }
        if (event.type === 'session.title') {
          const title = (event.payload as { title?: unknown } | undefined)?.title
          if (typeof title === 'string') setChat(c => ({ ...c, title }))
          return
        }
        if (STREAMING_DELTAS.has(event.type)) {
          deltas.current.push(event)
          // A hidden or minimized window gets no frames: a timer flushes there instead, so deltas never pile up.
          if (!frame.current) frame.current = { raf: requestAnimationFrame(flushDeltas), timer: setTimeout(flushDeltas, DELTA_FLUSH_MS) }
          return
        }
        dispatch({ type: 'event', event })
      }),
    [dispatch, flushDeltas]
  )

  /** A new chat's session, made on its first send or command. */
  const makeSession = useCallback(async (): Promise<{ sid: string; storedId: string | null }> => {
    const params: Record<string, unknown> = sessionAuthority ? { source: 'gui' } : { cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    if (botChat) Object.assign(params, { title: 'Bot Chat', hidden: true, follow_profile_config: true })
    else if (folder) params.cwd = folder
    const draft = { ...draftOverrides.current }
    if (draft.model) params.model = draft.model
    if (draft.provider) params.provider = draft.provider
    if (draft.reasoning !== undefined) params[sessionAuthority ? 'reasoning' : 'reasoning_effort'] = draft.reasoning
    if (draft.speed !== undefined) params.service_tier = draft.speed === 'normal' ? '' : draft.speed === 'fast' ? 'priority' : 'ultrafast'
    if (draft.yolo !== undefined && sessionAuthority) params.yolo = draft.yolo
    const opening = request.current
    const made = await gateway.rpc<CreateResult>('session.create', params)
    // Another chat opened meanwhile: this chat isn't on screen any more, so nothing goes in it.
    if (request.current !== opening) throw new ChatMovedOn()
    draftOverrides.current = {}
    const sid = made.session_id
    const storedId = made.stored_session_id ?? null
    liveId.current = sid
    created.current = storedId
    request.current++ // a resume still in flight is stale now
    openingChat.current = null
    setLoading(false)
    const info = chatSettings(made.info)
    setChat(c => ({ ...c, liveId: sid, storedId: storedId ?? c.storedId, ...info }))
    if (!sessionAuthority && draft.yolo !== undefined && info.yolo !== draft.yolo) {
      try {
        const res = await gateway.rpc<{ info?: ChatInfo | null }>('config.set', {
          key: 'yolo',
          value: draft.yolo ? '1' : '0',
          session_id: sid,
          ...(profile ? { profile } : {})
        })
        if (liveId.current === sid && res?.info) setChat(c => ({ ...c, ...chatSettings(res.info) }))
      } catch (e) {
        if (liveId.current === sid) {
          setChat(c => ({ ...c, yolo: info.yolo }))
          dispatch({ type: 'notice', text: message(e), tone: 'error' })
        }
      }
      if (liveId.current !== sid) throw new ChatMovedOn()
    }
    return { sid, storedId }
  }, [profile, sessionAuthority, botChat, folder, dispatch])
  const createSession = useCallback((): Promise<{ sid: string; storedId: string | null }> => {
    const run = makeSession()
    creating.current = run
    const clear = () => {
      if (creating.current === run) creating.current = null
    }
    run.then(clear, clear)
    return run
  }, [makeSession])

  /** The chat's history read again, after a command changed it (/undo, /retry, /compress). */
  const reloadHistory = useCallback(async () => {
    const stored = chatRef.current.storedId
    if (!stored) return
    const ticket = ++request.current
    const params: Record<string, unknown> = { session_id: stored, cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    if (!sessionAuthority) params.inline_images = false
    try {
      const open = await resumeChat(params, stored, profile)
      if (ticket !== request.current) return
      const { result, rows } = open
      liveId.current = result.session_id
      setChat(c => ({ ...c, liveId: result.session_id, title: result.info?.title ?? c.title }))
      setError(null)
      olderNow.current = open.older ?? null
      setOlder(open.older ?? null)
      const state = withPendingConnection(resumedTranscript(result, rows, open.tooLong), result)
      dispatch({ type: 'reset', state })
      setQueue(queueFrom(result.pending) ?? [])
      if (!rows) void loadBoards(state, result.stored_session_id ?? stored, profile, () => ticket === request.current, dispatch)
    } catch {
      // The chat as drawn stays; the next open reads it.
    }
  }, [profile, sessionAuthority])

  /**
   * Waits out the open chat's resume, if one runs. A stored chat whose open failed is opened once more, so
   * the words still reach it and never a new chat; throws when the chat was left meanwhile or still didn't open.
   */
  const openSettled = useCallback(async () => {
    if (liveId.current || !chatRef.current.storedId) return
    const open = openingChat.current
    if (open) {
      const ticket = request.current
      await open
      if (request.current !== ticket) throw new ChatMovedOn()
    }
    if (!liveId.current) {
      const ticket = request.current + 1
      await reloadHistory()
      if (request.current !== ticket) throw new ChatMovedOn()
    }
    if (!liveId.current) throw new Error(t('The chat didn’t open. Try again.'))
  }, [reloadHistory])

  /**
   * The session a send or command goes to. A stored chat still opening is waited for, so the words reach it,
   * not a new chat made over its resume (desktop#298); only a draft gets a new session.
   */
  const sessionFor = useCallback(async (): Promise<{ sid: string; storedId: string | null }> => {
    await openSettled()
    if (liveId.current) return { sid: liveId.current, storedId: null }
    return createSession()
  }, [openSettled, createSession])

  /** The connection card's answers: rows approved or skipped, or Continue without what isn't connected. */
  const respondConnection = useCallback(
    async (card: ConnectionCard, targets: Record<string, unknown>[], continues = false) => {
      const result: Record<string, unknown> = { targets }
      if (continues) result.settled_by = 'continue'
      const params: Record<string, unknown> = { owner: connectionOwner(card.sessionId), op_id: card.opId, result }
      if (profile) params.profile = profile
      await gateway.rpc('connection.respond', params)
    },
    [profile]
  )
  /** Try Again on an app whose sign-in page went dead: Hermes makes a new one on the open operation. */
  const reissueConnection = useCallback(
    async (card: ConnectionCard, name: string) => {
      const params: Record<string, unknown> = { owner: connectionOwner(card.sessionId), connectors: [name], reconnect: true }
      if (profile) params.profile = profile
      await gateway.rpc('connectors.connect', params)
    },
    [profile]
  )
  /** Signed in on the page: Hermes looks at the account now rather than at its next check. */
  const wakeConnection = useCallback(
    async (card: ConnectionCard) => {
      const params: Record<string, unknown> = { owner: connectionOwner(card.sessionId), op_id: card.opId }
      if (profile) params.profile = profile
      await gateway.rpc('connectors.operation.wake', params)
    },
    [profile]
  )

  /** Asks the plugin to drop another app's claim on this chat, under every id it goes by. */
  const takeOverChat = useCallback(
    (live: string | null) => {
      const ids = [...new Set([chatRef.current.storedId, live].filter((id): id is string => !!id))].slice(0, TAKEOVER_MAX_IDS)
      const path = dashboardProfilePath(TAKEOVER_PATH, profile)
      return gateway.http('POST', path, { session_ids: ids })
    },
    [profile]
  )

  /** The offer's Take Over: true once the chat is Conduit's (the composer then sends its words). */
  const takeOver = useCallback(async (): Promise<boolean> => {
    const offer = takeover
    if (!offer || offer.busy) return false
    const forChat = liveId.current
    setTakeover({ ...offer, busy: true })
    dispatch({ type: 'notice', text: takingOverMessage(owner(offer.surface)), tone: 'info' })
    const end = await runTakeover(() => takeOverChat(forChat), {
      surface: offer.surface,
      keepWaiting: () => liveId.current === forChat,
      onOwner: surface => setTakeover(current => (current ? { ...current, surface } : current))
    })
    if (end?.kind === 'ready') {
      setTakeover(null)
      return true
    }
    setTakeover(current => (current ? { ...current, busy: false } : current))
    if (end) dispatch({ type: 'notice', text: end.message, tone: 'error' })
    return false
  }, [takeover, takeOverChat])

  const send = useCallback(
    async (
      text: string,
      attachments: StagedAttachment[] = [],
      wire?: string,
      options: { takeOver?: boolean; spoken?: boolean } = {}
    ): Promise<string | null | false> => {
      const trimmed = text.trim()
      if (!trimmed && !attachments.length) return null
      const shown: Attachment[] = attachments.map(a =>
        a.kind === 'image' ? { kind: 'image', value: a.name, preview: `data:${a.mime};base64,${a.base64}` } : { kind: 'file', value: a.name }
      )
      const key = `u-${uuid()}`
      // A chat still opening is waited for before its row is drawn, so the resume's answer doesn't wipe it.
      try {
        await openSettled()
      } catch (e) {
        if (!(e instanceof ChatMovedOn)) dispatch({ type: 'notice', text: e instanceof Error ? e.message : String(e), tone: 'error' })
        return false
      }
      // Hermes' receipt says `queued` for every send; only one into a running turn, or behind a turn a restart cut off, waits.
      const joinsRunningTurn = transcriptRef.current.running || lostRows(queueRef.current).length > 0
      dispatch({ type: 'pending', text: trimmed, attachments: shown, key })
      let sid = liveId.current
      let held: string[] = []
      let reported: string | null = null
      try {
        let createdStoredId: string | null = null
        if (!sid) {
          const made = await sessionFor()
          sid = made.sid
          createdStoredId = made.storedId
        }
        const uploaded = attachments.length
          ? await uploadAttachments((method, params) => gateway.rpc(method, params), sid, profile, sessionAuthority, attachments).catch(e => {
              throw new Error(t('Attachment failed: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
            })
          : null
        held = uploaded?.heldImagePaths ?? []
        const params: Record<string, unknown> = { session_id: sid, text: promptText(wire ?? trimmed, uploaded?.references ?? []) }
        if (profile) params.profile = profile
        if (sessionAuthority) params.submission_id = uuid()
        if (uploaded?.images.length) params.attachments = uploaded.images
        // A message sent while a connection card waits continues it first, as in Hermes Desktop, so the message doesn't wait behind it.
        const waiting = openConnection(transcriptRef.current)
        if (waiting && waiting.sessionId === sid) await respondConnection(waiting, [], true).catch(() => undefined)
        const preview = titlePreview(attachments)
        if (preview) params.title_preview = preview
        // Where it was sent from, for its turn's line (the phone's TurnSurface).
        reported = params.text as string
        await reportTurnSurface(sid, reported, options.spoken ? 'spoken' : 'typed', readsRepliesAloud())
        const submit = async () => {
          let receipt: { status?: unknown; admission_id?: unknown } | null
          try {
            receipt = await gateway.rpc('prompt.submit', params)
          } catch (e) {
            // A Hermes that doesn't know the title preview gets the message without it.
            if (!preview || !String(e instanceof Error ? e.message : e).includes('title_preview')) throw e
            delete params.title_preview
            receipt = await gateway.rpc('prompt.submit', params)
          }
          // The Webapp's queue took it behind the running turn: it waits in the dock until its turn starts.
          if (sessionAuthority && joinsRunningTurn && receipt?.status === 'queued' && typeof receipt.admission_id === 'string' && receipt.admission_id) {
            dispatch({ type: 'held', key, admission: receipt.admission_id })
          }
        }
        /** Hermes cleared the chat's runtime: resumed by its stored id, which still finds it, the message goes once more. */
        const resumedAfterReap = async (e: unknown): Promise<boolean> => {
          const stored = chatRef.current.storedId
          if (!isRuntimeGone(e) || createdStoredId || uploaded || !stored || liveId.current !== sid) return false
          const resume: Record<string, unknown> = { session_id: stored, cols: 96, source: 'desktop', omit_messages: true }
          if (profile) resume.profile = profile
          const result = await gateway.rpc<ResumeResult>('session.resume', resume).catch(() => null)
          if (!result?.session_id || liveId.current !== sid) return false
          liveId.current = result.session_id
          sid = result.session_id
          params.session_id = result.session_id
          setChat(c => ({ ...c, liveId: result.session_id, storedId: result.stored_session_id ?? c.storedId }))
          return true
        }
        try {
          await submit()
        } catch (e) {
          if (await resumedAfterReap(e)) {
            await submit()
            setTakeover(null)
            return createdStoredId
          }
          if (!isSessionNotOwned(e)) throw e
          // Another app holds the chat. Taking it over waits out a reply it's running, then the message goes (#304, #1061).
          const surface = refusalDetails(e instanceof Error ? e.message : String(e)).surface
          if (!options.takeOver && !takesOverAutomatically()) {
            // The words go back to the composer and the offer says why; Take over sends them.
            setTakeover({ surface, busy: false })
            discardTurnSurface(sid, reported, e)
            if (held.length) await releaseHeldImages((method, params) => gateway.rpc(method, params), sid, profile, held)
            dispatch({ type: 'withdrawn' })
            return false
          }
          const forChat = sid
          dispatch({ type: 'notice', text: takingOverMessage(owner(surface)), tone: 'info' })
          const end = await runTakeover(() => takeOverChat(forChat), {
            surface,
            waitMs: options.takeOver ? CALL_TAKEOVER_WAIT_MS : undefined,
            keepWaiting: () => liveId.current === forChat
          })
          if (!end) return false
          if (end.kind === 'failed') throw new Error(end.message)
          await submit()
        }
        setTakeover(null)
        return createdStoredId
      } catch (e) {
        // The words go back to the composer; the chat now open gets nothing.
        if (e instanceof ChatMovedOn) return false
        if (sid && reported !== null) discardTurnSurface(sid, reported, e)
        // Pictures held for this message would ride on the next one.
        if (sid && held.length) await releaseHeldImages((method, params) => gateway.rpc(method, params), sid, profile, held)
        dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) })
        return false
      }
    },
    [profile, sessionAuthority, openSettled, sessionFor, takeOverChat, respondConnection]
  )

  const stop = useCallback(async () => {
    const sid = liveId.current
    if (!sid) return
    const params: Record<string, unknown> = { session_id: sid }
    if (profile) params.profile = profile
    try {
      await gateway.rpc('session.interrupt', params)
    } catch (e) {
      dispatch({ type: 'event', event: { type: 'error', payload: { message: e instanceof Error ? e.message : String(e) } } })
    }
  }, [profile])

  /**
   * Runs a typed `/command`: Conduit's own, else Hermes' `slash.exec` (`command.dispatch` when that turns it down).
   * `botChat`: the chat is a bot's one Bot Chat, which never resets, so `/new` compacts it instead.
   */
  const command = useCallback(
    async (text: string, commands: SlashCommand[] = [], options: { botChat?: boolean } = {}): Promise<CommandOutcome> => {
      const asTyped = text.trim()
      let typed = asTyped
      let { name, arg } = parseSlashCommand(typed)
      /** A Bot Chat's /new says why it compacts, under what was typed; shown after the compaction reads the history again, which would drop it. */
      let compactNote: string | null = null
      const showCompactNote = () => compactNote && dispatch({ type: 'output', command: asTyped, text: compactNote, format: 'plain' })
      const output = (body: string, format: 'plain' | 'markdown' = 'plain') => dispatch({ type: 'output', command: typed, text: body, format })
      const failed = (e: unknown) => dispatch({ type: 'notice', text: t('Command failed: {reason}', { reason: message(e) }), tone: 'error' })
      switch (name) {
        case 'new':
        case 'reset':
        case 'clear':
          if (!options.botChat) return { kind: 'new' }
          // A Bot Chat is one continuous conversation: it compacts, whatever follows the command.
          compactNote = t(
            'Bot chats never reset, so this one is compacted instead: Hermes carries on from a summary with fresh context, and keeps its memory and skills. For a separate chat, start one in Chats.'
          )
          typed = '/compress'
          ;({ name, arg } = parseSlashCommand(typed))
          break
        case 'help':
        case 'commands':
          output(helpText(commands), 'markdown')
          return { kind: 'done', created: null }
        case 'stop': {
          // The reply, then this chat's background processes: what Hermes' own /stop means.
          const sid = liveId.current
          if (!sid) {
            output(t('Nothing was running.'), 'markdown')
            return { kind: 'done', created: null }
          }
          const lines: string[] = []
          if (transcriptRef.current.running) {
            await stop()
            lines.push(t('Stopped the reply.'))
          }
          try {
            const result = await gateway.rpc<{ killed?: number }>('process.stop', profile ? { session_id: sid, profile } : { session_id: sid })
            if ((result.killed ?? 0) > 0) lines.push(t('Background processes stopped: {count}', { count: result.killed ?? 0 }))
          } catch (e) {
            if (!/method not found|unknown method|-32601/i.test(message(e))) lines.push(t('Command failed: {reason}', { reason: message(e) }))
          }
          output(lines.length ? lines.join('\n\n') : t('Nothing was running.'), 'markdown')
          return { kind: 'done', created: null }
        }
      }
      if (name === 'model' && !arg && isDraft()) return { kind: 'model', created: null }
      let sid = liveId.current
      let created: string | null = null
      const done: CommandOutcome = { kind: 'done', created: null }
      try {
        if (!sid) {
          const made = await sessionFor()
          sid = made.sid
          created = made.storedId
          done.created = created
        }
      } catch (e) {
        if (!(e instanceof ChatMovedOn)) failed(e)
        return { kind: 'unsent' }
      }
      const scoped = (params: Record<string, unknown>) => (profile ? { ...params, profile } : params)

      if (name === 'model' && !arg) return { kind: 'model', created }

      // Side agents answer on the chat as an event; through slash.exec the answer would be lost.
      if ((name === 'btw' || name === 'background' || name === 'bg') && arg) {
        try {
          await gateway.rpc(name === 'btw' ? 'prompt.btw' : 'prompt.background', scoped({ session_id: sid, text: arg }))
          output(
            name === 'btw'
              ? t('Answering from a snapshot of this chat. The answer will appear here.')
              : t('Started in the background. The answer will appear here.'),
            'markdown'
          )
          return done
        } catch (e) {
          if (!/method not found|unknown method|-32601/i.test(message(e))) {
            failed(e)
            return done
          }
        }
      }

      let result: SlashResult | null
      let current = typed
      for (let hops = 0; ; hops++) {
        try {
          const parsed = parseSlashCommand(current)
          let raw: unknown
          try {
            raw = await gateway.rpc('slash.exec', scoped({ session_id: sid, command: current }))
          } catch (e) {
            if (!wantsDispatch(e)) throw e
            raw = await gateway.rpc('command.dispatch', scoped({ session_id: sid, name: parsed.name, arg: parsed.arg }))
          }
          result = parseSlashResult(raw)
        } catch (e) {
          showCompactNote()
          failed(e)
          return done
        }
        if (result?.type !== 'alias' || hops >= 2) break
        current = `/${result.target.replace(/^\/+/, '')}${parseSlashCommand(current).arg ? ` ${parseSlashCommand(current).arg}` : ''}`
      }
      if (!result) {
        showCompactNote()
        return done
      }
      // /undo, /retry and /compress change the history Hermes keeps: read it again.
      const rewrites = ['undo', 'retry', 'compress', 'compact'].includes(name)
      switch (result.type) {
        case 'alias':
          showCompactNote()
          return done
        case 'output':
          if (rewrites) await reloadHistory()
          showCompactNote()
          if (result.output) output(result.output)
          return done
        case 'prefill':
          await reloadHistory()
          showCompactNote()
          if (result.notice) dispatch({ type: 'notice', text: result.notice })
          return { kind: 'prefill', text: result.message, created }
        case 'send':
          if (rewrites) await reloadHistory()
          showCompactNote()
          if (result.notice) dispatch({ type: 'notice', text: result.notice })
          await send(result.display ?? result.message, [], result.message)
          return done
      }
    },
    [profile, sessionFor, reloadHistory, send, stop, isDraft]
  )

  /** A line in the chat from Conduit itself (a refusal, say), as a command's notice shows. */
  const notice = useCallback((text: string, tone: 'error' | 'info' = 'info') => dispatch({ type: 'notice', text, tone }), [])

  /** A `config.set` on this chat's session, its answer's info folded in. */
  /** Words a call put into the running reply (a correction): shown in the chat as the user's, where Hermes keeps them. */
  const noteCorrection = useCallback((text: string) => dispatch({ type: 'event', event: { type: 'user.message', payload: { text } } }), [])

  const configure = useCallback(
    async (key: string, value: unknown, extra: Record<string, unknown> = {}) => {
      const sid = liveId.current
      if (!sid) throw new Error(t('Not connected.'))
      const params: Record<string, unknown> = { key, value, session_id: sid, ...extra }
      if (profile) params.profile = profile
      const result = await gateway.rpc<{
        info?: ChatInfo | null
        confirm_required?: boolean | null
        confirm_message?: string | null
        deferred?: boolean | null
        value?: unknown
      }>('config.set', params)
      if (result.info) setChat(c => ({ ...c, ...chatSettings(result.info) }))
      return result
    },
    [profile]
  )

  /** Switches the chat's model; a pick Hermes guards (an expensive model) asks first. */
  const setModel = useCallback(
    async (model: string, provider: string, confirmed = false): Promise<ModelSwitch> => {
      if (!(await createSettled())) return { kind: 'failed', message: t('Not connected.') }
      if (isDraft()) {
        pickDraft({ model, provider })
        return { kind: 'switched', deferred: false }
      }
      // The session authority takes a model pick as a `model` mutation, and refuses `config.set model` by name.
      const pickOnAuthority = async (): Promise<ModelSwitch> => {
        const sid = liveId.current
        if (!sid) throw new Error(t('Not connected.'))
        const pick = await authorityModelPick(gateway.rpc, gateway.http, sid, profile, model, provider, confirmed)
        if (pick.confirmRequired) {
          const words = pick.confirmMessage || t('Hermes did not accept the model switch.')
          return confirmed ? { kind: 'failed', message: words } : { kind: 'confirm', message: words }
        }
        setChat(c => ({ ...c, model: pick.model, provider }))
        return { kind: 'switched', deferred: pick.deferred }
      }
      if (sessionAuthority) {
        try {
          return await pickOnAuthority()
        } catch (e) {
          return { kind: 'failed', message: message(e) }
        }
      }
      try {
        const result = await configure('model', `${model} --provider ${provider} --session`, confirmed ? { confirm_expensive_model: true } : {})
        if (result.confirm_required) {
          const words = result.confirm_message || t('Hermes did not accept the model switch.')
          return confirmed ? { kind: 'failed', message: words } : { kind: 'confirm', message: words }
        }
        if (!result.info) setChat(c => ({ ...c, model, provider }))
        return { kind: 'switched', deferred: result.deferred === true }
      } catch (e) {
        // Sent before the socket said it's the authority's: once more as its mutation.
        if (/use_session_mutation_model/.test(message(e))) {
          try {
            return await pickOnAuthority()
          } catch (again) {
            return { kind: 'failed', message: message(again) }
          }
        }
        return { kind: 'failed', message: message(e) }
      }
    },
    [configure, profile, sessionAuthority, isDraft, pickDraft, createSettled]
  )

  const setReasoning = useCallback(
    async (effort: string) => {
      if (!(await createSettled())) return
      if (isDraft()) {
        pickDraft({ reasoning: effort })
        return
      }
      await configure('reasoning', effort)
      setChat(c => ({ ...c, reasoning: effort }))
    },
    [configure, isDraft, pickDraft, createSettled]
  )

  const setSpeed = useCallback(
    async (speed: 'normal' | 'fast' | 'ultrafast') => {
      if (!(await createSettled())) return
      if (isDraft()) {
        pickDraft({ speed })
        return
      }
      await configure('fast', speed)
      setChat(c => ({ ...c, speed }))
    },
    [configure, isDraft, pickDraft, createSettled]
  )

  const setYolo = useCallback(
    async (on: boolean) => {
      if (!(await createSettled())) return
      if (isDraft()) {
        pickDraft({ yolo: on })
        return
      }
      await configure('yolo', on ? '1' : '0')
      setChat(c => ({ ...c, yolo: on }))
    },
    [configure, isDraft, pickDraft, createSettled]
  )

  /** Runs one of the queue dock's verbs on the open chat; Hermes' refusal is thrown for the dock to say. */
  const queueVerb = useCallback(async <T = Record<string, unknown>>(method: string, row: QueuedPrompt, extra: Record<string, unknown> = {}): Promise<T> => {
    const sid = liveId.current
    if (!sid) throw new Error(t('Not connected to Hermes.'))
    // Hermes' queue verbs take a closed set of params, never `profile`: the ids name the row on any profile.
    const result = await gateway.rpc<T>(method, { session_id: sid, admission_id: row.admissionId, ...extra })
    if (liveId.current === sid) setQueue(rows => rows.filter(r => r.admissionId !== row.admissionId))
    return result
  }, [])

  /** Remove from queue: it never runs. */
  const cancelQueued = useCallback(
    async (row: QueuedPrompt) => {
      await queueVerb('prompt.cancel', row)
      dispatch({ type: 'dropped', admission: row.admissionId })
    },
    [queueVerb]
  )

  /** Edit: Hermes queues the new words at the back of the line in place of the old ones. */
  const editQueued = useCallback(
    async (row: QueuedPrompt, text: string) => {
      const words = text.trim()
      // Emptied is no edit: Remove from queue withdraws it.
      if (!words || words === row.text.trim()) return
      const receipt = await queueVerb<{ admission_id?: unknown }>('prompt.replace_queued', row, { submission_id: uuid(), text: words })
      if (typeof receipt?.admission_id === 'string' && receipt.admission_id) {
        dispatch({ type: 'edited', admission: row.admissionId, edited: receipt.admission_id, text: words })
      } else dispatch({ type: 'dropped', admission: row.admissionId })
    },
    [queueVerb]
  )

  /** Send now: into the running turn, as a steer; it never also runs as its own. */
  const sendQueuedNow = useCallback(
    async (row: QueuedPrompt) => {
      await queueVerb('prompt.steer_queued', row)
      dispatch({ type: 'released', admission: row.admissionId })
    },
    [queueVerb]
  )

  /** Discard a turn a restart cut off: Hermes settles it as interrupted and the messages behind it go on. */
  const discardLost = useCallback(
    async (row: QueuedPrompt) => {
      if (row.generation === undefined) throw new Error(t('Hermes didn’t say which turn this was. Reopen the chat and try again.'))
      await queueVerb('prompt.resolve_unknown', row, { execution_generation: row.generation })
      dispatch({ type: 'dropped', admission: row.admissionId })
    },
    [queueVerb]
  )

  /**
   * Resend: discards the cut-off turn and sends its words again as a new
   * message, at the back of the line; its files aren't sent again. Returns
   * the words when they didn't go (a discard with no answer, or one no longer
   * waiting), for the composer, rather than losing them.
   */
  const resendLost = useCallback(
    async (row: QueuedPrompt): Promise<string | null> => {
      const words = resendWords(row.text)
      if (!words) {
        await discardLost(row)
        return null
      }
      try {
        await discardLost(row)
      } catch (e) {
        if (!(e instanceof GatewayError) || refusalMeansSettled(e)) {
          setQueue(rows => rows.filter(r => r.admissionId !== row.admissionId))
          return words
        }
        throw e
      }
      const sent = await send(words)
      return sent === false ? words : null
    },
    [discardLost, send]
  )

  /**
   * A tapback on a reply (null, or the one you have, takes it back): painted
   * at once, saved with `message.react`, then the saved list. A failed save
   * puts your old reaction back and says why. Hermes hands it to the agent
   * with the next message, so nothing is sent now.
   */
  const reactingTo = useRef(new Map<string, number>())
  const react = useCallback(async (key: string, emoji: string | null) => {
    const sid = liveId.current
    const state = transcriptRef.current
    const target = reactionTarget(state, key)
    const item = state.items.find(i => i.key === key)
    if (!sid || !target || item?.kind !== 'assistant') return
    const previous = item.reactions ?? []
    const mine = previous.find(r => r.author === 'user')
    const pick = emoji && mine?.emoji === emoji ? null : emoji
    const attempt = (reactingTo.current.get(key) ?? 0) + 1
    reactingTo.current.set(key, attempt)
    dispatch({ type: 'reactions', key, reactions: applyingReaction(previous, pick) })
    try {
      const result = (await gateway.rpc('message.react', { session_id: sid, author: 'user', emoji: pick, ...target })) as { row_id?: unknown; reactions?: unknown }
      if (liveId.current !== sid || reactingTo.current.get(key) !== attempt) return
      const rowId = typeof result?.row_id === 'number' ? result.row_id : undefined
      // "The newest reply" is named when Hermes takes the call: keep the answer only for the reply it still is.
      if ('newest_role' in target && rowId) {
        const now = transcriptRef.current
        const newest = [...now.items].reverse().find(i => i.kind === 'assistant')
        if (now.running || newest?.key !== key) {
          dispatch({ type: 'reactions', key, reactions: previous })
          return
        }
      }
      dispatch({ type: 'reactions', key, reactions: reactionsFrom(result?.reactions), rowId })
    } catch (e) {
      if (liveId.current !== sid || reactingTo.current.get(key) !== attempt) return
      const now = transcriptRef.current.items.find(i => i.key === key)
      const others = (now?.kind === 'assistant' ? (now.reactions ?? []) : []).filter(r => r.author !== 'user')
      dispatch({ type: 'reactions', key, reactions: mine ? [...others, mine] : others })
      dispatch({ type: 'notice', text: t("Your reaction wasn't saved. {error}", { error: e instanceof Error ? e.message : String(e) }), tone: 'error' })
    }
  }, [])

  /**
   * The stored page before the chat's drawn rows, drawn above them: the reader
   * scrolling to the top of a chat opened bounded asks for it (longChat.ts). A
   * chat opened whole, or one whose pages are all drawn, does nothing.
   */
  const loadOlder = useCallback(async () => {
    const at = olderNow.current
    const stored = chatRef.current.storedId
    if (!at?.more || !stored || olderLoading.current) return
    olderLoading.current = true
    setLoadingOlder(true)
    const ticket = request.current
    try {
      // A page that draws nothing (hidden rows, or ones the chat already has) reads the one
      // before it, since the reader at the top has no further scroll to ask with.
      let next = at
      for (let page = 0; page < LONG_CHAT_PAGES && next.more; page++) {
        const got = await olderRows((method, path) => gateway.http(method, path), stored, profile, next.offset)
        if (ticket !== request.current) return
        // The chat may have written since: a row the page serves twice is drawn once (transcript.ts).
        next = { offset: next.offset + got.rows.length, more: got.more }
        olderNow.current = next
        setOlder(next)
        const held = transcriptRef.current.items.length
        if (got.rows.length) dispatch({ type: 'older', items: fromHistory(got.rows) })
        if (transcriptRef.current.items.length > held) break
      }
    } catch {
      // The rows stay as they are; the next scroll to the top asks again.
    } finally {
      olderLoading.current = false
      if (ticket === request.current) setLoadingOlder(false)
    }
  }, [profile, dispatch, transcriptRef])

  return {
    transcriptStore,
    chat,
    react,
    loading,
    error,
    send,
    stop,
    command,
    notice,
    setModel,
    setReasoning,
    setSpeed,
    setYolo,
    noteCorrection,
    takeover,
    takeOver,
    respondConnection,
    reissueConnection,
    wakeConnection,
    queue,
    cancelQueued,
    editQueued,
    sendQueuedNow,
    discardLost,
    resendLost,
    loadOlder,
    loadingOlder
  }
}
