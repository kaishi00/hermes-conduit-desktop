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
}

/** A call's unsent requests added to what an earlier call left for the same chat. */
export function leftByCall(left: AfterCall | null, chatId: string | null, requests: string[]): AfterCall | null {
  const kept = requests.map(request => request.trim()).filter(Boolean)
  if (!kept.length) return left
  if (left && left.chatId === chatId) return { ...left, requests: [...left.requests, ...kept] }
  return { chatId, requests: kept, sentAt: null }
}

/** A chat not made yet: no id, or the placeholder a docked new chat has until its first message. */
const unmade = (chatId: string | null): boolean => chatId === null || chatId.startsWith('new-')

export interface AfterCallStep {
  /** The request to send now, as the chat's next message. */
  send?: string
  left: AfterCall | null
}

/**
 * What to do with what a call left. Nothing while a call runs (its own
 * requests have the chat), while a reply runs, or until the reply to the last
 * one sent has ended; all of it is dropped once another chat is open. A new
 * chat getting its id from the first one sent is the same chat.
 */
export function afterCallStep(
  left: AfterCall | null,
  now: { chatId: string | null; calling: boolean; running: boolean; turnsDone: number }
): AfterCallStep {
  if (!left) return { left: null }
  if (left.chatId !== now.chatId) {
    const made = left.sentAt !== null && unmade(left.chatId) && !unmade(now.chatId)
    if (!made) return { left: null }
    left = { ...left, chatId: now.chatId }
  }
  if (now.calling || now.running || left.sentAt === now.turnsDone) return { left }
  const [send, ...rest] = left.requests
  if (send === undefined) return { left: null }
  return { send, left: rest.length ? { ...left, requests: rest, sentAt: now.turnsDone } : null }
}
