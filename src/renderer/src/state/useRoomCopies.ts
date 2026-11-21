import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { ROOM_POLL_MS, mergeEvents, type DriverStatus, type RoomEvent } from './groups'
import {
  ROOM_APPROVALS_CAPABILITY,
  ROOM_COPIES_CAPABILITY,
  ROOM_FORGET_CAPABILITY,
  ROOM_LEAVE_CAPABILITY,
  ROOM_POSTS_CAPABILITY,
  copyStatus,
  isOver,
  roomCopiesClient,
  type CopyApproval,
  type RoomCopy,
  type RoomPost
} from './roomCopies'
import type { RoomApprovalAnswer } from './useGroups'
import { t } from '../../../shared/i18n'
import type { RoomInvite } from './roomInvites'
import { everyWhileVisible } from './visibility'

const client = roomCopiesClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))
/** One empty list, so what's derived from an unserved host's copies keeps its identity between renders. */
const NO_COPIES: RoomCopy[] = []
const NO_APPROVALS: CopyApproval[] = []
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The rooms other people host that this Hermes keeps a copy of, read with
 * Group chats every 30 s while the window shows, for a plugin that keeps them.
 */
export function useRoomCopies(connected: boolean, host: string, capabilities: readonly string[]) {
  const served = capabilities.includes(ROOM_COPIES_CAPABILITY)
  const canForget = served && capabilities.includes(ROOM_FORGET_CAPABILITY)
  const canPost = served && capabilities.includes(ROOM_POSTS_CAPABILITY)
  const canAnswer = capabilities.includes(ROOM_APPROVALS_CAPABILITY)
  const canLeave = served && capabilities.includes(ROOM_LEAVE_CAPABILITY)
  const [copies, setCopies] = useState<RoomCopy[] | null>(null)
  const reads = useRef(0)
  const [approvals, setApprovals] = useState<CopyApproval[]>([])
  const approvalReads = useRef(0)
  const answering = useRef(new Set<string>())
  /** Each answer: on its way, sent, or failed with why; by approval id. A sent one's card goes. */
  const [answers, setAnswers] = useState<Record<string, RoomApprovalAnswer>>({})

  useEffect(() => {
    reads.current++
    approvalReads.current++
    setCopies(null)
    setApprovals([])
    setAnswers({})
  }, [host])

  /** Your agents' approvals; a read that fails keeps what was read last. */
  const refreshApprovals = useCallback(async () => {
    if (!canAnswer) return
    const read = ++approvalReads.current
    try {
      const list = await client.approvals()
      if (read !== approvalReads.current) return
      setApprovals(current => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
      // An answer whose approval is no longer listed needn't be kept.
      const listed = new Set(list.map(a => a.id))
      setAnswers(current => {
        const kept = Object.fromEntries(Object.entries(current).filter(([id]) => listed.has(id)))
        return Object.keys(kept).length === Object.keys(current).length ? current : kept
      })
    } catch {
      // The next read tries again.
    }
  }, [canAnswer])

  const refresh = useCallback(async () => {
    void refreshApprovals()
    const read = ++reads.current
    try {
      const list = await client.list()
      if (read !== reads.current) return
      // Unchanged, nothing re-renders: the open room reads them every few seconds.
      setCopies(current => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
    } catch {
      // The list stays as it was; the next read tries again.
    }
  }, [refreshApprovals])

  useEffect(() => {
    if (!connected || !served) return
    void refresh()
    return everyWhileVisible(() => void refresh(), 30_000)
  }, [connected, served, refresh])

  /**
   * Deletes an ended copy: each of your agents' hidden chats for it, then the
   * copy. Agents that left are only on its invite, so it's read too.
   */
  const remove = useCallback(async (copy: RoomCopy, invite?: RoomInvite) => {
    if (!isOver(copy)) return
    const profiles = [...new Set([...copy.yours.map(a => a.profile), ...(invite?.joined.map(a => a.profile) ?? [])].filter(Boolean))]
    for (const profile of profiles) await client.forgetSessions(copy.roomId, profile)
    await client.forget(copy.roomId)
    reads.current++
    setCopies(current => (current ?? []).filter(c => c.id !== copy.id))
  }, [])

  /** Run or Reject, once: sent, its card goes; refused, the plugin's words, and the list is read again. */
  const answer = useCallback(
    async (approval: CopyApproval, choice: 'once' | 'deny') => {
      if (!approval.choices.includes(choice) || answering.current.has(approval.id)) return
      answering.current.add(approval.id)
      setAnswers(current => ({ ...current, [approval.id]: { state: 'sending' } }))
      try {
        await client.answer(approval, choice)
        setAnswers(current => ({ ...current, [approval.id]: { state: 'sent' } }))
        approvalReads.current++
        setApprovals(current => current.filter(a => a.id !== approval.id))
      } catch (e) {
        setAnswers(current => ({ ...current, [approval.id]: { state: 'failed', message: t('Could not answer: {reason}', { reason: message(e) }) } }))
        void refreshApprovals()
      } finally {
        answering.current.delete(approval.id)
      }
    },
    [refreshApprovals]
  )

  /** All your agents out of a copy; it stays, over for you, to delete when you like. */
  const leave = useCallback(
    async (copy: RoomCopy) => {
      const outcome = await client.leave(copy, null)
      reads.current++
      await refresh()
      return outcome.kind
    },
    [refresh]
  )

  const shownApprovals = useMemo(() => approvals.filter(a => answers[a.id]?.state !== 'sent'), [approvals, answers])

  return {
    served,
    canForget,
    canPost,
    canLeave,
    leave,
    copies: served && copies ? copies : NO_COPIES,
    /** The list has been read here (or isn't served, so there's none to read). */
    loaded: !served || copies !== null,
    refresh,
    remove,
    approvals: served && canAnswer ? shownApprovals : NO_APPROVALS,
    answers,
    answer
  }
}

/** A post of yours this window sent, until the room's log holds it. */
export interface CopyOutgoing {
  eventId: string
  text: string
}

/** One open copy: its log, read in pages and then every few seconds, its status from the copies list, and your posts in it. */
export function useRoomCopy(copy: RoomCopy | null, connected: boolean, refreshCopies: () => Promise<void>) {
  const roomId = copy?.roomId ?? null
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [you, setYou] = useState<string | undefined>(undefined)
  const cursor = useRef(0)
  const ticket = useRef(0)
  const [outbox, setOutbox] = useState<CopyOutgoing[]>([])
  const [posts, setPosts] = useState<Record<string, RoomPost>>({})
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set())
  const outboxRef = useRef(outbox)
  outboxRef.current = outbox

  /** How your Hermes says the waiting posts stand. */
  const readPosts = useCallback(async (id: string, mine: number) => {
    if (!outboxRef.current.length) return
    const list = await client.posts(id)
    if (mine !== ticket.current) return
    setPosts(current => {
      const next = { ...current }
      for (const post of list) next[post.eventId] = post
      return next
    })
  }, [])

  const readLog = useCallback(async (id: string, mine: number) => {
    let more = true
    let fresh: RoomEvent[] = []
    while (more && mine === ticket.current) {
      const page = await client.log(id, cursor.current, 200)
      if (mine !== ticket.current) return
      fresh = fresh.concat(page.events)
      if (page.events.length) cursor.current = Math.max(cursor.current, page.cursor)
      more = page.hasMore && page.events.length > 0
    }
    if (fresh.length && mine === ticket.current) setEvents(current => mergeEvents(current, fresh))
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    cursor.current = 0
    setEvents([])
    setError(null)
    setYou(undefined)
    setOutbox([])
    setPosts({})
    setInFlight(new Set())
    if (!roomId || !connected) return
    setLoading(true)
    void readLog(roomId, mine)
      .catch(e => {
        if (mine === ticket.current) setError(message(e))
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false)
      })
    // What the host calls you, to take it off your own posts; without it they show as the host wrote them.
    void client
      .you(roomId)
      .then(name => mine === ticket.current && setYou(name))
      .catch(() => undefined)
    return everyWhileVisible(() => {
      void readLog(roomId, mine)
        .then(() => mine === ticket.current && setError(null))
        .catch(() => undefined)
      void refreshCopies()
      void readPosts(roomId, mine).catch(() => undefined)
    }, ROOM_POLL_MS)
  }, [roomId, connected, readLog, refreshCopies, readPosts])

  // A post the log now holds, at the seq the host gave it, is no longer waiting.
  useEffect(() => {
    if (!outbox.length) return
    const seqs = new Set(events.map(e => e.seq))
    const kept = outbox.filter(o => {
      const status = posts[o.eventId]?.status
      return !(status?.kind === 'posted' && seqs.has(status.seq))
    })
    if (kept.length !== outbox.length) setOutbox(kept)
  }, [events, posts, outbox])

  /** Posts `text`, or again under `retryId`: the same id never posts twice. */
  const post = useCallback(
    async (value: string, retryId?: string) => {
      const trimmed = value.trim()
      if (!roomId || !trimmed) return
      const mine = ticket.current
      const eventId = retryId ?? crypto.randomUUID()
      setOutbox(current => (current.some(o => o.eventId === eventId) ? current : [...current, { eventId, text: trimmed }]))
      setInFlight(current => new Set(current).add(eventId))
      try {
        const answer = await client.post(roomId, eventId, trimmed)
        if (mine === ticket.current) setPosts(current => ({ ...current, [eventId]: answer }))
      } catch {
        // Not delivered: its row offers to retry under the same id.
      } finally {
        if (mine === ticket.current) {
          setInFlight(current => {
            const next = new Set(current)
            next.delete(eventId)
            return next
          })
        }
      }
      if (mine === ticket.current) await readLog(roomId, mine).catch(() => undefined)
    },
    [roomId, readLog]
  )

  const dismiss = useCallback((eventId: string) => setOutbox(current => current.filter(o => o.eventId !== eventId)), [])

  const status = useMemo<DriverStatus>(() => (copy ? copyStatus(copy) : { working: false, busy: [], disbanded: false, approvals: [] }), [copy])
  return { events, status, loading, error, you, outbox, posts, inFlight, post, dismiss }
}
