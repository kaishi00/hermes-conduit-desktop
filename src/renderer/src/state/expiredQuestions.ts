/**
 * Questions Hermes stopped waiting for, after the phone's (issue 2850,
 * hermes-conduit#2873): a clarify card whose wait ran out (the clarify
 * timeout, an hour by default) or whose turn stopped keeps what it asked and
 * offered, so the person still sees it and can answer in a message instead.
 * One answered on another device (`request.cancel` with reason `resolved`)
 * just goes, as does one the person wrote past (`superseded`: they sent a
 * message instead, which the plugin hands Hermes in its place, hermes-conduit
 * issue 3105). Kept for this run of the app, and a chat's go once the person
 * sends there: the message is their answer.
 */
import { useEffect, useState } from 'react'
import type { PendingRequest } from '../../../shared/ipc'
import { blockquote } from './quote'

export interface ExpiredQuestion {
  request: PendingRequest
  /** Answers locked on this computer before the wait ended, by question id; null skipped. */
  locked: Record<string, string | null>
  /** The wordings of this card's questions the person dismissed: the card stops showing those, and goes once none is left. */
  dismissed?: string[]
}

/**
 * Which chat a dismissed question was asked in, by its live session: the one
 * given, or any but the one given (a question of another chat, dismissed in
 * the Work panel beside this one). Left out, the wording alone decides.
 */
/** `stored` is the saved id of the chat that asked, when the caller knows it. */
export type AskedIn = { live: string; stored?: string } | { notLive: string; stored?: string }

/** The chat on screen beside the Work panel: its saved id, its live session, and whether it's the bot's Bot Chat. */
export interface OpenChat {
  storedId?: string | null
  liveId?: string | null
  botChat?: boolean
}

/** Where a Work panel question was asked, against the chat on screen; `chat` is its saved id, "" the Bot Chat. */
export function askedInOf(chat: string, open?: OpenChat): AskedIn | undefined {
  if (!open?.liveId) return undefined
  const here = chat ? chat === open.storedId : open.botChat === true
  const stored = chat || ''
  return here ? { live: open.liveId, stored } : { notLive: open.liveId, stored }
}

/** The most kept at once, oldest dropped first. */
export const MOST_EXPIRED = 20

/** A chat's saved id to the live session its questions carry, learned when a chat resumes. */
const sessions = new Map<string, string>()

/** The live session of a stored chat, when this window has seen it. */
export function noteChatSession(storedId: string | null | undefined, liveId: string | null | undefined): void {
  if (!storedId || !liveId) return
  sessions.set(storedId, liveId)
}

const seen = new Map<string, PendingRequest>()
const locks = new Map<string, Record<string, string | null>>()
/** Wordings dismissed while their card still waited here, by request id: its `request.cancel` hasn't landed yet. */
const dismissedEarly = new Map<string, string[]>()
let expired: ExpiredQuestion[] = []
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(listener => listener())

/** Every question card the window has shown, so a later `request.cancel` can keep it. */
export function noteRequests(requests: readonly PendingRequest[]): void {
  for (const request of requests) if (request.method === 'clarify') seen.set(request.id, request)
}

/** An answer locked on this card, kept with it should the wait end before the last one. */
export function noteLocked(id: string, qid: string, shown: string | null): void {
  locks.set(id, { ...locks.get(id), [qid]: shown })
}

/** The card stops waiting: kept, with what was locked here. */
export function markExpired(request: PendingRequest, locked: Record<string, string | null> = {}): void {
  seen.delete(request.id)
  // Dismissed before this window heard the wait had ended (a replay after a reconnect, say): those stay gone.
  const dismissed = dismissedEarly.get(request.id) ?? []
  dismissedEarly.delete(request.id)
  if (expired.some(e => e.request.id === request.id)) return
  const all = { ...locks.get(request.id), ...locked }
  locks.delete(request.id)
  if (dismissed.length && asked(request).every(text => dismissed.includes(text))) return
  expired = [...expired, { request, locked: all, ...(dismissed.length ? { dismissed } : {}) }].slice(-MOST_EXPIRED)
  changed()
}

