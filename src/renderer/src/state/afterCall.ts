/**
 * Requests a live call left unsent when it ended. A call's request for the
 * chat waits while the chat is busy; one still waiting at hang-up was
 * dropped with the call. The person asked for it, so it is sent once the
 * chat is free, as on the phone (hermes-conduit issue 3185; Eric,
 * 2026-11-25). The desktop's call is the chat on screen's, so they go only
 * while that chat stays open: another chat opening drops them. One the chat
 * didn't take drops the rest too, with the notice its send shows, rather
 * than leaving them waiting on a reply that never comes.
 */
export interface AfterCall {
  /** The chat the call was in. */
  chatId: string | null
  requests: string[]
  /** The chat's finished-turn count when the last one went: the next waits for that reply. */
  sentAt: number | null
  /** When that one went: a send no reply follows (a slash command) holds the next only this long. */
  sentWhen: number | null
}

/** A request sent after the call that started no reply is waited on this long, as a call's own is. */
export const AFTER_CALL_STALL_MS = 20_000

/** A call's unsent requests added to what an earlier call left for the same chat. */
export function leftByCall(left: AfterCall | null, chatId: string | null, requests: string[]): AfterCall | null {
  const kept = requests.map(request => request.trim()).filter(Boolean)
  if (!kept.length) return left
  if (left && left.chatId === chatId) return { ...left, requests: [...left.requests, ...kept] }
  return { chatId, requests: kept, sentAt: null, sentWhen: null }
}

/** A chat not made yet: no id, or the placeholder a docked new chat has until its first message. */
const unmade = (chatId: string | null): boolean => chatId === null || chatId.startsWith('new-')

/**
 * The chat a call belongs to, kept from one draw to the next: the chat open
 * when it started, and the id that chat got from the call's first message.
 * Another chat opening ends the call, and what the call leaves as it goes is
 * still its own chat's, never the one that opened.
 */
export function chatOfCall(kept: string | null, wasCalling: boolean, calling: boolean, chatId: string | null): string | null {
  return calling && (!wasCalling || unmade(kept)) ? chatId : kept
}

/** A send the chat didn't take: the rest go with it, unless a later call added to them meanwhile, which try again. */
export function afterFailedSend(left: AfterCall | null, sentFrom: AfterCall | null): AfterCall | null {
  if (!left || left === sentFrom) return null
  return { ...left, sentAt: null, sentWhen: null }
}

export interface AfterCallStep {
  /** The request to send now, as the chat's next message. */
  send?: string
  left: AfterCall | null
}

/**
 * What to do with what a call left. Nothing while a call runs (its own
 * requests have the chat), while a reply runs, or until the reply to the last
 * one sent has ended (or `AFTER_CALL_STALL_MS` passed with no reply started,
 * as after a slash command); all of it is dropped once another chat is open.
 * A new chat getting its id from the first one sent is the same chat.
 */
export function afterCallStep(
  left: AfterCall | null,
  now: { chatId: string | null; calling: boolean; running: boolean; turnsDone: number; at: number }
): AfterCallStep {
  if (!left) return { left: null }
  if (left.chatId !== now.chatId) {
    const made = left.sentAt !== null && unmade(left.chatId) && !unmade(now.chatId)
    if (!made) return { left: null }
    left = { ...left, chatId: now.chatId }
  }
  if (now.calling || now.running) return { left }
  const awaited = left.sentAt === now.turnsDone && (left.sentWhen === null || now.at - left.sentWhen < AFTER_CALL_STALL_MS)
  if (awaited) return { left }
  const [send, ...rest] = left.requests
  if (send === undefined) return { left: null }
  return { send, left: rest.length ? { ...left, requests: rest, sentAt: now.turnsDone, sentWhen: now.at } : null }
}