/** A `request.cancel` from Hermes: kept unless another device answered it or the person wrote past it. */
export function takeCancel(payload: unknown): void {
  const { id, reason } = (payload ?? {}) as { id?: unknown; reason?: unknown }
  if (typeof id !== 'string') return
  const request = seen.get(id)
  if (!request) return
  if (reason === 'resolved' || reason === 'superseded') {
    seen.delete(id)
    locks.delete(id)
    dismissedEarly.delete(id)
    return
  }
  markExpired(request)
}

/** The person sent a message in this chat: its kept questions are answered. */
export function clearExpired(sessionId: string | null | undefined): void {
  if (!sessionId || !expired.some(e => e.request.sessionId === sessionId)) return
  expired = expired.filter(e => e.request.sessionId !== sessionId)
  changed()
}

/** What a kept card asked: each of a batch's questions, or its one. */
function asked(request: PendingRequest): string[] {
  const params = request.params ?? {}
  const list = Array.isArray(params.questions) ? params.questions : []
  const texts = list
    .map(q => (q && typeof q === 'object' && typeof (q as Record<string, unknown>).question === 'string' ? ((q as Record<string, unknown>).question as string) : ''))
    .concat(typeof params.question === 'string' ? [params.question] : [])
  return texts.map(text => text.trim()).filter(Boolean)
}

/**
 * The person dismissed a kept question in the Work panel or the asked-question bar (hermes-conduit issue 3105):
 * its card in the chat goes too, so it doesn't still offer to answer a question the bot was told was dismissed.
 * The Work panel's question carries its wording, not the request's id, so the wording matches it, within the
 * chat that asked when the caller knows it: the same words kept in another chat stay, and a batch's other
 * questions stay on their card. A card still waiting here is remembered, so the `request.cancel` that
 * follows doesn't keep what was just dismissed.
 */
export function dropExpiredAsking(text: string, askedIn?: AskedIn): void {
  const wanted = text.trim()
  if (!wanted) return
  const inChat = (request: PendingRequest) => {
    if (!askedIn) return true
    const mapped = askedIn.stored ? sessions.get(askedIn.stored) : undefined
    if ('live' in askedIn) return request.sessionId === (mapped ?? askedIn.live)
    // Without the asking chat's live session, excluding the one on screen is all we can do.
    return mapped ? request.sessionId === mapped : request.sessionId !== askedIn.notLive
  }
  for (const request of seen.values()) {
    if (!inChat(request) || !asked(request).includes(wanted)) continue
    const before = dismissedEarly.get(request.id) ?? []
    if (!before.includes(wanted)) dismissedEarly.set(request.id, [...before, wanted])
  }
  let any = false
  const next = expired.flatMap(entry => {
    const texts = asked(entry.request)
    if (!inChat(entry.request) || !texts.includes(wanted) || entry.dismissed?.includes(wanted)) return [entry]
    any = true
    const dismissed = [...(entry.dismissed ?? []), wanted]
    return texts.every(text => dismissed.includes(text)) ? [] : [{ ...entry, dismissed }]
  })
  if (!any) return
  expired = next
  changed()
}

/** The kept questions of one live chat. */
export function expiredFor(sessionId: string | null | undefined): ExpiredQuestion[] {
  return sessionId ? expired.filter(e => e.request.sessionId === sessionId) : []
}

export function useExpiredQuestions(sessionId: string | null | undefined): ExpiredQuestion[] {
  const [list, setList] = useState(() => expiredFor(sessionId))
  useEffect(() => {
    const update = () => setList(expiredFor(sessionId))
    update()
    listeners.add(update)
    return () => void listeners.delete(update)
  }, [sessionId])
  return list
}

/** What goes in the draft for a tapped choice: the question quoted, the choice under it; just the quote with none. */
export function answering(question: string, answer: string | null): string {
  const quote = blockquote(question)
  if (!quote) return ''
  const reply = answer?.trim() ?? ''
  return reply ? `${quote}\n\n${reply}` : quote
}

/** For tests. */
export function resetExpiredQuestions(): void {
  seen.clear()
  sessions.clear()
  locks.clear()
  dismissedEarly.clear()
  expired = []
  changed()
}
